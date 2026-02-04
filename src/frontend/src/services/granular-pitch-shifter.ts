/**
 * GranularPitchShifter - Formant-preserving pitch shifting using Tone.js granular synthesis.
 *
 * Unlike playback-rate pitch shifting which causes formant distortion (chipmunk effect
 * at high pitches, muddy sound at low pitches), granular synthesis independently controls
 * pitch without affecting the spectral envelope (formants).
 *
 * This works by chopping the audio into small grains (typically 50-100ms), overlapping
 * them, and adjusting their playback rate while maintaining the original time domain.
 *
 * Supports adaptive grain sizing based on detected pitch period, which reduces "beating"
 * artifacts that occur when grain boundaries cut through pitch cycles.
 *
 * @example
 * ```typescript
 * const shifter = new GranularPitchShifter(audioContext);
 *
 * // Play sample shifted up 5 semitones with natural formants
 * shifter.playPitchShifted(audioBuffer, {
 *   pitchShift: 5,
 *   startOffset: 0.1,
 *   duration: 0.5,
 *   when: audioContext.currentTime,
 * });
 *
 * // Use adaptive grain sizing for better quality
 * const optimalGrainSize = shifter.calculateAdaptiveGrainSize(audioBuffer);
 * shifter.playPitchShifted(audioBuffer, {
 *   pitchShift: 5,
 *   grainSize: optimalGrainSize,
 * });
 * ```
 */

import * as Tone from 'tone';
import {
  detectPitchPeriod,
  detectRepresentativePitch,
  calculateOptimalGrainSize,
  type PitchDetectionOptions,
} from '../utils/pitch-detection.js';
import { PsolaProcessor, type PitchMarkOptions } from '../utils/psola.js';

/**
 * ADSR (Attack-Decay-Sustain-Release) envelope for shaping note dynamics.
 *
 * Controls amplitude over the lifetime of a note:
 * - Attack: Ramp from 0 to peak
 * - Decay: Ramp from peak to sustain level
 * - Sustain: Hold at sustain level during note body
 * - Release: Ramp from sustain to 0 at note end
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
 * Crossfade curve type for blending between notes.
 *
 * - 'linear': Simple linear ramp (faster, slight dip in perceived volume)
 * - 'equal-power': Sine/cosine curve maintaining constant perceived loudness
 */
export type CrossfadeType = 'linear' | 'equal-power';

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
 * Options for pitch-shifted playback.
 */
export interface PitchShiftOptions {
  /** Pitch shift in semitones. Positive = higher, negative = lower. Range: -24 to +24 recommended. */
  pitchShift: number;
  /** Start offset in the buffer in seconds */
  startOffset?: number;
  /** Duration to play in seconds (undefined = play to end) */
  duration?: number;
  /** When to start playback (AudioContext time). Defaults to immediately. */
  when?: number;
  /** Grain size in seconds. Smaller = smoother but more CPU. Default: 0.1 */
  grainSize?: number;
  /** Grain overlap factor (0-1). Higher = smoother crossfades. Default: 0.5 */
  overlap?: number;
  /** Gain/volume (0-1). Default: 1 */
  gain?: number;
  /** Fade in duration in seconds. Default: 0.01. Ignored if envelope is provided. */
  fadeIn?: number;
  /** Fade out duration in seconds. Default: 0.01. Ignored if envelope is provided. */
  fadeOut?: number;
  /** Optional ADSR envelope. If provided, overrides fadeIn/fadeOut with full ADSR shaping. */
  envelope?: ADSREnvelope;
  /**
   * Type of crossfade curve to use (default: 'equal-power').
   *
   * - 'linear': Simple linear ramp. Faster but can cause a slight dip in
   *   perceived volume during crossfades.
   * - 'equal-power': Uses sine/cosine curves that maintain constant perceived
   *   loudness during crossfades. Recommended for natural-sounding transitions.
   */
  crossfadeType?: CrossfadeType;
  /**
   * Optional vibrato modulation for the note.
   *
   * When provided, creates an LFO (Low Frequency Oscillator) that modulates
   * the pitch using the GrainPlayer's detune parameter. This produces a
   * natural-sounding vibrato effect common in vocal synthesis.
   */
  vibrato?: VibratoParams;
  /**
   * Use PSOLA (Pitch-Synchronous Overlap-Add) for pitch shifting (default: false).
   *
   * When enabled, uses TD-PSOLA algorithm which aligns grain windows to pitch
   * period boundaries, eliminating beating artifacts that occur with fixed grain
   * sizes. This is the gold standard for pitch manipulation in speech/singing
   * synthesis (used by Praat, UTAU, etc.).
   *
   * Trade-offs vs standard granular synthesis:
   * - Pros: Eliminates beating artifacts, higher quality for pitched audio
   * - Cons: Higher CPU for analysis, may not work well for non-pitched sounds
   *
   * When usePsola is true:
   * - The audio is pre-processed through PSOLA before playback
   * - grainSize and overlap parameters are ignored (PSOLA uses pitch-synchronous grains)
   * - Results are cached for repeated playback of the same pitch shift
   *
   * @example
   * ```typescript
   * // Use PSOLA for highest quality pitch shifting
   * shifter.playPitchShifted(audioBuffer, {
   *   pitchShift: 5,
   *   usePsola: true,
   * });
   * ```
   */
  usePsola?: boolean;
  /**
   * Options for PSOLA pitch mark analysis (only used when usePsola is true).
   *
   * Controls how pitch periods are detected for pitch-synchronous grain alignment.
   */
  psolaOptions?: PitchMarkOptions;
}

