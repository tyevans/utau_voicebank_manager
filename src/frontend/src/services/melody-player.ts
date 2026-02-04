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
  analyzeLoudnessForNormalization,
  type NormalizationOptions,
  type JoinCorrectionOptions,
  type JoinGainCorrection,
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
 * Native Web Audio LFO nodes used for vibrato on the playback-rate path.
 *
 * The OscillatorNode generates a sine wave at the vibrato rate, routed
 * through a GainNode that scales the output to the desired depth in cents.
 * The GainNode output is connected directly to source.detune (a native
 * AudioParam), providing sample-accurate pitch modulation without any
 * polling or scheduling overhead.
 */
interface VibratoNodes {
  /** Oscillator generating the LFO sine wave */
  oscillator: OscillatorNode;
  /** Gain node controlling vibrato depth (output in cents) */
  depthGain: GainNode;
}

/**
 * Internal representation of an active audio node for cleanup tracking.
 */
interface ActiveNode {
  source: AudioBufferSourceNode | null;
  gainNode: GainNode | null;
  granularHandle: PlaybackHandle | null;
  /** Native LFO nodes for vibrato on the playback-rate path */
  vibratoNodes: VibratoNodes | null;
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
  private _disposed = false;

  // Current synthesis settings
  private _useGranular = true;
  private _grainSize = 0.1;
  private _grainOverlap = 0.5;
  private _defaultEnvelope: ADSREnvelope = DEFAULT_ENVELOPE;
  private _crossfadeType: CrossfadeType = 'equal-power';
  private _usePsola = false;

  // Dynamic overlap cache
  private _spectralDistanceCache: SpectralDistanceCache | null = null;

  // Note: Loudness analysis is computed per-phrase via analyzeLoudnessForNormalization()
  // which uses oto consonant markers for accurate vowel-region RMS measurement.

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
   * Whether this player has been permanently disposed.
   *
   * A disposed player cannot be used for playback. Calling playSequence()
   * or playPhrase() on a disposed player will return immediately.
   */
  get disposed(): boolean {
    return this._disposed;
  }

