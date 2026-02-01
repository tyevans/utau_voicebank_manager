/**
 * MelodyPlayer - Web Audio synthesis engine for UTAU voicebank playback.
 *
 * Takes audio samples with oto.ini parameters and schedules pitch-shifted
 * note sequences using the Web Audio API. Designed for future DAW extensibility.
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
}

/**
 * Options for synthesizing a note sequence.
 */
export interface SynthesisOptions {
  /** Oto.ini entry defining sample boundaries and timing */
  otoEntry: OtoEntry;
  /** The decoded audio buffer for the sample */
  audioBuffer: AudioBuffer;
}

/**
 * Internal representation of an active audio node for cleanup tracking.
 */
interface ActiveNode {
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  startTime: number;
  endTime: number;
}

/**
 * MelodyPlayer synthesizes note sequences using UTAU samples.
 *
 * Features:
 * - Pitch shifting via playback rate adjustment
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
  private _activeNodes: ActiveNode[] = [];
  private _isPlaying = false;
  private _sequenceStartTime = 0;

  /**
   * Create a new MelodyPlayer.
   *
   * @param audioContext - The Web Audio AudioContext to use for playback
   */
  constructor(audioContext: AudioContext) {
    this._audioContext = audioContext;
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
   * Play a sequence of notes using a single sample.
   *
   * Each note is pitch-shifted and scheduled according to its timing.
   * Consecutive notes are crossfaded using the oto overlap parameter.
   *
   * @param notes - Array of note events to play
   * @param options - Synthesis options including oto entry and audio buffer
   */
  playSequence(notes: NoteEvent[], options: SynthesisOptions): void {
    if (notes.length === 0) {
      return;
    }

    // Stop any existing playback
    this.stop();

    const { otoEntry, audioBuffer } = options;

    // Resume context if suspended (browser autoplay policy)
    if (this._audioContext.state === 'suspended') {
      this._audioContext.resume();
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
        node.source.stop();
      } catch {
        // Ignore errors if already stopped
      }
      node.source.disconnect();
      node.gainNode.disconnect();
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

    // Calculate playback rate for pitch shifting
    // Formula: rate = 2^(semitones/12)
    const playbackRate = Math.pow(2, note.pitch / 12);

    // Adjust timing: the note's "attack point" should align with startTime,
    // but the sample actually starts preutterance before that
    const effectiveStartTime = this._sequenceStartTime + note.startTime - preutterance;

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

    // Apply velocity (prepared for future dynamics support)
    const velocity = note.velocity ?? 1;
    const baseGain = velocity;

    // Set up crossfade envelope
    this._applyCrossfadeEnvelope(gainNode, {
      startTime: effectiveStartTime,
      duration: noteDuration,
      overlap,
      prevNote,
      baseGain,
      sequenceStartTime: this._sequenceStartTime,
    });

    // Schedule the source node
    // start(when, offset, duration) - offset and duration are in source time (before rate adjustment)
    const whenToStart = Math.max(effectiveStartTime, this._audioContext.currentTime);
    source.start(whenToStart, sampleStart, sampleDuration);

    // Track active node for cleanup
    const activeNode: ActiveNode = {
      source,
      gainNode,
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
   * Apply crossfade envelope to a gain node.
   *
   * Implements smooth transitions between consecutive notes using the
   * oto overlap parameter for crossfade duration.
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
    }
  ): void {
    const { startTime, duration, overlap, prevNote, baseGain, sequenceStartTime } = params;

    // Clamp overlap to reasonable bounds
    const fadeTime = Math.min(overlap, duration * 0.5, 0.1); // Max 100ms or half duration

    // Start with fade-in from 0
    gainNode.gain.setValueAtTime(0, startTime);

    // Determine fade-in time based on overlap with previous note
    let fadeInTime = fadeTime;
    if (prevNote) {
      // If there's a previous note, use overlap for crossfade
      const prevEndTime = sequenceStartTime + prevNote.startTime + prevNote.duration;
      const overlapDuration = Math.max(0, prevEndTime - startTime);
      fadeInTime = Math.min(fadeTime, overlapDuration + 0.02);
    }

    // Fade in
    gainNode.gain.linearRampToValueAtTime(baseGain, startTime + fadeInTime);

    // Hold at full gain until fade-out
    const fadeOutStart = startTime + duration - fadeTime;
    gainNode.gain.setValueAtTime(baseGain, Math.max(fadeOutStart, startTime + fadeInTime));

    // Fade out
    gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
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
      node.source.disconnect();
      node.gainNode.disconnect();
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
        node.source.disconnect();
        node.gainNode.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
    this._activeNodes = [];
    this._isPlaying = false;
  }
}
