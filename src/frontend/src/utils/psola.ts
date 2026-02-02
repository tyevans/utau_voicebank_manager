/**
 * PSOLA (Pitch-Synchronous Overlap-Add) Implementation for TypeScript.
 *
 * TD-PSOLA (Time-Domain PSOLA) is the gold standard for pitch manipulation in
 * speech and singing synthesis, used by Praat, UTAU, and similar tools. Unlike
 * arbitrary grain timing, PSOLA aligns grain windows to pitch period boundaries,
 * eliminating beating artifacts that occur with fixed grain sizes.
 *
 * Algorithm Overview:
 * 1. Analysis: Detect pitch periods and place pitch marks at period boundaries
 * 2. Synthesis: Extract Hann-windowed frames centered on pitch marks
 * 3. Modification: Adjust pitch mark spacing for pitch shifting, repeat/skip frames for time stretching
 * 4. Reconstruction: Overlap-add windowed frames to create output
 *
 * Reference: Moulines & Charpentier (1990) - "Pitch-synchronous waveform processing
 * techniques for text-to-speech synthesis using diphones"
 *
 * @example
 * ```typescript
 * // Simple pitch shift
 * const shifted = applyPsola(audioBuffer, { pitchShift: 5 }); // +5 semitones
 *
 * // Time stretch without pitch change
 * const stretched = applyPsola(audioBuffer, { timeStretch: 1.5 }); // 50% slower
 *
 * // Analyze once, synthesize multiple times
 * const analysis = analyzePitchMarks(audioBuffer);
 * const up = psolaSynthesize(audioBuffer, analysis, { pitchShift: 7 });
 * const down = psolaSynthesize(audioBuffer, analysis, { pitchShift: -5 });
 * ```
 */

/**
 * Options for PSOLA synthesis.
 */
export interface PsolaOptions {
  /**
   * Pitch shift in semitones.
   * Positive = higher pitch, negative = lower pitch.
   * Default: 0 (no pitch change).
   */
  pitchShift?: number;

  /**
   * Time stretch factor.
   * > 1.0 = slower (longer duration), < 1.0 = faster (shorter duration).
   * Default: 1.0 (no time change).
   */
  timeStretch?: number;

  /**
   * Window function for grain extraction.
   * - 'hann': Smooth, good general-purpose (default)
   * - 'hamming': Slightly different sidelobe characteristics
   * - 'triangular': Simple linear ramps
   */
  windowType?: 'hann' | 'hamming' | 'triangular';
}

/**
 * Result of pitch mark analysis.
 */
export interface PsolaAnalysis {
  /**
   * Sample indices of pitch period boundaries (pitch marks).
   * Each mark represents the center of a pitch period.
   */
  pitchMarks: number[];

  /**
   * Period lengths in samples at each pitch mark.
   * Used for window sizing during synthesis.
   */
  pitchPeriods: number[];

  /**
   * Sample rate of the analyzed audio.
   */
  sampleRate: number;

  /**
   * Whether each region is voiced (true) or unvoiced (false).
   * Unvoiced regions use fixed frame spacing instead of pitch-synchronous.
   */
  voicedFlags: boolean[];
}

/**
 * Options for pitch mark analysis.
 */
export interface PitchMarkOptions {
  /**
   * Minimum pitch to detect in Hz.
   * Lower pitches have longer periods.
   * Default: 50 Hz.
   */
  minPitchHz?: number;

  /**
   * Maximum pitch to detect in Hz.
   * Higher pitches have shorter periods.
   * Default: 800 Hz.
   */
  maxPitchHz?: number;

  /**
   * Analysis window size in samples for local pitch detection.
   * Default: 2048 samples.
   */
  windowSize?: number;

  /**
   * Hop size for analysis windows in samples.
   * Default: 512 samples.
   */
  hopSize?: number;

  /**
   * Threshold for voiced/unvoiced detection (0-1).
   * Higher values require clearer pitch for voiced classification.
   * Default: 0.2.
   */
  voicedThreshold?: number;

  /**
   * Fixed frame period in samples for unvoiced regions.
   * Default: 256 samples (~5.8ms at 44.1kHz).
   */
  unvoicedPeriod?: number;
}

/**
 * Default options for pitch mark analysis.
 */
const DEFAULT_PITCH_MARK_OPTIONS: Required<PitchMarkOptions> = {
  minPitchHz: 50,
  maxPitchHz: 800,
  windowSize: 2048,
  hopSize: 512,
  voicedThreshold: 0.2,
  unvoicedPeriod: 256,
};

/**
 * Default options for PSOLA synthesis.
 */
