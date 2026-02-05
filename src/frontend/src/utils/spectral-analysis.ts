/**
 * Spectral Analysis Utilities for Dynamic Overlap Calculation.
 *
 * Calculates spectral distance between audio samples at join points to
 * dynamically adjust crossfade/overlap duration. When consecutive samples
 * have mismatched spectral envelopes, longer crossfades produce smoother
 * transitions.
 *
 * Algorithm approach:
 * 1. Extract analysis regions from end of buffer A and start of buffer B
 * 2. Compute magnitude spectra using FFT
 * 3. Calculate spectral distance using spectral centroid difference and
 *    log magnitude Euclidean distance
 * 4. Map distance to recommended overlap duration
 *
 * @example
 * ```typescript
 * const result = calculateSpectralDistance(bufferA, bufferB);
 * console.log(`Spectral distance: ${result.distance}`);
 * console.log(`Recommended overlap: ${result.recommendedOverlapMs}ms`);
 * ```
 */

import { fftSplit as fft } from './fft.js';

/**
 * Options for spectral distance calculation.
 */
export interface SpectralDistanceOptions {
  /**
   * FFT window size in samples (default: 2048).
   * Larger windows give better frequency resolution but worse time resolution.
   */
  windowSize?: number;

  /**
   * Hop size between frames in samples (default: 512).
   * Smaller hops give more frames for averaging.
   */
  hopSize?: number;

  /**
   * Region to analyze at the join point in milliseconds (default: 50ms).
   * Extracts this duration from the end of buffer A and start of buffer B.
   */
  analysisRegionMs?: number;

  /**
   * Base overlap duration in milliseconds (default: 30ms).
   * Minimum overlap used when spectral distance is low.
   */
  baseOverlapMs?: number;

  /**
   * Maximum additional overlap in milliseconds (default: 70ms).
   * Added to base overlap proportionally to spectral distance.
   * Total max overlap = baseOverlapMs + maxAdditionalOverlapMs
   */
  maxAdditionalOverlapMs?: number;

  /**
   * Weight for spectral centroid difference in overall distance (default: 0.4).
   * Higher values emphasize brightness differences.
   */
  centroidWeight?: number;

  /**
   * Weight for log magnitude distance in overall distance (default: 0.4).
   * Higher values emphasize overall spectral shape differences.
   */
  magnitudeWeight?: number;

  /**
   * Weight for energy difference in overall distance (default: 0.2).
   * Higher values emphasize loudness differences.
   */
  energyWeight?: number;
}

/**
 * Result of spectral distance calculation.
 */
export interface SpectralDistanceResult {
  /**
   * Normalized spectral distance (0-1).
   * 0 = identical spectra, 1 = maximally different spectra.
   */
  distance: number;

  /**
   * Recommended overlap duration based on spectral distance in milliseconds.
   * Formula: baseOverlapMs + distance * maxAdditionalOverlapMs
   */
  recommendedOverlapMs: number;

  /**
   * Difference in spectral centroid (brightness) normalized to 0-1.
   * Higher values indicate more brightness mismatch.
   */
  spectralCentroidDiff: number;

  /**
   * Difference in energy/loudness normalized to 0-1.
   * Higher values indicate more loudness mismatch.
   */
  energyDiff: number;

  /**
   * Log magnitude spectrum Euclidean distance normalized to 0-1.
   * Higher values indicate more overall spectral shape mismatch.
   */
  magnitudeDistance: number;
}

/**
 * Default options for spectral distance calculation.
 */
const DEFAULT_OPTIONS: Required<SpectralDistanceOptions> = {
  windowSize: 2048,
  hopSize: 512,
  analysisRegionMs: 50,
  baseOverlapMs: 30,
  maxAdditionalOverlapMs: 70,
  centroidWeight: 0.4,
  magnitudeWeight: 0.4,
  energyWeight: 0.2,
};

