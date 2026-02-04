/**
 * MelodyPlayer - Web Audio synthesis engine for UTAU voicebank playback.
 *
 * Takes audio samples with oto.ini parameters and schedules pitch-shifted
 * note sequences using the Web Audio API. Designed for future DAW extensibility.
 *
 * Supports two pitch-shifting modes:
 * - Granular synthesis (default): Formant-preserving, natural sound across wide pitch range
 * - Playback rate: Traditional method, faster but causes formant distortion
 *
 * @example
 * ```typescript
 * const player = new MelodyPlayer(audioContext);
 *
 * const notes: NoteEvent[] = [
 *   { pitch: 0, startTime: 0, duration: 0.5 },
 *   { pitch: 2, startTime: 0.5, duration: 0.5 },
 *   { pitch: 4, startTime: 1.0, duration: 0.5 },
 * ];
 *
 * player.playSequence(notes, { otoEntry, audioBuffer });
 * ```
 */

import type { OtoEntry } from './types.js';
import { GranularPitchShifter, type PlaybackHandle, type VibratoParams } from './granular-pitch-shifter.js';
import { detectRepresentativePitch, calculateOptimalGrainSize } from '../utils/pitch-detection.js';
import { SpectralDistanceCache, type SpectralDistanceOptions } from '../utils/spectral-analysis.js';
import {
  calculateNormalizationGain,
  calculateJoinGainCorrection,
  LoudnessAnalysisCache,
  type NormalizationOptions,
  type JoinCorrectionOptions,
} from '../utils/loudness-analysis.js';

// Re-export spectral analysis types for consumers using dynamic overlap
export type { SpectralDistanceOptions, SpectralDistanceResult } from '../utils/spectral-analysis.js';

// Re-export loudness analysis types for consumers using loudness normalization
export type {
  NormalizationOptions,
  JoinCorrectionOptions,
} from '../utils/loudness-analysis.js';

// Re-export VibratoParams for consumers
export type { VibratoParams } from './granular-pitch-shifter.js';

/**
 * ADSR (Attack-Decay-Sustain-Release) envelope for shaping note dynamics.
 *
 * Controls amplitude over the lifetime of a note:
 * - Attack: Ramp from 0 to peak
 * - Decay: Ramp from peak to sustain level
 * - Sustain: Hold at sustain level during note body
 * - Release: Ramp from sustain to 0 at note end
 *
 * @example
 * ```typescript
 * const envelope: ADSREnvelope = {
 *   attack: 10,    // 10ms attack
 *   decay: 50,     // 50ms decay
 *   sustain: 0.8,  // 80% sustain level
 *   release: 50,   // 50ms release
 * };
 * ```
 */
export interface ADSREnvelope {
  /** Attack time in milliseconds - time to ramp from 0 to peak */
  attack: number;
  /** Decay time in milliseconds - time to ramp from peak to sustain level */
  decay: number;
  /** Sustain level (0-1) - relative level to hold during note body */
  sustain: number;
  /** Release time in milliseconds - time to ramp from sustain to 0 at note end */
  release: number;
}

/**
 * Default ADSR envelope for notes without individual envelopes.
 *
 * These values provide a natural-sounding envelope that avoids clicks
 * while maintaining good articulation.
 */
export const DEFAULT_ENVELOPE: ADSREnvelope = {
  attack: 10,    // 10ms attack (quick, avoids click)
  decay: 50,     // 50ms decay
  sustain: 0.8,  // 80% sustain level
  release: 50,   // 50ms release
};

/**
 * A note event in a melody sequence.
 *
 * Designed for DAW extensibility - pitch is relative semitones,
 * timing is in seconds, and velocity is prepared for future dynamics support.
 */
export interface NoteEvent {
  /** Pitch shift in semitones relative to base (0 = no shift, positive = higher) */
  pitch: number;
  /** Start time in seconds from sequence start */
  startTime: number;
  /** Duration in seconds */
  duration: number;
  /** Velocity/dynamics (0-1, default 1). Reserved for future use. */
  velocity?: number;
  /** Optional ADSR envelope for this note. Overrides default envelope if provided. */
  envelope?: ADSREnvelope;
  /**
   * Optional vibrato modulation for this note.
   *
   * Vibrato adds expressiveness by periodically modulating the pitch.
   * Only applied when using granular pitch shifting mode.
   *
   * @example
   * ```typescript
   * {
   *   pitch: 0,
   *   startTime: 0,
   *   duration: 2.0,
   *   vibrato: { rate: 5, depth: 40, delay: 300 }
   * }
   * ```
   */
  vibrato?: VibratoParams;
}

/**
 * A note event with an associated phoneme/sample alias for multi-sample synthesis.
 *
 * Extends NoteEvent to support phrase playback where each note can specify
 * which phoneme sample to use from the voicebank. This enables concatenative
 * synthesis where different phonemes are stitched together to form phrases.
 *
 * @example
 * ```typescript
 * const phrase: PhraseNote[] = [
 *   { alias: 'ka', pitch: 0, startTime: 0, duration: 0.3 },
 *   { alias: 'a', pitch: 0, startTime: 0.3, duration: 0.2 },
 *   { alias: 'sa', pitch: 2, startTime: 0.5, duration: 0.3 },
 *   { alias: 'ta', pitch: 4, startTime: 0.8, duration: 0.3 },
 * ];
 * ```
 */
export interface PhraseNote extends NoteEvent {
  /**
   * Phoneme/sample alias to use for this note.
   *
   * This maps to an OtoEntry alias in the voicebank (e.g., 'ka', '- ka', 'a ka').
   * The alias determines which audio sample and timing parameters are used
   * when rendering this note.
   */
  alias: string;
}

/**
 * Crossfade curve type for blending between notes.
 *
 * - 'linear': Simple linear ramp (faster, slight dip in perceived volume)
 * - 'equal-power': Sine/cosine curve maintaining constant perceived loudness
 */
export type CrossfadeType = 'linear' | 'equal-power';

/**
 * Options for synthesizing a note sequence.
 */