const DEFAULT_PSOLA_OPTIONS: Required<PsolaOptions> = {
  pitchShift: 0,
  timeStretch: 1.0,
  windowType: 'hann',
};

/**
 * Generate a Hann window of the specified length.
 *
 * The Hann window has the property that overlapping windows at 50% add to unity,
 * making it ideal for overlap-add synthesis.
 *
 * @param length - Window length in samples
 * @returns Float32Array containing the window values
 */
function generateHannWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)));
  }
  return window;
}

/**
 * Generate a Hamming window of the specified length.
 *
 * Similar to Hann but with slightly different coefficients,
 * providing better sidelobe suppression.
 *
 * @param length - Window length in samples
 * @returns Float32Array containing the window values
 */
function generateHammingWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    window[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (length - 1));
  }
  return window;
}

/**
 * Generate a triangular (Bartlett) window of the specified length.
 *
 * Simple linear ramps, less smooth than Hann but computationally trivial.
 *
 * @param length - Window length in samples
 * @returns Float32Array containing the window values
 */
function generateTriangularWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  const halfLength = (length - 1) / 2;
  for (let i = 0; i < length; i++) {
    window[i] = 1 - Math.abs((i - halfLength) / halfLength);
  }
  return window;
}

/**
 * Generate a window function of the specified type and length.
 *
 * @param type - Window type ('hann', 'hamming', or 'triangular')
 * @param length - Window length in samples
 * @returns Float32Array containing the window values
 */
function generateWindow(
  type: 'hann' | 'hamming' | 'triangular',
  length: number
): Float32Array {
  switch (type) {
    case 'hamming':
      return generateHammingWindow(length);
    case 'triangular':
      return generateTriangularWindow(length);
    case 'hann':
    default:
      return generateHannWindow(length);
  }
}

/**
 * Detect local pitch period using autocorrelation.
 *
 * This is a simplified version for per-frame analysis within PSOLA.
 * Returns the period in samples if voiced, or 0 if unvoiced.
 *
 * @param samples - Audio samples to analyze
 * @param minPeriod - Minimum period in samples
 * @param maxPeriod - Maximum period in samples
 * @param threshold - Confidence threshold for voiced detection
 * @returns Object with period (samples) and confidence (0-1)
 */
function detectLocalPitchPeriod(
  samples: Float32Array,
  minPeriod: number,
  maxPeriod: number,
  threshold: number
): { period: number; confidence: number; voiced: boolean } {
  const n = samples.length;

  // Compute energy
  let energy = 0;
  for (let i = 0; i < n; i++) {
    energy += samples[i] * samples[i];
  }

  // If near silence, return unvoiced
  if (energy < 1e-10) {
    return { period: 0, confidence: 0, voiced: false };
  }

  // Compute autocorrelation for each lag
  let maxCorr = -Infinity;
  let bestLag = 0;

  for (let lag = minPeriod; lag <= maxPeriod && lag < n / 2; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) {
      sum += samples[i] * samples[i + lag];
    }
    const corr = sum / energy;

    if (corr > maxCorr) {
      maxCorr = corr;
      bestLag = lag;
    }
  }

  // Check if confident enough to be voiced
  const voiced = maxCorr > threshold;

  return {
    period: voiced ? bestLag : 0,
    confidence: Math.max(0, maxCorr),
    voiced,
  };
}

/**
 * Find the nearest positive-going zero crossing to a given sample index.
 *
 * Used to refine pitch mark placement to consistent waveform positions.
 *
 * @param samples - Audio samples
 * @param targetIndex - Target sample index to search around
 * @param searchRadius - Number of samples to search in each direction
 * @returns Sample index of nearest zero crossing, or targetIndex if none found
 */
function findNearestZeroCrossing(
  samples: Float32Array,
  targetIndex: number,
  searchRadius: number
): number {
  const start = Math.max(0, targetIndex - searchRadius);
  const end = Math.min(samples.length - 1, targetIndex + searchRadius);

  let nearestCrossing = targetIndex;
  let minDistance = Infinity;

  for (let i = start; i < end; i++) {
    // Look for positive-going zero crossing (negative to positive)
    if (samples[i] <= 0 && samples[i + 1] > 0) {
      const distance = Math.abs(i - targetIndex);
      if (distance < minDistance) {
        minDistance = distance;
        nearestCrossing = i;
      }
    }
  }

  return nearestCrossing;
}

