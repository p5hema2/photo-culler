/**
 * Quality scoring Web Worker.
 * Receives image data as ArrayBuffer, computes sharpness, exposure, contrast,
 * and noise scores using OffscreenCanvas + getImageData pixel analysis.
 * Posts back a composite quality score (0-100) and individual metric scores.
 */

export interface ScoringRequest {
  path: string;
  buffer: ArrayBuffer;
}

export interface ScoringResult {
  path: string;
  qualityScore: number;
  sharpness: number;
  exposure: number;
  contrast: number;
  noise: number;
}

const TARGET_SIZE = 800;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Sharpness via Laplacian variance (weight 0.40).
 * Higher variance = sharper image.
 */
function computeSharpness(gray: Float32Array, width: number, height: number): number {
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const lap =
        4 * gray[idx]! -
        gray[(y - 1) * width + x]! -
        gray[(y + 1) * width + x]! -
        gray[y * width + (x - 1)]! -
        gray[y * width + (x + 1)]!;
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  if (count === 0) return 50;

  const mean = sum / count;
  const variance = sumSq / count - mean * mean;

  // Normalize: variance / 20, clamped to 0-100
  return clamp(variance / 20, 0, 100);
}

/**
 * Exposure score from luminance histogram (weight 0.25).
 * Penalizes deviation from midpoint (128) and clipped pixels.
 */
function computeExposure(gray: Float32Array, width: number, height: number): number {
  const histogram = new Uint32Array(256);
  const totalPixels = width * height;

  let lumSum = 0;
  let clippedCount = 0;

  for (let i = 0; i < totalPixels; i++) {
    const lum = Math.round(clamp(gray[i]!, 0, 255));
    histogram[lum]!;
    histogram[lum]++;
    lumSum += gray[i]!;

    if (gray[i]! < 5 || gray[i]! > 250) {
      clippedCount++;
    }
  }

  const meanLum = lumSum / totalPixels;
  const clipPercent = (clippedCount / totalPixels) * 100;

  // Score: 100 - deviation penalty - clipping penalty
  const deviationPenalty = (Math.abs(meanLum - 128) / 128) * 50;
  const clippingPenalty = clamp(clipPercent - 15, 0, 85) * 0.5;

  return clamp(100 - deviationPenalty - clippingPenalty, 0, 100);
}

/**
 * Contrast score from luminance standard deviation (weight 0.20).
 * Sweet spot: stddev 40-80 scores 100.
 */
function computeContrast(gray: Float32Array, width: number, height: number): number {
  const totalPixels = width * height;
  let sum = 0;
  let sumSq = 0;

  for (let i = 0; i < totalPixels; i++) {
    const val = gray[i]!;
    sum += val;
    sumSq += val * val;
  }

  const mean = sum / totalPixels;
  const variance = sumSq / totalPixels - mean * mean;
  const stddev = Math.sqrt(Math.max(0, variance));

  if (stddev >= 40 && stddev <= 80) {
    return 100;
  } else if (stddev < 40) {
    // Linear ramp from 0 (stddev=0) to 100 (stddev=40)
    return (stddev / 40) * 100;
  } else {
    // Above 80: gentle penalty, clamped to 50-100
    return clamp(100 - (stddev - 80) * 0.3, 50, 100);
  }
}

/**
 * Noise score from variance in flat regions (weight 0.15).
 * Samples random 8x8 patches with low Laplacian variance (flat regions).
 * Low noise in flat regions = high score.
 */