/**
 * Compute magnitude spectrum from time-domain samples.
 *
 * Applies a Hann window and computes FFT to get magnitude spectrum.
 * Only returns the first half (positive frequencies).
 *
 * @param samples - Time-domain audio samples
 * @param windowSize - FFT window size (must be power of 2)
 * @returns Magnitude spectrum (length = windowSize / 2)
 */
function computeMagnitudeSpectrum(
  samples: Float32Array,
  windowSize: number
): Float32Array {
  const real = new Float32Array(windowSize);
  const imag = new Float32Array(windowSize);

  // Apply Hann window and copy samples
  const len = Math.min(samples.length, windowSize);
  for (let i = 0; i < len; i++) {
    // Hann window: 0.5 * (1 - cos(2*pi*i/(N-1)))
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowSize - 1)));
    real[i] = samples[i] * window;
  }

  // Zero-pad if samples shorter than window
  for (let i = len; i < windowSize; i++) {
    real[i] = 0;
  }

  // Compute FFT
  fft(real, imag);

  // Compute magnitude spectrum (only positive frequencies)
  const halfSize = windowSize >> 1;
  const magnitude = new Float32Array(halfSize);

  for (let i = 0; i < halfSize; i++) {
    magnitude[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
  }

  return magnitude;
}

/**
 * Compute spectral centroid from magnitude spectrum.
 *
 * Spectral centroid is the "center of mass" of the spectrum,
 * indicating the perceived brightness of the sound.
 *
 * Formula: sum(f * M(f)) / sum(M(f))
 *
 * @param magnitude - Magnitude spectrum
 * @param sampleRate - Audio sample rate in Hz
 * @param windowSize - FFT window size
 * @returns Spectral centroid in Hz
 */
function computeSpectralCentroid(
  magnitude: Float32Array,
  sampleRate: number,
  windowSize: number
): number {
  let weightedSum = 0;
  let totalMagnitude = 0;

  const binWidth = sampleRate / windowSize;

  for (let i = 0; i < magnitude.length; i++) {
    const frequency = i * binWidth;
    weightedSum += frequency * magnitude[i];
    totalMagnitude += magnitude[i];
  }

  if (totalMagnitude < 1e-10) {
    return 0;
  }

  return weightedSum / totalMagnitude;
}

/**
 * Compute RMS energy of samples.
 *
 * @param samples - Audio samples
 * @returns RMS energy value
 */