/**
 * Analyze audio to find pitch marks (epoch detection).
 *
 * This is the analysis phase of PSOLA. It detects pitch periods throughout
 * the audio and places pitch marks at period boundaries. For unvoiced
 * regions (consonants, noise), it uses fixed frame spacing.
 *
 * @param audioBuffer - The audio buffer to analyze
 * @param options - Analysis options
 * @returns PsolaAnalysis with pitch marks and period information
 *
 * @example
 * ```typescript
 * const analysis = analyzePitchMarks(audioBuffer);
 * console.log(`Found ${analysis.pitchMarks.length} pitch marks`);
 * ```
 */
export function analyzePitchMarks(
  audioBuffer: AudioBuffer,
  options?: PitchMarkOptions
): PsolaAnalysis {
  const opts = { ...DEFAULT_PITCH_MARK_OPTIONS, ...options };
  const sampleRate = audioBuffer.sampleRate;

  // Get mono audio data
  const samples = audioBuffer.getChannelData(0);
  const numSamples = samples.length;

  // Calculate period bounds in samples
  const minPeriod = Math.floor(sampleRate / opts.maxPitchHz);
  const maxPeriod = Math.ceil(sampleRate / opts.minPitchHz);

  // Analysis results
  const pitchMarks: number[] = [];
  const pitchPeriods: number[] = [];
  const voicedFlags: boolean[] = [];

  // Analyze pitch in overlapping windows
  const windowSize = opts.windowSize;
  const hopSize = opts.hopSize;
  const numFrames = Math.ceil((numSamples - windowSize) / hopSize) + 1;

  // Store pitch period estimates for each frame
  const framePeriods: number[] = [];
  const frameVoiced: boolean[] = [];
  const frameCenters: number[] = [];

  for (let frame = 0; frame < numFrames; frame++) {
    const frameStart = frame * hopSize;
    const frameEnd = Math.min(frameStart + windowSize, numSamples);
    const frameCenter = Math.floor((frameStart + frameEnd) / 2);

    // Extract frame samples
    const frameSamples = samples.slice(frameStart, frameEnd);

    // Detect pitch in this frame
    const result = detectLocalPitchPeriod(
      frameSamples,
      minPeriod,
      maxPeriod,
      opts.voicedThreshold
    );

    framePeriods.push(result.voiced ? result.period : opts.unvoicedPeriod);
    frameVoiced.push(result.voiced);
    frameCenters.push(frameCenter);
  }

  // Now place pitch marks based on the detected periods
  // Start from the beginning and place marks at pitch period intervals
  let currentSample = 0;

  while (currentSample < numSamples) {
    // Find which frame this sample belongs to
    const frameIndex = Math.min(
      Math.floor(currentSample / hopSize),
      numFrames - 1
    );
    const period = framePeriods[frameIndex];
    const voiced = frameVoiced[frameIndex];

    // For voiced regions, try to refine pitch mark to zero crossing
    let pitchMark = currentSample;
    if (voiced && period > 0) {
      const searchRadius = Math.floor(period / 4);
      pitchMark = findNearestZeroCrossing(samples, currentSample, searchRadius);
    }

    // Ensure pitch mark is within bounds
    pitchMark = Math.max(0, Math.min(numSamples - 1, pitchMark));

    // Add pitch mark
    pitchMarks.push(pitchMark);
    pitchPeriods.push(period);
    voicedFlags.push(voiced);

    // Move to next pitch mark
    currentSample = pitchMark + period;
  }

  return {
    pitchMarks,
    pitchPeriods,
    sampleRate,
    voicedFlags,
  };
}

/**
 * Synthesize audio with pitch/time modification using PSOLA.
 *
 * This is the synthesis phase of PSOLA. It extracts windowed frames centered
 * on each pitch mark from the input, then reconstructs the output by
 * overlap-adding frames at modified positions.
 *
 * For pitch shifting:
 * - Output pitch period = Input pitch period / (2^(semitones/12))
 * - Higher pitch = shorter periods = marks closer together
 *
 * For time stretching:
 * - Repeat frames to lengthen, skip frames to shorten
 * - Pitch is preserved because period spacing within repetitions is unchanged
 *
 * @param audioBuffer - The original audio buffer
 * @param analysis - Pitch mark analysis from analyzePitchMarks()
 * @param options - Synthesis options (pitch shift, time stretch, window type)
 * @returns New AudioBuffer with modifications applied
 *
 * @example
 * ```typescript
 * const analysis = analyzePitchMarks(audioBuffer);
 *
 * // Pitch shift up 5 semitones
 * const higher = psolaSynthesize(audioBuffer, analysis, { pitchShift: 5 });
 *
 * // Time stretch to 150%
 * const slower = psolaSynthesize(audioBuffer, analysis, { timeStretch: 1.5 });
 * ```
 */