export interface SynthesisOptions {
  /** Oto.ini entry defining sample boundaries and timing */
  otoEntry: OtoEntry;
  /** The decoded audio buffer for the sample */
  audioBuffer: AudioBuffer;
  /**
   * Use granular pitch shifting for formant preservation (default: true).
   *
   * When true, uses Tone.js GrainPlayer for natural-sounding pitch shifts
   * that preserve vocal formants. When false, uses traditional playback-rate
   * shifting which is faster but causes the "chipmunk effect" at high pitches.
   *
   * Granular mode is recommended for pitch shifts beyond +-3 semitones.
   */
  useGranular?: boolean;
  /**
   * Use adaptive grain sizing based on detected pitch (default: false).
   *
   * When true, analyzes the audio to detect its fundamental frequency and
   * sets the grain size to approximately 2x the pitch period. This reduces
   * "beating" artifacts that occur when grain boundaries cut through pitch cycles.
   *
   * When enabled, this overrides the grainSize option.
   *
   * @example
   * ```typescript
   * player.playSequence(notes, {
   *   otoEntry,
   *   audioBuffer,
   *   useAdaptiveGrainSize: true, // Automatically detect optimal grain size
   * });
   * ```
   */
  useAdaptiveGrainSize?: boolean;
  /**
   * Grain size in seconds for granular synthesis (default: 0.1).
   *
   * Smaller values produce smoother results but use more CPU.
   * Typical range: 0.05 to 0.2 seconds.
   *
   * This is overridden when useAdaptiveGrainSize is true.
   */
  grainSize?: number;
  /**
   * Grain overlap factor for granular synthesis (default: 0.5).
   *
   * Higher values produce smoother crossfades between grains.
   * Range: 0 to 1.
   */
  grainOverlap?: number;
  /**
   * Default ADSR envelope for notes without individual envelopes.
   *
   * If not provided, uses DEFAULT_ENVELOPE. Notes can override this
   * by specifying their own envelope in NoteEvent.envelope.
   */
  defaultEnvelope?: ADSREnvelope;
  /**
   * Type of crossfade curve to use for note transitions (default: 'equal-power').
   *
   * - 'linear': Simple linear ramp. Faster but can cause a slight dip in
   *   perceived volume during crossfades.
   * - 'equal-power': Uses sine/cosine curves that maintain constant perceived
   *   loudness during crossfades. Recommended for natural-sounding transitions.
   *
   * Equal-power crossfades use the formula:
   * - Fade out: gain = cos(t * PI/2)
   * - Fade in: gain = sin(t * PI/2)
   *
   * This ensures the sum of squares of both gains equals 1 at all points,
   * maintaining constant power throughout the crossfade.
   */
  crossfadeType?: CrossfadeType;
  /**
   * Use PSOLA (Pitch-Synchronous Overlap-Add) for pitch shifting (default: false).
   *
   * When enabled, uses TD-PSOLA algorithm which aligns grain windows to pitch
   * period boundaries, eliminating beating artifacts. This is the gold standard
   * for pitch manipulation in speech/singing synthesis (used by Praat, UTAU, etc.).
   *
   * PSOLA provides the highest quality pitch shifting for pitched audio, but
   * has higher CPU cost for analysis. Best used when:
   * - Audio has clear pitch (voiced vocals)
   * - Highest quality is needed
   * - Pitch shifts are moderate (+-12 semitones)
   *
   * When usePsola is true, useAdaptiveGrainSize and grainSize are ignored
   * since PSOLA uses pitch-synchronous grain alignment.
   *
   * @example
   * ```typescript
   * player.playSequence(notes, {
   *   otoEntry,
   *   audioBuffer,
   *   usePsola: true, // Use PSOLA for highest quality
   * });
   * ```
   */
  usePsola?: boolean;
}

/**
 * Sample data containing both audio and oto parameters for a phoneme.
 *
 * Used by playPhrase() to look up the correct sample and timing
 * parameters for each note in a phrase.
 */
export interface SampleData {
  /** The decoded audio buffer for this sample */
  audioBuffer: AudioBuffer;
  /** Oto.ini entry defining timing parameters for this sample */
  otoEntry: OtoEntry;
}

/**
 * Internal representation of an active audio node for cleanup tracking.
 */
interface ActiveNode {
  source: AudioBufferSourceNode | null;
  gainNode: GainNode | null;
  granularHandle: PlaybackHandle | null;
  startTime: number;
  endTime: number;
}

/**
 * MelodyPlayer synthesizes note sequences using UTAU samples.
 *
 * Features:
 * - Granular pitch shifting for formant-preserving sound (default)
 * - Fallback to playback-rate pitch shifting for speed
 * - Oto.ini parameter application (offset, cutoff, preutterance, overlap)
 * - Crossfade/overlap handling between consecutive notes
 * - Precise scheduling using AudioContext timing
 *
 * Design principles for DAW extensibility:
 * - Scheduling logic is separate from audio rendering
 * - Accepts generic NoteEvent sequences (no hardcoded patterns)
 * - Transforms are designed to be pluggable (pitch curves, vibrato)
 */
export class MelodyPlayer {
  private readonly _audioContext: AudioContext;
  private _granularShifter: GranularPitchShifter | null = null;
  private _activeNodes: ActiveNode[] = [];
  private _isPlaying = false;
  private _sequenceStartTime = 0;

  // Current synthesis settings
  private _useGranular = true;
  private _grainSize = 0.1;
  private _grainOverlap = 0.5;
  private _defaultEnvelope: ADSREnvelope = DEFAULT_ENVELOPE;
  private _crossfadeType: CrossfadeType = 'equal-power';
  private _usePsola = false;

  // Dynamic overlap cache
  private _spectralDistanceCache: SpectralDistanceCache | null = null;

  // Loudness analysis cache
  private _loudnessAnalysisCache: LoudnessAnalysisCache | null = null;

  /**
   * Create a new MelodyPlayer.
   *
   * @param audioContext - The Web Audio AudioContext to use for playback
   */
  constructor(audioContext: AudioContext) {
    this._audioContext = audioContext;
  }

  /**
   * Generate an equal-power crossfade curve.
   *
   * Equal-power crossfades maintain constant perceived loudness during transitions
   * by using sine/cosine curves. The sum of squares of fade-in and fade-out gains
   * equals 1 at all points: sin^2(t) + cos^2(t) = 1.
   *
   * @param length - Number of samples in the curve
   * @param fadeIn - If true, generates fade-in curve (sine); if false, fade-out (cosine)
   * @param baseGain - Peak gain value (default 1)
   * @returns Float32Array containing the curve values
   */
  private _generateEqualPowerCurve(
    length: number,
    fadeIn: boolean,
    baseGain = 1
  ): Float32Array {
    // Minimum of 2 samples required for setValueCurveAtTime
    const safeLength = Math.max(2, length);
    const curve = new Float32Array(safeLength);

    for (let i = 0; i < safeLength; i++) {
      const t = i / (safeLength - 1);
      // Fade in: sin(t * PI/2) goes from 0 to 1
      // Fade out: cos(t * PI/2) goes from 1 to 0
      curve[i] = fadeIn
        ? Math.sin(t * Math.PI / 2) * baseGain
        : Math.cos(t * Math.PI / 2) * baseGain;
    }

    return curve;
  }

  /**
   * Generate a linear crossfade curve.
   *
   * @param length - Number of samples in the curve
   * @param fadeIn - If true, generates fade-in curve; if false, fade-out
   * @param baseGain - Peak gain value (default 1)
   * @returns Float32Array containing the curve values
   */
  private _generateLinearCurve(
    length: number,
    fadeIn: boolean,
    baseGain = 1
  ): Float32Array {
    // Minimum of 2 samples required for setValueCurveAtTime
    const safeLength = Math.max(2, length);
    const curve = new Float32Array(safeLength);

    for (let i = 0; i < safeLength; i++) {
      const t = i / (safeLength - 1);
      curve[i] = fadeIn ? t * baseGain : (1 - t) * baseGain;
    }

    return curve;
  }

  /**
   * Generate a crossfade curve based on the current crossfade type setting.
   *
   * @param durationSeconds - Duration of the fade in seconds
   * @param fadeIn - If true, generates fade-in curve; if false, fade-out
   * @param baseGain - Peak gain value (default 1)
   * @returns Float32Array containing the curve values
   */
  private _generateCrossfadeCurve(
    durationSeconds: number,
    fadeIn: boolean,
    baseGain = 1
  ): Float32Array {
    // Calculate curve length based on sample rate
    // Use a reasonable resolution: ~100 samples per 100ms, minimum 2
    const length = Math.max(2, Math.ceil(durationSeconds * this._audioContext.sampleRate / 441));

    return this._crossfadeType === 'equal-power'
      ? this._generateEqualPowerCurve(length, fadeIn, baseGain)
      : this._generateLinearCurve(length, fadeIn, baseGain);
  }

  /**
   * Whether the player is currently playing a sequence.
   */
  get isPlaying(): boolean {
    return this._isPlaying;
  }

  /**
   * The AudioContext used by this player.
   */
  get audioContext(): AudioContext {
    return this._audioContext;
  }

  /**
   * Get or create the GranularPitchShifter instance.
   */
  private _getGranularShifter(): GranularPitchShifter {
    if (!this._granularShifter) {
      this._granularShifter = new GranularPitchShifter(this._audioContext);
    }
    return this._granularShifter;
  }

