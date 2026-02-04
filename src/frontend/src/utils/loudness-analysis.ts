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
   * Maximum output peak in dB (default: -0.3dB).
   * Applies peak limiting to prevent clipping.
   * Uses a soft-knee approach: when the peak limiter would reduce gain
   * by more than softKneeDb below the RMS-based target, only half the
   * excess reduction is applied. This prevents transient-heavy samples
   * (like Japanese "ra") from being over-attenuated.
   */
  maxPeakDb?: number;

  /**
   * Soft-knee threshold in dB (default: 6dB).
   * When peak limiting would reduce the gain by more than this amount
   * below what RMS normalization requested, only half of the excess
   * reduction is applied. This preserves perceived loudness for samples
   * with high crest factors (large peak-to-RMS ratio) like plosives
   * and flap consonants.
   *
   * Set to 0 to disable soft-knee behavior and use hard limiting.
   */
  softKneeDb?: number;
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

  /**
   * Oto.ini timing parameters for buffer A (outgoing sample).
   *
   * When provided, the analysis region for buffer A is anchored to the
   * oto-defined playback end (cutoff) instead of the absolute buffer end.
   * This ensures gain correction is measured against the actual audio that
   * plays at the join point, not silence or unused audio beyond the cutoff.
   */
  otoTimingA?: OtoTimingParams;

  /**
   * Oto.ini timing parameters for buffer B (incoming sample).
   *
   * When provided, the analysis region for buffer B starts at the
   * oto-defined playback start (offset) instead of the absolute buffer start.
   * This avoids measuring silence or pre-offset audio that never plays.
   */
  otoTimingB?: OtoTimingParams;
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
 * Oto.ini timing parameters for defining analysis regions.
 * Mirrors the relevant fields from the OtoEntry type.
 */
export interface OtoTimingParams {
  /** Playback start position in milliseconds */
  offset: number;
  /** Fixed region end in milliseconds (consonant boundary) */
  consonant: number;
  /** Playback end position in ms (negative = from audio end, 0 = play to end) */
  cutoff: number;
}

/**
 * Default duration in milliseconds to skip from the start of the playback
 * region when oto consonant timing is not available. This skips the initial
 * consonant transient which can inflate peak measurements.
 */
const DEFAULT_TRANSIENT_SKIP_MS = 40;

/**
 * Analyze loudness of the sustained (vowel) portion of a sample for normalization.
 *
 * For consonant-vowel samples, the initial consonant often has a sharp transient
 * (high peak, low RMS) that causes the peak limiter in calculateNormalizationGain()
 * to over-attenuate the sample. This is especially problematic for transient-heavy
 * consonants like Japanese "ra" (alveolar flap/tap), plosives ("ta", "ka"), etc.
 *
 * This function analyzes two separate regions:
 * 1. **RMS region**: The sustained vowel portion (from consonant marker to cutoff),
 *    which better represents the perceived loudness of the sample.
 * 2. **Peak region**: The full playback region (offset to cutoff), since peaks
 *    anywhere in the sample can cause clipping.
 *
 * The returned LoudnessAnalysis uses the vowel RMS but the full-region peak,
 * giving calculateNormalizationGain() the information it needs to set gain based
 * on perceived loudness while still respecting peak headroom.
 *
 * @param buffer - The audio buffer to analyze
 * @param otoParams - Oto.ini timing parameters (offset, consonant, cutoff)
 * @returns Loudness analysis with vowel-region RMS and full-region peak
 *
 * @example
 * ```typescript
 * const analysis = analyzeLoudnessForNormalization(buffer, {
 *   offset: 45,
 *   consonant: 120,
 *   cutoff: -140,
 * });
 * const gain = calculateNormalizationGain(analysis);
 * ```
 */