  /**
   * Permanently dispose of this player, releasing all resources.
   *
   * This performs deeper cleanup than stop():
   * - Calls stop() to halt all active playback
   * - Disconnects all tracked audio nodes
   * - Disposes the GranularPitchShifter (which disconnects its output bridge)
   * - Clears the spectral distance cache
   * - Sets a disposed flag preventing future playback
   *
   * Does NOT close the AudioContext since it may be shared across components.
   *
   * After calling dispose(), this instance cannot be reused. Create a new
   * MelodyPlayer if playback is needed again.
   */
  dispose(): void {
    if (this._disposed) {
      return;
    }

    this._disposed = true;

    // Stop all active playback
    this.stop();

    // Disconnect any remaining tracked nodes (stop() clears the array,
    // but belt-and-suspenders for nodes that slipped through)
    for (const node of this._activeNodes) {
      // Detach callbacks to prevent re-entrant cleanup
      if (node.granularHandle) {
        node.granularHandle.onended = null;
      } else if (node.source) {
        node.source.onended = null;
      }
      try {
        if (node.granularHandle) {
          node.granularHandle.stop();
        } else {
          node.source?.disconnect();
          node.gainNode?.disconnect();
        }
      } catch {
        // Ignore errors if already disconnected
      }
      // Clean up vibrato LFO nodes
      this._cleanupVibratoNodes(node.vibratoNodes);
    }
    this._activeNodes = [];

    // Dispose the granular pitch shifter (stops all and disconnects bridge)
    if (this._granularShifter) {
      this._granularShifter.dispose();
      this._granularShifter = null;
    }

    // Clear the spectral distance cache
    if (this._spectralDistanceCache) {
      this._spectralDistanceCache.clear();
      this._spectralDistanceCache = null;
    }
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
    if (this._disposed) {
      console.warn('MelodyPlayer: Cannot play sequence on a disposed player');
      return;
    }

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

    // Pre-initialize granular shifter before capturing start time.
    // This avoids async Tone.js initialization during note scheduling,
    // which would cause the first notes to start late and overlap.
    if (useGranular) {
      await this._getGranularShifter().ensureInitialized();
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

    // Record sequence start time for position tracking.
    // Offset by preutterance so that the first note's effective start
    // (startTime - preutterance) lands at currentTime instead of being
    // clamped forward, which would collapse early notes onto the same time.
    this._sequenceStartTime = this._audioContext.currentTime + preutterance;
    this._isPlaying = true;

    console.group('[MelodyPlayer] playSequence diagnostics');
    console.log('sequenceStartTime:', this._sequenceStartTime.toFixed(4));
    console.log('oto params (s):', { sampleStart, sampleDuration, preutterance, overlap });
    console.log('notes:', sortedNotes.length, '| granular:', this._useGranular, '| psola:', this._usePsola);

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
    console.groupEnd();

    // Individual node cleanup is handled by source.onended (playback-rate path)
    // and handle.onended (granular path). When the last ActiveNode is removed,
    // _removeActiveNode() sets _isPlaying = false automatically.
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
    if (this._disposed) {
      console.warn('MelodyPlayer: Cannot play phrase on a disposed player');
      return;
    }

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

    // Pre-initialize granular shifter before capturing start time.
    // This avoids async Tone.js initialization during note scheduling,
    // which would cause the first notes to start late and overlap.
    if (useGranular) {
      await this._getGranularShifter().ensureInitialized();
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

    // Pre-compute loudness normalization factors if enabled.
    // IMPORTANT: Analyze only the sustained vowel portion of each sample
    // (from consonant marker to cutoff), not the full playback region.
    // This prevents transient-heavy consonants like Japanese "ra" (alveolar flap)
    // from being over-attenuated by the peak limiter. The consonant transient
    // has high peak but low RMS; measuring RMS over just the vowel portion
    // gives a more accurate representation of perceived loudness.
    const normalizationGains = new Map<string, number>();
    if (useLoudnessNormalization) {
      for (const [alias, data] of sampleMap) {
        // Use vowel-region analysis that skips the consonant transient for RMS
        // but still measures peak across the full playback region
        const analysis = analyzeLoudnessForNormalization(data.audioBuffer, {
          offset: data.otoEntry.offset,
          consonant: data.otoEntry.consonant,
          cutoff: data.otoEntry.cutoff,
        });
        const gain = calculateNormalizationGain(analysis, normalizationOptions);
        normalizationGains.set(alias, gain);
      }
    }

    // Find the first schedulable note's preutterance to offset the start time.
    let firstNotePreutterance = 0;
    for (const note of sortedNotes) {
      const sd = sampleMap.get(note.alias);
      if (sd) {
        firstNotePreutterance = sd.otoEntry.preutterance / 1000;
        break;
      }
    }

    // Record sequence start time for position tracking.
    // Offset by first note's preutterance so its effective start lands at
    // currentTime instead of being clamped forward (collapsing early notes).
    this._sequenceStartTime = this._audioContext.currentTime + firstNotePreutterance;
    this._isPlaying = true;

    console.group('[MelodyPlayer] playPhrase diagnostics');
    console.log('sequenceStartTime:', this._sequenceStartTime.toFixed(4));
    console.log('notes:', sortedNotes.length, '| granular:', this._useGranular, '| psola:', this._usePsola);

    // Log normalization gains for volume diagnostics
    if (useLoudnessNormalization && normalizationGains.size > 0) {
      const gainEntries = [...normalizationGains.entries()].map(
        ([alias, gain]) => `${alias}: ${(20 * Math.log10(gain)).toFixed(1)}dB (${gain.toFixed(3)}x)`
      );
      console.log('normalization gains:', gainEntries.join(', '));
    }

    // Filter to schedulable notes (those with samples in the map)
    const schedulableNotes: Array<{ note: PhraseNote; sampleData: SampleData; grainSize: number }> = [];
    for (const note of sortedNotes) {
      const sampleData = sampleMap.get(note.alias);
      if (sampleData) {
        schedulableNotes.push({
          note,
          sampleData,
          grainSize: grainSizeCache.get(note.alias) ?? grainSize,
        });
      }
    }

    // Pre-compute join corrections between all consecutive note pairs.
    // This allows applying BOTH gainA (outgoing) and gainB (incoming) to
    // each note, which the previous approach couldn't do because gainA needed
    // to be applied to an already-scheduled note.
    const joinCorrections: JoinGainCorrection[] = [];
    if (useLoudnessNormalization) {
      for (let i = 0; i < schedulableNotes.length - 1; i++) {
        const dataA = schedulableNotes[i].sampleData;
        const dataB = schedulableNotes[i + 1].sampleData;
        joinCorrections.push(calculateJoinGainCorrection(
          dataA.audioBuffer,
          dataB.audioBuffer,
          {
            ...joinCorrectionOptions,
            otoTimingA: {
              offset: dataA.otoEntry.offset,
              consonant: dataA.otoEntry.consonant,
              cutoff: dataA.otoEntry.cutoff,
            },
            otoTimingB: {
              offset: dataB.otoEntry.offset,
              consonant: dataB.otoEntry.consonant,
              cutoff: dataB.otoEntry.cutoff,
            },
          }
        ));
      }
    }

    // Get spectral cache if using dynamic overlap
    const spectralCache = useDynamicOverlap ? this._getSpectralCache() : null;

    // Schedule each note with its specific sample
    for (let i = 0; i < schedulableNotes.length; i++) {
      const { note, sampleData, grainSize: noteGrainSize } = schedulableNotes[i];
      const prev = i > 0 ? schedulableNotes[i - 1] : null;

      // Calculate dynamic overlap if enabled and we have a previous sample
      let dynamicOverlapMs: number | undefined;
      if (useDynamicOverlap && spectralCache && prev) {
        const distanceResult = spectralCache.getDistance(
          prev.sampleData.audioBuffer,
          sampleData.audioBuffer,
          spectralDistanceOptions
        );
        const baseOverlap = sampleData.otoEntry.overlap;
        const additionalFactor = (dynamicOverlapMaxScale - 1) * distanceResult.distance;
        dynamicOverlapMs = baseOverlap * (1 + additionalFactor);
      }

      // Calculate loudness normalization gain and combined join correction
      let normalizationGain = 1;
      let joinGain = 1;

      if (useLoudnessNormalization) {
        normalizationGain = normalizationGains.get(note.alias) ?? 1;

        // Combine incoming gainB (from join with previous note) and
        // outgoing gainA (from join with next note). This applies the
        // full correction from both sides, unlike the previous approach
        // which could only apply gainB and lost gainA entirely.
        const incomingGainB = i > 0 ? joinCorrections[i - 1].gainB : 1;
        const outgoingGainA = i < schedulableNotes.length - 1 ? joinCorrections[i].gainA : 1;
        joinGain = incomingGainB * outgoingGainA;
      }

      this._schedulePhraseNote(
        note,
        prev?.note ?? null,
        prev?.sampleData ?? null,
        sampleData,
        noteGrainSize,
        dynamicOverlapMs,
        normalizationGain,
        joinGain
      );
    }

    console.groupEnd();

    // Individual node cleanup is handled by source.onended (playback-rate path)
    // and handle.onended (granular path). When the last ActiveNode is removed,
    // _removeActiveNode() sets _isPlaying = false automatically.
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

    // Detach all onended callbacks before stopping to prevent re-entrant
    // calls to _removeActiveNode during iteration.
    for (const node of this._activeNodes) {
      if (node.granularHandle) {
        node.granularHandle.onended = null;
      } else if (node.source) {
        node.source.onended = null;
      }
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
      // Clean up vibrato LFO nodes
      this._cleanupVibratoNodes(node.vibratoNodes);
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
   * When granular mode is enabled and |pitch| > 3 semitones, uses GranularPitchShifter
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
    // but the sample actually starts preutterance before that.
    // Apply preutterance uniformly to ALL notes (including the first) so that
    // every note gets the same duration and timing structure. Without this,
    // the first note is shorter than subsequent notes because it misses the
    // preutterance lead-in, making it sound rushed when the second note's
    // crossfade starts early.
    const effectiveStartTime = this._sequenceStartTime + note.startTime - preutterance;
    const whenToStart = Math.max(effectiveStartTime, this._audioContext.currentTime);

    // Apply velocity (prepared for future dynamics support)
    const velocity = note.velocity ?? 1;

    // Calculate note duration (for granular, we don't adjust for playback rate).
    // Always include preutterance in duration for consistent note lengths.
    const noteDuration = Math.min(note.duration + preutterance, sampleDuration);

    // Determine crossfade timing
    // For equal-power crossfade, both the outgoing note's fade-out and the
    // incoming note's fade-in MUST use the same duration and time window.
    // fadeTime is used for both the fade-in of this note and the fade-out
    // tail of this note (when the *next* note overlaps).
    const fadeTime = Math.min(overlap, noteDuration * 0.5, 0.1);
    // The incoming fade-in must match the outgoing fade-out duration exactly
    // to maintain g_in(t)^2 + g_out(t)^2 = 1 (constant power).
    const fadeInTime = prevNote ? fadeTime : Math.min(fadeTime, 0.02);

    // Diagnostic logging for note scheduling
    const clamped = whenToStart > effectiveStartTime;
    const relEffective = (effectiveStartTime - this._sequenceStartTime).toFixed(4);
    const relWhen = (whenToStart - this._sequenceStartTime).toFixed(4);
    console.log(
      `[Note] pitch=${note.pitch} start=${note.startTime.toFixed(3)} | effective=${relEffective} when=${relWhen} ${clamped ? '(CLAMPED) ' : ''}| dur=${noteDuration.toFixed(3)} fadeIn=${fadeInTime.toFixed(3)} fadeOut=${fadeTime.toFixed(3)}`
    );
    if (prevNote) {
      const prevEffective = this._sequenceStartTime + prevNote.startTime - preutterance;
      const prevWhen = Math.max(prevEffective, this._sequenceStartTime);
      const gapFromPrev = whenToStart - prevWhen;
      console.log(
        `  -> gap from prev note start: ${gapFromPrev.toFixed(3)} s (requested: ${(note.startTime - prevNote.startTime).toFixed(3)} s)`
      );
    }

    if (this._useGranular) {
      // Granular pitch shifting - preserves formants and ensures consistent
      // timbre across all notes in a sequence regardless of pitch interval
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
      // Pass the same timing values the dispatcher computed so both paths
      // produce identical scheduling (whenToStart, noteDuration, fades).
      this._schedulePlaybackRateNote(note, {
        audioBuffer,
        sampleStart,
        sampleDuration,
        whenToStart,
        noteDuration,
        fadeInTime,
        fadeTime,
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

    // Get the envelope for this note (note-specific or default).
    // Cap attack/release to the crossfade timing so that the incoming
    // ramp-up and outgoing ramp-down don't exceed the crossfade window,
    // but keep the original ADSR values when they're shorter (e.g. 10ms
    // attack preserves brief consonant bursts like "k").
    const baseEnvelope = note.envelope ?? this._defaultEnvelope;
    const envelope = {
      ...baseEnvelope,
      attack: Math.min(fadeInTime * 1000, baseEnvelope.attack),   // preserve fast attacks for consonants
      release: Math.min(fadeTime * 1000, baseEnvelope.release),    // preserve fast releases
    };

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
          vibratoNodes: null,
          startTime: whenToStart,
          endTime: whenToStart + adjustedNoteDuration,
        };
        this._activeNodes.push(activeNode);

        // Hook into the granular handle's onended callback for event-driven cleanup.
        // GranularPitchShifter fires this when its internal setTimeout triggers,
        // since Tone.js GrainPlayer lacks a native onended event.
        handle.onended = () => {
          this._removeActiveNode(activeNode);
        };
      })
      .catch((error) => {
        // Fallback to playback-rate if granular fails
        console.warn('Granular pitch shifting failed, falling back to playback rate:', error);
        this._schedulePlaybackRateFallback(note, params);
      });
  }

  /**
   * Schedule a note using traditional playback-rate pitch shifting.
   *
   * Timing values (whenToStart, noteDuration, fadeInTime, fadeTime) are
   * computed by the dispatcher (_scheduleNote) and passed in directly.
   * This ensures identical scheduling regardless of whether the granular
   * or playback-rate path is chosen.
   */
  private _schedulePlaybackRateNote(
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

    // Get the envelope for this note (note-specific or default)
    const envelope = note.envelope ?? this._defaultEnvelope;

    // Apply envelope using the same fade values the granular path uses
    this._applyUnifiedEnvelope(gainNode, {
      whenToStart,
      noteDuration,
      fadeInTime,
      fadeTime,
      baseGain: velocity,
      envelope,
    });

    // Set up vibrato modulation if specified.
    //
    // On the playback-rate path, AudioBufferSourceNode.detune is a native
    // AudioParam, so we can connect a Web Audio OscillatorNode LFO directly
    // for sample-accurate pitch modulation with zero polling overhead.
    const vibratoNodes = this._createVibratoLFO(note.vibrato, source.detune, whenToStart, noteDuration);

    // Schedule the source node.
    // Use noteDuration + a release buffer instead of the full sampleDuration so
    // the AudioBufferSourceNode stops shortly after the envelope silences the
    // audio, rather than running silently for the remainder of the sample.
    // The actual release time used is fadeTime (crossfade-aligned), not envelope.release.
    const releaseBuffer = Math.max(fadeTime, 0.05);
    const sourceDuration = Math.min(noteDuration + releaseBuffer, sampleDuration);
    source.start(whenToStart, sampleStart, sourceDuration);

    // Track active node for cleanup
    const activeNode: ActiveNode = {
      source,
      gainNode,
      granularHandle: null,
      vibratoNodes,
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

    // Set up vibrato modulation if specified (same native LFO approach as primary path)
    const vibratoNodes = this._createVibratoLFO(note.vibrato, source.detune, whenToStart, noteDuration);

    // Use noteDuration + a release buffer instead of the full sampleDuration so
    // the AudioBufferSourceNode stops shortly after the envelope silences the
    // audio, rather than running silently for the remainder of the sample.
    // The actual release time used is fadeTime (crossfade-aligned), not envelope.release.
    const releaseBuffer = Math.max(fadeTime, 0.05);
    const sourceDuration = Math.min(noteDuration + releaseBuffer, sampleDuration);
    source.start(whenToStart, sampleStart, sourceDuration);

    const activeNode: ActiveNode = {
      source,
      gainNode,
      granularHandle: null,
      vibratoNodes,
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
   * When granular mode is enabled and |pitch| > 3 semitones, uses GranularPitchShifter
   * for formant-preserving pitch shifts. Otherwise uses playback-rate shifting.
   *
   * @param note - The phrase note to schedule
   * @param prevNote - Previous note for overlap calculation (or null)
   * @param prevSampleData - Previous note's sample data (or null)
   * @param sampleData - Sample data for this note
   * @param grainSize - Grain size to use for this note (optional, uses class default if not provided)
   * @param dynamicOverlapMs - Dynamic overlap in milliseconds calculated from spectral distance (optional)
   * @param normalizationGain - Global normalization gain for this sample (optional, default 1)
   * @param joinGain - Combined join correction gain (incoming gainB * outgoing gainA, default 1)
   */
  private _schedulePhraseNote(
    note: PhraseNote,
    prevNote: PhraseNote | null,
    prevSampleData: SampleData | null,
    sampleData: SampleData,
    grainSize?: number,
    dynamicOverlapMs?: number,
    normalizationGain = 1,
    joinGain = 1
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
    // but the sample actually starts preutterance before that.
    // Apply preutterance uniformly to ALL notes (including the first) so that
    // every note gets the same duration and timing structure. Without this,
    // the first note is shorter than subsequent notes because it misses the
    // preutterance lead-in, making it sound rushed when the second note's
    // crossfade starts early.
    const hasPrevNote = prevNote !== null && prevSampleData !== null;
    const effectiveStartTime = this._sequenceStartTime + note.startTime - preutterance;
    const whenToStart = Math.max(effectiveStartTime, this._audioContext.currentTime);

    // Apply velocity and normalization gain
    // Base velocity from note (prepared for future dynamics support)
    const baseVelocity = note.velocity ?? 1;
    // Apply normalization gain to the velocity
    const velocity = baseVelocity * normalizationGain;

    // Apply combined join correction (incoming gainB + outgoing gainA)
    const effectiveVelocity = velocity * joinGain;

    // Calculate note duration. Always include preutterance for consistent note lengths.
    const noteDuration = Math.min(note.duration + preutterance, sampleDuration);

    // Determine crossfade timing using the (potentially dynamic) overlap.
    // For equal-power crossfade, the incoming note's fade-in and the outgoing
    // note's fade-out MUST use the same duration so that
    // g_in(t)^2 + g_out(t)^2 = 1 (constant power) at every point.
    const fadeTime = Math.min(overlap, noteDuration * 0.5, 0.1);
    // When there is a previous note, use the full fadeTime for the crossfade
    // so it matches the previous note's fade-out duration. For the first note
    // (no previous note to crossfade with), use a short anti-click fade.
    const fadeInTime = hasPrevNote ? fadeTime : Math.min(fadeTime, 0.02);

    // Diagnostic logging for phrase note scheduling
    const clamped = whenToStart > effectiveStartTime;
    const relEffective = (effectiveStartTime - this._sequenceStartTime).toFixed(4);
    const relWhen = (whenToStart - this._sequenceStartTime).toFixed(4);
    console.log(
      `[PhraseNote] alias=${note.alias} pitch=${note.pitch} start=${note.startTime.toFixed(3)} | effective=${relEffective} when=${relWhen} ${clamped ? '(CLAMPED) ' : ''}| dur=${noteDuration.toFixed(3)} fadeIn=${fadeInTime.toFixed(3)} fadeOut=${fadeTime.toFixed(3)} preut=${preutterance.toFixed(3)} ovlp=${overlap.toFixed(3)}`
    );
    if (prevNote) {
      const prevPreutterance = prevSampleData!.otoEntry.preutterance / 1000;
      const prevEffective = this._sequenceStartTime + prevNote.startTime - prevPreutterance;
      const prevWhen = Math.max(prevEffective, this._sequenceStartTime);
      const gapFromPrev = whenToStart - prevWhen;
      console.log(
        `  -> gap from prev note start: ${gapFromPrev.toFixed(3)} s (requested: ${(note.startTime - prevNote.startTime).toFixed(3)} s)`
      );
    }

    // Use provided grain size or fall back to class default
    const effectiveGrainSize = grainSize ?? this._grainSize;

    if (this._useGranular) {
      // Granular pitch shifting - preserves formants and ensures consistent
      // timbre across all notes in a phrase regardless of pitch interval
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
      // Pass the same timing values the dispatcher computed so both paths
      // produce identical scheduling (whenToStart, noteDuration, fades).
      this._schedulePlaybackRatePhraseNote(note, {
        audioBuffer,
        sampleStart,
        sampleDuration,
        whenToStart,
        noteDuration,
        fadeInTime,
        fadeTime,
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

    // Get the envelope for this note (note-specific or default).
    // Cap attack/release to the crossfade timing so that the incoming
    // ramp-up and outgoing ramp-down don't exceed the crossfade window,
    // but keep the original ADSR values when they're shorter (e.g. 10ms
    // attack preserves brief consonant bursts like "k").
    const baseEnvelope = note.envelope ?? this._defaultEnvelope;
    const envelope = {
      ...baseEnvelope,
      attack: Math.min(fadeInTime * 1000, baseEnvelope.attack),   // preserve fast attacks for consonants
      release: Math.min(fadeTime * 1000, baseEnvelope.release),    // preserve fast releases
    };

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
          vibratoNodes: null,
          startTime: whenToStart,
          endTime: whenToStart + adjustedNoteDuration,
        };
        this._activeNodes.push(activeNode);

        // Hook into the granular handle's onended callback for event-driven cleanup.
        // GranularPitchShifter fires this when its internal setTimeout triggers,
        // since Tone.js GrainPlayer lacks a native onended event.
        handle.onended = () => {
          this._removeActiveNode(activeNode);
        };
      })
      .catch((error) => {
        console.warn('Granular pitch shifting failed for phrase note, falling back:', error);
        this._schedulePlaybackRateFallback(note, params);
      });
  }

  /**
   * Schedule a phrase note using traditional playback-rate pitch shifting.
   *
   * Timing values (whenToStart, noteDuration, fadeInTime, fadeTime) are
   * computed by the dispatcher (_schedulePhraseNote) and passed in directly.
   * This ensures identical scheduling regardless of whether the granular
   * or playback-rate path is chosen.
   */
  private _schedulePlaybackRatePhraseNote(
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

    // Get the envelope for this note (note-specific or default)
    const envelope = note.envelope ?? this._defaultEnvelope;

    // Apply envelope using the same fade values the granular path uses
    this._applyUnifiedEnvelope(gainNode, {
      whenToStart,
      noteDuration,
      fadeInTime,
      fadeTime,
      baseGain: velocity,
      envelope,
    });

    // Set up vibrato modulation if specified (same native LFO approach as primary path)
    const vibratoNodes = this._createVibratoLFO(note.vibrato, source.detune, whenToStart, noteDuration);

    // Use noteDuration + a release buffer instead of the full sampleDuration so
    // the AudioBufferSourceNode stops shortly after the envelope silences the
    // audio, rather than running silently for the remainder of the sample.
    // The actual release time used is fadeTime (crossfade-aligned), not envelope.release.
    const releaseBuffer = Math.max(fadeTime, 0.05);
    const sourceDuration = Math.min(noteDuration + releaseBuffer, sampleDuration);
    source.start(whenToStart, sampleStart, sourceDuration);

    const activeNode: ActiveNode = {
      source,
      gainNode,
      granularHandle: null,
      vibratoNodes,
      startTime: whenToStart,
      endTime: whenToStart + noteDuration,
    };
    this._activeNodes.push(activeNode);

    source.onended = () => {
      this._removeActiveNode(activeNode);
    };
  }

  /**
   * Apply a unified envelope to a gain node using dispatcher-computed timing.
   *
   * This method is used by the playback-rate path so that it receives the
   * exact same whenToStart / noteDuration / fadeInTime / fadeTime values
   * that the granular path receives.  When an ADSR envelope is present it
   * delegates to _applyADSREnvelope; otherwise it applies a crossfade
   * shaped by the current _crossfadeType setting.
   */
  private _applyUnifiedEnvelope(
    gainNode: GainNode,
    params: {
      whenToStart: number;
      noteDuration: number;
      fadeInTime: number;
      fadeTime: number;
      baseGain: number;
      envelope: ADSREnvelope;
    }
  ): void {
    const { whenToStart, noteDuration, fadeInTime, fadeTime, baseGain, envelope } = params;

    // If an ADSR envelope is provided, use it -- but cap the attack and
    // release times to the crossfade timing so they don't exceed the
    // crossfade window. Keep the original ADSR values when they're shorter
    // (e.g. 10ms attack preserves brief consonant bursts like "k").
    if (envelope) {
      const crossfadeEnvelope: ADSREnvelope = {
        ...envelope,
        attack: Math.min(fadeInTime * 1000, envelope.attack),   // preserve fast attacks for consonants
        release: Math.min(fadeTime * 1000, envelope.release),    // preserve fast releases
      };
      this._applyADSREnvelope(gainNode, {
        startTime: whenToStart,
        duration: noteDuration,
        envelope: crossfadeEnvelope,
        baseGain,
      });
      return;
    }

    // Minimum fade time to avoid artifacts
    const safeFadeInTime = Math.max(0.005, fadeInTime);
    const safeFadeOutTime = Math.max(0.005, fadeTime);

    // Apply crossfade using curve-based approach matching the fallback path
    gainNode.gain.setValueAtTime(0, whenToStart);

    // Generate and apply fade-in curve
    const fadeInCurve = this._generateCrossfadeCurve(safeFadeInTime, true, baseGain);
    gainNode.gain.setValueCurveAtTime(fadeInCurve, whenToStart, safeFadeInTime);

    const fadeInEnd = whenToStart + safeFadeInTime;
    const fadeOutStart = whenToStart + noteDuration - safeFadeOutTime;

    if (fadeOutStart > fadeInEnd + 0.001) {
      gainNode.gain.setValueAtTime(baseGain, fadeInEnd);
      gainNode.gain.setValueAtTime(baseGain, fadeOutStart);
    }

    // Generate and apply fade-out curve
    const fadeOutCurve = this._generateCrossfadeCurve(safeFadeOutTime, false, baseGain);
    gainNode.gain.setValueCurveAtTime(fadeOutCurve, fadeOutStart, safeFadeOutTime);
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
   * Create a native Web Audio OscillatorNode LFO for vibrato modulation
   * on the playback-rate path.
   *
   * Connects an OscillatorNode (LFO) through a GainNode (depth in cents)
   * directly to the target AudioParam (source.detune). This provides
   * sample-accurate pitch modulation with zero polling overhead.
   *
   * Vibrato delay is handled by scheduling the depth GainNode's gain:
   * it starts at 0 and ramps to the target depth after the delay period.
   *
   * @param vibrato - Vibrato parameters (rate, depth, delay), or undefined to skip
   * @param targetParam - The AudioParam to modulate (typically source.detune)
   * @param noteStart - When the note starts (AudioContext time)
   * @param noteDuration - Duration of the note in seconds
   * @returns VibratoNodes for cleanup tracking, or null if no vibrato
   */
  private _createVibratoLFO(
    vibrato: VibratoParams | undefined,
    targetParam: AudioParam,
    noteStart: number,
    noteDuration: number
  ): VibratoNodes | null {
    if (!vibrato) {
      return null;
    }

    const vibratoDelay = (vibrato.delay ?? 0) / 1000; // Convert ms to seconds
    const vibratoStartTime = noteStart + vibratoDelay;
    const vibratoEndTime = noteStart + noteDuration;

    // Only apply vibrato if it starts before the note ends
    if (vibratoStartTime >= vibratoEndTime) {
      return null;
    }

    // 1. Create native OscillatorNode as the LFO source (sine wave at vibrato rate)
    const oscillator = this._audioContext.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = vibrato.rate;

    // 2. Create GainNode for depth control (scales oscillator output to cents)
    const depthGain = this._audioContext.createGain();

    // Handle vibrato delay: start at 0 depth, ramp to target after delay
    if (vibratoDelay > 0) {
      depthGain.gain.setValueAtTime(0, noteStart);
      depthGain.gain.setValueAtTime(0, vibratoStartTime);
      // Quick ramp-up to target depth (50ms or 10% of remaining vibrato duration)
      const rampUpDuration = Math.min(0.05, (vibratoEndTime - vibratoStartTime) * 0.1);
      depthGain.gain.linearRampToValueAtTime(vibrato.depth, vibratoStartTime + rampUpDuration);
    } else {
      depthGain.gain.setValueAtTime(vibrato.depth, noteStart);
    }

    // Ramp down to 0 at note end to avoid abrupt cutoff
    const rampDownStart = Math.max(vibratoStartTime, vibratoEndTime - 0.02);
    if (rampDownStart > vibratoStartTime) {
      depthGain.gain.setValueAtTime(vibrato.depth, rampDownStart);
    }
    depthGain.gain.linearRampToValueAtTime(0, vibratoEndTime);

    // 3. Connect: oscillator -> depthGain -> target AudioParam (source.detune)
    //    This is a true native AudioParam connection -- sample-accurate modulation
    //    with no polling, no scheduling callbacks, no jitter.
    oscillator.connect(depthGain);
    depthGain.connect(targetParam);

    // 4. Schedule oscillator lifetime to match the note
    oscillator.start(noteStart);
    oscillator.stop(vibratoEndTime + 0.1); // Small buffer past note end

    return { oscillator, depthGain };
  }

  /**
   * Stop and disconnect vibrato LFO nodes.
   */
  private _cleanupVibratoNodes(vibratoNodes: VibratoNodes | null): void {
    if (!vibratoNodes) {
      return;
    }
    try {
      vibratoNodes.oscillator.stop();
    } catch {
      // May already be stopped
    }
    try {
      vibratoNodes.oscillator.disconnect();
      vibratoNodes.depthGain.disconnect();
    } catch {
      // Ignore disconnect errors
    }
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

    // Clean up vibrato LFO nodes
    this._cleanupVibratoNodes(node.vibratoNodes);

    // If no more active nodes, mark as not playing
    if (this._activeNodes.length === 0) {
      this._isPlaying = false;
    }
  }

}
