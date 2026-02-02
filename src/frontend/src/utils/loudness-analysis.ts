/**
 * Loudness Analysis Utilities for Sample Normalization.
 *
 * Calculates loudness metrics (RMS, peak) and normalization factors to reduce
 * amplitude discontinuities at sample joins. Even with crossfades, samples
 * recorded at different levels can create audible "bumps" at join points.
 *
 * This module provides:
 * 1. Loudness analysis (RMS, peak, crest factor) for samples or regions
 * 2. Global normalization gain calculation to bring samples to a target level
 * 3. Local gain correction at join points for smooth transitions
 *
 * RMS (Root Mean Square) is used as the primary metric because it correlates
 * with perceived loudness better than peak levels.
 *
 * @example
 * ```typescript
 * // Analyze a sample's loudness
 * const analysis = analyzeLoudness(audioBuffer);
 * console.log(`RMS: ${analysis.rmsDb}dB, Peak: ${analysis.peakDb}dB`);
 *
 * // Calculate normalization gain to reach -18dB RMS
 * const gain = calculateNormalizationGain(analysis);
 *
 * // Calculate gain correction at a join point
 * const correction = calculateJoinGainCorrection(bufferA, bufferB);
 * console.log(`RMS difference: ${correction.rmsDiffDb}dB`);
 * ```
 */

/**
 * Result of loudness analysis for an audio buffer or region.
 */
export interface LoudnessAnalysis {
  /**
   * Root Mean Square amplitude (linear scale, 0-1).
   * Represents the "average" amplitude and correlates with perceived loudness.
   */
  rms: number;

  /**
   * RMS in decibels (relative to full scale, typically negative).
   * -Infinity indicates silence.
   */
  rmsDb: number;

  /**
   * Peak amplitude (linear scale, 0-1).
   * The maximum absolute sample value.
   */
  peak: number;

  /**
   * Peak in decibels (relative to full scale).
   * -Infinity indicates silence.
   */
  peakDb: number;

  /**
   * Crest factor (peak / RMS ratio).
   * Indicates dynamic range of the audio:
   * - ~1.4 (3dB): Sine wave
   * - ~4-8 (12-18dB): Typical music
   * - ~10+ (>20dB): Very dynamic content
   */
  crestFactor: number;

  /**
   * Whether the analysis represents valid audio (non-silent).
   */
  hasContent: boolean;
}

/**
 * Result of join gain correction calculation.
 */
export interface JoinGainCorrection {
  /**
   * Gain multiplier to apply to the end of sample A.
   * Values < 1 reduce volume, > 1 increase volume.
   */
  gainA: number;

  /**
   * Gain multiplier to apply to the start of sample B.
   * Values < 1 reduce volume, > 1 increase volume.
   */
  gainB: number;

  /**
   * RMS difference between the samples in decibels.
   * Positive means B is louder than A.
   */
  rmsDiffDb: number;

  /**
   * RMS of sample A's end region (linear).
   */
  rmsA: number;

  /**
   * RMS of sample B's start region (linear).
   */
  rmsB: number;
}

/**
 * Options for loudness analysis.
 */
export interface LoudnessAnalysisOptions {
  /**
   * Start time in seconds for analysis region (default: 0).
   * If undefined, analyzes from the beginning.
   */
  startTime?: number;

  /**
   * End time in seconds for analysis region (default: buffer duration).
   * If undefined, analyzes to the end.
   */
  endTime?: number;

  /**
   * Channel to analyze (default: 0).
   * For mono audio, always use 0.
   */
  channel?: number;
}

/**
 * Options for normalization gain calculation.
 */
export interface NormalizationOptions {
  /**
   * Target RMS level in decibels (default: -18dB).
   * -18dB is a common broadcast/podcast target that leaves headroom.
   * Typical ranges:
   * - -24dB to -20dB: Quiet, lots of headroom
   * - -18dB to -14dB: Normal speech/vocals
   * - -12dB to -6dB: Loud (risk of clipping)
   */
  targetRmsDb?: number;

  /**
   * Maximum allowed gain in dB (default: 12dB).
   * Prevents excessive amplification of quiet signals which could
   * amplify noise or cause distortion.
   */
  maxGainDb?: number;

  /**
   * Minimum allowed gain in dB (default: -12dB).
   * Prevents excessive attenuation.
   */
  minGainDb?: number;

