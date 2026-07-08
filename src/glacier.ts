import Pbf from "pbf";
import { VectorTile } from "@mapbox/vector-tile";
import type { GetTileFunction } from "./types";

/** A list of polygons, each a list of rings, each ring a flat `[x1, y1, x2, y2, ...]` array. */
export type GlacierPolygons = number[][][];

export interface GlacierOptions {
  glacierUrlPattern?: string;
  glacierSourceLayer?: string;
  glacierPropertyKey?: string;
  glacierPropertyValue?: string;
  glacierMaxzoom?: number;
}

/**
 * Fetches and decodes the glacier polygons that overlap contour tile `z/x/y`, in the same
 * pixel coordinate space that `generateIsolines` produces (`0..extent`).
 *
 * Returns `null` if no glacier source is configured, the tile has no matching layer/features,
 * or the fetch/decode fails for any reason - callers should treat that as "don't split lines".
 */
export async function fetchGlacierPolygons(
  getTile: GetTileFunction,
  options: GlacierOptions,
  z: number,
  x: number,
  y: number,
  extent: number,
  abortController: AbortController,
): Promise<GlacierPolygons | null> {
  const { glacierUrlPattern } = options;
  if (!glacierUrlPattern) return null;

  const sourceLayer = options.glacierSourceLayer || "land";
  const propertyKey = options.glacierPropertyKey || "kind";
  const propertyValue = options.glacierPropertyValue ?? "ice";
  const maxzoom = options.glacierMaxzoom ?? z;

  const zoom = Math.min(z, maxzoom);
  const subZ = z - zoom;
  const div = 1 << subZ;
  const tileX = Math.floor(x / div);
  const tileY = Math.floor(y / div);

  const url = glacierUrlPattern
    .replace("{z}", zoom.toString())
    .replace("{x}", tileX.toString())
    .replace("{y}", tileY.toString());

  try {
    const response = await getTile(url, abortController);
    const buffer = await response.data.arrayBuffer();
    const tile = new VectorTile(new Pbf(new Uint8Array(buffer)));
    const layer = tile.layers[sourceLayer];
    if (!layer) return null;

    // scale from this (possibly overzoomed) glacier tile's pixel space into the contour tile's
    // extent-space: normalize by the source layer's own extent, then zoom in `div`x and offset
    // to the sub-quadrant that this contour tile occupies within its ancestor.
    const scale = (extent / layer.extent) * div;
    const offsetX = (x % div) * extent;
    const offsetY = (y % div) * extent;

    const polygons: GlacierPolygons = [];
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      if (feature.type !== 3 /* Polygon */) continue;
      if (feature.properties[propertyKey] !== propertyValue) continue;

      polygons.push(
        feature.loadGeometry().map((ring) => {
          const flat: number[] = [];
          for (const point of ring) {
            flat.push(point.x * scale - offsetX, point.y * scale - offsetY);
          }
          return flat;
        }),
      );
    }
    return polygons;
  } catch {
    return null;
  }
}

function pointInRing(x: number, y: number, ring: number[]): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2];
    const yi = ring[i * 2 + 1];
    const xj = ring[j * 2];
    const yj = ring[j * 2 + 1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(x: number, y: number, rings: number[][]): boolean {
  let inside = false;
  for (const ring of rings) {
    if (pointInRing(x, y, ring)) inside = !inside;
  }
  return inside;
}

function isInGlacier(x: number, y: number, polygons: GlacierPolygons): boolean {
  for (const polygon of polygons) {
    if (pointInPolygon(x, y, polygon)) return true;
  }
  return false;
}

/**
 * Splits a contour line (flat `[x1, y1, x2, y2, ...]`) into runs that are each entirely inside
 * or outside `polygons`, snapping transitions to the nearest existing vertex so no new points
 * are interpolated. Consecutive runs share their boundary vertex so there's no visual gap.
 */
export function splitLineByGlacier(
  line: number[],
  polygons: GlacierPolygons,
): { glacier: boolean; points: number[] }[] {
  const n = line.length / 2;
  if (n === 0) return [];

  const result: { glacier: boolean; points: number[] }[] = [];
  let currentGlacier = isInGlacier(line[0], line[1], polygons);
  let current: number[] = [line[0], line[1]];

  for (let i = 1; i < n; i++) {
    const x = line[i * 2];
    const y = line[i * 2 + 1];
    const glacier = isInGlacier(x, y, polygons);
    current.push(x, y);
    if (glacier !== currentGlacier) {
      result.push({ glacier: currentGlacier, points: current });
      current = [x, y];
      currentGlacier = glacier;
    }
  }
  result.push({ glacier: currentGlacier, points: current });
  return result;
}