  /**
   * Get or create the SpectralDistanceCache instance.
   */
  private _getSpectralCache(): SpectralDistanceCache {
    if (!this._spectralDistanceCache) {
      this._spectralDistanceCache = new SpectralDistanceCache();
    }
    return this._spectralDistanceCache;
  }

  /**
   * Get or create the LoudnessAnalysisCache instance.
   */
  private _getLoudnessCache(): LoudnessAnalysisCache {
    if (!this._loudnessAnalysisCache) {
      this._loudnessAnalysisCache = new LoudnessAnalysisCache();
    }
    return this._loudnessAnalysisCache;
  }

  /**
   * Calculate adaptive grain size based on detected pitch.
   *
   * Analyzes the audio buffer to detect its fundamental frequency,
   * then calculates an optimal grain size (approximately 2x pitch period).
   *
   * @param audioBuffer - The audio buffer to analyze
   * @returns Optimal grain size in seconds
   */
  private _calculateAdaptiveGrainSize(audioBuffer: AudioBuffer): number {
    // Use representative pitch detection for more stable results
    const pitchPeriod = detectRepresentativePitch(audioBuffer, {
      numSamples: 5,
      sampleDuration: 0.05,
      startOffset: 0.05, // Skip initial attack
    });

    return calculateOptimalGrainSize(pitchPeriod, {
      periodMultiplier: 2.0,
      minGrainSize: 0.02,
      maxGrainSize: 0.2,
      defaultGrainSize: 0.1,
    });
  }

