import { flattenDeep } from "lodash";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { LocalDemManager } from "./local-dem-manager";
import type { DemTile } from "./types";
import encodeVectorTile, { GeomType } from "./vtpbf";

// Same 4x4 "hill" DEM used in e2e.test.ts: a level-10 contour traces one closed ring roughly
// centered in the tile, entirely within its interior (nowhere near the tile edges).
const heightData: DemTile = {
  data: Float32Array.from(
    flattenDeep([
      [5, 5, 5, 5],
      [5, 15, 15, 5],
      [5, 15, 15, 5],
      [5, 5, 5, 5],
    ]),
  ),
  width: 4,
  height: 4,
};

function fakeIceTile(ring: number[]) {
  return encodeVectorTile({
    extent: 4096,
    layers: {
      land: {
        features: [
          {
            type: GeomType.POLYGON,
            geometry: [ring],
            properties: { kind: "ice" },
          },
        ],
      },
    },
  });
}

function makeManager(getTile: LocalDemManager["getTile"]) {
  return new LocalDemManager({
    demUrlPattern: "https://example.com/{z}/{x}/{y}.png",
    cacheSize: 100,
    encoding: "terrarium",
    maxzoom: 11,
    timeoutMs: 10000,
    decodeImage: async () => heightData,
    getTile,
  });
}

const wholeTileIce = [0, 0, 4096, 0, 4096, 4096, 0, 4096, 0, 0];
const tinyIceInCorner = [0, 0, 8, 0, 8, 8, 0, 8, 0, 0];

test("contour lines aren't tagged when no glacier source is configured", async () => {
  const manager = makeManager(async () => ({ data: new Blob([]) }));

  const result = await manager.fetchContourTile(
    10,
    20,
    30,
    { levels: [10], buffer: 0 },
    new AbortController(),
  );

  const tile = new VectorTile(new Pbf(new Uint8Array(result.arrayBuffer)));
  expect(tile.layers.contours.length).toBe(1);
  expect(tile.layers.contours.feature(0).properties).not.toHaveProperty(
    "glacier",
  );
});

test("contour lines are tagged glacier:true when fully inside the ice polygon", async () => {
  const iceTileBuffer = fakeIceTile(wholeTileIce);
  const manager = makeManager(async (url) =>
    url.endsWith(".pbf")
      ? { data: new Blob([iceTileBuffer]) }
      : { data: new Blob([]) },
  );

  const result = await manager.fetchContourTile(
    10,
    20,
    30,
    {
      levels: [10],
      buffer: 0,
      glacierUrlPattern: "https://example.com/glacier/{z}/{x}/{y}.pbf",
    },
    new AbortController(),
  );

  const tile = new VectorTile(new Pbf(new Uint8Array(result.arrayBuffer)));
  expect(tile.layers.contours.length).toBe(1);
  expect(tile.layers.contours.feature(0).properties).toMatchObject({
    glacier: true,
  });
});

test("contour lines are tagged glacier:false when outside the ice polygon", async () => {
  const iceTileBuffer = fakeIceTile(tinyIceInCorner);
  const manager = makeManager(async (url) =>
    url.endsWith(".pbf")
      ? { data: new Blob([iceTileBuffer]) }
      : { data: new Blob([]) },
  );

  const result = await manager.fetchContourTile(
    10,
    20,
    30,
    {
      levels: [10],
      buffer: 0,
      glacierUrlPattern: "https://example.com/glacier/{z}/{x}/{y}.pbf",
    },
    new AbortController(),
  );

  const tile = new VectorTile(new Pbf(new Uint8Array(result.arrayBuffer)));
  expect(tile.layers.contours.length).toBe(1);
  expect(tile.layers.contours.feature(0).properties).toMatchObject({
    glacier: false,
  });
});

test("falls back to untagged lines when the glacier tile fetch fails", async () => {
  const manager = makeManager(async (url) => {
    if (url.endsWith(".pbf")) throw new Error("network error");
    return { data: new Blob([]) };
  });

  const result = await manager.fetchContourTile(
    10,
    20,
    30,
    {
      levels: [10],
      buffer: 0,
      glacierUrlPattern: "https://example.com/glacier/{z}/{x}/{y}.pbf",
    },
    new AbortController(),
  );

  const tile = new VectorTile(new Pbf(new Uint8Array(result.arrayBuffer)));
  expect(tile.layers.contours.length).toBe(1);
  expect(tile.layers.contours.feature(0).properties).not.toHaveProperty(
    "glacier",
  );
});

test("falls back to untagged lines when the configured source layer is missing", async () => {
  const emptyTileBuffer = encodeVectorTile({ layers: {} });
  const manager = makeManager(async (url) =>
    url.endsWith(".pbf")
      ? { data: new Blob([emptyTileBuffer]) }
      : { data: new Blob([]) },
  );

  const result = await manager.fetchContourTile(
    10,
    20,
    30,
    {
      levels: [10],
      buffer: 0,
      glacierUrlPattern: "https://example.com/glacier/{z}/{x}/{y}.pbf",
    },
    new AbortController(),
  );

  const tile = new VectorTile(new Pbf(new Uint8Array(result.arrayBuffer)));
  expect(tile.layers.contours.length).toBe(1);
  expect(tile.layers.contours.feature(0).properties).not.toHaveProperty(
    "glacier",
  );
});