function computeEnergy(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Compute log magnitude spectrum for comparison.
 *
 * Applies log transform with floor to avoid log(0).
 *
 * @param magnitude - Magnitude spectrum
 * @returns Log magnitude spectrum
 */
function computeLogMagnitude(magnitude: Float32Array): Float32Array {
  const logMag = new Float32Array(magnitude.length);
  const floor = 1e-10;

  for (let i = 0; i < magnitude.length; i++) {
    logMag[i] = Math.log(Math.max(magnitude[i], floor));
  }

  return logMag;
}

/**
 * Compute Euclidean distance between two spectra, normalized.
 *
 * @param specA - First spectrum
 * @param specB - Second spectrum
 * @returns Normalized distance (0-1)
 */
function computeNormalizedEuclideanDistance(
  specA: Float32Array,
  specB: Float32Array
): number {
  const len = Math.min(specA.length, specB.length);
  let sumSquaredDiff = 0;
  let sumSquaredA = 0;
  let sumSquaredB = 0;

  for (let i = 0; i < len; i++) {
    const diff = specA[i] - specB[i];
    sumSquaredDiff += diff * diff;
    sumSquaredA += specA[i] * specA[i];
    sumSquaredB += specB[i] * specB[i];
  }

  // Normalize by the maximum possible distance
  const normFactor = Math.sqrt(sumSquaredA + sumSquaredB);

  if (normFactor < 1e-10) {
    return 0;
  }

  return Math.min(1, Math.sqrt(sumSquaredDiff) / normFactor);
}

/**
 * Extract audio samples from end of buffer.
 *
 * @param buffer - Audio buffer
 * @param durationMs - Duration to extract in milliseconds
 * @returns Extracted samples (mono)
 */
function extractEndRegion(buffer: AudioBuffer, durationMs: number): Float32Array {
  const sampleRate = buffer.sampleRate;
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const channelData = buffer.getChannelData(0); // Use first channel

  const startSample = Math.max(0, channelData.length - numSamples);
  const actualLength = channelData.length - startSample;

  return channelData.slice(startSample, startSample + actualLength);
}

/**
 * Extract audio samples from start of buffer.
 *
 * @param buffer - Audio buffer
 * @param durationMs - Duration to extract in milliseconds
 * @returns Extracted samples (mono)
 */
function extractStartRegion(buffer: AudioBuffer, durationMs: number): Float32Array {
  const sampleRate = buffer.sampleRate;
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const channelData = buffer.getChannelData(0); // Use first channel

  const actualLength = Math.min(numSamples, channelData.length);

  return channelData.slice(0, actualLength);
}

/**
 * Average multiple magnitude spectra from overlapping frames.
 *
 * @param samples - Audio samples
 * @param windowSize - FFT window size
 * @param hopSize - Hop size between frames
 * @returns Averaged magnitude spectrum
 */
function computeAverageMagnitudeSpectrum(
  samples: Float32Array,
  windowSize: number,
  hopSize: number
): Float32Array {
  const halfSize = windowSize >> 1;
  const avgMagnitude = new Float32Array(halfSize);
  let numFrames = 0;

  // Process overlapping frames
  for (let start = 0; start + windowSize <= samples.length; start += hopSize) {
    const frame = samples.slice(start, start + windowSize);
    const frameMag = computeMagnitudeSpectrum(frame, windowSize);

    for (let i = 0; i < halfSize; i++) {
      avgMagnitude[i] += frameMag[i];
    }
    numFrames++;
  }

  // Handle case where audio is shorter than one window
  if (numFrames === 0 && samples.length > 0) {
    const paddedSamples = new Float32Array(windowSize);
    paddedSamples.set(samples.slice(0, Math.min(samples.length, windowSize)));
    const frameMag = computeMagnitudeSpectrum(paddedSamples, windowSize);
    for (let i = 0; i < halfSize; i++) {
      avgMagnitude[i] = frameMag[i];
    }
    numFrames = 1;
  }

  // Average
  if (numFrames > 0) {
    for (let i = 0; i < halfSize; i++) {
      avgMagnitude[i] /= numFrames;
    }
  }

  return avgMagnitude;
}

/**
 * Calculate spectral distance between end of buffer A and start of buffer B.
 *
 * This function analyzes the spectral characteristics at the join point
 * between two audio samples and calculates how different they are.
 * Higher distance values indicate more spectral mismatch, suggesting
 * that a longer crossfade/overlap would help smooth the transition.
 *
 * The distance is computed using three components:
 * 1. Spectral centroid difference (brightness mismatch)
 * 2. Log magnitude Euclidean distance (overall spectral shape)
 * 3. Energy difference (loudness mismatch)
 *
 * @param bufferA - First audio buffer (analyze end region)
 * @param bufferB - Second audio buffer (analyze start region)
 * @param options - Analysis options
 * @returns Spectral distance result with recommended overlap
 *
 * @example
 * ```typescript
 * // Basic usage
 * const result = calculateSpectralDistance(sampleA, sampleB);
 * const dynamicOverlap = result.recommendedOverlapMs;
 *
 * // With custom options
 * const result = calculateSpectralDistance(sampleA, sampleB, {
 *   analysisRegionMs: 100,  // Analyze 100ms at join
 *   baseOverlapMs: 50,      // Minimum 50ms overlap
 * });
 * ```
 */
export function calculateSpectralDistance(
  bufferA: AudioBuffer,
  bufferB: AudioBuffer,
  options?: SpectralDistanceOptions
): SpectralDistanceResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Extract analysis regions
  const samplesA = extractEndRegion(bufferA, opts.analysisRegionMs);
  const samplesB = extractStartRegion(bufferB, opts.analysisRegionMs);

  // Handle edge cases
  if (samplesA.length === 0 || samplesB.length === 0) {
    return {
      distance: 0,
      recommendedOverlapMs: opts.baseOverlapMs,
      spectralCentroidDiff: 0,
      energyDiff: 0,
      magnitudeDistance: 0,
    };
  }

  const sampleRate = bufferA.sampleRate;

  // Compute averaged magnitude spectra
  const magA = computeAverageMagnitudeSpectrum(samplesA, opts.windowSize, opts.hopSize);
  const magB = computeAverageMagnitudeSpectrum(samplesB, opts.windowSize, opts.hopSize);

  // Compute spectral centroids
  const centroidA = computeSpectralCentroid(magA, sampleRate, opts.windowSize);
  const centroidB = computeSpectralCentroid(magB, sampleRate, opts.windowSize);

  // Normalize centroid difference (assume max meaningful difference is ~4000 Hz)
  const maxCentroidDiff = 4000;
  const spectralCentroidDiff = Math.min(1, Math.abs(centroidA - centroidB) / maxCentroidDiff);

  // Compute energy difference
  const energyA = computeEnergy(samplesA);
  const energyB = computeEnergy(samplesB);
  const maxEnergy = Math.max(energyA, energyB, 1e-10);
  const energyDiff = Math.abs(energyA - energyB) / maxEnergy;

  // Compute log magnitude distance
  const logMagA = computeLogMagnitude(magA);
  const logMagB = computeLogMagnitude(magB);
  const magnitudeDistance = computeNormalizedEuclideanDistance(logMagA, logMagB);

  // Compute weighted overall distance
  const distance = Math.min(
    1,
    opts.centroidWeight * spectralCentroidDiff +
    opts.magnitudeWeight * magnitudeDistance +
    opts.energyWeight * energyDiff
  );

  // Calculate recommended overlap
  const recommendedOverlapMs = opts.baseOverlapMs + distance * opts.maxAdditionalOverlapMs;

  return {
    distance,
    recommendedOverlapMs,
    spectralCentroidDiff,
    energyDiff,
    magnitudeDistance,
  };
}