  /**
   * Maximum output peak in dB (default: -1dB).
   * Applies peak limiting to prevent clipping.
   * The gain will be reduced if needed to keep peaks below this level.
   */
  maxPeakDb?: number;
}

/**
 * Options for join gain correction.
 */
export interface JoinCorrectionOptions {
  /**
   * Region to analyze at join point in milliseconds (default: 50ms).
   * Analyzes last N ms of buffer A and first N ms of buffer B.
   */
  joinRegionMs?: number;

  /**
   * Maximum gain correction in dB (default: 6dB).
   * Limits how much correction is applied to avoid artifacts.
   * Large corrections may indicate a problem with the source audio.
   */
  maxCorrectionDb?: number;

  /**
   * Correction strategy (default: 'both').
   * - 'both': Split correction between A and B (least intrusive)
   * - 'adjustB': Only adjust B's start (preserves A's tail)
   * - 'adjustA': Only adjust A's end (preserves B's attack)
   */
  strategy?: 'both' | 'adjustB' | 'adjustA';
}

/**
 * Silence threshold for valid content detection (linear).
 * Audio below this RMS is considered silence.
 */
const SILENCE_THRESHOLD = 1e-6;

/**
 * Reference level for dB calculations (full scale = 1.0).
 */
const DB_REFERENCE = 1.0;

/**
 * Default target RMS for normalization (-18 dBFS).
 */
export const DEFAULT_TARGET_RMS_DB = -18;

/**
 * Convert linear amplitude to decibels.
 *
 * @param linear - Linear amplitude value
 * @returns Value in decibels, or -Infinity for zero/negative input
 */
export function linearToDb(linear: number): number {
  if (linear <= 0) {
    return -Infinity;
  }
  return 20 * Math.log10(linear / DB_REFERENCE);
}

/**
 * Convert decibels to linear amplitude.
 *
 * @param db - Value in decibels
 * @returns Linear amplitude value
 */
export function dbToLinear(db: number): number {
  if (!isFinite(db)) {
    return 0;
  }
  return DB_REFERENCE * Math.pow(10, db / 20);
}

/**
 * Analyze loudness of an audio buffer or region.
 *
 * Computes RMS (Root Mean Square) for perceived loudness and peak for
 * headroom analysis. RMS is the standard metric for loudness normalization
 * as it correlates better with human perception than peak values.
 *
 * @param buffer - The audio buffer to analyze
 * @param options - Analysis options (region, channel)
 * @returns Loudness analysis with RMS, peak, and crest factor
 *
 * @example
 * ```typescript
 * // Analyze entire buffer
 * const analysis = analyzeLoudness(buffer);
 * console.log(`RMS: ${analysis.rmsDb.toFixed(1)} dBFS`);
 * console.log(`Peak: ${analysis.peakDb.toFixed(1)} dBFS`);
 * console.log(`Crest factor: ${analysis.crestFactor.toFixed(2)}`);
 *
 * // Analyze a specific region (0.5s to 1.0s)
 * const regionAnalysis = analyzeLoudness(buffer, {
 *   startTime: 0.5,
 *   endTime: 1.0,
 * });
 * ```
 */
export function analyzeLoudness(
  buffer: AudioBuffer,
  options?: LoudnessAnalysisOptions
): LoudnessAnalysis {
  const {
    startTime = 0,
    endTime = buffer.duration,
    channel = 0,
  } = options ?? {};

  // Validate channel
  const safeChannel = Math.min(channel, buffer.numberOfChannels - 1);
  const channelData = buffer.getChannelData(safeChannel);
  const sampleRate = buffer.sampleRate;

  // Calculate sample range
  const startSample = Math.max(0, Math.floor(startTime * sampleRate));
  const endSample = Math.min(channelData.length, Math.floor(endTime * sampleRate));
  const numSamples = endSample - startSample;

  // Handle edge cases
  if (numSamples <= 0) {
    return {
      rms: 0,
      rmsDb: -Infinity,
      peak: 0,
      peakDb: -Infinity,
      crestFactor: 0,
      hasContent: false,
    };
  }

  // Compute RMS and peak in a single pass
  let sumSquared = 0;
  let peak = 0;

  for (let i = startSample; i < endSample; i++) {
    const sample = channelData[i];
    const absSample = Math.abs(sample);

    sumSquared += sample * sample;

    if (absSample > peak) {
      peak = absSample;
    }
  }

  const rms = Math.sqrt(sumSquared / numSamples);
  const hasContent = rms > SILENCE_THRESHOLD;

  // Calculate crest factor (peak/RMS ratio)
  // For a pure sine wave, this is sqrt(2) = ~1.414
  const crestFactor = rms > SILENCE_THRESHOLD ? peak / rms : 0;

  return {
    rms,
    rmsDb: linearToDb(rms),
    peak,
    peakDb: linearToDb(peak),
    crestFactor,
    hasContent,
  };
}