export function psolaSynthesize(
  audioBuffer: AudioBuffer,
  analysis: PsolaAnalysis,
  options?: PsolaOptions
): AudioBuffer {
  const opts = { ...DEFAULT_PSOLA_OPTIONS, ...options };
  const { pitchMarks, pitchPeriods, sampleRate, voicedFlags } = analysis;

  // Get input samples
  const inputSamples = audioBuffer.getChannelData(0);
  const inputLength = inputSamples.length;

  // Calculate pitch shift ratio
  // Formula: ratio = 2^(semitones/12)
  // For higher pitch, ratio > 1 means output periods are shorter
  const pitchRatio = Math.pow(2, opts.pitchShift / 12);

  // Calculate output length based on time stretch
  const outputLength = Math.ceil(inputLength * opts.timeStretch);

  // Create output buffer
  const audioContext = new OfflineAudioContext(1, outputLength, sampleRate);
  const outputBuffer = audioContext.createBuffer(1, outputLength, sampleRate);
  const outputSamples = outputBuffer.getChannelData(0);

  // Initialize output to zeros
  outputSamples.fill(0);

  // Also track normalization (sum of window values at each output position)
  const windowSum = new Float32Array(outputLength);

  // Process each pitch mark
  let outputPosition = 0;
  let inputMarkIndex = 0;

  while (outputPosition < outputLength && inputMarkIndex < pitchMarks.length) {
    const inputMark = pitchMarks[inputMarkIndex];
    const period = pitchPeriods[inputMarkIndex];
    const voiced = voicedFlags[inputMarkIndex];

    // Window size is 2x the period (centered on pitch mark)
    const windowLength = Math.max(64, Math.min(4096, period * 2));
    const halfWindow = Math.floor(windowLength / 2);

    // Generate window function
    const window = generateWindow(opts.windowType, windowLength);

    // Extract and window the grain from input
    const grain = new Float32Array(windowLength);
    for (let i = 0; i < windowLength; i++) {
      const inputIndex = inputMark - halfWindow + i;
      if (inputIndex >= 0 && inputIndex < inputLength) {
        grain[i] = inputSamples[inputIndex] * window[i];
      }
    }

    // Calculate output position for this grain
    const outputMark = Math.floor(outputPosition);

    // Add grain to output (overlap-add)
    for (let i = 0; i < windowLength; i++) {
      const outputIndex = outputMark - halfWindow + i;
      if (outputIndex >= 0 && outputIndex < outputLength) {
        outputSamples[outputIndex] += grain[i];
        windowSum[outputIndex] += window[i];
      }
    }

    // Calculate next output position based on pitch shift
    // For voiced regions, use pitch-modified period
    // For unvoiced regions, keep original period (pitch shift doesn't apply)
    const outputPeriod = voiced ? period / pitchRatio : period;

    // Apply time stretch to the output position increment
    outputPosition += outputPeriod * opts.timeStretch;

    // Move to next input mark
    // For time stretch < 1 (faster), we may skip input marks
    // For time stretch > 1 (slower), we may repeat input marks
    const inputIncrement = outputPeriod / opts.timeStretch;
    const targetInputPosition = inputMark + inputIncrement;

    // Find the next input mark that's past our target
    while (
      inputMarkIndex < pitchMarks.length - 1 &&
      pitchMarks[inputMarkIndex + 1] <= targetInputPosition
    ) {
      inputMarkIndex++;
    }

    // If time stretching, we may need to repeat the current mark
    if (opts.timeStretch > 1) {
      // Check if we should repeat this mark
      const nextInputMark =
        inputMarkIndex < pitchMarks.length - 1
          ? pitchMarks[inputMarkIndex + 1]
          : inputLength;
      const distanceToNext = nextInputMark - inputMark;

      // If output hasn't advanced past this input period, don't increment input mark
      if (outputPosition / opts.timeStretch < inputMark + distanceToNext) {
        // Keep using current input mark
      } else {
        inputMarkIndex++;
      }
    } else {
      // For time compression or normal speed, always advance
      inputMarkIndex++;
    }
  }

  // Normalize output by window sum to prevent amplitude variations
  // Only normalize where windows overlap (windowSum > 0)
  for (let i = 0; i < outputLength; i++) {
    if (windowSum[i] > 0.01) {
      outputSamples[i] /= windowSum[i];
    }
  }

  return outputBuffer;
}