/**
 * Incrementing ID counter for assigning unique IDs to AudioBuffer objects.
 *
 * Each AudioBuffer gets a stable numeric ID on first encounter, used for
 * cache key generation. This avoids collisions that would occur when using
 * only buffer metadata (duration, sampleRate, length) as cache keys.
 */
let _nextBufferId = 1;
const _bufferIdMap = new WeakMap<AudioBuffer, number>();

/**
 * Get a stable unique ID for an AudioBuffer.
 *
 * Uses a WeakMap to associate each AudioBuffer object with an incrementing
 * integer ID. The WeakMap ensures that IDs are tied to object identity
 * (not metadata) and that entries are garbage collected when buffers are freed.
 *
 * @param buffer - Audio buffer to identify
 * @returns Unique numeric ID for this buffer instance
 */
function getBufferId(buffer: AudioBuffer): number {
  let id = _bufferIdMap.get(buffer);
  if (id === undefined) {
    id = _nextBufferId++;
    _bufferIdMap.set(buffer, id);
  }
  return id;
}

/**
 * Cache key generator for spectral distance results.
 *
 * Uses stable per-object IDs (via WeakMap) so that different AudioBuffer
 * instances always produce different keys, even if they share the same
 * duration and sample rate.
 *
 * @param bufferA - First audio buffer
 * @param bufferB - Second audio buffer
 * @returns Cache key string
 */
function generateCacheKey(bufferA: AudioBuffer, bufferB: AudioBuffer): string {
  return `${getBufferId(bufferA)}_${getBufferId(bufferB)}`;
}