  /**
   * Play a sequence of notes using a single sample.
   *
   * Each note is pitch-shifted and scheduled according to its timing.
   * Consecutive notes are crossfaded using the oto overlap parameter.
   *
   * @param notes - Array of note events to play
   * @param options - Synthesis options including oto entry and audio buffer
   */
  async playSequence(notes: NoteEvent[], options: SynthesisOptions): Promise<void> {
    if (notes.length === 0) {
      return;
    }

    // Stop any existing playback
    this.stop();

    const {
      otoEntry,
      audioBuffer,
      useGranular = true,
      useAdaptiveGrainSize = false,
      grainSize = 0.1,
      grainOverlap = 0.5,
      defaultEnvelope = DEFAULT_ENVELOPE,
      crossfadeType = 'equal-power',
      usePsola = false,
    } = options;

    // Calculate grain size - use adaptive if enabled, otherwise use provided value
    // Note: When usePsola is true, grainSize is ignored by the granular shifter
    let effectiveGrainSize = grainSize;
    if (useAdaptiveGrainSize && useGranular && !usePsola) {
      effectiveGrainSize = this._calculateAdaptiveGrainSize(audioBuffer);
    }

    // Store synthesis settings
    this._useGranular = useGranular;
    this._grainSize = effectiveGrainSize;
    this._grainOverlap = grainOverlap;
    this._defaultEnvelope = defaultEnvelope;
    this._crossfadeType = crossfadeType;
    this._usePsola = usePsola;

    // Resume context if suspended (browser autoplay policy).
    // Must await to ensure currentTime is advancing before we capture it.
    if (this._audioContext.state === 'suspended') {
      await this._audioContext.resume();
    }

    // Calculate sample boundaries from oto parameters (convert ms to seconds)
    const sampleStart = otoEntry.offset / 1000;
    const sampleEnd = this._calculateSampleEnd(otoEntry, audioBuffer.duration);
    const sampleDuration = Math.max(0, sampleEnd - sampleStart);

    if (sampleDuration <= 0) {
      console.warn('MelodyPlayer: Invalid sample boundaries (offset >= cutoff)');
      return;
    }

    // Preutterance and overlap in seconds
    const preutterance = otoEntry.preutterance / 1000;
    const overlap = otoEntry.overlap / 1000;

    // Sort notes by start time for proper overlap handling
    const sortedNotes = [...notes].sort((a, b) => a.startTime - b.startTime);

    // Record sequence start time for position tracking
    this._sequenceStartTime = this._audioContext.currentTime;
    this._isPlaying = true;

    // Schedule each note
    for (let i = 0; i < sortedNotes.length; i++) {
      const note = sortedNotes[i];
      const prevNote = i > 0 ? sortedNotes[i - 1] : null;

      this._scheduleNote(note, prevNote, {
        sampleStart,
        sampleDuration,
        preutterance,
        overlap,
        audioBuffer,
      });
    }

    // Set up cleanup when last note ends
    const lastNote = sortedNotes[sortedNotes.length - 1];
    const sequenceEnd = lastNote.startTime + lastNote.duration;
    const cleanupTime = this._sequenceStartTime + sequenceEnd + 0.1; // Small buffer

    // Schedule cleanup
    setTimeout(() => {
      if (this._isPlaying) {
        this._cleanup();
      }
    }, (cleanupTime - this._audioContext.currentTime) * 1000);
  }

/**
   * Options for phrase playback.
   */
  /**
   * Play a phrase of notes where each note uses a different sample.
   *
   * This is the core method for concatenative synthesis, where different
   * phoneme samples are stitched together to form natural-sounding phrases.
   * Each note specifies its alias, and the corresponding sample is looked up
   * from the sampleMap.
   *
   * Key differences from playSequence():
   * - Each note can use a different audio sample with different oto parameters
   * - Preutterance and overlap are calculated per-sample, not globally
   * - Crossfades use the current note's overlap parameter
   *
   * @param notes - Array of phrase notes with aliases
   * @param sampleMap - Map from alias to sample data (audio + oto entry)
   * @param options - Optional playback options
   *
   * @example
   * ```typescript
   * const phrase: PhraseNote[] = [
   *   { alias: 'ka', pitch: 0, startTime: 0, duration: 0.3 },
   *   { alias: 'a', pitch: 0, startTime: 0.3, duration: 0.2 },
   *   { alias: 'sa', pitch: 2, startTime: 0.5, duration: 0.3 },
   * ];
   *
   * const sampleMap = new Map<string, SampleData>([
   *   ['ka', { audioBuffer: kaBuffer, otoEntry: kaOto }],
   *   ['a', { audioBuffer: aBuffer, otoEntry: aOto }],
   *   ['sa', { audioBuffer: saBuffer, otoEntry: saOto }],
   * ]);
   *
   * // Basic playback
   * player.playPhrase(phrase, sampleMap);
   *
   * // With adaptive grain sizing for better quality
   * player.playPhrase(phrase, sampleMap, { useAdaptiveGrainSize: true });
   * ```
   */
  async playPhrase(
    notes: PhraseNote[],
    sampleMap: Map<string, SampleData>,
    options?: {
      /** Use granular pitch shifting (default: true) */
      useGranular?: boolean;
      /** Use adaptive grain sizing per sample (default: false) */
      useAdaptiveGrainSize?: boolean;
      /** Default grain size if not using adaptive (default: 0.1) */
      grainSize?: number;
      /** Grain overlap factor (default: 0.5) */
      grainOverlap?: number;
      /** Default ADSR envelope */
      defaultEnvelope?: ADSREnvelope;
      /** Crossfade curve type (default: 'equal-power') */
      crossfadeType?: CrossfadeType;
      /**
       * Use dynamic overlap based on spectral distance (default: false).
       *
       * When enabled, analyzes the spectral characteristics at sample join points
       * and dynamically extends the overlap/crossfade duration when consecutive
       * samples have mismatched spectral envelopes. This produces smoother
       * transitions between phonemes with different timbres.
       *
       * The oto.ini overlap value is used as a baseline, and can be scaled up
       * to `dynamicOverlapMaxScale` times based on spectral distance.
       */
      useDynamicOverlap?: boolean;
      /**
       * Maximum scale factor for dynamic overlap (default: 2.0).
       *
       * When spectral distance is maximum (1.0), the overlap will be
       * otoOverlap * dynamicOverlapMaxScale. For example, if otoOverlap is 30ms
       * and maxScale is 2.0, the maximum dynamic overlap would be 60ms.
       *
       * Only used when useDynamicOverlap is true.
       */
      dynamicOverlapMaxScale?: number;
      /**
       * Options for spectral distance calculation.
       *
       * Only used when useDynamicOverlap is true.
       */
      spectralDistanceOptions?: SpectralDistanceOptions;
      /**
       * Use loudness normalization to reduce amplitude discontinuities (default: false).
       *
       * When enabled, analyzes the loudness of each sample and applies gain corrections
       * to reduce level differences between samples. This produces smoother transitions
       * even when samples were recorded at different levels.
       *
       * Two normalization strategies are applied:
       * 1. Global normalization: Each sample is normalized toward a target RMS level
       * 2. Local join correction: Gain adjustments are made at join points to smooth
       *    the transition between consecutive samples
       */
      useLoudnessNormalization?: boolean;
      /**
       * Options for loudness normalization.
       *
       * Only used when useLoudnessNormalization is true.
       */
      normalizationOptions?: NormalizationOptions;
      /**
       * Options for join gain correction.
       *
       * Only used when useLoudnessNormalization is true.
       */
      joinCorrectionOptions?: JoinCorrectionOptions;
      /**
       * Use PSOLA (Pitch-Synchronous Overlap-Add) for pitch shifting (default: false).
       *
       * When enabled, uses TD-PSOLA algorithm which aligns grain windows to pitch
       * period boundaries, eliminating beating artifacts. This is the gold standard
       * for pitch manipulation in speech/singing synthesis.
       *
       * When usePsola is true, useAdaptiveGrainSize and grainSize are ignored
       * since PSOLA uses pitch-synchronous grain alignment.
       */
      usePsola?: boolean;
    }
  ): Promise<void> {
    if (notes.length === 0) {
      return;
    }

    // Stop any existing playback
    this.stop();

    // Extract options with defaults
    const {
      useGranular = true,
      useAdaptiveGrainSize = false,
      grainSize = 0.1,
      grainOverlap = 0.5,
      defaultEnvelope = DEFAULT_ENVELOPE,
      crossfadeType = 'equal-power',
      useDynamicOverlap = false,
      dynamicOverlapMaxScale = 2.0,
      spectralDistanceOptions,
      useLoudnessNormalization = false,
      normalizationOptions,
      joinCorrectionOptions,
      usePsola = false,
    } = options ?? {};

    // Store synthesis settings
    this._useGranular = useGranular;
    this._grainSize = grainSize;
    this._grainOverlap = grainOverlap;
    this._defaultEnvelope = defaultEnvelope;
    this._crossfadeType = crossfadeType;
    this._usePsola = usePsola;

    // Resume context if suspended (browser autoplay policy).
    // Must await to ensure currentTime is advancing before we capture it.
    if (this._audioContext.state === 'suspended') {
      await this._audioContext.resume();
    }

    // Sort notes by start time for proper overlap handling
    const sortedNotes = [...notes].sort((a, b) => a.startTime - b.startTime);

    // Validate that all aliases exist in the sample map
    const missingAliases: string[] = [];
    for (const note of sortedNotes) {
      if (!sampleMap.has(note.alias)) {
        missingAliases.push(note.alias);
      }
    }

    if (missingAliases.length > 0) {
      console.warn(
        `MelodyPlayer: Missing samples for aliases: ${missingAliases.join(', ')}`
      );
      // Continue with available samples, skip missing ones
    }

    // Pre-compute adaptive grain sizes for each unique sample if enabled
    const grainSizeCache = new Map<string, number>();
    if (useAdaptiveGrainSize && useGranular) {
      for (const [alias, data] of sampleMap) {
        grainSizeCache.set(alias, this._calculateAdaptiveGrainSize(data.audioBuffer));
      }
    }

    // Pre-compute loudness normalization factors if enabled
    // IMPORTANT: Analyze only the oto-defined playback region (offset to cutoff),
    // not the entire audio buffer. This ensures accurate normalization when samples
    // have varying loudness across different regions of the file.
    const normalizationGains = new Map<string, number>();
    const loudnessCache = useLoudnessNormalization ? this._getLoudnessCache() : null;
    if (useLoudnessNormalization && loudnessCache) {
      for (const [alias, data] of sampleMap) {
        // Calculate the playable region from oto.ini parameters
        const sampleStart = data.otoEntry.offset / 1000;
        const sampleEnd = this._calculateSampleEnd(data.otoEntry, data.audioBuffer.duration);

        const analysis = loudnessCache.getAnalysis(data.audioBuffer, {
          startTime: sampleStart,
          endTime: sampleEnd,
        });
        const gain = calculateNormalizationGain(analysis, normalizationOptions);
        normalizationGains.set(alias, gain);
      }
    }

    // Record sequence start time for position tracking
    this._sequenceStartTime = this._audioContext.currentTime;
    this._isPlaying = true;

    // Schedule each note with its specific sample
    let lastScheduledNote: PhraseNote | null = null;
    let lastSampleData: SampleData | null = null;

    // Get spectral cache if using dynamic overlap
    const spectralCache = useDynamicOverlap ? this._getSpectralCache() : null;

    for (const note of sortedNotes) {
      const sampleData = sampleMap.get(note.alias);
      if (!sampleData) {
        // Skip notes with missing samples
        continue;
      }

      // Get grain size for this sample (adaptive or default)
      const noteGrainSize = grainSizeCache.get(note.alias) ?? grainSize;

      // Calculate dynamic overlap if enabled and we have a previous sample
      let dynamicOverlapMs: number | undefined;
      if (useDynamicOverlap && spectralCache && lastSampleData) {
        const distanceResult = spectralCache.getDistance(
          lastSampleData.audioBuffer,
          sampleData.audioBuffer,
          spectralDistanceOptions
        );
        // Scale the current note's overlap based on spectral distance
        const baseOverlap = sampleData.otoEntry.overlap;
        const additionalFactor = (dynamicOverlapMaxScale - 1) * distanceResult.distance;
        dynamicOverlapMs = baseOverlap * (1 + additionalFactor);
      }

      // Calculate loudness normalization gain and join correction
      let normalizationGain = 1;
      let joinCorrection: { gainA: number; gainB: number } | undefined;

      if (useLoudnessNormalization) {
        // Get global normalization gain for this sample
        normalizationGain = normalizationGains.get(note.alias) ?? 1;

        // Calculate join correction if we have a previous sample
        if (lastSampleData) {
          const correction = calculateJoinGainCorrection(
            lastSampleData.audioBuffer,
            sampleData.audioBuffer,
            joinCorrectionOptions
          );
          joinCorrection = { gainA: correction.gainA, gainB: correction.gainB };
        }
      }

      this._schedulePhraseNote(
        note,
        lastScheduledNote,
        lastSampleData,
        sampleData,
        noteGrainSize,
        dynamicOverlapMs,
        normalizationGain,
        joinCorrection
      );

      lastScheduledNote = note;
      lastSampleData = sampleData;
    }

    // Set up cleanup when last note ends
    if (sortedNotes.length > 0) {
      const lastNote = sortedNotes[sortedNotes.length - 1];
      const sequenceEnd = lastNote.startTime + lastNote.duration;
      const cleanupTime = this._sequenceStartTime + sequenceEnd + 0.1; // Small buffer

      // Schedule cleanup
      setTimeout(() => {
        if (this._isPlaying) {
          this._cleanup();
        }
      }, (cleanupTime - this._audioContext.currentTime) * 1000);
    }
  }

