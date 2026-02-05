/**
 * Pitch Period Detection using Autocorrelation.
 *
 * Detects the fundamental frequency (pitch period) of an audio signal using
 * autocorrelation analysis. This is used to determine optimal grain sizes
 * for granular synthesis, reducing "beating" artifacts that occur when grain
 * boundaries cut through pitch cycles.
 *
 * Algorithm:
 * 1. Compute autocorrelation: R(tau) = sum(x(t) * x(t+tau))
 * 2. Find the first significant peak after tau=0 (this is the pitch period)
 * 3. Use parabolic interpolation for sub-sample accuracy
 * 4. Constrain search to reasonable vocal range (50Hz-1000Hz)
 *
 * @example
 * ```typescript
 * const pitchPeriod = detectPitchPeriod(audioBuffer);
 * console.log(`Detected pitch period: ${pitchPeriod * 1000}ms`);
 *
 * // Use for adaptive grain sizing
 * const optimalGrainSize = pitchPeriod * 2;
 * ```
 */

/**
 * Options for pitch detection.
 */
export interface PitchDetectionOptions {
  /**
   * Minimum frequency to detect in Hz (default: 50Hz).
   * Lower frequencies require longer analysis windows.
   */
  minFrequency?: number;

  /**
   * Maximum frequency to detect in Hz (default: 1000Hz).
   * Higher frequencies have shorter periods.
   */
  maxFrequency?: number;

  /**
   * Threshold for peak detection (0-1, default: 0.2).
   * Higher values require more prominent peaks.
   */
  peakThreshold?: number;

  /**
   * Start time in seconds for analysis window (default: 0).
   * Useful for analyzing a specific portion of the audio.
   */
  startTime?: number;

  /**
   * Duration in seconds for analysis window (default: 0.1s = 100ms).
   * Longer windows give more accurate results for low frequencies.
   */
  duration?: number;

  /**
   * Channel to analyze (default: 0 = first channel).
   * For stereo audio, typically analyze left channel.
   */
  channel?: number;
}

/**
 * Result of pitch detection.
 */
export interface PitchDetectionResult {
  /**
   * Detected pitch period in seconds.
   * Returns 0 if no clear pitch was detected.
   */
  period: number;

  /**
   * Detected frequency in Hz (1 / period).
   * Returns 0 if no clear pitch was detected.
   */
  frequency: number;

  /**
   * Confidence of the detection (0-1).
   * Higher values indicate a clearer pitch.
   */
  confidence: number;

  /**
   * Whether a valid pitch was detected.
   */
  detected: boolean;
}

/**
 * Standard pitch reference: C4 (middle C) in Hz.
 *
 * Used as the default reference pitch for pitch matching.
 * When pitch matching is enabled, each sample's detected fundamental
 * frequency is corrected so that pitch=0 plays at C4.
 */
export const C4_FREQUENCY = 261.63;

/**
 * Calculate the pitch correction needed to transpose a sample from its
 * detected frequency to a reference pitch.
 *
 * Returns a value in semitones that, when added to the note's pitch,
 * makes the sample sound at the reference frequency.
 *
 * Formula: correction = 12 * log₂(referencePitch / detectedFrequency)
 *
 * @param detectedFrequency - The sample's detected fundamental frequency in Hz
 * @param referenceFrequency - Target frequency in Hz (default: C4 = 261.63Hz)
 * @returns Correction in semitones (negative = sample is sharp, positive = sample is flat)
 *
 * @example
 * ```typescript
 * // Sample recorded at A4 (440Hz), want it to play at C4 (261.63Hz)
 * const correction = calculatePitchCorrection(440);
 * // Returns ~-9.0 semitones (pitch down from A4 to C4)
 *
 * // Apply to note: note.pitch + correction
 * ```
 */
export function calculatePitchCorrection(
  detectedFrequency: number,
  referenceFrequency: number = C4_FREQUENCY
): number {
  if (detectedFrequency <= 0 || referenceFrequency <= 0) return 0;
  return 12 * Math.log2(referenceFrequency / detectedFrequency);
}