/**
 * Vibrato LFO nodes for cleanup tracking.
 *
 * When vibrato is active on the granular path, a native Web Audio OscillatorNode
 * generates the LFO waveform at sample-accurate precision, connected through a
 * GainNode for depth control and an AnalyserNode for value sampling. A Tone.js
 * Transport-scheduled repeating event reads the LFO output and applies it to
 * the GrainPlayer's detune property at grain-rate resolution.
 */
export interface VibratoLFONodes {
  /** Native oscillator generating the LFO sine wave */
  oscillator: OscillatorNode;
  /** Gain node controlling vibrato depth (in cents) */
  depthGain: GainNode;
  /** AnalyserNode used to sample the current LFO value */
  analyser: AnalyserNode;
  /** Tone.js Transport scheduled event ID for the update loop */
  transportEventId: number;
}

/**
 * Handle returned from playPitchShifted for controlling playback.
 */
export interface PlaybackHandle {
  /** Stop this specific playback */
  stop: () => void;
  /** The Tone.js GrainPlayer instance */
  player: Tone.GrainPlayer;
  /** The gain node for volume control */
  gainNode: Tone.Gain;
  /** Native Web Audio LFO nodes for vibrato (if vibrato is enabled) */
  vibratoLFO?: VibratoLFONodes;
}

/**
 * GranularPitchShifter wraps Tone.js GrainPlayer for formant-preserving pitch shifting.
 *
 * Key advantages over playback-rate shifting:
 * - Natural-sounding pitch shifts across a wide range (+-12 semitones and beyond)
 * - Preserves vocal formants, avoiding chipmunk/Darth Vader effects
 * - Independent control of pitch and time
 *
 * Trade-offs:
 * - Higher CPU usage due to grain processing
 * - Slight artifacts possible at extreme settings
 * - Small latency from grain windowing
 */
export class GranularPitchShifter {
  private readonly _audioContext: AudioContext;
  private _activePlayers: Set<PlaybackHandle> = new Set();
  private _toneContextSynced = false;
  // Bridge node to connect Tone.js output to native AudioContext destination
  private _outputBridge: GainNode | null = null;
  // PSOLA processor for pitch-synchronous processing
  private _psolaProcessor: PsolaProcessor | null = null;
  // Cache for PSOLA-processed buffers: WeakMap<AudioBuffer, Map<pitchShiftKey, AudioBuffer>>
  // Using WeakMap keyed on AudioBuffer for correct identity and automatic GC
  private _psolaBufferCache = new WeakMap<AudioBuffer, Map<string, AudioBuffer>>();
  // Track strong references for size-limited eviction
  private _psolaCacheEntries: { buffer: AudioBuffer; pitchKey: string }[] = [];

  /**
   * Create a new GranularPitchShifter.
   *
   * @param audioContext - The Web Audio AudioContext to use. Tone.js will be
   *                       configured to use this context for seamless integration.
   */
  constructor(audioContext: AudioContext) {
    this._audioContext = audioContext;
  }

  /**
   * Get or create the PSOLA processor instance.
   */
  private _getPsolaProcessor(): PsolaProcessor {
    if (!this._psolaProcessor) {
      this._psolaProcessor = new PsolaProcessor();
    }
    return this._psolaProcessor;
  }