/**
 * Apply PSOLA pitch/time modification in one step.
 *
 * This is a convenience function that performs both analysis and synthesis.
 * For multiple modifications of the same audio, it's more efficient to
 * call analyzePitchMarks() once and then psolaSynthesize() multiple times.
 *
 * @param audioBuffer - The audio buffer to process
 * @param options - Combined analysis and synthesis options
 * @returns New AudioBuffer with modifications applied
 *
 * @example
 * ```typescript
 * // Pitch shift up 3 semitones
 * const shifted = applyPsola(audioBuffer, { pitchShift: 3 });
 *
 * // Time stretch to 80% speed
 * const faster = applyPsola(audioBuffer, { timeStretch: 0.8 });
 *
 * // Both pitch shift and time stretch
 * const modified = applyPsola(audioBuffer, {
 *   pitchShift: -2,
 *   timeStretch: 1.2,
 * });
 * ```
 */
export function applyPsola(
  audioBuffer: AudioBuffer,
  options?: PsolaOptions & PitchMarkOptions
): AudioBuffer {
  // Extract pitch mark options
  const pitchMarkOptions: PitchMarkOptions = {
    minPitchHz: options?.minPitchHz,
    maxPitchHz: options?.maxPitchHz,
    windowSize: options?.windowSize,
    hopSize: options?.hopSize,
    voicedThreshold: options?.voicedThreshold,
    unvoicedPeriod: options?.unvoicedPeriod,
  };

  // Extract PSOLA synthesis options
  const psolaOptions: PsolaOptions = {
    pitchShift: options?.pitchShift,
    timeStretch: options?.timeStretch,
    windowType: options?.windowType,
  };

  // Analyze and synthesize
  const analysis = analyzePitchMarks(audioBuffer, pitchMarkOptions);
  return psolaSynthesize(audioBuffer, analysis, psolaOptions);
}

/**
 * Cache for PSOLA analysis results.
 *
 * Stores analysis results keyed by AudioBuffer reference to avoid
 * redundant computation when the same buffer is processed multiple times.
 */
export class PsolaAnalysisCache {
  private _cache = new WeakMap<AudioBuffer, PsolaAnalysis>();
  private _optionsCache = new WeakMap<AudioBuffer, string>();

  /**
   * Get cached analysis or compute and cache it.
   *
   * @param audioBuffer - The audio buffer to analyze
   * @param options - Analysis options (used to invalidate cache if changed)
   * @returns Cached or newly computed analysis
   */
  getAnalysis(audioBuffer: AudioBuffer, options?: PitchMarkOptions): PsolaAnalysis {
    const optionsKey = JSON.stringify(options ?? {});
    const cachedOptions = this._optionsCache.get(audioBuffer);

    // Check if we have a cached analysis with the same options
    if (cachedOptions === optionsKey) {
      const cached = this._cache.get(audioBuffer);
      if (cached) {
        return cached;
      }
    }

    // Compute new analysis
    const analysis = analyzePitchMarks(audioBuffer, options);
    this._cache.set(audioBuffer, analysis);
    this._optionsCache.set(audioBuffer, optionsKey);

    return analysis;
  }

  /**
   * Clear the cache.
   */
  clear(): void {
    // WeakMaps don't have a clear method, so we just replace them
    this._cache = new WeakMap();
    this._optionsCache = new WeakMap();
  }
}

/**
 * Process audio buffer through PSOLA with caching.
 *
 * This helper maintains an analysis cache and provides a simple interface
 * for pitch/time modification.
 */
export class PsolaProcessor {
  private _cache = new PsolaAnalysisCache();
  private _defaultOptions: PitchMarkOptions;

  /**
   * Create a new PSOLA processor.
   *
   * @param options - Default pitch mark options for analysis
   */
  constructor(options?: PitchMarkOptions) {
    this._defaultOptions = options ?? {};
  }

  /**
   * Process an audio buffer with pitch/time modification.
   *
   * Uses cached analysis if available for the same buffer.
   *
   * @param audioBuffer - The audio to process
   * @param options - Synthesis options
   * @returns Processed audio buffer
   */
  process(audioBuffer: AudioBuffer, options?: PsolaOptions): AudioBuffer {
    const analysis = this._cache.getAnalysis(audioBuffer, this._defaultOptions);
    return psolaSynthesize(audioBuffer, analysis, options);
  }

  /**
   * Pre-analyze a buffer to populate the cache.
   *
   * Call this ahead of time if you know you'll need to process a buffer.
   *
   * @param audioBuffer - The audio to analyze
   * @returns The analysis result
   */
  preAnalyze(audioBuffer: AudioBuffer): PsolaAnalysis {
    return this._cache.getAnalysis(audioBuffer, this._defaultOptions);
  }

  /**
   * Clear the analysis cache.
   */
  clearCache(): void {
    this._cache.clear();
  }
}