/**
 * Default options for pitch detection.
 */
const DEFAULT_OPTIONS: Required<PitchDetectionOptions> = {
  minFrequency: 50, // 50Hz -> 20ms period
  maxFrequency: 1000, // 1000Hz -> 1ms period
  peakThreshold: 0.2,
  startTime: 0,
  duration: 0.1, // 100ms analysis window
  channel: 0,
};

/**
 * Detect the pitch period of an audio buffer using autocorrelation.
 *
 * This function analyzes the audio to find the fundamental frequency
 * by computing the autocorrelation and finding the first significant peak.
 *
 * @param audioBuffer - The audio buffer to analyze
 * @param options - Detection options
 * @returns The detected pitch period in seconds, or 0 if no clear pitch found
 *
 * @example
 * ```typescript
 * // Basic usage - analyze first 100ms
 * const period = detectPitchPeriod(audioBuffer);
 *
 * // Analyze a specific region
 * const period = detectPitchPeriod(audioBuffer, {
 *   startTime: 0.2,
 *   duration: 0.1,
 * });
 *
 * // For known vocal range (alto/tenor)
 * const period = detectPitchPeriod(audioBuffer, {
 *   minFrequency: 130, // C3
 *   maxFrequency: 523, // C5
 * });
 * ```
 */
export function detectPitchPeriod(
  audioBuffer: AudioBuffer,
  options?: PitchDetectionOptions
): number {
  const result = detectPitch(audioBuffer, options);
  return result.period;
}

/**
 * Detect pitch with full result information.
 *
 * Returns detailed information about the pitch detection including
 * confidence and whether a valid pitch was detected.
 *
 * @param audioBuffer - The audio buffer to analyze
 * @param options - Detection options
 * @returns Full detection result with period, frequency, and confidence
 */
export function detectPitch(
  audioBuffer: AudioBuffer,
  options?: PitchDetectionOptions
): PitchDetectionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Validate channel
  const channel = Math.min(opts.channel, audioBuffer.numberOfChannels - 1);

  // Get sample data
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(channel);

  // Calculate sample indices for analysis window
  const startSample = Math.floor(opts.startTime * sampleRate);
  const windowSamples = Math.floor(opts.duration * sampleRate);
  const endSample = Math.min(startSample + windowSamples, channelData.length);

  // Need enough samples for analysis
  if (endSample - startSample < 64) {
    return { period: 0, frequency: 0, confidence: 0, detected: false };
  }

  // Extract analysis window
  const samples = channelData.slice(startSample, endSample);

  // Calculate lag range based on frequency bounds
  // period = 1/frequency, lag = period * sampleRate
  const minLag = Math.floor(sampleRate / opts.maxFrequency);
  const maxLag = Math.ceil(sampleRate / opts.minFrequency);

  // Ensure we have enough samples for max lag
  if (samples.length < maxLag * 2) {
    // Not enough samples for the requested frequency range
    // Adjust maxLag to what we can analyze
    const adjustedMaxLag = Math.floor(samples.length / 2);
    if (adjustedMaxLag < minLag) {
      return { period: 0, frequency: 0, confidence: 0, detected: false };
    }
  }

  // Compute normalized autocorrelation
  const autocorr = computeAutocorrelation(samples, minLag, Math.min(maxLag, Math.floor(samples.length / 2)));

  // Find the first significant peak
  const peakResult = findFirstPeak(autocorr, minLag, opts.peakThreshold);

  if (!peakResult.found) {
    return { period: 0, frequency: 0, confidence: 0, detected: false };
  }

  // Refine peak position using parabolic interpolation
  const refinedLag = parabolicInterpolation(autocorr, peakResult.index, minLag);

  // Convert lag to period in seconds
  const period = refinedLag / sampleRate;
  const frequency = 1 / period;

  return {
    period,
    frequency,
    confidence: peakResult.confidence,
    detected: true,
  };
}

