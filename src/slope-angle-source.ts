import { HeightTile } from "./height-tile";
import { SlopeAngleTile } from "./slope-angle-tile";
import type { DemManager, Timing } from "./types";
import { Timer } from "./performance";

// for maplibre interop
type RequestParameters = {
  url: string;
  headers?: any;
  method?: "GET" | "POST" | "PUT";
  body?: string;
  type?: "string" | "json" | "arrayBuffer" | "image";
  credentials?: "same-origin" | "include";
  collectResourceTiming?: boolean;
};
type ExpiryData = {
  cacheControl?: string | null;
  expires?: Date | string | null;
};
type GetResourceResponse<T> = ExpiryData & {
  data: T;
};
type AddProtocolAction = (
  requestParameters: RequestParameters,
  abortController: AbortController,
) => Promise<GetResourceResponse<ArrayBuffer>>;

// for legacy maplibre-3 interop
type ResponseCallbackV3 = (
  error?: Error | undefined,
  data?: any | undefined,
  cacheControl?: string | undefined,
  expires?: string | undefined,
) => void;
type V3OrV4Protocol = <
  T extends AbortController | ResponseCallbackV3,
  R = T extends AbortController
  ? Promise<GetResourceResponse<ArrayBuffer>>
  : { cancel: () => void },
>(
  requestParameters: RequestParameters,
  arg2: T,
) => R;

const v3compat =
  (v4: AddProtocolAction): V3OrV4Protocol =>
    (requestParameters, arg2) => {
      if (arg2 instanceof AbortController) {
        return v4(requestParameters, arg2) as any;
      } else {
        const abortController = new AbortController();
        v4(requestParameters, abortController)
          .then(
            (result) =>
              arg2(
                undefined,
                result.data,
                result.cacheControl as any,
                result.expires as any,
              ),
            (err) => arg2(err),
          )
          .catch((err) => arg2(err));
        return { cancel: () => abortController.abort() };
      }
    };

const used = new Set<string>();

export interface SlopeAngleOptions {
  /** Maximum slope angle in degrees to map to white (255) in the output */
  maxAngle?: number;
  /** Pixel size in meters for slope calculation (affects gradient scaling) */
  pixelSize?: number;
}

/**
 * A source that generates raster tiles containing slope angle data calculated from DEM tiles.
 */
export class SlopeAngleSource {
  slopeProtocolId: string;
  slopeProtocolUrl: string;
  demManager: DemManager;
  timingCallbacks: Array<(timing: Timing) => void> = [];

  constructor({
    demManager,
    id = "slope",
  }: {
    /** DEM manager to use for fetching elevation data */
    demManager: DemManager;
    /** Prefix for the maplibre protocol */
    id?: string;
  }) {
    let protocolPrefix = id;
    let i = 1;
    while (used.has(protocolPrefix)) {
      protocolPrefix = id + i++;
    }
    used.add(protocolPrefix);
    this.slopeProtocolId = `${protocolPrefix}-slope`;
    this.slopeProtocolUrl = `${this.slopeProtocolId}://{z}/{x}/{y}`;
    this.demManager = demManager;
  }

  /** Registers a callback to be invoked with a performance report after each tile is requested. */
  onTiming = (callback: (timing: Timing) => void) => {
    this.timingCallbacks.push(callback);
  };

  /**
   * Adds slope angle protocol handler to maplibre.
   *
   * @param maplibre maplibre global object
   */
  setupMaplibre = (maplibre: {
    addProtocol: (id: string, protocol: V3OrV4Protocol) => void;
  }) => {
    maplibre.addProtocol(this.slopeProtocolId, this.slopeProtocol);
  };

  parseUrl(url: string): [number, number, number] {
    const [, z, x, y] = /\/\/(\d+)\/(\d+)\/(\d+)/.exec(url) || [];
    return [Number(z), Number(x), Number(y)];
  }

  /**
   * Callback to be used with maplibre addProtocol to generate slope angle raster tiles.
   */
  slopeProtocolV4: AddProtocolAction = async (
    request: RequestParameters,
    abortController: AbortController,
  ) => {
    const timer = new Timer("main");
    let timing: Timing;
    try {
      const [z, x, y] = this.parseUrl(request.url);
      const urlParams = new URLSearchParams(request.url.split('?')[1] || '');
      const maxAngle = parseFloat(urlParams.get('maxAngle') || '45');
      const pixelSize = parseFloat(urlParams.get('pixelSize') || '30');

      // Fetch the center tile and its 8 neighbors for slope calculation
      const neighbors = await Promise.allSettled([
        this.demManager.fetchAndParseTile(z, x - 1, y - 1, abortController), // nw
        this.demManager.fetchAndParseTile(z, x, y - 1, abortController),     // n
        this.demManager.fetchAndParseTile(z, x + 1, y - 1, abortController), // ne
        this.demManager.fetchAndParseTile(z, x - 1, y, abortController),     // w
        this.demManager.fetchAndParseTile(z, x, y, abortController),         // c (center)
        this.demManager.fetchAndParseTile(z, x + 1, y, abortController),     // e
        this.demManager.fetchAndParseTile(z, x - 1, y + 1, abortController), // sw
        this.demManager.fetchAndParseTile(z, x, y + 1, abortController),     // s
        this.demManager.fetchAndParseTile(z, x + 1, y + 1, abortController), // se
      ]);

      // Convert results to HeightTiles (undefined for failed fetches)
      const heightTiles = neighbors.map(result => {
        if (result.status === "fulfilled") {
          return HeightTile.fromRawDem(result.value);
        }
        return undefined;
      });

      // Combine neighbors into a single HeightTile that can access boundary pixels
      const combinedHeightTile = HeightTile.combineNeighbors(heightTiles);
      
      if (!combinedHeightTile) {
        throw new Error("Center tile is required but was not available");
      }

      // Generate slope angle tile
      const slopeAngleTile = SlopeAngleTile.fromHeightTile(combinedHeightTile, pixelSize);
      
      // Convert to image buffer
      const imageBuffer = slopeAngleTile.toImageBuffer(maxAngle);

      // Convert to ArrayBuffer for maplibre
      const arrayBuffer: ArrayBuffer = imageBuffer.buffer.slice(
        imageBuffer.byteOffset,
        imageBuffer.byteOffset + imageBuffer.byteLength
      ) as ArrayBuffer;

      timing = timer.finish(request.url);
      return { 
        data: arrayBuffer,
        cacheControl: "public, max-age=3600",
        expires: new Date(Date.now() + 3600 * 1000),
      };
    } catch (error) {
      timing = timer.error(request.url);
      throw error;
    } finally {
      this.timingCallbacks.forEach((cb) => cb(timing));
    }
  };

  slopeProtocol: V3OrV4Protocol = v3compat(this.slopeProtocolV4);

  /**
   * Returns a URL with the correct maplibre protocol prefix and options encoded in request parameters.
   */
  getSlopeProtocolUrl = (options: SlopeAngleOptions = {}) => {
    const params = new URLSearchParams();
    if (options.maxAngle !== undefined) {
      params.set('maxAngle', options.maxAngle.toString());
    }
    if (options.pixelSize !== undefined) {
      params.set('pixelSize', options.pixelSize.toString());
    }
    const queryString = params.toString();
    return `${this.slopeProtocolUrl}${queryString ? '?' + queryString : ''}`;
  };
}