  /**
   * Generate a cache key for the pitch shift component of PSOLA cache lookups.
   *
   * The AudioBuffer identity is handled by the WeakMap outer key, so this
   * only needs to encode the pitch shift value.
   */
  private _getPsolaPitchKey(pitchShift: number): string {
    return pitchShift.toFixed(2);
  }

  /**
   * Get or create a PSOLA-processed buffer for the given pitch shift.
   *
   * Results are cached to avoid redundant processing for repeated playback.
   *
   * @param audioBuffer - The original audio buffer
   * @param pitchShift - Pitch shift in semitones
   * @param options - PSOLA options for pitch mark analysis
   * @returns Pitch-shifted audio buffer
   */
  private _getPsolaProcessedBuffer(
    audioBuffer: AudioBuffer,
    pitchShift: number,
    _options?: PitchMarkOptions
  ): AudioBuffer {
    const pitchKey = this._getPsolaPitchKey(pitchShift);

    // Check cache first (WeakMap keyed by AudioBuffer object identity)
    const bufferMap = this._psolaBufferCache.get(audioBuffer);
    if (bufferMap) {
      const cached = bufferMap.get(pitchKey);
      if (cached) {
        return cached;
      }
    }

    // Process with PSOLA
    // Note: _options could be used here in the future for custom pitch mark settings
    const processor = this._getPsolaProcessor();
    const processed = processor.process(audioBuffer, { pitchShift });

    // Cache the result using WeakMap for buffer identity + Map for pitch key
    let pitchMap = this._psolaBufferCache.get(audioBuffer);
    if (!pitchMap) {
      pitchMap = new Map<string, AudioBuffer>();
      this._psolaBufferCache.set(audioBuffer, pitchMap);
    }
    pitchMap.set(pitchKey, processed);

    // Track for size-limited eviction
    this._psolaCacheEntries.push({ buffer: audioBuffer, pitchKey });

    // Limit cache size to prevent memory issues (keep last 50 processed buffers)
    if (this._psolaCacheEntries.length > 50) {
      const oldest = this._psolaCacheEntries.shift();
      if (oldest) {
        const oldMap = this._psolaBufferCache.get(oldest.buffer);
        if (oldMap) {
          oldMap.delete(oldest.pitchKey);
          if (oldMap.size === 0) {
            this._psolaBufferCache.delete(oldest.buffer);
          }
        }
      }
    }

    return processed;
  }

  /**
   * Clear the PSOLA buffer cache.
   *
   * Call this if you need to free memory or if source audio has changed.
   */
  clearPsolaCache(): void {
    // Clear all tracked entries from the WeakMap
    for (const entry of this._psolaCacheEntries) {
      const pitchMap = this._psolaBufferCache.get(entry.buffer);
      if (pitchMap) {
        pitchMap.delete(entry.pitchKey);
      }
    }
    this._psolaCacheEntries = [];
    // WeakMap entries without strong references will be GC'd automatically
    this._psolaBufferCache = new WeakMap<AudioBuffer, Map<string, AudioBuffer>>();
    if (this._psolaProcessor) {
      this._psolaProcessor.clearCache();
    }
  }

  /**
   * Ensure Tone.js is using our AudioContext and create output bridge.
   *
   * Tone.js creates its own context by default, but we need it to use
   * the same context as the rest of the application for proper timing
   * and routing.
   *
   * We use an output bridge (native GainNode) to connect Tone.js nodes
   * to the AudioContext destination. This avoids issues with Tone.js's
   * internal Destination node when using an external AudioContext.
   */
  private async _ensureToneContext(): Promise<void> {
    if (this._toneContextSynced) {
      return;
    }

    // Resume our context if suspended (browser autoplay policy)
    if (this._audioContext.state === 'suspended') {
      await this._audioContext.resume();
    }

    // Set Tone.js to use our AudioContext BEFORE calling Tone.start()
    // This is critical - the context must be set before any Tone.js initialization
    Tone.setContext(this._audioContext);

    // Start Tone.js (handles user gesture requirements)
    await Tone.start();

    // Create a bridge gain node using the native AudioContext
    // This bridges Tone.js nodes to the native destination, avoiding
    // the "param must be an AudioParam" error that occurs when
    // Tone.js's Destination isn't properly initialized with external contexts
    this._outputBridge = this._audioContext.createGain();
    this._outputBridge.gain.value = 1;
    this._outputBridge.connect(this._audioContext.destination);

    this._toneContextSynced = true;
  }