/**
 * Compute normalized autocorrelation for a range of lags.
 *
 * Uses the standard autocorrelation formula:
 * R(tau) = sum(x(t) * x(t+tau)) / sum(x(t)^2)
 *
 * @param samples - Audio samples to analyze
 * @param minLag - Minimum lag to compute (samples)
 * @param maxLag - Maximum lag to compute (samples)
 * @returns Array of autocorrelation values indexed by (lag - minLag)
 */
function computeAutocorrelation(
  samples: Float32Array,
  minLag: number,
  maxLag: number
): Float32Array {
  const n = samples.length;
  const numLags = maxLag - minLag + 1;
  const autocorr = new Float32Array(numLags);

  // Compute energy (normalization factor)
  let energy = 0;
  for (let i = 0; i < n; i++) {
    energy += samples[i] * samples[i];
  }

  // Handle silence
  if (energy < 1e-10) {
    return autocorr;
  }

  // Compute autocorrelation for each lag
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const len = n - lag;

    for (let i = 0; i < len; i++) {
      sum += samples[i] * samples[i + lag];
    }

    // Normalize by energy and window length
    // Using sqrt(energy) for both terms gives correlation coefficient
    autocorr[lag - minLag] = sum / energy;
  }

  return autocorr;
}

/**
 * Find the first significant peak in the autocorrelation.
 *
 * A peak is considered significant if:
 * 1. It's a local maximum (higher than neighbors)
 * 2. Its value exceeds the threshold
 *
 * @param autocorr - Autocorrelation values
 * @param minLag - The lag offset (autocorr[0] corresponds to minLag)
 * @param threshold - Minimum peak value (0-1)
 * @returns Peak information or not found
 */
function findFirstPeak(
  autocorr: Float32Array,
  minLag: number,
  threshold: number
): { found: boolean; index: number; confidence: number } {
  const n = autocorr.length;

  // Need at least 3 points to find a peak
  if (n < 3) {
    return { found: false, index: 0, confidence: 0 };
  }

  // Track if we've crossed below threshold first
  // (to avoid detecting the zero-lag area as a peak)
  let belowThreshold = false;

  for (let i = 1; i < n - 1; i++) {
    const prev = autocorr[i - 1];
    const curr = autocorr[i];
    const next = autocorr[i + 1];

    // Track when we first go below threshold
    if (curr < threshold * 0.5) {
      belowThreshold = true;
    }

    // Only look for peaks after we've gone below threshold
    if (!belowThreshold) {
      continue;
    }

    // Check for local maximum above threshold
    if (curr > prev && curr > next && curr > threshold) {
      return {
        found: true,
        index: i + minLag,
        confidence: curr,
      };
    }
  }

  return { found: false, index: 0, confidence: 0 };
}

/**
 * Refine peak position using parabolic interpolation.
 *
 * Given a peak at index i, fits a parabola through points (i-1, i, i+1)
 * to find the true maximum with sub-sample accuracy.
 *
 * The interpolated peak position is:
 * x_peak = i + 0.5 * (y[i-1] - y[i+1]) / (y[i-1] - 2*y[i] + y[i+1])
 *
 * @param autocorr - Autocorrelation values
 * @param peakIndex - Index of the peak in lag space (not array index)
 * @param minLag - The lag offset for array indexing
 * @returns Refined lag value with sub-sample precision
 */
function parabolicInterpolation(
  autocorr: Float32Array,
  peakIndex: number,
  minLag: number
): number {
  const arrayIndex = peakIndex - minLag;

  // Bounds check
  if (arrayIndex < 1 || arrayIndex >= autocorr.length - 1) {
    return peakIndex;
  }

  const y0 = autocorr[arrayIndex - 1];
  const y1 = autocorr[arrayIndex];
  const y2 = autocorr[arrayIndex + 1];

  // Denominator for parabolic fit
  const denom = y0 - 2 * y1 + y2;

  // If denominator is too small (flat peak), return center
  if (Math.abs(denom) < 1e-10) {
    return peakIndex;
  }

  // Parabolic interpolation offset from center
  const offset = 0.5 * (y0 - y2) / denom;

  // Clamp offset to reasonable range
  const clampedOffset = Math.max(-1, Math.min(1, offset));

  return peakIndex + clampedOffset;
}