/**
 * Calculate gain factor to normalize a sample to target RMS level.
 *
 * Takes a loudness analysis and calculates the gain needed to bring
 * the sample to the target RMS level. Includes headroom protection
 * to prevent peaks from exceeding the maximum peak level.
 *
 * @param analysis - Loudness analysis from analyzeLoudness()
 * @param options - Normalization options (target level, limits)
 * @returns Gain factor to apply (multiply samples by this value)
 *
 * @example
 * ```typescript
 * const analysis = analyzeLoudness(buffer);
 * const gain = calculateNormalizationGain(analysis);
 *
 * // Apply gain to samples
 * const channelData = buffer.getChannelData(0);
 * for (let i = 0; i < channelData.length; i++) {
 *   channelData[i] *= gain;
 * }
 *
 * // Or use with Web Audio GainNode
 * gainNode.gain.value = gain;
 * ```
 */
export function calculateNormalizationGain(
  analysis: LoudnessAnalysis,
  options?: NormalizationOptions
): number {
  const {
    targetRmsDb = DEFAULT_TARGET_RMS_DB,
    maxGainDb = 12,
    minGainDb = -12,
    maxPeakDb = -1,
  } = options ?? {};

  // Handle silent audio
  if (!analysis.hasContent) {
    return 1; // No gain change for silence
  }

  // Calculate required gain to reach target RMS
  const requiredGainDb = targetRmsDb - analysis.rmsDb;

  // Clamp to gain limits
  let gainDb = Math.max(minGainDb, Math.min(maxGainDb, requiredGainDb));

  // Check if the resulting peak would exceed maxPeakDb
  const resultingPeakDb = analysis.peakDb + gainDb;
  if (resultingPeakDb > maxPeakDb) {
    // Reduce gain to keep peak below limit
    gainDb = maxPeakDb - analysis.peakDb;
    // Still respect minimum gain
    gainDb = Math.max(minGainDb, gainDb);
  }

  return dbToLinear(gainDb);
}

/**
 * Calculate gain correction for joining two audio samples.
 *
 * Analyzes the loudness at the join point (end of A, start of B) and
 * calculates gain corrections to minimize the amplitude discontinuity.
 * This helps produce smoother transitions even when samples were
 * recorded at different levels.
 *
 * The correction is intentionally conservative (default max 6dB) to avoid
 * introducing artifacts. Large discrepancies may indicate source audio
 * issues that should be addressed upstream.
 *
 * @param bufferA - First audio buffer (analyze end region)
 * @param bufferB - Second audio buffer (analyze start region)
 * @param options - Correction options
 * @returns Gain correction values for A and B
 *
 * @example
 * ```typescript
 * const correction = calculateJoinGainCorrection(sampleA, sampleB);
 *
 * // Apply during crossfade
 * // At A's end, ramp gain from 1.0 to correction.gainA
 * // At B's start, ramp gain from correction.gainB to 1.0
 *
 * console.log(`Level difference: ${correction.rmsDiffDb.toFixed(1)} dB`);
 * ```
 */