function computeNoise(gray: Float32Array, width: number, height: number): number {
  if (width < 16 || height < 16) return 50;

  const patchSize = 8;
  const maxPatchX = width - patchSize;
  const maxPatchY = height - patchSize;
  const candidateCount = 80; // Sample many candidates to find flat regions
  const targetFlat = 18; // Want 16-20 flat patches

  // Deterministic seed based on image dimensions for reproducibility
  let seed = width * 7919 + height * 104729;
  const pseudoRandom = (): number => {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  // Collect candidate patches with their Laplacian variance
  const candidates: Array<{ patchVariance: number }> = [];

  for (let c = 0; c < candidateCount; c++) {
    const px = Math.floor(pseudoRandom() * maxPatchX);
    const py = Math.floor(pseudoRandom() * maxPatchY);

    // Compute Laplacian variance for this patch (to identify flat regions)
    let lapSum = 0;
    let lapSumSq = 0;
    let lapCount = 0;

    // Also compute pixel variance for noise estimation
    let pixSum = 0;
    let pixSumSq = 0;
    let pixCount = 0;

    for (let dy = 1; dy < patchSize - 1; dy++) {
      for (let dx = 1; dx < patchSize - 1; dx++) {
        const idx = (py + dy) * width + (px + dx);
        const lap =
          4 * gray[idx]! -
          gray[(py + dy - 1) * width + (px + dx)]! -
          gray[(py + dy + 1) * width + (px + dx)]! -
          gray[(py + dy) * width + (px + dx - 1)]! -
          gray[(py + dy) * width + (px + dx + 1)]!;
        lapSum += lap;
        lapSumSq += lap * lap;
        lapCount++;
      }
    }

    for (let dy = 0; dy < patchSize; dy++) {
      for (let dx = 0; dx < patchSize; dx++) {
        const val = gray[(py + dy) * width + (px + dx)]!;
        pixSum += val;
        pixSumSq += val * val;
        pixCount++;
      }
    }

    const lapMean = lapSum / lapCount;
    const lapVariance = lapSumSq / lapCount - lapMean * lapMean;

    // Only consider flat patches (low Laplacian variance)
    if (lapVariance < 200) {
      const pixMean = pixSum / pixCount;
      const patchVariance = pixSumSq / pixCount - pixMean * pixMean;
      candidates.push({ patchVariance });
    }
  }

  if (candidates.length === 0) {
    // No flat regions found -- assume moderate noise
    return 50;
  }

  // Take the best flat patches (lowest Laplacian variance, up to targetFlat)
  const selected = candidates.slice(0, targetFlat);
  const meanVariance = selected.reduce((acc, p) => acc + p.patchVariance, 0) / selected.length;

  // Inverse normalize: low variance = low noise = high score
  return clamp(100 - meanVariance * 2, 0, 100);
}

self.onmessage = async (event: MessageEvent<ScoringRequest>) => {
  const { path, buffer } = event.data;

  try {
    const blob = new Blob([buffer]);
    let bitmap = await createImageBitmap(blob);

    // Downscale to ~TARGET_SIZE px longest side
    const longest = Math.max(bitmap.width, bitmap.height);
    let drawWidth = bitmap.width;
    let drawHeight = bitmap.height;

    if (longest > TARGET_SIZE) {
      const scale = TARGET_SIZE / longest;
      drawWidth = Math.round(bitmap.width * scale);
      drawHeight = Math.round(bitmap.height * scale);
      const resized = await createImageBitmap(blob, {
        resizeWidth: drawWidth,
        resizeHeight: drawHeight,
      });
      bitmap.close();
      bitmap = resized;
    }

    const canvas = new OffscreenCanvas(drawWidth, drawHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      throw new Error('Could not get 2d context');
    }

    ctx.drawImage(bitmap, 0, 0, drawWidth, drawHeight);
    bitmap.close();

    const imageData = ctx.getImageData(0, 0, drawWidth, drawHeight);
    const pixels = imageData.data;

    // Convert to grayscale
    const gray = new Float32Array(drawWidth * drawHeight);
    for (let i = 0; i < gray.length; i++) {
      gray[i] = 0.299 * pixels[i * 4]! + 0.587 * pixels[i * 4 + 1]! + 0.114 * pixels[i * 4 + 2]!;
    }

    const sharpness = computeSharpness(gray, drawWidth, drawHeight);
    const exposure = computeExposure(gray, drawWidth, drawHeight);
    const contrast = computeContrast(gray, drawWidth, drawHeight);
    const noise = computeNoise(gray, drawWidth, drawHeight);

    const composite = sharpness * 0.4 + exposure * 0.25 + contrast * 0.2 + noise * 0.15;
    const qualityScore = Math.round(clamp(composite, 0, 100));

    self.postMessage({
      path,
      qualityScore,
      sharpness: Math.round(sharpness),
      exposure: Math.round(exposure),
      contrast: Math.round(contrast),
      noise: Math.round(noise),
    } as ScoringResult);
  } catch {
    // On error, return neutral scores
    self.postMessage({
      path,
      qualityScore: 50,
      sharpness: 50,
      exposure: 50,
      contrast: 50,
      noise: 50,
    } as ScoringResult);
  }
};
