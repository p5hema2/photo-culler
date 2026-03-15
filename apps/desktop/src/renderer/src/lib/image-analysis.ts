/**
 * Shared pixel analysis utilities for focus peaking and exposure clipping overlays.
 */

/**
 * Sobel edge detection on grayscale image data.
 * Edge pixels (gradient magnitude > threshold) are cyan rgba(0, 255, 255, 180).
 * Non-edge pixels are transparent rgba(0, 0, 0, 0).
 */
export function computeSobelEdges(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 30,
): ImageData {
  const output = new Uint8ClampedArray(width * height * 4);

  // Convert to grayscale first
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = pixels[i * 4]!;
    const g = pixels[i * 4 + 1]!;
    const b = pixels[i * 4 + 2]!;
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // Sobel kernels
  // Gx: [-1 0 1; -2 0 2; -1 0 1]
  // Gy: [-1 -2 -1; 0 0 0; 1 2 1]
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const tl = gray[(y - 1) * width + (x - 1)]!;
      const tc = gray[(y - 1) * width + x]!;
      const tr = gray[(y - 1) * width + (x + 1)]!;
      const ml = gray[y * width + (x - 1)]!;
      const mr = gray[y * width + (x + 1)]!;
      const bl = gray[(y + 1) * width + (x - 1)]!;
      const bc = gray[(y + 1) * width + x]!;
      const br = gray[(y + 1) * width + (x + 1)]!;

      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      const magnitude = Math.sqrt(gx * gx + gy * gy);

      const idx = (y * width + x) * 4;
      if (magnitude > threshold) {
        output[idx] = 0; // R
        output[idx + 1] = 255; // G
        output[idx + 2] = 255; // B
        output[idx + 3] = 180; // A
      }
      // else remains 0,0,0,0 (transparent)
    }
  }

  return new ImageData(output, width, height);
}

/**
 * Exposure clipping overlay.
 * Blown highlights: any channel > 250 AND luminance > 240 -> red rgba(255, 0, 0, 180)
 * Crushed shadows: luminance < 10 -> blue rgba(0, 0, 255, 180)
 * Non-clipped pixels are transparent.
 */
export function computeClippingOverlay(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): ImageData {
  const output = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const r = pixels[i * 4]!;
    const g = pixels[i * 4 + 1]!;
    const b = pixels[i * 4 + 2]!;
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

    const idx = i * 4;
    if ((r > 250 || g > 250 || b > 250) && luminance > 240) {
      // Blown highlights - red
      output[idx] = 255;
      output[idx + 1] = 0;
      output[idx + 2] = 0;
      output[idx + 3] = 180;
    } else if (luminance < 10) {
      // Crushed shadows - blue
      output[idx] = 0;
      output[idx + 1] = 0;
      output[idx + 2] = 255;
      output[idx + 3] = 180;
    }
    // else remains transparent
  }

  return new ImageData(output, width, height);
}