  /**
   * Stop all playback immediately.
   *
   * Stops all active audio nodes and cleans up resources.
   */
  stop(): void {
    if (!this._isPlaying && this._activeNodes.length === 0) {
      return;
    }

    // Stop all active nodes
    for (const node of this._activeNodes) {
      try {
        if (node.granularHandle) {
          // Stop granular playback
          node.granularHandle.stop();
        } else if (node.source) {
          // Stop regular playback
          node.source.stop();
          node.source.disconnect();
          node.gainNode?.disconnect();
        }
      } catch {
        // Ignore errors if already stopped
      }
    }

    // Also stop any remaining granular playbacks
    if (this._granularShifter) {
      this._granularShifter.stopAll();
    }

    this._activeNodes = [];
    this._isPlaying = false;
  }

  /**
   * Calculate the sample end time from oto cutoff parameter.
   *
   * Cutoff can be:
   * - Negative: measured from end of audio (e.g., -100 = 100ms before end)
   * - Positive: absolute position from start
   * - Zero: play to end
   */
  private _calculateSampleEnd(otoEntry: OtoEntry, audioDuration: number): number {
    if (otoEntry.cutoff < 0) {
      // Negative cutoff: measured from end
      return audioDuration + (otoEntry.cutoff / 1000);
    } else if (otoEntry.cutoff > 0) {
      // Positive cutoff: absolute position
      return otoEntry.cutoff / 1000;
    } else {
      // Zero: play to end
      return audioDuration;
    }
  }

  /**
   * Schedule a single note for playback.
   *
   * Handles pitch shifting, timing adjustments for preutterance,
   * and crossfade with the previous note.
   *
   * When granular mode is enabled and pitch !== 0, uses GranularPitchShifter
   * for formant-preserving pitch shifts. Otherwise uses playback-rate shifting.
   */
  private _scheduleNote(
    note: NoteEvent,
    prevNote: NoteEvent | null,
    params: {
      sampleStart: number;
      sampleDuration: number;
      preutterance: number;
      overlap: number;
      audioBuffer: AudioBuffer;
    }
  ): void {
    const { sampleStart, sampleDuration, preutterance, overlap, audioBuffer } = params;

    // Adjust timing: the note's "attack point" should align with startTime,
    // but the sample actually starts preutterance before that
    const effectiveStartTime = prevNote
      ? this._sequenceStartTime + note.startTime - preutterance
      : this._sequenceStartTime + note.startTime;
    const whenToStart = Math.max(effectiveStartTime, this._audioContext.currentTime);

    // Apply velocity (prepared for future dynamics support)
    const velocity = note.velocity ?? 1;

    // Calculate note duration (for granular, we don't adjust for playback rate)
    const noteDuration = prevNote
      ? Math.min(note.duration + preutterance, sampleDuration)
      : Math.min(note.duration, sampleDuration);

    // Determine crossfade timing
    const fadeTime = Math.min(overlap, noteDuration * 0.5, 0.1);
    let fadeInTime = fadeTime;
    if (prevNote) {
      const prevEndTime = this._sequenceStartTime + prevNote.startTime + prevNote.duration;
      const overlapDuration = Math.max(0, prevEndTime - whenToStart);
      fadeInTime = Math.min(fadeTime, overlapDuration + 0.02);
    }

    // Use granular pitch shifting if enabled and pitch is not zero
    const shouldUseGranular = this._useGranular && note.pitch !== 0;

    if (shouldUseGranular) {
      // Granular pitch shifting - preserves formants
      this._scheduleGranularNote(note, {
        audioBuffer,
        sampleStart,
        sampleDuration,
        whenToStart,
        noteDuration,
        fadeInTime,
        fadeTime,
        velocity,
      });
    } else {
      // Playback-rate pitch shifting - traditional method
      this._schedulePlaybackRateNote(note, prevNote, {
        audioBuffer,
        sampleStart,
        sampleDuration,
        preutterance: prevNote ? preutterance : 0,
        overlap,
        effectiveStartTime,
        velocity,
      });
    }
  }

  /**
   * Schedule a note using granular pitch shifting.
   *
   * Uses Tone.js GrainPlayer for formant-preserving pitch shifts.
   */
  private _scheduleGranularNote(
    note: NoteEvent,
    params: {
      audioBuffer: AudioBuffer;
      sampleStart: number;
      sampleDuration: number;
      whenToStart: number;
      noteDuration: number;
      fadeInTime: number;
      fadeTime: number;
      velocity: number;
    }
  ): void {
    const {
      audioBuffer,
      sampleStart,
      sampleDuration,
      whenToStart,
      noteDuration,
      fadeInTime,
      fadeTime,
      velocity,
    } = params;

    const shifter = this._getGranularShifter();

    // Get the envelope for this note (note-specific or default)
    const envelope = note.envelope ?? this._defaultEnvelope;

    // GrainPlayer internally plays grains at a rate corresponding to the pitch shift,
    // which means source material is consumed faster when pitching up. Adjust the
    // maximum playable duration to prevent overlap with the next note.
    const playbackRate = Math.pow(2, note.pitch / 12);
    const adjustedSampleDuration = sampleDuration / playbackRate;
    const adjustedNoteDuration = Math.min(noteDuration, adjustedSampleDuration);

    // Schedule granular playback
    shifter
      .playPitchShifted(audioBuffer, {
        pitchShift: note.pitch,
        startOffset: sampleStart,
        duration: Math.min(adjustedNoteDuration, sampleDuration),
        when: whenToStart,
        grainSize: this._grainSize,
        overlap: this._grainOverlap,
        gain: velocity,
        fadeIn: fadeInTime,
        fadeOut: fadeTime,
        envelope,
        vibrato: note.vibrato,
        usePsola: this._usePsola,
      })
      .then((handle) => {
        // Track active node for cleanup
        const activeNode: ActiveNode = {
          source: null,
          gainNode: null,
          granularHandle: handle,
          startTime: whenToStart,
          endTime: whenToStart + adjustedNoteDuration,
        };
        this._activeNodes.push(activeNode);

        // Note: Cleanup is handled by GranularPitchShifter internally
      })
      .catch((error) => {
        // Fallback to playback-rate if granular fails
        console.warn('Granular pitch shifting failed, falling back to playback rate:', error);
        this._schedulePlaybackRateFallback(note, params);
      });
  }

  /**
   * Schedule a note using traditional playback-rate pitch shifting.
   */
  private _schedulePlaybackRateNote(
    note: NoteEvent,
    prevNote: NoteEvent | null,
    params: {
      audioBuffer: AudioBuffer;
      sampleStart: number;
      sampleDuration: number;
      preutterance: number;
      overlap: number;
      effectiveStartTime: number;
      velocity: number;
    }
  ): void {
    const {
      audioBuffer,
      sampleStart,
      sampleDuration,
      preutterance,
      overlap,
      effectiveStartTime,
      velocity,
    } = params;

    // Calculate playback rate for pitch shifting
    // Formula: rate = 2^(semitones/12)
    const playbackRate = Math.pow(2, note.pitch / 12);

    // Create audio nodes
    const source = this._audioContext.createBufferSource();
    const gainNode = this._audioContext.createGain();

    source.buffer = audioBuffer;
    source.playbackRate.value = playbackRate;

    // Connect: source -> gain -> destination
    source.connect(gainNode);
    gainNode.connect(this._audioContext.destination);

    // Calculate actual playback duration
    // The sample duration is affected by playback rate
    const adjustedSampleDuration = sampleDuration / playbackRate;
    const noteDuration = Math.min(note.duration + preutterance, adjustedSampleDuration);

    // Get the envelope for this note (note-specific or default)
    const envelope = note.envelope ?? this._defaultEnvelope;

    // Set up crossfade envelope (or ADSR if envelope is provided)
    this._applyCrossfadeEnvelope(gainNode, {
      startTime: effectiveStartTime,
      duration: noteDuration,
      overlap,
      prevNote,
      baseGain: velocity,
      sequenceStartTime: this._sequenceStartTime,
      envelope,
    });

    // Schedule the source node
    const whenToStart = Math.max(effectiveStartTime, this._audioContext.currentTime);
    source.start(whenToStart, sampleStart, sampleDuration);

    // Track active node for cleanup
    const activeNode: ActiveNode = {
      source,
      gainNode,
      granularHandle: null,
      startTime: whenToStart,
      endTime: whenToStart + noteDuration,
    };
    this._activeNodes.push(activeNode);

    // Set up ended callback for this node
    source.onended = () => {
      this._removeActiveNode(activeNode);
    };
  }

