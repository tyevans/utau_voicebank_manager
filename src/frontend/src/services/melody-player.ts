/**
 * MelodyPlayer - Web Audio synthesis engine for UTAU voicebank playback.
 *
 * Takes audio samples with oto.ini parameters and schedules pitch-shifted
 * note sequences using the Web Audio API. Designed for future DAW extensibility.
 *
 * Uses playback-rate pitch shifting via AudioBufferSourceNode.playbackRate.
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
import { detectRepresentativePitch, calculatePitchCorrection, C4_FREQUENCY } from '../utils/pitch-detection.js';
import { SpectralDistanceCache, type SpectralDistanceOptions } from '../utils/spectral-analysis.js';
import {
  calculateNormalizationGain,
  calculateJoinGainCorrection,
  analyzeLoudnessForNormalization,
  calculateMedianRmsDb,
  type LoudnessAnalysis,
  type NormalizationOptions,
  type JoinGainCorrection,
} from '../utils/loudness-analysis.js';
import { applySpectralSmoothing, type SpectralSmoothingOptions } from '../utils/spectral-smoothing.js';
import { AudioProcessorClient } from './audio-processor-client.js';
import { ProcessedBufferCache } from './processed-buffer-cache.js';

// Re-export spectral analysis types for consumers using dynamic overlap
export type { SpectralDistanceOptions, SpectralDistanceResult } from '../utils/spectral-analysis.js';

// Re-export spectral smoothing types for consumers using spectral smoothing
export type { SpectralSmoothingOptions } from '../utils/spectral-smoothing.js';

// Re-export loudness analysis types for consumers using loudness normalization
export type {
  NormalizationOptions,
} from '../utils/loudness-analysis.js';

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
 * A pitch bend keyframe defining a pitch offset at a specific time within a note.
 *
 * Pitch bend curves are defined as an array of keyframes that are linearly
 * interpolated. Each keyframe specifies a time offset from note start and a
 * pitch deviation in cents from the note's base pitch.
 *
 * Pitch bends are applied via `source.detune` (an AudioParam in cents).
 * When vibrato is also present, the two stack additively: pitch bend sets
 * the base detune value, and the vibrato LFO oscillates on top of it.
 *
 * @example
 * ```typescript
 * // Portamento: glide from 100 cents above down to base pitch over 200ms
 * const bend: PitchBendPoint[] = [
 *   { time: 0, cents: 100 },
 *   { time: 0.2, cents: 0 },
 * ];
 * ```
 */
export interface PitchBendPoint {
  /** Time offset in seconds from note start */
  time: number;
  /** Pitch offset in cents (100 cents = 1 semitone) */
  cents: number;
}

/**
 * Vibrato parameters for periodic pitch modulation.
 *
 * Vibrato adds expressiveness to vocal synthesis by modulating the pitch
 * with a sine wave. This creates the natural "wavering" sound in singing.
 *
 * @example
 * ```typescript
 * const vibrato: VibratoParams = {
 *   rate: 5,      // 5 Hz oscillation (typical for vocals)
 *   depth: 40,    // 40 cents variation (+/- 40 cents = ~0.4 semitones)
 *   delay: 300,   // Start vibrato 300ms after note attack
 * };
 * ```
 */
export interface VibratoParams {
  /**
   * Frequency of vibrato oscillation in Hz.
   * Typical vocal vibrato: 4-7 Hz.
   * - 4 Hz: Slow, romantic vibrato
   * - 5-6 Hz: Natural singing vibrato
   * - 7+ Hz: Faster, more intense vibrato
   */
  rate: number;

  /**
   * Amplitude of pitch variation in cents (100 cents = 1 semitone).
   * Typical range: 20-80 cents.
   * - 20 cents: Subtle shimmer
   * - 40 cents: Natural vocal vibrato
   * - 80+ cents: Dramatic, operatic vibrato
   */
  depth: number;

  /**
   * Delay before vibrato starts, in milliseconds.
   * Allows for a clean note attack before vibrato kicks in.
   * Default: 0 (immediate vibrato).
   * - 0 ms: Immediate vibrato (can sound unnatural)
   * - 200-300 ms: Natural delayed onset
   * - 500+ ms: Very late onset for held notes
   */
  delay?: number;
}

/**
 * Minimum vowel region duration (in seconds) required for looping.
 *
 * If the vowel region (consonant → cutoff) is shorter than this, the sample
 * plays one-shot instead of looping. This prevents artifacts from looping
 * very short regions (e.g. consonant-only samples like 子音 files).
 */
const MIN_LOOP_REGION = 0.04; // 40ms

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
   * Vibrato adds expressiveness by periodically modulating the pitch
   * using a native Web Audio OscillatorNode LFO connected to source.detune.
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
  /**
   * Optional pitch bend curve for this note. Array of {time, cents} keyframes
   * defining pitch deviation from the note's base pitch over time.
   *
   * Points are linearly interpolated via `source.detune.linearRampToValueAtTime()`.
   * If not provided, pitch is constant (no detune automation).
   *
   * When vibrato is also present, pitch bend and vibrato stack additively:
   * pitch bend keyframes set the base detune value, and the vibrato LFO
   * output adds on top via its GainNode connection to `source.detune`.
   *
   * @example
   * ```typescript
   * {
   *   pitch: 0,
   *   startTime: 0,
   *   duration: 1.0,
   *   pitchBend: [
   *     { time: 0, cents: 200 },   // Start 200 cents (2 semitones) above
   *     { time: 0.3, cents: 0 },   // Glide down to base pitch over 300ms
   *     { time: 0.8, cents: -50 }, // Slight dip at end
   *   ],
   * }
   * ```
   */
  pitchBend?: PitchBendPoint[];
  /**
   * Time stretch factor (1.0 = original, >1 = slower/longer, <1 = faster/shorter).
   * Default 1.0.
   *
   * When set to a value other than 1.0, forces PSOLA processing even for small
   * pitch shifts that would otherwise use playback-rate shifting. The PSOLA
   * pipeline handles both pitch and time stretch simultaneously.
   *
   * The processed buffer's actual duration changes proportionally to this factor,
   * affecting loop points and source scheduling accordingly.
   */
  timeStretch?: number;
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
  /** Native LFO nodes for vibrato */
  vibratoNodes: VibratoNodes | null;
  startTime: number;
  endTime: number;
}

