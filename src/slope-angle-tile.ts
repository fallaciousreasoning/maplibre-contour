import type { HeightTile } from "./height-tile";

/**
 * A tile containing slope angle values calculated from elevation data.
 * Slope angles are in degrees (0-90°).
 */
export class SlopeAngleTile {
  get: (x: number, y: number) => number;
  width: number;
  height: number;

  constructor(
    width: number,
    height: number,
    get: (x: number, y: number) => number,
  ) {
    this.get = get;
    this.width = width;
    this.height = height;
  }

  /**
   * Construct a slope angle tile from a HeightTile with neighboring tiles.
   * The HeightTile should be constructed using HeightTile.combineNeighbors
   * so that boundary pixels can access neighboring elevation data.
   * 
   * @param heightTile - HeightTile with access to neighboring elevation data
   * @param pixelSize - Size of one pixel in meters (for calculating gradients)
   */
  static fromHeightTile(
    heightTile: HeightTile,
    pixelSize: number = 30, // Default for 30m resolution DEM
  ): SlopeAngleTile {
    return new SlopeAngleTile(heightTile.width, heightTile.height, (x, y) => {
      // Skip border pixels since we don't want to output slope angles for them
      // but we can use them in calculations for interior pixels
      if (x < 0 || x >= heightTile.width || y < 0 || y >= heightTile.height) {
        return NaN;
      }

      // Get elevation values for the 3x3 neighborhood
      // Using Horn's method for slope calculation
      const z1 = heightTile.get(x - 1, y - 1); // top-left
      const z2 = heightTile.get(x, y - 1);     // top-center
      const z3 = heightTile.get(x + 1, y - 1); // top-right
      const z4 = heightTile.get(x - 1, y);     // middle-left
      const z6 = heightTile.get(x + 1, y);     // middle-right
      const z7 = heightTile.get(x - 1, y + 1); // bottom-left
      const z8 = heightTile.get(x, y + 1);     // bottom-center
      const z9 = heightTile.get(x + 1, y + 1); // bottom-right

      // Check if we have valid elevation data for all neighbors
      const values = [z1, z2, z3, z4, z6, z7, z8, z9];
      if (values.some(v => isNaN(v))) {
        return NaN;
      }

      // Calculate gradients using Horn's method
      // dz/dx = ((z3 + 2*z6 + z9) - (z1 + 2*z4 + z7)) / (8 * pixelSize)
      const dzdx = ((z3 + 2 * z6 + z9) - (z1 + 2 * z4 + z7)) / (8 * pixelSize);
      
      // dz/dy = ((z7 + 2*z8 + z9) - (z1 + 2*z2 + z3)) / (8 * pixelSize)
      const dzdy = ((z7 + 2 * z8 + z9) - (z1 + 2 * z2 + z3)) / (8 * pixelSize);

      // Calculate slope angle in radians, then convert to degrees
      const slopeRadians = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
      const slopeDegrees = (slopeRadians * 180) / Math.PI;

      return slopeDegrees;
    });
  }

  /**
   * Convert slope angle values to a grayscale image buffer for use as a raster tile.
   * @param maxAngle - Maximum angle to map to white (255). Angles above this are clamped.
   * @returns Uint8Array representing RGBA pixels
   */
  toImageBuffer(maxAngle: number = 45): Uint8Array {
    const buffer = new Uint8Array(this.width * this.height * 4); // RGBA
    let bufferIdx = 0;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const angle = this.get(x, y);
        
        let pixelValue = 0;
        if (!isNaN(angle)) {
          // Map angle from 0-maxAngle to 0-255
          pixelValue = Math.round(Math.min(angle / maxAngle, 1) * 255);
        }

        // Set RGBA values (grayscale with full opacity)
        buffer[bufferIdx++] = pixelValue; // R
        buffer[bufferIdx++] = pixelValue; // G
        buffer[bufferIdx++] = pixelValue; // B
        buffer[bufferIdx++] = isNaN(angle) ? 0 : 255; // A (transparent for NaN)
      }
    }

    return buffer;
  }

  /**
   * Precompute every value and serve them out of a Float32Array for performance.
   */
  materialize = (): SlopeAngleTile => {
    const data = new Float32Array(this.width * this.height);
    let idx = 0;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        data[idx++] = this.get(x, y);
      }
    }
    return new SlopeAngleTile(
      this.width,
      this.height,
      (x, y) => data[y * this.width + x],
    );
  };
}