  /**
   * Fallback to playback-rate shifting when granular fails.
   *
   * Uses the current crossfade type setting for envelope shaping.
   */
  private _schedulePlaybackRateFallback(
    note: NoteEvent,
    params: {
      audioBuffer: AudioBuffer;
      sampleStart: number;
      sampleDuration: number;
      whenToStart: number;
      noteDuration: number;
      fadeInTime: number;
      fadeTime: number;
      velocity: number;
    }
  ): void {
    const {
      audioBuffer,
      sampleStart,
      sampleDuration,
      whenToStart,
      noteDuration,
      fadeInTime,
      fadeTime,
      velocity,
    } = params;

    const playbackRate = Math.pow(2, note.pitch / 12);

    const source = this._audioContext.createBufferSource();
    const gainNode = this._audioContext.createGain();

    source.buffer = audioBuffer;
    source.playbackRate.value = playbackRate;

    source.connect(gainNode);
    gainNode.connect(this._audioContext.destination);

    // Minimum fade time to avoid artifacts
    const safeFadeInTime = Math.max(0.005, fadeInTime);
    const safeFadeOutTime = Math.max(0.005, fadeTime);

    // Apply crossfade using curve-based approach for equal-power or linear
    gainNode.gain.setValueAtTime(0, whenToStart);

    // Generate and apply fade-in curve
    const fadeInCurve = this._generateCrossfadeCurve(safeFadeInTime, true, velocity);
    gainNode.gain.setValueCurveAtTime(fadeInCurve, whenToStart, safeFadeInTime);

    const fadeInEnd = whenToStart + safeFadeInTime;
    const fadeOutStart = whenToStart + noteDuration - safeFadeOutTime;

    if (fadeOutStart > fadeInEnd + 0.001) {
      gainNode.gain.setValueAtTime(velocity, fadeInEnd);
      gainNode.gain.setValueAtTime(velocity, fadeOutStart);
    }

    // Generate and apply fade-out curve
    const fadeOutCurve = this._generateCrossfadeCurve(safeFadeOutTime, false, velocity);
    gainNode.gain.setValueCurveAtTime(fadeOutCurve, fadeOutStart, safeFadeOutTime);

    source.start(whenToStart, sampleStart, sampleDuration);

    const activeNode: ActiveNode = {
      source,
      gainNode,
      granularHandle: null,
      startTime: whenToStart,
      endTime: whenToStart + noteDuration,
    };
    this._activeNodes.push(activeNode);

    source.onended = () => {
      this._removeActiveNode(activeNode);
    };
  }

  /**
   * Schedule a single phrase note for playback with its specific sample.
   *
   * This is similar to _scheduleNote but handles per-note sample data,
   * extracting oto parameters from each note's specific sample.
   *
   * When granular mode is enabled and pitch !== 0, uses GranularPitchShifter
   * for formant-preserving pitch shifts. Otherwise uses playback-rate shifting.
   *
   * @param note - The phrase note to schedule
   * @param prevNote - Previous note for overlap calculation (or null)
   * @param prevSampleData - Previous note's sample data (or null)
   * @param sampleData - Sample data for this note
   * @param grainSize - Grain size to use for this note (optional, uses class default if not provided)
   * @param dynamicOverlapMs - Dynamic overlap in milliseconds calculated from spectral distance (optional)
   * @param normalizationGain - Global normalization gain for this sample (optional, default 1)
   * @param joinCorrection - Gain correction for join with previous sample (optional)
   */
  private _schedulePhraseNote(
    note: PhraseNote,
    prevNote: PhraseNote | null,
    prevSampleData: SampleData | null,
    sampleData: SampleData,
    grainSize?: number,
    dynamicOverlapMs?: number,
    normalizationGain = 1,
    joinCorrection?: { gainA: number; gainB: number }
  ): void {
    const { audioBuffer, otoEntry } = sampleData;

    // Calculate sample boundaries from oto parameters (convert ms to seconds)
    const sampleStart = otoEntry.offset / 1000;
    const sampleEnd = this._calculateSampleEnd(otoEntry, audioBuffer.duration);
    const sampleDuration = Math.max(0, sampleEnd - sampleStart);

    if (sampleDuration <= 0) {
      console.warn(
        `MelodyPlayer: Invalid sample boundaries for alias "${note.alias}" (offset >= cutoff)`
      );
      return;
    }

    // Preutterance and overlap in seconds for this specific sample
    // Use dynamic overlap if provided, otherwise use oto.ini value
    const preutterance = otoEntry.preutterance / 1000;
    const overlap = dynamicOverlapMs !== undefined
      ? dynamicOverlapMs / 1000
      : otoEntry.overlap / 1000;

    // Adjust timing: the note's "attack point" should align with startTime,
    // but the sample actually starts preutterance before that
    const hasPrevNote = prevNote !== null && prevSampleData !== null;
    const effectiveStartTime = hasPrevNote
      ? this._sequenceStartTime + note.startTime - preutterance
      : this._sequenceStartTime + note.startTime;
    const whenToStart = Math.max(effectiveStartTime, this._audioContext.currentTime);

    // Apply velocity and normalization gain
    // Base velocity from note (prepared for future dynamics support)
    const baseVelocity = note.velocity ?? 1;
    // Apply normalization gain to the velocity
    const velocity = baseVelocity * normalizationGain;

    // Apply join correction if available
    // joinCorrection.gainB should be applied to the start of this note
    // The gainB factor adjusts this note's level to match the end of the previous note
    const joinGainB = joinCorrection?.gainB ?? 1;
    const effectiveVelocity = velocity * joinGainB;

    // Calculate note duration
    const noteDuration = hasPrevNote
      ? Math.min(note.duration + preutterance, sampleDuration)
      : Math.min(note.duration, sampleDuration);

    // Determine crossfade timing using the (potentially dynamic) overlap
    const fadeTime = Math.min(overlap, noteDuration * 0.5, 0.1);
    let fadeInTime = fadeTime;
    if (prevNote && prevSampleData) {
      const prevNoteEndTime = this._sequenceStartTime + prevNote.startTime + prevNote.duration;
      const actualOverlap = Math.max(0, prevNoteEndTime - whenToStart);
      fadeInTime = Math.min(fadeTime, actualOverlap + 0.02, 0.1);
      if (actualOverlap <= 0) {
        fadeInTime = Math.min(fadeTime, 0.02);
      }
    } else {
      fadeInTime = Math.min(fadeTime, 0.02);
    }

    // Use granular pitch shifting if enabled and pitch is not zero
    const shouldUseGranular = this._useGranular && note.pitch !== 0;

    // Use provided grain size or fall back to class default
    const effectiveGrainSize = grainSize ?? this._grainSize;

    if (shouldUseGranular) {
      // Granular pitch shifting - preserves formants
      this._scheduleGranularPhraseNote(note, {
        audioBuffer,
        sampleStart,
        sampleDuration,
        whenToStart,
        noteDuration,
        fadeInTime,
        fadeTime,
        velocity: effectiveVelocity,
        grainSize: effectiveGrainSize,
      });
    } else {
      // Playback-rate pitch shifting - traditional method
      this._schedulePlaybackRatePhraseNote(note, prevNote, prevSampleData, {
        audioBuffer,
        sampleStart,
        sampleDuration,
        preutterance: hasPrevNote ? preutterance : 0,
        overlap,
        effectiveStartTime,
        velocity: effectiveVelocity,
      });
    }
  }