/**
 * MelodyPlayer synthesizes note sequences using UTAU samples.
 *
 * Features:
 * - Playback-rate pitch shifting via AudioBufferSourceNode.playbackRate
 * - Oto.ini parameter application (offset, cutoff, preutterance, overlap)
 * - Crossfade/overlap handling between consecutive notes
 * - ADSR envelope shaping
 * - Native Web Audio vibrato via OscillatorNode LFO
 * - Vowel-region looping for sustained notes
 * - Loudness normalization and join gain correction
 * - Precise scheduling using AudioContext timing
 *
 * Design principles for DAW extensibility:
 * - Scheduling logic is separate from audio rendering
 * - Accepts generic NoteEvent sequences (no hardcoded patterns)
 * - Transforms are designed to be pluggable (pitch curves, vibrato)
 */
export class MelodyPlayer {
  private readonly _audioContext: AudioContext;
  private _activeNodes: ActiveNode[] = [];
  private _isPlaying = false;
  private _sequenceStartTime = 0;
  private _disposed = false;

  // Current synthesis settings
  private _defaultEnvelope: ADSREnvelope = DEFAULT_ENVELOPE;
  private _crossfadeType: CrossfadeType = 'equal-power';

  // Dynamic overlap cache
  private _spectralDistanceCache: SpectralDistanceCache | null = null;