/**
 * Calculate optimal grain size based on detected pitch.
 *
 * For best results, grain size should be approximately 2x the pitch period.
 * This ensures grains contain at least one complete pitch cycle, reducing
 * "beating" artifacts from grain boundaries cutting through cycles.
 *
 * @param pitchPeriod - Detected pitch period in seconds
 * @param options - Grain sizing options
 * @returns Optimal grain size in seconds, or default if pitch invalid
 */
export function calculateOptimalGrainSize(
  pitchPeriod: number,
  options?: {
    /** Multiplier for pitch period (default: 2.0) */
    periodMultiplier?: number;
    /** Minimum grain size in seconds (default: 0.02 = 20ms) */
    minGrainSize?: number;
    /** Maximum grain size in seconds (default: 0.2 = 200ms) */
    maxGrainSize?: number;
    /** Default grain size if pitch detection fails (default: 0.1 = 100ms) */
    defaultGrainSize?: number;
  }
): number {
  const {
    periodMultiplier = 2.0,
    minGrainSize = 0.02,
    maxGrainSize = 0.2,
    defaultGrainSize = 0.1,
  } = options ?? {};

  // If no valid pitch period, return default
  if (pitchPeriod <= 0) {
    return defaultGrainSize;
  }

  // Calculate optimal grain size
  const optimalSize = pitchPeriod * periodMultiplier;

  // Clamp to reasonable range
  return Math.max(minGrainSize, Math.min(maxGrainSize, optimalSize));
}

/**
 * Analyze multiple regions of audio to get a representative pitch.
 *
 * This is useful for audio with varying pitch - it samples multiple
 * regions and returns the median pitch period.
 *
 * @param audioBuffer - The audio buffer to analyze
 * @param options - Analysis options
 * @returns Representative pitch period in seconds
 */
export function detectRepresentativePitch(
  audioBuffer: AudioBuffer,
  options?: {
    /** Number of regions to sample (default: 5) */
    numSamples?: number;
    /** Duration of each sample region in seconds (default: 0.05 = 50ms) */
    sampleDuration?: number;
    /** Start time offset in seconds (default: 0.05 to skip attack) */
    startOffset?: number;
    /** Detection options passed to each sample */
    detectionOptions?: PitchDetectionOptions;
  }
): number {
  const {
    numSamples = 5,
    sampleDuration = 0.05,
    startOffset = 0.05,
    detectionOptions,
  } = options ?? {};

  const duration = audioBuffer.duration;
  const analysisEnd = duration - sampleDuration;

  // Need enough audio to analyze
  if (analysisEnd <= startOffset) {
    return detectPitchPeriod(audioBuffer, detectionOptions);
  }

  // Sample multiple regions
  const periods: number[] = [];
  const step = (analysisEnd - startOffset) / Math.max(1, numSamples - 1);

  for (let i = 0; i < numSamples; i++) {
    const startTime = startOffset + i * step;

    const result = detectPitch(audioBuffer, {
      ...detectionOptions,
      startTime,
      duration: sampleDuration,
    });

    if (result.detected && result.period > 0) {
      periods.push(result.period);
    }
  }

  // If no valid periods detected, return 0
  if (periods.length === 0) {
    return 0;
  }

  // Return median period
  periods.sort((a, b) => a - b);
  const mid = Math.floor(periods.length / 2);

  if (periods.length % 2 === 0) {
    return (periods[mid - 1] + periods[mid]) / 2;
  }

  return periods[mid];
}