  /**
   * Schedule a phrase note using granular pitch shifting.
   */
  private _scheduleGranularPhraseNote(
    note: PhraseNote,
    params: {
      audioBuffer: AudioBuffer;
      sampleStart: number;
      sampleDuration: number;
      whenToStart: number;
      noteDuration: number;
      fadeInTime: number;
      fadeTime: number;
      velocity: number;
      grainSize: number;
    }
  ): void {
    const {
      audioBuffer,
      sampleStart,
      sampleDuration,
      whenToStart,
      noteDuration,
      fadeInTime,
      fadeTime,
      velocity,
      grainSize,
    } = params;

    const shifter = this._getGranularShifter();

    // Get the envelope for this note (note-specific or default)
    const envelope = note.envelope ?? this._defaultEnvelope;

    // GrainPlayer internally plays grains at a rate corresponding to the pitch shift,
    // which means source material is consumed faster when pitching up. Adjust the
    // maximum playable duration to prevent overlap with the next note.
    const playbackRate = Math.pow(2, note.pitch / 12);
    const adjustedSampleDuration = sampleDuration / playbackRate;
    const adjustedNoteDuration = Math.min(noteDuration, adjustedSampleDuration);

    shifter
      .playPitchShifted(audioBuffer, {
        pitchShift: note.pitch,
        startOffset: sampleStart,
        duration: Math.min(adjustedNoteDuration, sampleDuration),
        when: whenToStart,
        grainSize,
        overlap: this._grainOverlap,
        gain: velocity,
        fadeIn: fadeInTime,
        fadeOut: fadeTime,
        envelope,
        vibrato: note.vibrato,
        usePsola: this._usePsola,
      })
      .then((handle) => {
        const activeNode: ActiveNode = {
          source: null,
          gainNode: null,
          granularHandle: handle,
          startTime: whenToStart,
          endTime: whenToStart + adjustedNoteDuration,
        };
        this._activeNodes.push(activeNode);
      })
      .catch((error) => {
        console.warn('Granular pitch shifting failed for phrase note, falling back:', error);
        this._schedulePlaybackRateFallback(note, params);
      });
  }

  /**
   * Schedule a phrase note using traditional playback-rate pitch shifting.
   */
  private _schedulePlaybackRatePhraseNote(
    note: PhraseNote,
    prevNote: PhraseNote | null,
    prevSampleData: SampleData | null,
    params: {
      audioBuffer: AudioBuffer;
      sampleStart: number;
      sampleDuration: number;
      preutterance: number;
      overlap: number;
      effectiveStartTime: number;
      velocity: number;
    }
  ): void {
    const {
      audioBuffer,
      sampleStart,
      sampleDuration,
      preutterance,
      overlap,
      effectiveStartTime,
      velocity,
    } = params;

    const playbackRate = Math.pow(2, note.pitch / 12);

    const source = this._audioContext.createBufferSource();
    const gainNode = this._audioContext.createGain();

    source.buffer = audioBuffer;
    source.playbackRate.value = playbackRate;

    source.connect(gainNode);
    gainNode.connect(this._audioContext.destination);

    const adjustedSampleDuration = sampleDuration / playbackRate;
    const noteDuration = Math.min(note.duration + preutterance, adjustedSampleDuration);

    // Get the envelope for this note (note-specific or default)
    const envelope = note.envelope ?? this._defaultEnvelope;

    this._applyPhraseCrossfadeEnvelope(gainNode, {
      startTime: effectiveStartTime,
      duration: noteDuration,
      overlap,
      prevNote,
      prevSampleData,
      baseGain: velocity,
      sequenceStartTime: this._sequenceStartTime,
      envelope,
    });

    const whenToStart = Math.max(effectiveStartTime, this._audioContext.currentTime);
    source.start(whenToStart, sampleStart, sampleDuration);

    const activeNode: ActiveNode = {
      source,
      gainNode,
      granularHandle: null,
      startTime: whenToStart,
      endTime: whenToStart + noteDuration,
    };
    this._activeNodes.push(activeNode);

    source.onended = () => {
      this._removeActiveNode(activeNode);
    };
  }

  /**
   * Apply ADSR envelope to a gain node.
   *
   * Implements Attack-Decay-Sustain-Release amplitude shaping:
   * - Attack: Ramp from 0 to peak (baseGain)
   * - Decay: Ramp from peak to sustain level
   * - Sustain: Hold at sustain level during note body
   * - Release: Ramp from sustain to 0 at note end
   *
   * Ensures release does not extend past note duration.
   */
  private _applyADSREnvelope(
    gainNode: GainNode,
    params: {
      startTime: number;
      duration: number;
      envelope: ADSREnvelope;
      baseGain: number;
    }
  ): void {
    const { startTime, duration, envelope, baseGain } = params;

    // All AudioParam times must be non-negative (>= currentTime)
    const now = this._audioContext.currentTime;
    const safeStartTime = Math.max(startTime, now);

    // Adjust duration if we had to clamp start time
    const timeShift = safeStartTime - startTime;
    const safeDuration = Math.max(0.01, duration - timeShift);

    // Convert ADSR times from ms to seconds
    const attackTime = envelope.attack / 1000;
    const decayTime = envelope.decay / 1000;
    const releaseTime = envelope.release / 1000;
    const sustainLevel = Math.max(0, Math.min(1, envelope.sustain)) * baseGain;

    // Calculate the total ADS time (before sustain hold)
    const adsTime = attackTime + decayTime;

    // Ensure release doesn't extend past note duration
    // Release must start before note ends, leaving room for the release ramp
    const safeReleaseTime = Math.min(releaseTime, safeDuration * 0.5);
    const releaseStartTime = safeStartTime + safeDuration - safeReleaseTime;

    // If ADS phase would overlap with release, compress proportionally
    const availableADSTime = Math.max(0, releaseStartTime - safeStartTime);
    const adsScale = adsTime > 0 && adsTime > availableADSTime ? availableADSTime / adsTime : 1;
    const safeAttackTime = attackTime * adsScale;
    const safeDecayTime = decayTime * adsScale;

    // Start at 0
    gainNode.gain.setValueAtTime(0, safeStartTime);

    // Attack: ramp to peak
    const attackEndTime = safeStartTime + safeAttackTime;
    gainNode.gain.linearRampToValueAtTime(baseGain, attackEndTime);

    // Decay: ramp to sustain level
    const decayEndTime = attackEndTime + safeDecayTime;
    if (safeDecayTime > 0) {
      gainNode.gain.linearRampToValueAtTime(sustainLevel, decayEndTime);
    }

    // Sustain: hold at sustain level until release
    if (releaseStartTime > decayEndTime) {
      gainNode.gain.setValueAtTime(sustainLevel, releaseStartTime);
    }

    // Release: ramp to 0
    gainNode.gain.linearRampToValueAtTime(0, safeStartTime + safeDuration);
  }