  // PSOLA Web Worker client and cache
  private _processorClient: AudioProcessorClient | null = null;
  private _bufferCache = new ProcessedBufferCache(100);
  private _psolaThreshold = 2; // Use PSOLA for |pitch| > this many semitones

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
      if (node.source) {
        node.source.onended = null;
      }
      try {
        node.source?.disconnect();
        node.gainNode?.disconnect();
      } catch {
        // Ignore errors if already disconnected
      }
      // Clean up vibrato LFO nodes
      this._cleanupVibratoNodes(node.vibratoNodes);
    }
    this._activeNodes = [];

    // Clear the spectral distance cache
    if (this._spectralDistanceCache) {
      this._spectralDistanceCache.clear();
      this._spectralDistanceCache = null;
    }

    // Dispose PSOLA worker client and clear buffer cache
    if (this._processorClient) {
      this._processorClient.dispose();
      this._processorClient = null;
    }
    this._bufferCache.clear();
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
   * Detect the fundamental pitch of a sample in its vowel region.
   *
   * Uses the oto entry's consonant and cutoff markers to isolate the
   * sustained vowel portion (where pitch is most stable), then runs
   * representative pitch detection across that region.
   *
   * @param audioBuffer - The audio buffer to analyze
   * @param otoEntry - Oto parameters defining sample regions
   * @returns Detected frequency in Hz, or 0 if no pitch detected
   */
  private _detectSamplePitch(audioBuffer: AudioBuffer, otoEntry: OtoEntry): number {
    // Vowel region: from consonant marker to cutoff
    const consonantTime = otoEntry.consonant / 1000;
    const sampleEnd = this._calculateSampleEnd(otoEntry, audioBuffer.duration);
    const vowelStart = Math.max(otoEntry.offset / 1000, consonantTime);
    const vowelDuration = sampleEnd - vowelStart;

    if (vowelDuration < 0.02) {
      // Not enough vowel region to analyze
      return 0;
    }

    // Use detectPitch on the vowel region for a single stable measurement
    // Try representative pitch first for robustness
    const period = detectRepresentativePitch(audioBuffer, {
      numSamples: 3,
      sampleDuration: Math.min(0.05, vowelDuration / 3),
      startOffset: vowelStart,
    });

    if (period <= 0) {
      return 0;
    }

    return 1 / period;
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
      defaultEnvelope = DEFAULT_ENVELOPE,
      crossfadeType = 'equal-power',
    } = options;

    // Store synthesis settings
    this._defaultEnvelope = defaultEnvelope;
    this._crossfadeType = crossfadeType;

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

    // Record sequence start time for position tracking.
    // Offset by preutterance so that the first note's effective start
    // (startTime - preutterance) lands at currentTime instead of being
    // clamped forward, which would collapse early notes onto the same time.
    this._sequenceStartTime = this._audioContext.currentTime + preutterance;
    this._isPlaying = true;

    console.group('[MelodyPlayer] playSequence diagnostics');
    console.log('sequenceStartTime:', this._sequenceStartTime.toFixed(4));
    console.log('oto params (s):', { sampleStart, sampleDuration, preutterance, overlap });
    console.log('notes:', sortedNotes.length);

    // Schedule each note
    for (let i = 0; i < sortedNotes.length; i++) {
      const note = sortedNotes[i];
      const prevNote = i > 0 ? sortedNotes[i - 1] : null;
      const nextNote = i < sortedNotes.length - 1 ? sortedNotes[i + 1] : null;

      // UTAU-style 2-note polyphony cap: a note must reach zero gain before
      // the note-after-next starts playing. Cap duration to 2× the spacing
      // to the next note so at most 2 notes overlap at any point.
      const noteSpacing = nextNote ? nextNote.startTime - note.startTime : Infinity;
      const maxNoteDuration = 2 * noteSpacing;

      this._scheduleNote(note, prevNote, {
        sampleStart,
        sampleDuration,
        preutterance,
        overlap,
        audioBuffer,
        otoEntry,
        maxNoteDuration,
      });
    }
    console.groupEnd();

    // Individual node cleanup is handled by source.onended callbacks.
    // When the last ActiveNode is removed, _removeActiveNode() sets
    // _isPlaying = false automatically.
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
   * ```
   */
  async playPhrase(
    notes: PhraseNote[],
    sampleMap: Map<string, SampleData>,
    options?: {
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
       * Use per-sample pitch matching to normalize all samples to a reference pitch (default: false).
       *
       * When enabled, detects each sample's fundamental frequency in its vowel region
       * and applies a pitch correction so that pitch=0 produces the reference frequency.
       * This compensates for voicebanks recorded at different pitches (e.g., A4 vs C4).
       */
      usePitchMatching?: boolean;
      /**
       * Reference pitch for pitch matching in Hz (default: C4 = 261.63Hz).
       *
       * Only used when usePitchMatching is true. All samples will be corrected
       * so that pitch=0 plays at this frequency.
       */
      referencePitch?: number;
      /**
       * Use PSOLA for pitch shifts above threshold (default: true).
       *
       * When enabled, pitch shifts exceeding psolaThreshold semitones are
       * processed through the PSOLA Web Worker for formant-preserving quality.
       * Shifts at or below the threshold use fast playback-rate shifting.
       */
      usePsola?: boolean;
      /**
       * Semitone threshold for PSOLA vs playback-rate shifting (default: 2).
       *
       * Pitch shifts with absolute value greater than this use PSOLA processing.
       * Shifts at or below this threshold use playback-rate shifting (faster,
       * lower quality but acceptable for small intervals).
       */
      psolaThreshold?: number;
      /**
       * Preserve formants during PSOLA pitch shifting (default: true).
       *
       * When enabled, applies cepstral envelope correction after PSOLA to
       * restore the original vocal tract shape (formants). This prevents
       * chipmunk/Darth Vader effects on large pitch shifts while keeping
       * the new fundamental frequency.
       *
       * Only applies to notes processed through PSOLA (above psolaThreshold).
       */
      preserveFormants?: boolean;
      /**
       * Formant scaling factor (0.0 - 1.0, default: 0.15).
       *
       * Controls how much formants follow the pitch shift:
       * - 0.0 = full preservation (formants stay at original positions)
       * - 0.15 = natural scaling (formants shift ~15% with pitch, sounds natural)
       * - 1.0 = no correction (same as plain PSOLA, formants shift fully)
       *
       * Only used when preserveFormants is true.
       */
      formantScale?: number;
      /**
       * Apply spectral envelope smoothing at sample join boundaries (default: false).
       *
       * When enabled, analyzes spectral envelopes at the overlap region between
       * consecutive samples and applies per-bin magnitude correction so the timbre
       * transitions smoothly, not just the amplitude. This eliminates the
       * "glued-together" quality of concatenated samples with different timbres.
       *
       * Processing cost: one STFT analysis + resynthesis per join. Opt-in because
       * it adds latency to the pre-scheduling phase.
       *
       * Requires useDynamicOverlap=true (or at minimum that spectral distance is
       * available for each join). When spectral distance is below the threshold,
       * smoothing is automatically skipped for that join.
       */
      useSpectralSmoothing?: boolean;
      /**
       * Options for spectral smoothing at join boundaries.
       *
       * Only used when useSpectralSmoothing is true.
       */
      spectralSmoothingOptions?: SpectralSmoothingOptions;
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
      defaultEnvelope = DEFAULT_ENVELOPE,
      crossfadeType = 'equal-power',
      useDynamicOverlap = false,
      dynamicOverlapMaxScale = 2.0,
      spectralDistanceOptions,
      useLoudnessNormalization = false,
      normalizationOptions,
      usePitchMatching = false,
      referencePitch = C4_FREQUENCY,
      usePsola = true,
      psolaThreshold = this._psolaThreshold,
      preserveFormants = true,
      formantScale = 0.15,
      useSpectralSmoothing = false,
      spectralSmoothingOptions,
    } = options ?? {};

    // Store synthesis settings
    this._defaultEnvelope = defaultEnvelope;
    this._crossfadeType = crossfadeType;

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

    // Pre-compute loudness normalization factors if enabled.
    // IMPORTANT: Analyze only the sustained vowel portion of each sample
    // (from consonant marker to cutoff), not the full playback region.
    // This prevents transient-heavy consonants like Japanese "ra" (alveolar flap)
    // from being over-attenuated by the peak limiter. The consonant transient
    // has high peak but low RMS; measuring RMS over just the vowel portion
    // gives a more accurate representation of perceived loudness.
    const normalizationGains = new Map<string, number>();
    if (useLoudnessNormalization) {
      // First pass: analyze all samples
      const analysisMap = new Map<string, LoudnessAnalysis>();
      for (const [alias, data] of sampleMap) {
        // Use vowel-region analysis that skips the consonant transient
        const analysis = analyzeLoudnessForNormalization(data.audioBuffer, {
          offset: data.otoEntry.offset,
          consonant: data.otoEntry.consonant,
          cutoff: data.otoEntry.cutoff,
        });
        analysisMap.set(alias, analysis);
      }

      // Calculate median RMS across all samples in the phrase for relative normalization.
      // This keeps overall volume at the voicebank's natural level instead of boosting
      // to an absolute target, while still correcting per-sample volume differences.
      const medianRmsDb = calculateMedianRmsDb([...analysisMap.values()]);
      console.log(
        `[NormMedian] medianRms=${medianRmsDb.toFixed(1)}dB across ${analysisMap.size} samples`
      );

      // Second pass: calculate gains using absolute target (-18dB default).
      // Now that VCV analysis bias is fixed (vowel-region-only RMS+peak),
      // absolute normalization produces consistent CV/VCV balance while
      // bringing overall volume to a comfortable listening level.
      for (const [alias, analysis] of analysisMap) {
        const gain = calculateNormalizationGain(analysis, normalizationOptions);
        normalizationGains.set(alias, gain);
        const gainDb = 20 * Math.log10(gain);
        const sampleData = sampleMap.get(alias)!;
        console.log(
          `[NormAnalysis] ${alias}: rms=${analysis.rmsDb.toFixed(1)}dB peak=${analysis.peakDb.toFixed(1)}dB ` +
          `crest=${analysis.crestFactor.toFixed(1)} → gain=${gainDb.toFixed(1)}dB (median=${medianRmsDb.toFixed(1)}dB) | ` +
          `oto: off=${sampleData.otoEntry.offset} cons=${sampleData.otoEntry.consonant} cut=${sampleData.otoEntry.cutoff} ` +
          `bufDur=${(sampleData.audioBuffer.duration * 1000).toFixed(0)}ms`
        );
      }
    }

    // Pre-compute per-sample pitch corrections if pitch matching is enabled.
    // Detects each sample's fundamental frequency in the vowel region and
    // calculates the semitone offset needed to make pitch=0 sound at referencePitch.
    const pitchCorrections = new Map<string, number>();
    if (usePitchMatching) {
      for (const [alias, data] of sampleMap) {
        const frequency = this._detectSamplePitch(data.audioBuffer, data.otoEntry);
        if (frequency > 0) {
          const correction = calculatePitchCorrection(frequency, referencePitch);
          pitchCorrections.set(alias, correction);
          console.log(
            `[PitchMatch] ${alias}: detected=${frequency.toFixed(1)}Hz → correction=${correction.toFixed(2)} semitones`
          );
        } else {
          console.log(`[PitchMatch] ${alias}: no pitch detected, skipping correction`);
        }
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
    console.log('notes:', sortedNotes.length);

    // Log normalization gains for volume diagnostics
    if (useLoudnessNormalization && normalizationGains.size > 0) {
      const gainEntries = [...normalizationGains.entries()].map(
        ([alias, gain]) => `${alias}: ${(20 * Math.log10(gain)).toFixed(1)}dB (${gain.toFixed(3)}x)`
      );
      console.log('normalization gains:', gainEntries.join(', '));
    }

    // Filter to schedulable notes (those with samples in the map)
    // Apply pitch corrections if pitch matching is enabled
    const schedulableNotes: Array<{ note: PhraseNote; sampleData: SampleData }> = [];
    for (const note of sortedNotes) {
      const sampleData = sampleMap.get(note.alias);
      if (sampleData) {
        const correction = pitchCorrections.get(note.alias) ?? 0;
        const correctedNote = correction !== 0
          ? { ...note, pitch: note.pitch + correction }
          : note;
        schedulableNotes.push({
          note: correctedNote,
          sampleData,
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
        const jc = calculateJoinGainCorrection(
          dataA.audioBuffer,
          dataB.audioBuffer,
          {
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
        );
        joinCorrections.push(jc);
        console.log(
          `[JoinCorrection] ${schedulableNotes[i].note.alias} → ${schedulableNotes[i + 1].note.alias}: ` +
          `rmsDiff=${jc.rmsDiffDb.toFixed(1)}dB gainA=${jc.gainA.toFixed(3)} gainB=${jc.gainB.toFixed(3)} ` +
          `rmsA=${(20 * Math.log10(jc.rmsA || 1e-10)).toFixed(1)}dB rmsB=${(20 * Math.log10(jc.rmsB || 1e-10)).toFixed(1)}dB`
        );
      }
    }

    // Get spectral cache if using dynamic overlap or spectral smoothing
    const spectralCache = (useDynamicOverlap || useSpectralSmoothing) ? this._getSpectralCache() : null;

    // Pre-process spectral smoothing at join boundaries if enabled.
    // This creates cloned AudioBuffers for samples that participate in smoothed
    // joins, applies the spectral correction in-place on the clones, then
    // replaces the sample data references so the scheduling loop uses the
    // smoothed versions. Original AudioBuffers are not mutated.
    if (useSpectralSmoothing && spectralCache && schedulableNotes.length >= 2) {
      // Track which note indices need cloned buffers (to avoid double-cloning)
      const clonedBuffers = new Map<number, AudioBuffer>();

      const getOrCloneBuffer = (idx: number): AudioBuffer => {
        let cloned = clonedBuffers.get(idx);
        if (!cloned) {
          const orig = schedulableNotes[idx].sampleData.audioBuffer;
          cloned = this._cloneAudioBuffer(orig);
          clonedBuffers.set(idx, cloned);
        }
        return cloned;
      };

      for (let i = 0; i < schedulableNotes.length - 1; i++) {
        const dataA = schedulableNotes[i].sampleData;
        const dataB = schedulableNotes[i + 1].sampleData;

        // Get spectral distance for this join
        const distResult = spectralCache.getDistance(
          dataA.audioBuffer,
          dataB.audioBuffer,
          spectralDistanceOptions,
        );

        // Skip if distance is below threshold (applySpectralSmoothing also checks,
        // but we avoid unnecessary buffer cloning here)
        const threshold = spectralSmoothingOptions?.distanceThreshold ?? 0.1;
        if (distResult.distance < threshold) {
          continue;
        }

        // Determine the overlap region in samples.
        // tailA = end of sample A's playback region
        // headB = start of sample B's playback region
        const sampleRate = dataA.audioBuffer.sampleRate;
        const smoothingMs = spectralSmoothingOptions?.smoothingRegionMs ?? 30;
        const smoothingSamples = Math.floor((smoothingMs / 1000) * sampleRate);

        // Sample A: playback ends at cutoff position
        const endA = this._calculateSampleEnd(dataA.otoEntry, dataA.audioBuffer.duration);
        const endASample = Math.floor(endA * sampleRate);
        const startATail = Math.max(0, endASample - smoothingSamples);

        // Sample B: playback starts at offset position
        const startB = dataB.otoEntry.offset / 1000;
        const startBSample = Math.floor(startB * sampleRate);
        const endBHead = Math.min(
          dataB.audioBuffer.length,
          startBSample + smoothingSamples,
        );

        // Clone the buffers if not already cloned
        const clonedA = getOrCloneBuffer(i);
        const clonedB = getOrCloneBuffer(i + 1);

        // Get mutable channel data from the clones
        const channelA = clonedA.getChannelData(0);
        const channelB = clonedB.getChannelData(0);

        // Extract the tail/head regions as subarrays (views into the clone)
        const tailA = channelA.subarray(startATail, endASample);
        const headB = channelB.subarray(startBSample, endBHead);

        if (tailA.length > 0 && headB.length > 0) {
          applySpectralSmoothing(
            tailA,
            headB,
            sampleRate,
            distResult.distance,
            spectralSmoothingOptions,
          );
          console.log(
            `[SpectralSmooth] ${schedulableNotes[i].note.alias} → ${schedulableNotes[i + 1].note.alias}: ` +
            `distance=${distResult.distance.toFixed(3)} tailA=${tailA.length}samp headB=${headB.length}samp`,
          );
        }
      }

      // Replace sample data references with cloned (smoothed) buffers
      for (const [idx, clonedBuffer] of clonedBuffers) {
        const original = schedulableNotes[idx].sampleData;
        schedulableNotes[idx] = {
          ...schedulableNotes[idx],
          sampleData: {
            ...original,
            audioBuffer: clonedBuffer,
          },
        };
      }
    }

    // Pre-process audio with PSOLA for notes with large pitch shifts or
    // non-unity time stretch. This must happen BEFORE the scheduling loop
    // so all processed buffers are ready for synchronous scheduling.
    const processedBuffers = new Map<string, AudioBuffer>();
    if (usePsola) {
      // Collect unique (audioBuffer, effectivePitch, timeStretch) pairs that
      // need PSOLA. A note needs PSOLA when either:
      // - |pitch| exceeds psolaThreshold, OR
      // - timeStretch !== 1.0 (playback-rate cannot time-stretch independently)
      const batchRequests: Array<{
        audioBuffer: AudioBuffer;
        pitchShift: number;
        timeStretch?: number;
        preserveFormants?: boolean;
        formantScale?: number;
        cacheKey: string;
      }> = [];

      for (const { note, sampleData } of schedulableNotes) {
        const effectivePitch = note.pitch;
        const noteTimeStretch = note.timeStretch ?? 1.0;
        const needsPsola = Math.abs(effectivePitch) > psolaThreshold || noteTimeStretch !== 1.0;

        if (needsPsola) {
          const bufferHash = ProcessedBufferCache.hashBuffer(sampleData.audioBuffer);
          const cacheKey = ProcessedBufferCache.makeKey(bufferHash, effectivePitch, noteTimeStretch, preserveFormants, formantScale);

          // Check local cache first
          const cached = this._bufferCache.get(cacheKey);
          if (cached) {
            processedBuffers.set(cacheKey, cached);
          } else if (!batchRequests.some((r) => r.cacheKey === cacheKey)) {
            batchRequests.push({
              audioBuffer: sampleData.audioBuffer,
              pitchShift: effectivePitch,
              timeStretch: noteTimeStretch,
              preserveFormants,
              formantScale,
              cacheKey,
            });
          }
        }
      }

      // Process cache misses in the worker
      if (batchRequests.length > 0) {
        try {
          // Lazily create the worker client
          if (!this._processorClient) {
            this._processorClient = new AudioProcessorClient();
          }

          console.log(`[PSOLA] Processing ${batchRequests.length} unique pitch-shifted/time-stretched buffers in worker`);
          const workerResults = await this._processorClient.processBatch(batchRequests);

          // Check for partial failures: if any requested buffer was not returned,
          // fall back to playback-rate for the ENTIRE phrase to avoid timbral
          // inconsistency (some notes PSOLA, others playback-rate).
          const missingKeys = batchRequests
            .filter((r) => !workerResults.has(r.cacheKey))
            .map((r) => r.cacheKey);

          if (missingKeys.length > 0) {
            console.warn(
              `[PSOLA] Worker returned partial results (${missingKeys.length}/${batchRequests.length} failed). ` +
              `Falling back to playback-rate for entire phrase to maintain timbral consistency.`
            );
            processedBuffers.clear();
            window.dispatchEvent(new CustomEvent('playback-psola-fallback', {
              detail: {
                reason: 'partial_failure',
                failedCount: missingKeys.length,
                totalCount: batchRequests.length,
                failedKeys: missingKeys,
              },
            }));
          } else {
            // All succeeded -- store results in both the local map and the persistent cache
            for (const [cacheKey, buffer] of workerResults) {
              processedBuffers.set(cacheKey, buffer);
              this._bufferCache.set(cacheKey, buffer);
            }
          }
        } catch (err) {
          console.warn('[PSOLA] Worker batch processing failed, falling back to playback-rate for entire phrase:', err);
          // Clear ALL processed buffers (including cached ones collected earlier)
          // to ensure the entire phrase uses playback-rate shifting consistently.
          processedBuffers.clear();
          window.dispatchEvent(new CustomEvent('playback-psola-fallback', {
            detail: {
              reason: 'worker_error',
              error: err instanceof Error ? err.message : String(err),
            },
          }));
        }
      }
    }

    // Schedule each note with its specific sample
    for (let i = 0; i < schedulableNotes.length; i++) {
      const { note, sampleData } = schedulableNotes[i];
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
        // full correction from both sides.
        const incomingGainB = i > 0 ? joinCorrections[i - 1].gainB : 1;
        const outgoingGainA = i < schedulableNotes.length - 1 ? joinCorrections[i].gainA : 1;
        joinGain = incomingGainB * outgoingGainA;
      }

      const effectiveVelocity = (note.velocity ?? 1) * normalizationGain * joinGain;
      const normDb = normalizationGain !== 1 ? `${(20 * Math.log10(normalizationGain)).toFixed(1)}dB` : '0dB';
      const joinDb = joinGain !== 1 ? `${(20 * Math.log10(joinGain)).toFixed(1)}dB` : '0dB';
      const effectiveDb = `${(20 * Math.log10(effectiveVelocity)).toFixed(1)}dB`;
      console.log(
        `[Gain] #${i} ${note.alias}: norm=${normDb} join=${joinDb} → effective=${effectiveDb} (${effectiveVelocity.toFixed(3)}x)`
      );

      // UTAU-style 2-note polyphony cap: a note must reach zero gain before
      // the note-after-next starts playing. Cap duration to 2× the spacing
      // to the next note so at most 2 notes overlap at any point.
      const nextSchedulable = i < schedulableNotes.length - 1 ? schedulableNotes[i + 1] : null;
      const noteSpacing = nextSchedulable ? nextSchedulable.note.startTime - note.startTime : Infinity;
      const maxNoteDuration = 2 * noteSpacing;

      // Look up PSOLA-processed buffer for this note if available.
      // A note uses PSOLA when |pitch| > threshold OR timeStretch !== 1.0.
      const noteTimeStretch = note.timeStretch ?? 1.0;
      let processedBuffer: AudioBuffer | undefined;
      if (usePsola && (Math.abs(note.pitch) > psolaThreshold || noteTimeStretch !== 1.0)) {
        const bufferHash = ProcessedBufferCache.hashBuffer(sampleData.audioBuffer);
        const cacheKey = ProcessedBufferCache.makeKey(bufferHash, note.pitch, noteTimeStretch, preserveFormants, formantScale);
        processedBuffer = processedBuffers.get(cacheKey);
      }

      this._schedulePhraseNote(
        note,
        prev?.note ?? null,
        prev?.sampleData ?? null,
        sampleData,
        dynamicOverlapMs,
        normalizationGain,
        joinGain,
        maxNoteDuration,
        processedBuffer,
      );
    }

    console.groupEnd();

    // Individual node cleanup is handled by source.onended callbacks.
    // When the last ActiveNode is removed, _removeActiveNode() sets
    // _isPlaying = false automatically.
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
      if (node.source) {
        node.source.onended = null;
      }
    }

    // Stop all active nodes
    for (const node of this._activeNodes) {
      try {
        if (node.source) {
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
   * Create a deep clone of an AudioBuffer.
   *
   * The Web Audio API's AudioBuffer.getChannelData() returns a mutable view
   * into internal storage. To avoid mutating shared sample buffers (e.g. when
   * applying spectral smoothing), we clone into a fresh AudioBuffer and copy
   * all channel data.
   *
   * @param buffer - The AudioBuffer to clone
   * @returns A new AudioBuffer with identical content
   */
  private _cloneAudioBuffer(buffer: AudioBuffer): AudioBuffer {
    const clone = this._audioContext.createBuffer(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate,
    );
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      clone.getChannelData(ch).set(buffer.getChannelData(ch));
    }
    return clone;
  }

  /**
   * Compute loop parameters for a sample, determining whether vowel-region
   * looping is viable and the loop boundaries.
   *
   * The vowel region spans from the consonant marker to the cutoff position.
   * Looping is only enabled when this region is at least MIN_LOOP_REGION (40ms),
   * which prevents artifacts from looping very short or consonant-only samples.
   *
   * @param otoEntry - Oto parameters defining sample regions
   * @param audioBuffer - The audio buffer for duration reference
   * @returns Loop viability and boundary positions in seconds
   */
  private _computeLoopParams(
    otoEntry: OtoEntry,
    audioBuffer: AudioBuffer
  ): { canLoop: boolean; consonantSec: number; sampleEndSec: number } {
    // Consonant boundary: the later of offset and consonant marker
    const consonantSec = Math.max(otoEntry.offset, otoEntry.consonant) / 1000;
    const sampleEndSec = this._calculateSampleEnd(otoEntry, audioBuffer.duration);
    const vowelDuration = sampleEndSec - consonantSec;
    const canLoop = vowelDuration >= MIN_LOOP_REGION;
    return { canLoop, consonantSec, sampleEndSec };
  }

  /**
   * Schedule a single note for playback.
   *
   * Handles pitch shifting, timing adjustments for preutterance,
   * and crossfade with the previous note.
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
      otoEntry: OtoEntry;
      maxNoteDuration?: number;
    }
  ): void {
    const { sampleStart, sampleDuration, preutterance, overlap, audioBuffer, otoEntry, maxNoteDuration } = params;

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

    // Compute loop parameters for vowel-region looping
    const { canLoop, consonantSec, sampleEndSec } = this._computeLoopParams(otoEntry, audioBuffer);

    // Calculate note duration.
    // Always include preutterance in duration for consistent note lengths.
    // Cap to maxNoteDuration to enforce UTAU-style 2-note polyphony: a note
    // must reach zero gain before the note-after-next starts playing.
    // When looping is available, don't clamp to sampleDuration since the
    // vowel region loops to sustain beyond the sample's natural length.
    const noteDuration = canLoop
      ? Math.min(note.duration + preutterance, maxNoteDuration ?? Infinity)
      : Math.min(note.duration + preutterance, sampleDuration, maxNoteDuration ?? Infinity);

    // Determine crossfade timing
    // For equal-power crossfade, both the outgoing note's fade-out and the
    // incoming note's fade-in MUST use the same duration and time window.
    // fadeTime is used for both the fade-in of this note and the fade-out
    // tail of this note (when the *next* note overlaps).
    const fadeTime = Math.min(overlap, noteDuration * 0.5);
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

    this._schedulePlaybackRateNote(note, {
      audioBuffer,
      sampleStart,
      sampleDuration,
      whenToStart,
      noteDuration,
      fadeInTime,
      fadeTime,
      velocity,
      canLoop,
      consonantSec,
      sampleEndSec,
    });
  }

  /**
   * Schedule a note using playback-rate pitch shifting.
   *
   * Timing values (whenToStart, noteDuration, fadeInTime, fadeTime) are
   * computed by the dispatcher (_scheduleNote) and passed in directly.
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
      canLoop: boolean;
      consonantSec: number;
      sampleEndSec: number;
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
      canLoop,
      consonantSec,
      sampleEndSec,
    } = params;

    // Calculate playback rate for pitch shifting
    // Formula: rate = 2^(semitones/12)
    const playbackRate = Math.pow(2, note.pitch / 12);

    // Create audio nodes
    const source = this._audioContext.createBufferSource();
    const gainNode = this._audioContext.createGain();

    source.buffer = audioBuffer;
    source.playbackRate.value = playbackRate;

    // Enable vowel-region looping for sustained notes
    if (canLoop) {
      source.loop = true;
      source.loopStart = consonantSec;
      source.loopEnd = sampleEndSec;
    }

    // Connect: source -> gain -> destination
    source.connect(gainNode);
    gainNode.connect(this._audioContext.destination);

    // Get the envelope for this note (note-specific or default)
    const envelope = note.envelope ?? this._defaultEnvelope;

    // Apply envelope shaping
    this._applyUnifiedEnvelope(gainNode, {
      whenToStart,
      noteDuration,
      fadeInTime,
      fadeTime,
      baseGain: velocity,
      envelope,
    });

    // Set up vibrato modulation if specified.
    // AudioBufferSourceNode.detune is a native AudioParam, so we connect a
    // Web Audio OscillatorNode LFO directly for sample-accurate pitch
    // modulation with zero polling overhead.
    const vibratoNodes = this._createVibratoLFO(note.vibrato, source.detune, whenToStart, noteDuration);

    // Apply pitch bend keyframes to source.detune if specified.
    // Pitch bend sets the base detune value; vibrato LFO adds on top additively.
    this._applyPitchBend(note.pitchBend, source.detune, whenToStart);

    // Schedule the source node.
    // Use noteDuration + a release buffer instead of the full sampleDuration so
    // the AudioBufferSourceNode stops shortly after the envelope silences the
    // audio, rather than running silently for the remainder of the sample.
    // The actual release time used is fadeTime (crossfade-aligned), not envelope.release.
    // When looping, don't clamp to sampleDuration since the source loops.
    const releaseBuffer = Math.max(fadeTime, 0.05);
    const sourceDuration = canLoop ? noteDuration + releaseBuffer : Math.min(noteDuration + releaseBuffer, sampleDuration);
    source.start(whenToStart, sampleStart, sourceDuration);

    // Track active node for cleanup
    const activeNode: ActiveNode = {
      source,
      gainNode,
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
   * Schedule a single phrase note for playback with its specific sample.
   *
   * This is similar to _scheduleNote but handles per-note sample data,
   * extracting oto parameters from each note's specific sample.
   *
   * @param note - The phrase note to schedule
   * @param prevNote - Previous note for overlap calculation (or null)
   * @param prevSampleData - Previous note's sample data (or null)
   * @param sampleData - Sample data for this note
   * @param dynamicOverlapMs - Dynamic overlap in milliseconds calculated from spectral distance (optional)
   * @param normalizationGain - Global normalization gain for this sample (optional, default 1)
   * @param joinGain - Combined join correction gain (incoming gainB * outgoing gainA, default 1)
   * @param maxNoteDuration - Maximum note duration for polyphony cap
   * @param processedBuffer - Pre-processed PSOLA buffer with pitch already applied (optional)
   */
  private _schedulePhraseNote(
    note: PhraseNote,
    prevNote: PhraseNote | null,
    prevSampleData: SampleData | null,
    sampleData: SampleData,
    dynamicOverlapMs?: number,
    normalizationGain = 1,
    joinGain = 1,
    maxNoteDuration?: number,
    processedBuffer?: AudioBuffer,
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

    // Apply velocity, normalization gain, and join correction
    const baseVelocity = note.velocity ?? 1;
    const velocity = baseVelocity * normalizationGain;
    const effectiveVelocity = velocity * joinGain;

    // Compute loop parameters for vowel-region looping
    const { canLoop, consonantSec, sampleEndSec } = this._computeLoopParams(otoEntry, audioBuffer);

    // Calculate note duration. Always include preutterance for consistent note lengths.
    // Cap to maxNoteDuration to enforce UTAU-style 2-note polyphony: a note
    // must reach zero gain before the note-after-next starts playing.
    // When looping is available, don't clamp to sampleDuration since the
    // vowel region loops to sustain beyond the sample's natural length.
    const noteDuration = canLoop
      ? Math.min(note.duration + preutterance, maxNoteDuration ?? Infinity)
      : Math.min(note.duration + preutterance, sampleDuration, maxNoteDuration ?? Infinity);

    // Determine crossfade timing using the (potentially dynamic) overlap.
    // For equal-power crossfade, the incoming note's fade-in and the outgoing
    // note's fade-out MUST use the same duration so that
    // g_in(t)^2 + g_out(t)^2 = 1 (constant power) at every point.
    const fadeTime = Math.min(overlap, noteDuration * 0.5);
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

    this._schedulePlaybackRatePhraseNote(note, {
      audioBuffer,
      sampleStart,
      sampleDuration,
      whenToStart,
      noteDuration,
      fadeInTime,
      fadeTime,
      velocity: effectiveVelocity,
      canLoop,
      consonantSec,
      sampleEndSec,
      processedBuffer,
      timeStretch: note.timeStretch ?? 1.0,
    });
  }

  /**
   * Schedule a phrase note for playback.
   *
   * Supports two pitch-shifting strategies:
   * - If a processedBuffer is provided (from PSOLA worker), uses it as the
   *   audio source with playbackRate=1.0 (pitch already baked in). Vibrato
   *   still works via source.detune modulation on top of the base pitch.
   * - Otherwise, uses the original audioBuffer with playbackRate-based
   *   pitch shifting (existing behavior).
   *
   * Timing values (whenToStart, noteDuration, fadeInTime, fadeTime) are
   * computed by the dispatcher (_schedulePhraseNote) and passed in directly.
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
      canLoop: boolean;
      consonantSec: number;
      sampleEndSec: number;
      /** Pre-processed PSOLA buffer with pitch already applied (optional). */
      processedBuffer?: AudioBuffer;
      /** Time stretch factor applied via PSOLA (default 1.0). */
      timeStretch?: number;
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
      canLoop,
      consonantSec,
      sampleEndSec,
      processedBuffer,
      timeStretch = 1.0,
    } = params;

    // When a PSOLA-processed buffer is available, pitch is already baked in.
    // Use it as the source with playbackRate=1.0. Vibrato still works via
    // source.detune modulation on top of the base pitch.
    const usePsolaBuffer = processedBuffer !== undefined;
    const effectiveBuffer = usePsolaBuffer ? processedBuffer : audioBuffer;
    const playbackRate = usePsolaBuffer ? 1.0 : Math.pow(2, note.pitch / 12);

    // When PSOLA time-stretching is applied, the processed buffer's timeline
    // is scaled by the timeStretch factor. All position-based parameters
    // (sampleStart, loop points, sampleEnd) must be scaled accordingly.
    const tsScale = usePsolaBuffer ? timeStretch : 1.0;
    const effectiveSampleStart = sampleStart * tsScale;
    const effectiveSampleDuration = sampleDuration * tsScale;

    const source = this._audioContext.createBufferSource();
    const gainNode = this._audioContext.createGain();

    source.buffer = effectiveBuffer;
    source.playbackRate.value = playbackRate;

    // Enable vowel-region looping for sustained notes.
    // Loop points refer to the buffer's timeline. When PSOLA time-stretching
    // is applied, the processed buffer is proportionally longer/shorter,
    // so loop boundaries must be scaled by the timeStretch factor.
    if (canLoop) {
      source.loop = true;
      source.loopStart = consonantSec * tsScale;
      source.loopEnd = sampleEndSec * tsScale;
    }

    source.connect(gainNode);
    gainNode.connect(this._audioContext.destination);

    // Get the envelope for this note (note-specific or default)
    const envelope = note.envelope ?? this._defaultEnvelope;

    // Apply envelope shaping
    this._applyUnifiedEnvelope(gainNode, {
      whenToStart,
      noteDuration,
      fadeInTime,
      fadeTime,
      baseGain: velocity,
      envelope,
    });

    // Set up vibrato modulation if specified.
    // Even with PSOLA-processed buffers, source.detune modulates pitch
    // in real-time, providing vibrato on top of the base pitch.
    const vibratoNodes = this._createVibratoLFO(note.vibrato, source.detune, whenToStart, noteDuration);

    // Apply pitch bend keyframes to source.detune if specified.
    // For PSOLA-processed buffers, the base pitch is already baked in (detune base = 0),
    // so pitch bend cents are deviations from that. For playback-rate buffers, detune
    // adds on top of the playbackRate pitch shift. In both cases, vibrato LFO output
    // adds additively via its GainNode connection to source.detune.
    this._applyPitchBend(note.pitchBend, source.detune, whenToStart);

    // Use noteDuration + a release buffer instead of the full sampleDuration so
    // the AudioBufferSourceNode stops shortly after the envelope silences the
    // audio, rather than running silently for the remainder of the sample.
    // The actual release time used is fadeTime (crossfade-aligned), not envelope.release.
    // When looping, don't clamp to sampleDuration since the source loops.
    // Use effectiveSampleDuration/effectiveSampleStart for PSOLA time-stretched buffers.
    const releaseBuffer = Math.max(fadeTime, 0.05);
    const sourceDuration = canLoop ? noteDuration + releaseBuffer : Math.min(noteDuration + releaseBuffer, effectiveSampleDuration);
    source.start(whenToStart, effectiveSampleStart, sourceDuration);

    if (usePsolaBuffer) {
      const tsInfo = timeStretch !== 1.0 ? ` timeStretch=${timeStretch}` : '';
      console.log(`  [PSOLA] Using pre-processed buffer for ${note.alias} (pitch=${note.pitch}${tsInfo})`);
    }

    const activeNode: ActiveNode = {
      source,
      gainNode,
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
   * When an ADSR envelope is present, delegates to _applyADSREnvelope;
   * otherwise applies a crossfade shaped by the current _crossfadeType setting.
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
        release: Math.min(fadeTime * 1000, envelope.release),    // cap release to crossfade window
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

    // Apply crossfade using curve-based approach
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
   * Apply pitch bend keyframes to a source node's detune AudioParam.
   *
   * Schedules `setValueAtTime` for the first keyframe and
   * `linearRampToValueAtTime` for each subsequent keyframe, producing
   * piecewise-linear pitch automation in cents.
   *
   * This operates on `source.detune` which is additive with any connected
   * LFO (vibrato). The pitch bend sets the base detune value; the vibrato
   * oscillator's output adds on top via its GainNode connection.
   *
   * @param pitchBend - Array of pitch bend keyframes, or undefined to skip
   * @param detuneParam - The detune AudioParam to automate (source.detune)
   * @param absoluteStart - Absolute AudioContext time when the note starts
   */
  private _applyPitchBend(
    pitchBend: PitchBendPoint[] | undefined,
    detuneParam: AudioParam,
    absoluteStart: number
  ): void {
    if (!pitchBend || pitchBend.length === 0) {
      return;
    }

    // Sort keyframes by time to ensure correct scheduling order
    const sortedBends = [...pitchBend].sort((a, b) => a.time - b.time);

    // Set the initial detune value at the first keyframe's time
    detuneParam.setValueAtTime(
      sortedBends[0].cents,
      absoluteStart + sortedBends[0].time
    );

    // Linearly ramp to each subsequent keyframe
    for (let i = 1; i < sortedBends.length; i++) {
      detuneParam.linearRampToValueAtTime(
        sortedBends[i].cents,
        absoluteStart + sortedBends[i].time
      );
    }
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
      node.source?.disconnect();
      node.gainNode?.disconnect();
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