/**
 * Cached spectral distance calculator.
 *
 * Maintains a cache of previously computed spectral distances to avoid
 * redundant FFT computations during phrase playback.
 *
 * @example
 * ```typescript
 * const cache = new SpectralDistanceCache();
 *
 * // First call computes the distance
 * const result1 = cache.getDistance(bufferA, bufferB);
 *
 * // Second call returns cached result
 * const result2 = cache.getDistance(bufferA, bufferB);
 * ```
 */
export class SpectralDistanceCache {
  private readonly _cache = new Map<string, SpectralDistanceResult>();
  private readonly _options: SpectralDistanceOptions;
  private readonly _maxSize: number;

  /**
   * Create a new spectral distance cache.
   *
   * @param options - Default options for distance calculation
   * @param maxSize - Maximum cache size (default: 1000)
   */
  constructor(options?: SpectralDistanceOptions, maxSize = 1000) {
    this._options = options ?? {};
    this._maxSize = maxSize;
  }

  /**
   * Get spectral distance, using cache if available.
   *
   * @param bufferA - First audio buffer
   * @param bufferB - Second audio buffer
   * @param options - Override options for this calculation
   * @returns Spectral distance result
   */
  getDistance(
    bufferA: AudioBuffer,
    bufferB: AudioBuffer,
    options?: SpectralDistanceOptions
  ): SpectralDistanceResult {
    const key = generateCacheKey(bufferA, bufferB);

    // Check cache
    const cached = this._cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    // Compute distance
    const mergedOptions = { ...this._options, ...options };
    const result = calculateSpectralDistance(bufferA, bufferB, mergedOptions);

    // Add to cache (with simple LRU-like eviction)
    if (this._cache.size >= this._maxSize) {
      // Remove oldest entry (first key)
      const firstKey = this._cache.keys().next().value;
      if (firstKey !== undefined) {
        this._cache.delete(firstKey);
      }
    }

    this._cache.set(key, result);
    return result;
  }

  /**
   * Clear the cache.
   */
  clear(): void {
    this._cache.clear();
  }

  /**
   * Get current cache size.
   */
  get size(): number {
    return this._cache.size;
  }
}

/**
 * Calculate dynamic overlap based on spectral distance and oto.ini baseline.
 *
 * This is a convenience function that takes the oto.ini overlap value as a
 * baseline and scales it up based on spectral distance.
 *
 * @param bufferA - First audio buffer
 * @param bufferB - Second audio buffer
 * @param otoOverlapMs - Base overlap from oto.ini in milliseconds
 * @param options - Options including max scale factor
 * @returns Dynamic overlap in milliseconds
 *
 * @example
 * ```typescript
 * const otoOverlap = 30; // From oto.ini
 * const dynamicOverlap = calculateDynamicOverlap(
 *   prevSample,
 *   currentSample,
 *   otoOverlap,
 *   { maxScaleFactor: 2.0 }
 * );
 * // Returns 30-60ms depending on spectral distance
 * ```
 */
export function calculateDynamicOverlap(
  bufferA: AudioBuffer,
  bufferB: AudioBuffer,
  otoOverlapMs: number,
  options?: {
    /**
     * Maximum scale factor for overlap (default: 2.0).
     * Dynamic overlap will be at most otoOverlapMs * maxScaleFactor.
     */
    maxScaleFactor?: number;
    /**
     * Spectral distance options.
     */
    spectralOptions?: SpectralDistanceOptions;
  }
): number {
  const { maxScaleFactor = 2.0, spectralOptions } = options ?? {};

  const result = calculateSpectralDistance(bufferA, bufferB, spectralOptions);

  // Scale overlap: min = otoOverlapMs, max = otoOverlapMs * maxScaleFactor
  const additionalFactor = (maxScaleFactor - 1) * result.distance;
  const scaleFactor = 1 + additionalFactor;

  return otoOverlapMs * scaleFactor;
}