  /**
   * Apply crossfade envelope to a gain node.
   *
   * If the note has an ADSR envelope, uses ADSR shaping instead of simple crossfade.
   * Otherwise implements smooth transitions between consecutive notes using the
   * oto overlap parameter for crossfade duration.
   *
   * Supports both linear and equal-power crossfade curves based on the
   * _crossfadeType setting. Equal-power crossfades maintain constant perceived
   * loudness during transitions.
   */
  private _applyCrossfadeEnvelope(
    gainNode: GainNode,
    params: {
      startTime: number;
      duration: number;
      overlap: number;
      prevNote: NoteEvent | null;
      baseGain: number;
      sequenceStartTime: number;
      envelope?: ADSREnvelope;
    }
  ): void {
    const { startTime, duration, overlap, prevNote, baseGain, sequenceStartTime, envelope } = params;

    // If an ADSR envelope is provided, use it instead of simple crossfade
    if (envelope) {
      this._applyADSREnvelope(gainNode, {
        startTime,
        duration,
        envelope,
        baseGain,
      });
      return;
    }

    // All AudioParam times must be non-negative (>= currentTime)
    const now = this._audioContext.currentTime;
    const safeStartTime = Math.max(startTime, now);

    // Adjust duration if we had to clamp start time
    const timeShift = safeStartTime - startTime;
    const safeDuration = Math.max(0.01, duration - timeShift);

    // Clamp overlap to reasonable bounds
    const fadeTime = Math.min(overlap, safeDuration * 0.5, 0.1); // Max 100ms or half duration

    // Determine fade-in time based on overlap with previous note
    let fadeInTime = fadeTime;
    if (prevNote) {
      // If there's a previous note, use overlap for crossfade
      const prevEndTime = sequenceStartTime + prevNote.startTime + prevNote.duration;
      const overlapDuration = Math.max(0, prevEndTime - safeStartTime);
      fadeInTime = Math.min(fadeTime, overlapDuration + 0.02);
    }

    // Minimum fade time to avoid artifacts
    fadeInTime = Math.max(0.005, fadeInTime);
    const fadeOutTime = Math.max(0.005, fadeTime);

    // Apply crossfade using curve-based approach for equal-power or linear
    // Start at 0
    gainNode.gain.setValueAtTime(0, safeStartTime);

    // Generate and apply fade-in curve
    const fadeInCurve = this._generateCrossfadeCurve(fadeInTime, true, baseGain);
    gainNode.gain.setValueCurveAtTime(fadeInCurve, safeStartTime, fadeInTime);

    // Hold at full gain until fade-out
    const fadeInEnd = safeStartTime + fadeInTime;
    const fadeOutStart = safeStartTime + safeDuration - fadeOutTime;

    if (fadeOutStart > fadeInEnd + 0.001) {
      // setValueCurveAtTime ends at the last curve value, so we need to explicitly
      // set the value at the sustain phase start
      gainNode.gain.setValueAtTime(baseGain, fadeInEnd);
      gainNode.gain.setValueAtTime(baseGain, fadeOutStart);
    }

    // Generate and apply fade-out curve
    const fadeOutCurve = this._generateCrossfadeCurve(fadeOutTime, false, baseGain);
    gainNode.gain.setValueCurveAtTime(fadeOutCurve, fadeOutStart, fadeOutTime);
  }

  /**
   * Apply crossfade envelope for phrase playback.
   *
   * If the note has an ADSR envelope, uses ADSR shaping instead of simple crossfade.
   * Otherwise considers per-note oto parameters.
   * The crossfade duration is determined by:
   * - The current note's overlap parameter for fade-in
   * - The actual timing overlap between notes
   *
   * This produces natural-sounding transitions in concatenative synthesis
   * where each phoneme may have different overlap characteristics.
   *
   * Supports both linear and equal-power crossfade curves based on the
   * _crossfadeType setting. Equal-power crossfades maintain constant perceived
   * loudness during transitions.
   */
  private _applyPhraseCrossfadeEnvelope(
    gainNode: GainNode,
    params: {
      startTime: number;
      duration: number;
      overlap: number;
      prevNote: PhraseNote | null;
      prevSampleData: SampleData | null;
      baseGain: number;
      sequenceStartTime: number;
      envelope?: ADSREnvelope;
    }
  ): void {
    const {
      startTime,
      duration,
      overlap,
      prevNote,
      prevSampleData,
      baseGain,
      sequenceStartTime,
      envelope,
    } = params;

    // If an ADSR envelope is provided, use it instead of simple crossfade
    if (envelope) {
      this._applyADSREnvelope(gainNode, {
        startTime,
        duration,
        envelope,
        baseGain,
      });
      return;
    }

    // All AudioParam times must be non-negative (>= currentTime)
    const now = this._audioContext.currentTime;
    const safeStartTime = Math.max(startTime, now);

    // Adjust duration if we had to clamp start time
    const timeShift = safeStartTime - startTime;
    const safeDuration = Math.max(0.01, duration - timeShift);

    // Use this note's overlap parameter for crossfade, clamped to reasonable bounds
    const fadeTime = Math.min(overlap, safeDuration * 0.5, 0.1); // Max 100ms or half duration

    // Determine fade-in time based on overlap with previous note
    let fadeInTime = fadeTime;
    if (prevNote && prevSampleData) {
      // Calculate when the previous note actually ends based on its scheduled timing
      const prevNoteEndTime = sequenceStartTime + prevNote.startTime + prevNote.duration;

      // How much do the notes actually overlap in time?
      const actualOverlap = Math.max(0, prevNoteEndTime - safeStartTime);

      // Use the minimum of: our overlap param, actual timing overlap, or a small buffer
      fadeInTime = Math.min(fadeTime, actualOverlap + 0.02, 0.1);

      // If notes don't actually overlap in time, use a quick fade-in
      if (actualOverlap <= 0) {
        fadeInTime = Math.min(fadeTime, 0.02);
      }
    } else {
      // First note: quick fade-in to avoid click
      fadeInTime = Math.min(fadeTime, 0.02);
    }

    // Minimum fade time to avoid artifacts
    fadeInTime = Math.max(0.005, fadeInTime);
    const fadeOutTime = Math.max(0.005, fadeTime);

    // Apply crossfade using curve-based approach for equal-power or linear
    // Start at 0
    gainNode.gain.setValueAtTime(0, safeStartTime);

    // Generate and apply fade-in curve
    const fadeInCurve = this._generateCrossfadeCurve(fadeInTime, true, baseGain);
    gainNode.gain.setValueCurveAtTime(fadeInCurve, safeStartTime, fadeInTime);

    // Hold at full gain until fade-out
    const fadeInEnd = safeStartTime + fadeInTime;
    const fadeOutStart = safeStartTime + safeDuration - fadeOutTime;

    if (fadeOutStart > fadeInEnd + 0.001) {
      // setValueCurveAtTime ends at the last curve value, so we need to explicitly
      // set the value at the sustain phase start
      gainNode.gain.setValueAtTime(baseGain, fadeInEnd);
      gainNode.gain.setValueAtTime(baseGain, fadeOutStart);
    }

    // Generate and apply fade-out curve
    const fadeOutCurve = this._generateCrossfadeCurve(fadeOutTime, false, baseGain);
    gainNode.gain.setValueCurveAtTime(fadeOutCurve, fadeOutStart, fadeOutTime);
  }

  /**
   * Remove a node from the active nodes list.
   */
  private _removeActiveNode(node: ActiveNode): void {
    const index = this._activeNodes.indexOf(node);
    if (index !== -1) {
      this._activeNodes.splice(index, 1);
    }

    // Disconnect nodes
    try {
      if (node.granularHandle) {
        node.granularHandle.stop();
      } else {
        node.source?.disconnect();
        node.gainNode?.disconnect();
      }
    } catch {
      // Ignore disconnect errors
    }

    // If no more active nodes, mark as not playing
    if (this._activeNodes.length === 0) {
      this._isPlaying = false;
    }
  }

  /**
   * Clean up all nodes after sequence completes.
   */
  private _cleanup(): void {
    for (const node of this._activeNodes) {
      try {
        if (node.granularHandle) {
          node.granularHandle.stop();
        } else {
          node.source?.disconnect();
          node.gainNode?.disconnect();
        }
      } catch {
        // Ignore disconnect errors
      }
    }

    // Also clean up granular shifter
    if (this._granularShifter) {
      this._granularShifter.stopAll();
    }

    this._activeNodes = [];
    this._isPlaying = false;
  }
}