export function calculateJoinGainCorrection(
  bufferA: AudioBuffer,
  bufferB: AudioBuffer,
  options?: JoinCorrectionOptions
): JoinGainCorrection {
  const {
    joinRegionMs = 50,
    maxCorrectionDb = 6,
    strategy = 'both',
  } = options ?? {};

  const joinRegionSec = joinRegionMs / 1000;

  // Analyze end of buffer A
  const analysisA = analyzeLoudness(bufferA, {
    startTime: Math.max(0, bufferA.duration - joinRegionSec),
    endTime: bufferA.duration,
  });

  // Analyze start of buffer B
  const analysisB = analyzeLoudness(bufferB, {
    startTime: 0,
    endTime: Math.min(joinRegionSec, bufferB.duration),
  });

  // Handle cases where one or both regions are silent
  if (!analysisA.hasContent || !analysisB.hasContent) {
    return {
      gainA: 1,
      gainB: 1,
      rmsDiffDb: 0,
      rmsA: analysisA.rms,
      rmsB: analysisB.rms,
    };
  }

  // Calculate RMS difference (positive means B is louder)
  const rmsDiffDb = analysisB.rmsDb - analysisA.rmsDb;

  // Clamp to max correction
  const clampedDiffDb = Math.max(-maxCorrectionDb, Math.min(maxCorrectionDb, rmsDiffDb));

  // Calculate gains based on strategy
  let gainADb = 0;
  let gainBDb = 0;

  switch (strategy) {
    case 'adjustB':
      // Only adjust B's start to match A's level
      gainBDb = -clampedDiffDb;
      break;

    case 'adjustA':
      // Only adjust A's end to match B's level
      gainADb = clampedDiffDb;
      break;

    case 'both':
    default:
      // Split the correction between A and B
      // This is the least intrusive approach
      gainADb = clampedDiffDb / 2;
      gainBDb = -clampedDiffDb / 2;
      break;
  }

  return {
    gainA: dbToLinear(gainADb),
    gainB: dbToLinear(gainBDb),
    rmsDiffDb,
    rmsA: analysisA.rms,
    rmsB: analysisB.rms,
  };
}

/**
 * Pre-compute normalization factors for a collection of samples.
 *
 * Analyzes all samples and calculates their normalization gains,
 * useful for pre-processing a voicebank before playback.
 *
 * @param samples - Map of sample ID to AudioBuffer
 * @param options - Normalization options
 * @returns Map of sample ID to normalization gain
 *
 * @example
 * ```typescript
 * const samples = new Map<string, AudioBuffer>([
 *   ['ka', kaBuffer],
 *   ['sa', saBuffer],
 *   ['ta', taBuffer],
 * ]);
 *
 * const gains = computeNormalizationGains(samples);
 *
 * // Apply gains during playback
 * for (const [alias, gain] of gains) {
 *   console.log(`${alias}: ${linearToDb(gain).toFixed(1)} dB`);
 * }
 * ```
 */
export function computeNormalizationGains(
  samples: Map<string, AudioBuffer>,
  options?: NormalizationOptions
): Map<string, number> {
  const gains = new Map<string, number>();

  for (const [id, buffer] of samples) {
    const analysis = analyzeLoudness(buffer);
    const gain = calculateNormalizationGain(analysis, options);
    gains.set(id, gain);
  }

  return gains;
}

/**
 * Cache for loudness analysis results.
 *
 * Avoids redundant RMS calculations for buffers that have been
 * analyzed previously.
 */
export class LoudnessAnalysisCache {
  private readonly _cache = new Map<string, LoudnessAnalysis>();
  private readonly _maxSize: number;

  /**
   * Create a new loudness analysis cache.
   *
   * @param maxSize - Maximum number of entries to cache (default: 1000)
   */
  constructor(maxSize = 1000) {
    this._maxSize = maxSize;
  }

  /**
   * Generate a cache key for an audio buffer.
   *
   * Uses buffer properties as a simple fingerprint.
   * Note: This assumes buffers with the same properties are the same audio.
   * For more robust caching, consider hashing audio content.
   *
   * @param buffer - The audio buffer
   * @param options - Analysis options that affect the result
   * @returns Cache key string
   */
  private _generateKey(
    buffer: AudioBuffer,
    options?: LoudnessAnalysisOptions
  ): string {
    const startTime = options?.startTime ?? 0;
    const endTime = options?.endTime ?? buffer.duration;
    const channel = options?.channel ?? 0;

    return `${buffer.duration.toFixed(6)}_${buffer.sampleRate}_${startTime}_${endTime}_${channel}`;
  }

  /**
   * Get or compute loudness analysis for a buffer.
   *
   * Returns cached result if available, otherwise computes and caches.
   *
   * @param buffer - The audio buffer to analyze
   * @param options - Analysis options
   * @returns Loudness analysis result
   */
  getAnalysis(
    buffer: AudioBuffer,
    options?: LoudnessAnalysisOptions
  ): LoudnessAnalysis {
    const key = this._generateKey(buffer, options);

    // Check cache
    const cached = this._cache.get(key);
    if (cached) {
      return cached;
    }

    // Compute analysis
    const analysis = analyzeLoudness(buffer, options);

    // Add to cache with simple LRU eviction
    if (this._cache.size >= this._maxSize) {
      const firstKey = this._cache.keys().next().value;
      if (firstKey !== undefined) {
        this._cache.delete(firstKey);
      }
    }

    this._cache.set(key, analysis);
    return analysis;
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