export function analyzeLoudnessForNormalization(
  buffer: AudioBuffer,
  otoParams: OtoTimingParams
): LoudnessAnalysis {
  const { offset, consonant, cutoff } = otoParams;

  // Calculate playback region boundaries in seconds
  const playbackStart = offset / 1000;
  let playbackEnd: number;
  if (cutoff < 0) {
    playbackEnd = buffer.duration + (cutoff / 1000);
  } else if (cutoff > 0) {
    playbackEnd = cutoff / 1000;
  } else {
    playbackEnd = buffer.duration;
  }

  // Clamp to buffer bounds
  const safePlaybackStart = Math.max(0, playbackStart);
  const safePlaybackEnd = Math.min(buffer.duration, playbackEnd);

  if (safePlaybackEnd <= safePlaybackStart) {
    return analyzeLoudness(buffer);
  }

  // Determine the RMS analysis start: skip the consonant transient.
  // The oto "consonant" marker defines the end of the fixed (consonant) region,
  // measured from the start of the file (not from offset). Use consonant marker
  // if it falls within the playback region; otherwise skip a default amount.
  const consonantEndSec = consonant / 1000;
  let rmsStart: number;

  if (consonantEndSec > safePlaybackStart && consonantEndSec < safePlaybackEnd) {
    // Use the consonant marker -- this is the most accurate boundary
    rmsStart = consonantEndSec;
  } else {
    // Fallback: skip a default amount from playback start
    rmsStart = safePlaybackStart + (DEFAULT_TRANSIENT_SKIP_MS / 1000);
  }

  // Ensure rmsStart doesn't exceed the playback end (leave at least some audio)
  // If the vowel region would be too short (< 20ms), fall back to full region
  const MIN_VOWEL_REGION_SEC = 0.02;
  if (rmsStart + MIN_VOWEL_REGION_SEC >= safePlaybackEnd) {
    // Region too short for meaningful vowel analysis; use full playback region
    return analyzeLoudness(buffer, {
      startTime: safePlaybackStart,
      endTime: safePlaybackEnd,
    });
  }

  // Analyze RMS over the vowel/sustained portion only
  const vowelAnalysis = analyzeLoudness(buffer, {
    startTime: rmsStart,
    endTime: safePlaybackEnd,
  });

  // Analyze peak and RMS over the full playback region
  const fullAnalysis = analyzeLoudness(buffer, {
    startTime: safePlaybackStart,
    endTime: safePlaybackEnd,
  });

  // Blend vowel-region and full-region RMS to prevent normalization from being
  // entirely driven by the loudest sustained portion. For samples like "ku" where
  // the consonant "k" is near-silent, the vowel-only RMS is much higher than the
  // full-region RMS, causing normalization to over-attenuate the sample. Blending
  // reduces this effect while still weighting toward the vowel (the "ra" fix).
  const VOWEL_WEIGHT = 0.7;
  const FULL_WEIGHT = 0.3;
  const blendedRmsDb = vowelAnalysis.hasContent && fullAnalysis.hasContent
    ? VOWEL_WEIGHT * vowelAnalysis.rmsDb + FULL_WEIGHT * fullAnalysis.rmsDb
    : vowelAnalysis.rmsDb;
  const blendedRms = blendedRmsDb > -Infinity ? dbToLinear(blendedRmsDb) : 0;

  // Combine: blended RMS for perceived loudness, full-region peak for headroom
  return {
    rms: blendedRms,
    rmsDb: blendedRmsDb,
    peak: fullAnalysis.peak,
    peakDb: fullAnalysis.peakDb,
    crestFactor: blendedRms > SILENCE_THRESHOLD
      ? fullAnalysis.peak / blendedRms
      : 0,
    hasContent: vowelAnalysis.hasContent,
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
    maxPeakDb = -0.3,
    softKneeDb = 6,
  } = options ?? {};

  // Handle silent audio
  if (!analysis.hasContent) {
    return 1; // No gain change for silence
  }

  // Calculate required gain to reach target RMS
  const requiredGainDb = targetRmsDb - analysis.rmsDb;

  // Clamp to gain limits
  const rmsGainDb = Math.max(minGainDb, Math.min(maxGainDb, requiredGainDb));

  // Check if the resulting peak would exceed maxPeakDb
  const resultingPeakDb = analysis.peakDb + rmsGainDb;
  let gainDb = rmsGainDb;

  if (resultingPeakDb > maxPeakDb) {
    // Hard peak limit: the gain that would keep peak exactly at maxPeakDb
    const hardLimitGainDb = maxPeakDb - analysis.peakDb;

    // How much the peak limiter wants to cut below the RMS-based gain
    const reductionDb = rmsGainDb - hardLimitGainDb;

    if (softKneeDb > 0 && reductionDb > softKneeDb) {
      // Soft-knee: apply full reduction up to softKneeDb, then only half
      // of the excess. This prevents transient-heavy samples (high crest
      // factor, e.g. Japanese "ra" flap) from being over-attenuated while
      // still protecting against clipping for sustained loud signals.
      const excessReduction = reductionDb - softKneeDb;
      gainDb = rmsGainDb - softKneeDb - (excessReduction * 0.5);
    } else {
      // Within the knee or soft-knee disabled: apply full peak limiting
      gainDb = hardLimitGainDb;
    }

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
    otoTimingA,
    otoTimingB,
  } = options ?? {};

  const joinRegionSec = joinRegionMs / 1000;

  // Determine the playback end for buffer A.
  // When oto timing is available, use the cutoff-defined end instead of the
  // absolute buffer end, since audio beyond the cutoff is never played.
  let playbackEndA = bufferA.duration;
  if (otoTimingA) {
    if (otoTimingA.cutoff < 0) {
      playbackEndA = bufferA.duration + (otoTimingA.cutoff / 1000);
    } else if (otoTimingA.cutoff > 0) {
      playbackEndA = otoTimingA.cutoff / 1000;
    }
    // cutoff === 0 means play to end, so playbackEndA stays as bufferA.duration
    playbackEndA = Math.min(bufferA.duration, Math.max(0, playbackEndA));
  }

  // Determine the playback start for buffer B.
  // When oto timing is available, use the offset instead of absolute buffer start,
  // since audio before the offset is never played.
  let playbackStartB = 0;
  if (otoTimingB) {
    playbackStartB = Math.max(0, Math.min(bufferB.duration, otoTimingB.offset / 1000));
  }

  // Analyze the last joinRegionSec of buffer A's playback region
  const analysisA = analyzeLoudness(bufferA, {
    startTime: Math.max(0, playbackEndA - joinRegionSec),
    endTime: playbackEndA,
  });

  // Analyze the first joinRegionSec of buffer B's playback region
  const analysisB = analyzeLoudness(bufferB, {
    startTime: playbackStartB,
    endTime: Math.min(playbackStartB + joinRegionSec, bufferB.duration),
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
