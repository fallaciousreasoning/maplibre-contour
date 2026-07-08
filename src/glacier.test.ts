import encodeVectorTile, { GeomType } from "./vtpbf";
import { fetchGlacierPolygons, splitLineByGlacier } from "./glacier";
import type { GetTileFunction } from "./types";

function fakeIceTile(
  ring: number[],
  extent = 4096,
  layerName = "land",
  properties: { [k: string]: string | number | boolean } = { kind: "ice" },
) {
  return encodeVectorTile({
    extent,
    layers: {
      [layerName]: {
        features: [
          {
            type: GeomType.POLYGON,
            geometry: [ring],
            properties,
          },
        ],
      },
    },
  });
}

function getTileFor(buffer: Uint8Array): GetTileFunction {
  return async () => ({ data: new Blob([buffer]) });
}

describe("fetchGlacierPolygons", () => {
  const square = [0, 0, 4096, 0, 4096, 4096, 0, 4096, 0, 0];

  test("returns null when no glacierUrlPattern is set", async () => {
    const getTile = jest.fn();
    const result = await fetchGlacierPolygons(
      getTile,
      {},
      10,
      5,
      5,
      4096,
      new AbortController(),
    );
    expect(result).toBeNull();
    expect(getTile).not.toHaveBeenCalled();
  });

  test("returns null when the fetch fails", async () => {
    const getTile: GetTileFunction = async () => {
      throw new Error("network error");
    };
    const result = await fetchGlacierPolygons(
      getTile,
      { glacierUrlPattern: "https://example.com/{z}/{x}/{y}.pbf" },
      10,
      5,
      5,
      4096,
      new AbortController(),
    );
    expect(result).toBeNull();
  });

  test("returns null when the source layer is missing", async () => {
    const buffer = encodeVectorTile({ layers: {} });
    const result = await fetchGlacierPolygons(
      getTileFor(buffer),
      { glacierUrlPattern: "https://example.com/{z}/{x}/{y}.pbf" },
      10,
      5,
      5,
      4096,
      new AbortController(),
    );
    expect(result).toBeNull();
  });

  test("parses matching polygons at the requested zoom", async () => {
    const buffer = fakeIceTile(square);
    const result = await fetchGlacierPolygons(
      getTileFor(buffer),
      { glacierUrlPattern: "https://example.com/{z}/{x}/{y}.pbf" },
      10,
      5,
      5,
      4096,
      new AbortController(),
    );
    expect(result).toEqual([[square]]);
  });

  test("ignores features that don't match the property filter", async () => {
    const buffer = fakeIceTile(square, 4096, "land", { kind: "sand" });
    const result = await fetchGlacierPolygons(
      getTileFor(buffer),
      { glacierUrlPattern: "https://example.com/{z}/{x}/{y}.pbf" },
      10,
      5,
      5,
      4096,
      new AbortController(),
    );
    expect(result).toEqual([]);
  });

  test("respects a custom source layer and property key/value", async () => {
    const buffer = fakeIceTile(square, 4096, "custom", { surface: "glacier" });
    const result = await fetchGlacierPolygons(
      getTileFor(buffer),
      {
        glacierUrlPattern: "https://example.com/{z}/{x}/{y}.pbf",
        glacierSourceLayer: "custom",
        glacierPropertyKey: "surface",
        glacierPropertyValue: "glacier",
      },
      10,
      5,
      5,
      4096,
      new AbortController(),
    );
    expect(result).toEqual([[square]]);
  });

  test("crops and rescales polygons from an overzoomed ancestor tile", async () => {
    // z10 ancestor tile x=4,y=4 covers z12 tiles x=[16..19],y=[16..19]. Tile x=16,y=16 is the
    // top-left child (zero offset within the ancestor), so a full-ancestor ice polygon should
    // reappear scaled up by `div` (4x) with no offset.
    const buffer = fakeIceTile(square);
    const result = await fetchGlacierPolygons(
      getTileFor(buffer),
      {
        glacierUrlPattern: "https://example.com/{z}/{x}/{y}.pbf",
        glacierMaxzoom: 10,
      },
      12,
      16,
      16,
      4096,
      new AbortController(),
    );
    expect(result).toEqual([[square.map((n) => n * 4)]]);
  });
});

describe("splitLineByGlacier", () => {
  const polygon = [[0, 0, 10, 0, 10, 10, 0, 10, 0, 0]];

  test("empty line produces no segments", () => {
    expect(splitLineByGlacier([], [polygon])).toEqual([]);
  });

  test("line entirely outside the glacier stays a single segment", () => {
    const line = [20, 20, 30, 20, 30, 30];
    expect(splitLineByGlacier(line, [polygon])).toEqual([
      { glacier: false, points: line },
    ]);
  });

  test("line entirely inside the glacier stays a single segment", () => {
    const line = [1, 1, 5, 5, 9, 9];
    expect(splitLineByGlacier(line, [polygon])).toEqual([
      { glacier: true, points: line },
    ]);
  });

  test("splits a line that crosses into the glacier once, sharing the boundary vertex", () => {
    const line = [-5, 5, 5, 5];
    const result = splitLineByGlacier(line, [polygon]);
    expect(result).toEqual([
      { glacier: false, points: [-5, 5, 5, 5] },
      { glacier: true, points: [5, 5] },
    ]);
  });

  test("splits a line that dips into the glacier and back out", () => {
    const line = [-5, 5, 5, 5, 15, 5];
    const result = splitLineByGlacier(line, [polygon]);
    expect(result).toEqual([
      { glacier: false, points: [-5, 5, 5, 5] },
      { glacier: true, points: [5, 5, 15, 5] },
      { glacier: false, points: [15, 5] },
    ]);
  });
});