  /**
   * Get the output node for connecting Tone.js players.
   * Returns the bridge gain node that routes to AudioContext.destination.
   */
  private _getOutputNode(): GainNode {
    if (!this._outputBridge) {
      throw new Error('Tone context not initialized. Call _ensureToneContext first.');
    }
    return this._outputBridge;
  }

  /**
   * Convert an AudioBuffer to a Tone.js ToneAudioBuffer.
   *
   * Tone.js GrainPlayer requires its own buffer type, so we need to
   * convert the standard Web Audio AudioBuffer.
   */
  private _convertBuffer(audioBuffer: AudioBuffer): Tone.ToneAudioBuffer {
    // ToneAudioBuffer can be created from a raw AudioBuffer
    return new Tone.ToneAudioBuffer(audioBuffer);
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
   * @returns number array containing the curve values
   */
  private _generateEqualPowerCurve(
    length: number,
    fadeIn: boolean,
    baseGain = 1
  ): number[] {
    // Minimum of 2 samples required
    const safeLength = Math.max(2, length);
    const curve: number[] = [];

    for (let i = 0; i < safeLength; i++) {
      const t = i / (safeLength - 1);
      // Fade in: sin(t * PI/2) goes from 0 to 1
      // Fade out: cos(t * PI/2) goes from 1 to 0
      curve.push(
        fadeIn
          ? Math.sin(t * Math.PI / 2) * baseGain
          : Math.cos(t * Math.PI / 2) * baseGain
      );
    }

    return curve;
  }

  /**
   * Generate a linear crossfade curve.
   *
   * @param length - Number of samples in the curve
   * @param fadeIn - If true, generates fade-in curve; if false, fade-out
   * @param baseGain - Peak gain value (default 1)
   * @returns number array containing the curve values
   */
  private _generateLinearCurve(
    length: number,
    fadeIn: boolean,
    baseGain = 1
  ): number[] {
    // Minimum of 2 samples required
    const safeLength = Math.max(2, length);
    const curve: number[] = [];

    for (let i = 0; i < safeLength; i++) {
      const t = i / (safeLength - 1);
      curve.push(fadeIn ? t * baseGain : (1 - t) * baseGain);
    }

    return curve;
  }

  /**
   * Generate a crossfade curve based on the specified type.
   *
   * @param durationSeconds - Duration of the fade in seconds
   * @param fadeIn - If true, generates fade-in curve; if false, fade-out
   * @param baseGain - Peak gain value (default 1)
   * @param crossfadeType - Type of curve to generate
   * @returns number array containing the curve values
   */
  private _generateCrossfadeCurve(
    durationSeconds: number,
    fadeIn: boolean,
    baseGain = 1,
    crossfadeType: CrossfadeType = 'equal-power'
  ): number[] {
    // Calculate curve length: ~100 samples per 100ms, minimum 2
    // Use Tone.js context sample rate if available
    const sampleRate = Tone.getContext().sampleRate || 44100;
    const length = Math.max(2, Math.ceil(durationSeconds * sampleRate / 441));

    return crossfadeType === 'equal-power'
      ? this._generateEqualPowerCurve(length, fadeIn, baseGain)
      : this._generateLinearCurve(length, fadeIn, baseGain);
  }

  /**
   * Apply ADSR envelope to a Tone.js Param (gain).
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
    gainParam: Tone.Param<'gain'>,
    params: {
      startTime: number;
      duration: number;
      envelope: ADSREnvelope;
      baseGain: number;
    }
  ): void {
    const { startTime, duration, envelope, baseGain } = params;

    // Convert ADSR times from ms to seconds
    const attackTime = envelope.attack / 1000;
    const decayTime = envelope.decay / 1000;
    const releaseTime = envelope.release / 1000;
    const sustainLevel = Math.max(0, Math.min(1, envelope.sustain)) * baseGain;

    // Calculate the total ADS time (before sustain hold)
    const adsTime = attackTime + decayTime;

    // Ensure release doesn't extend past note duration
    // Release must start before note ends, leaving room for the release ramp
    const safeReleaseTime = Math.min(releaseTime, duration * 0.5);
    const releaseStartTime = startTime + duration - safeReleaseTime;

    // If ADS phase would overlap with release, compress proportionally
    const availableADSTime = Math.max(0, releaseStartTime - startTime);
    const adsScale = adsTime > 0 && adsTime > availableADSTime ? availableADSTime / adsTime : 1;
    const safeAttackTime = attackTime * adsScale;
    const safeDecayTime = decayTime * adsScale;

    // Start at 0
    gainParam.setValueAtTime(0, startTime);

    // Attack: ramp to peak
    const attackEndTime = startTime + safeAttackTime;
    gainParam.linearRampToValueAtTime(baseGain, attackEndTime);

    // Decay: ramp to sustain level
    const decayEndTime = attackEndTime + safeDecayTime;
    if (safeDecayTime > 0) {
      gainParam.linearRampToValueAtTime(sustainLevel, decayEndTime);
    }

    // Sustain: hold at sustain level until release
    if (releaseStartTime > decayEndTime) {
      gainParam.setValueAtTime(sustainLevel, releaseStartTime);
    }

    // Release: ramp to 0
    gainParam.linearRampToValueAtTime(0, startTime + duration);
  }

  /**
   * Play an audio buffer with granular pitch shifting.
   *
   * This is the main method for formant-preserving pitch playback.
   * It creates a GrainPlayer, configures it for the specified pitch shift,
   * and schedules playback.
   *
   * @param audioBuffer - The audio to play
   * @param options - Playback options including pitch shift amount
   * @returns A handle for controlling the playback
   *
   * @example
   * ```typescript
   * // Play shifted up 7 semitones (perfect fifth)
   * const handle = shifter.playPitchShifted(buffer, {
   *   pitchShift: 7,
   *   startOffset: 0.1,
   *   duration: 0.5,
   * });
   *
   * // Later, stop it
   * handle.stop();
   * ```
   */
  async playPitchShifted(
    audioBuffer: AudioBuffer,
    options: PitchShiftOptions
  ): Promise<PlaybackHandle> {
    await this._ensureToneContext();

    const {
      pitchShift,
      startOffset = 0,
      duration,
      when,
      grainSize = 0.1,
      overlap = 0.5,
      gain = 1,
      fadeIn = 0.01,
      fadeOut = 0.01,
      envelope,
      crossfadeType = 'equal-power',
      vibrato,
      usePsola = false,
      psolaOptions,
    } = options;

    // When using PSOLA, pre-process the audio with pitch shifting
    // and then play it without additional pitch modification
    let processedBuffer = audioBuffer;
    let effectivePitchShift = pitchShift;

    if (usePsola && pitchShift !== 0) {
      // Process through PSOLA - this applies the pitch shift to the audio
      processedBuffer = this._getPsolaProcessedBuffer(audioBuffer, pitchShift, psolaOptions);
      // The pitch shift has been applied, so don't apply it again via detune
      effectivePitchShift = 0;
    }

    // Convert buffer for Tone.js
    const toneBuffer = this._convertBuffer(processedBuffer);

    // Create GrainPlayer with our settings
    // When using PSOLA, effectivePitchShift will be 0 since pitch is already applied
    const player = new Tone.GrainPlayer({
      url: toneBuffer,
      grainSize,
      overlap,
      // Detune is in cents (100 cents = 1 semitone)
      // When usePsola is true, effectivePitchShift is 0 (pitch already applied)
      detune: effectivePitchShift * 100,
      // Don't loop by default
      loop: false,
    });

    // Create gain node for volume and envelope control
    const gainNode = new Tone.Gain(0); // Start at 0 for fade-in

    // Connect: player -> gain -> output bridge -> destination
    // We use a native GainNode bridge to avoid Tone.js Destination issues
    // when using an external AudioContext. The bridge routes through the
    // native AudioContext.destination instead of Tone.js's internal Destination.
    player.connect(gainNode);
    // Connect Tone.js gain to our native bridge node
    // gainNode.connect() can accept a native AudioNode
    gainNode.connect(this._getOutputNode());

    // Calculate timing
    const now = Tone.now();
    const startTime = when !== undefined ? when : now;

    // Calculate actual duration
    // Use processedBuffer duration (may differ from original if PSOLA applied time stretch)
    const bufferDuration = processedBuffer.duration;
    const maxDuration = bufferDuration - startOffset;
    const playDuration = duration !== undefined ? Math.min(duration, maxDuration) : maxDuration;

    if (playDuration <= 0) {
      // Nothing to play
      player.dispose();
      gainNode.dispose();
      throw new Error('Invalid playback duration: startOffset exceeds buffer length');
    }

    // Apply envelope (ADSR or simple fade with equal-power/linear curves)
    if (envelope) {
      // Apply ADSR envelope
      this._applyADSREnvelope(gainNode.gain, {
        startTime,
        duration: playDuration,
        envelope,
        baseGain: gain,
      });
    } else {
      // Apply crossfade using curve-based approach for equal-power or linear
      const safeFadeIn = Math.max(0.005, Math.min(fadeIn, playDuration * 0.4));
      const safeFadeOut = Math.max(0.005, Math.min(fadeOut, playDuration * 0.4));

      // Start at 0
      gainNode.gain.setValueAtTime(0, startTime);

      // Generate and apply fade-in curve
      const fadeInCurve = this._generateCrossfadeCurve(safeFadeIn, true, gain, crossfadeType);
      gainNode.gain.setValueCurveAtTime(fadeInCurve, startTime, safeFadeIn);

      // Hold at full gain until fade-out
      const fadeInEnd = startTime + safeFadeIn;
      const fadeOutStart = startTime + playDuration - safeFadeOut;

      if (fadeOutStart > fadeInEnd + 0.001) {
        gainNode.gain.setValueAtTime(gain, fadeInEnd);
        gainNode.gain.setValueAtTime(gain, fadeOutStart);
      }

      // Generate and apply fade-out curve
      const fadeOutCurve = this._generateCrossfadeCurve(safeFadeOut, false, gain, crossfadeType);
      gainNode.gain.setValueCurveAtTime(fadeOutCurve, fadeOutStart, safeFadeOut);
    }

    // Set up vibrato modulation if specified
    //
    // Vibrato uses a native Web Audio OscillatorNode as the LFO source for
    // sample-accurate waveform generation. Since GrainPlayer.detune is a plain
    // number property (not an AudioParam), we cannot connect the oscillator
    // directly. Instead, the oscillator feeds through a GainNode (for depth
    // control including delayed onset) into an AnalyserNode. A Tone.js
    // Transport-scheduled repeating callback samples the AnalyserNode output
    // and applies the value to player.detune. This is driven by the audio
    // clock rather than requestAnimationFrame, avoiding rAF jitter and
    // background-tab throttling.
    //
    // The update rate is matched to the grain rate (1/grainSize) since that
    // is the effective resolution -- each grain reads player.detune once at
    // creation time.
    let vibratoLFONodes: VibratoLFONodes | undefined;

    if (vibrato) {
      // Calculate vibrato timing
      const vibratoDelay = (vibrato.delay ?? 0) / 1000; // Convert ms to seconds
      const vibratoStartTime = startTime + vibratoDelay;
      const vibratoEndTime = startTime + playDuration;

      // Only apply vibrato if it starts before the note ends
      if (vibratoStartTime < vibratoEndTime) {
        const rawCtx = this._audioContext;

        // 1. Create native OscillatorNode as the LFO source
        const lfoOscillator = rawCtx.createOscillator();
        lfoOscillator.type = 'sine';
        lfoOscillator.frequency.value = vibrato.rate;

        // 2. Create GainNode for depth control (output in cents)
        const depthGain = rawCtx.createGain();
        // Handle vibrato delay: start at 0 depth, ramp to target depth
        if (vibratoDelay > 0) {
          depthGain.gain.setValueAtTime(0, startTime);
          depthGain.gain.setValueAtTime(0, vibratoStartTime);
          depthGain.gain.linearRampToValueAtTime(
            vibrato.depth,
            vibratoStartTime + Math.min(0.05, (vibratoEndTime - vibratoStartTime) * 0.1)
          );
        } else {
          depthGain.gain.setValueAtTime(vibrato.depth, startTime);
        }
        // Ramp down to 0 at note end to avoid abrupt cutoff
        const rampDownStart = Math.max(vibratoStartTime, vibratoEndTime - 0.02);
        if (rampDownStart > vibratoStartTime) {
          depthGain.gain.setValueAtTime(vibrato.depth, rampDownStart);
        }
        depthGain.gain.linearRampToValueAtTime(0, vibratoEndTime);

        // 3. Create AnalyserNode to sample the LFO output value
        //    Using fftSize=32 (minimum) since we only need a single time-domain sample
        const analyser = rawCtx.createAnalyser();
        analyser.fftSize = 32;

        // Connect: oscillator -> depthGain -> analyser
        lfoOscillator.connect(depthGain);
        depthGain.connect(analyser);

        // Start the oscillator aligned with the note
        lfoOscillator.start(startTime);
        lfoOscillator.stop(vibratoEndTime + 0.1);

        // 4. Schedule audio-clock-based updates via Tone.Transport
        //    Update at grain rate since that is the effective resolution
        //    (each grain reads player.detune once at creation)
        const updateInterval = Math.max(grainSize * 0.5, 1 / 120); // At least 2x grain rate, cap at 120Hz
        const baseDetune = effectivePitchShift * 100;
        const sampleBuffer = new Float32Array(analyser.fftSize);

        const transportEventId = Tone.getTransport().scheduleRepeat(
          (time) => {
            // Only update while the note is active
            if (time < vibratoStartTime || time >= vibratoEndTime) {
              // Before vibrato starts, ensure base detune
              if (time < vibratoStartTime) {
                try {
                  player.detune = baseDetune;
                } catch {
                  // Player may have been disposed
                }
              }
              return;
            }
            try {
              if (player.state === 'started') {
                // Sample the LFO value from the AnalyserNode
                analyser.getFloatTimeDomainData(sampleBuffer);
                // Use the first sample as the current LFO value (in cents, pre-scaled by depthGain)
                const lfoValue = sampleBuffer[0];
                player.detune = baseDetune + lfoValue;
              }
            } catch {
              // Player may have been disposed
            }
          },
          updateInterval,
          startTime,
          playDuration
        );

        // Ensure Transport is started for scheduling to work
        if (Tone.getTransport().state !== 'started') {
          Tone.getTransport().start();
        }

        vibratoLFONodes = {
          oscillator: lfoOscillator,
          depthGain,
          analyser,
          transportEventId,
        };
      }
    }

    // Schedule playback
    // GrainPlayer.start(time, offset, duration)
    player.start(startTime, startOffset, playDuration);

    // Create handle for controlling playback
    const handle: PlaybackHandle = {
      stop: () => {
        try {
          player.stop();
          player.dispose();
          gainNode.dispose();
          // Clean up vibrato LFO nodes if present
          if (vibratoLFONodes) {
            try {
              vibratoLFONodes.oscillator.stop();
            } catch {
              // May already be stopped
            }
            vibratoLFONodes.oscillator.disconnect();
            vibratoLFONodes.depthGain.disconnect();
            vibratoLFONodes.analyser.disconnect();
            Tone.getTransport().clear(vibratoLFONodes.transportEventId);
          }
        } catch {
          // Ignore errors if already disposed
        }
        this._activePlayers.delete(handle);
      },
      player,
      gainNode,
      vibratoLFO: vibratoLFONodes,
    };

    this._activePlayers.add(handle);

    // Schedule cleanup when playback ends
    const cleanupTime = (startTime + playDuration + 0.1 - now) * 1000;
    if (cleanupTime > 0) {
      setTimeout(() => {
        if (this._activePlayers.has(handle)) {
          handle.stop();
        }
      }, cleanupTime);
    }

    return handle;
  }

  /**
   * Stop all active pitch-shifted playbacks.
   */
  stopAll(): void {
    for (const handle of this._activePlayers) {
      handle.stop();
    }
    this._activePlayers.clear();
  }

  /**
   * Check if there are any active playbacks.
   */
  get isPlaying(): boolean {
    return this._activePlayers.size > 0;
  }

  /**
   * Get the number of active playbacks.
   */
  get activeCount(): number {
    return this._activePlayers.size;
  }

  /**
   * Dispose of the shifter and clean up resources.
   */
  dispose(): void {
    this.stopAll();
    // Disconnect and clean up the output bridge
    if (this._outputBridge) {
      try {
        this._outputBridge.disconnect();
      } catch {
        // Ignore errors if already disconnected
      }
      this._outputBridge = null;
    }
    // Clean up PSOLA resources
    this.clearPsolaCache();
    this._psolaProcessor = null;
    this._toneContextSynced = false;
  }

  /**
   * Calculate the adaptive grain size for an audio buffer based on detected pitch.
   *
   * Analyzes the audio to detect its fundamental frequency, then calculates
   * an optimal grain size that is approximately 2x the pitch period. This
   * reduces "beating" artifacts that occur when grain boundaries cut through
   * pitch cycles.
   *
   * @param audioBuffer - The audio buffer to analyze
   * @param options - Options for pitch detection and grain sizing
   * @returns Optimal grain size in seconds
   *
   * @example
   * ```typescript
   * const grainSize = shifter.calculateAdaptiveGrainSize(audioBuffer);
   * console.log(`Optimal grain size: ${grainSize * 1000}ms`);
   *
   * // Use with playPitchShifted
   * shifter.playPitchShifted(audioBuffer, {
   *   pitchShift: 5,
   *   grainSize: grainSize,
   * });
   * ```
   */
  calculateAdaptiveGrainSize(
    audioBuffer: AudioBuffer,
    options?: {
      /** Options for pitch detection */
      detection?: PitchDetectionOptions;
      /** Multiplier for pitch period (default: 2.0) */
      periodMultiplier?: number;
      /** Minimum grain size in seconds (default: 0.02 = 20ms) */
      minGrainSize?: number;
      /** Maximum grain size in seconds (default: 0.2 = 200ms) */
      maxGrainSize?: number;
      /** Default grain size if pitch detection fails (default: 0.1 = 100ms) */
      defaultGrainSize?: number;
      /** Use representative pitch from multiple samples (default: false) */
      useRepresentative?: boolean;
    }
  ): number {
    const {
      detection,
      periodMultiplier = 2.0,
      minGrainSize = 0.02,
      maxGrainSize = 0.2,
      defaultGrainSize = 0.1,
      useRepresentative = false,
    } = options ?? {};

    // Detect pitch period
    const pitchPeriod = useRepresentative
      ? detectRepresentativePitch(audioBuffer, { detectionOptions: detection })
      : detectPitchPeriod(audioBuffer, detection);

    // Calculate optimal grain size
    return calculateOptimalGrainSize(pitchPeriod, {
      periodMultiplier,
      minGrainSize,
      maxGrainSize,
      defaultGrainSize,
    });
  }

  /**
   * Set grain size adaptively based on an audio buffer's detected pitch.
   *
   * This is a convenience method that analyzes the audio and returns
   * the optimal grain size. The grain size can then be passed to
   * playPitchShifted() for that buffer.
   *
   * For best results, call this once per unique audio sample and reuse
   * the grain size for all pitch shifts of that sample.
   *
   * @param audioBuffer - The audio buffer to analyze
   * @param options - Options for adaptive sizing
   * @returns Object containing the optimal grain size and detected pitch info
   *
   * @example
   * ```typescript
   * const result = shifter.analyzeForAdaptiveGrainSize(audioBuffer);
   * console.log(`Detected ${result.frequency}Hz, grain size: ${result.grainSize * 1000}ms`);
   *
   * // Use the grain size for playback
   * shifter.playPitchShifted(audioBuffer, {
   *   pitchShift: 7,
   *   grainSize: result.grainSize,
   * });
   * ```
   */
  analyzeForAdaptiveGrainSize(
    audioBuffer: AudioBuffer,
    options?: {
      /** Options for pitch detection */
      detection?: PitchDetectionOptions;
      /** Use representative pitch from multiple samples (default: true for longer audio) */
      useRepresentative?: boolean;
    }
  ): {
    /** Optimal grain size in seconds */
    grainSize: number;
    /** Detected pitch period in seconds (0 if not detected) */
    pitchPeriod: number;
    /** Detected frequency in Hz (0 if not detected) */
    frequency: number;
    /** Whether a valid pitch was detected */
    detected: boolean;
  } {
    const {
      detection,
      useRepresentative = audioBuffer.duration > 0.3,
    } = options ?? {};

    // Detect pitch
    const pitchPeriod = useRepresentative
      ? detectRepresentativePitch(audioBuffer, { detectionOptions: detection })
      : detectPitchPeriod(audioBuffer, detection);

    const detected = pitchPeriod > 0;
    const frequency = detected ? 1 / pitchPeriod : 0;

    // Calculate grain size
    const grainSize = calculateOptimalGrainSize(pitchPeriod);

    return {
      grainSize,
      pitchPeriod,
      frequency,
      detected,
    };
  }
}

/**
 * Create a singleton instance for convenience.
 *
 * For most use cases, a single GranularPitchShifter instance is sufficient
 * since it can handle multiple concurrent playbacks.
 */
let _defaultShifter: GranularPitchShifter | null = null;

/**
 * Get or create a default GranularPitchShifter instance.
 *
 * @param audioContext - The AudioContext to use (required on first call)
 */
export function getGranularPitchShifter(audioContext?: AudioContext): GranularPitchShifter {
  if (!_defaultShifter && audioContext) {
    _defaultShifter = new GranularPitchShifter(audioContext);
  }
  if (!_defaultShifter) {
    throw new Error('GranularPitchShifter not initialized. Provide an AudioContext.');
  }
  return _defaultShifter;
}
