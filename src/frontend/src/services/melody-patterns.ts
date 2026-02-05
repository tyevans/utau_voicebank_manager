/**
 * Predefined melody patterns for voicebank sample preview.
 *
 * These patterns are designed to test different aspects of sample quality:
 * - Pitch accuracy and range
 * - Consonant-vowel transitions
 * - Sustained note quality and loop points
 * - Extreme pitch shifts
 */

import type { NoteEvent } from './melody-player.js';

/**
 * A predefined melody pattern for sample preview.
 */
export interface MelodyPattern {
  /** Unique identifier for the pattern */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Description of what this pattern tests */
  description: string;
  /** The note sequence to play */
  notes: NoteEvent[];
}

/**
 * Helper function to create sequential notes from durations.
 * Calculates startTime as cumulative sum of previous durations.
 */
function createSequentialNotes(
  pitchDurations: Array<{ pitch: number; duration: number }>
): NoteEvent[] {
  const notes: NoteEvent[] = [];
  let startTime = 0;

  for (const { pitch, duration } of pitchDurations) {
    notes.push({ pitch, startTime, duration });
    startTime += duration;
  }

  return notes;
}

/**
 * Diatonic scale pattern - ascending then descending.
 *
 * Full major scale up and down: do-re-mi-fa-sol-la-ti-do-ti-la-sol-fa-mi-re-do
 * Tests pitch range, accuracy, and smooth transitions across the full octave.
 */
const scalePattern: MelodyPattern = {
  id: 'scale',
  name: 'Diatonic Scale',
  description: 'Full major scale up then down across one octave',
  notes: createSequentialNotes([
    { pitch: 0, duration: 0.3 },   // do
    { pitch: 2, duration: 0.3 },   // re
    { pitch: 4, duration: 0.3 },   // mi
    { pitch: 5, duration: 0.3 },   // fa
    { pitch: 7, duration: 0.3 },   // sol
    { pitch: 9, duration: 0.3 },   // la
    { pitch: 11, duration: 0.3 },  // ti
    { pitch: 12, duration: 0.4 },  // do (top, slightly longer)
    { pitch: 11, duration: 0.3 },  // ti
    { pitch: 9, duration: 0.3 },   // la
    { pitch: 7, duration: 0.3 },   // sol
    { pitch: 5, duration: 0.3 },   // fa
    { pitch: 4, duration: 0.3 },   // mi
    { pitch: 2, duration: 0.3 },   // re
    { pitch: 0, duration: 0.4 },   // do (bottom, slightly longer)
  ]),
};

/**
 * CV (consonant-vowel) transition test pattern.
 *
 * Varied rhythms with short-short-long pattern at same pitch.
 * Tests consonant attack consistency and timing precision.
 */
const cvTestPattern: MelodyPattern = {
  id: 'cv-test',
  name: 'CV Transitions',
  description: 'Tests consonant-vowel attack consistency with varied rhythms',
  notes: createSequentialNotes([
    { pitch: 0, duration: 0.15 },  // short
    { pitch: 0, duration: 0.15 },  // short
    { pitch: 0, duration: 0.5 },   // long
    { pitch: 0, duration: 0.15 },  // short
    { pitch: 0, duration: 0.15 },  // short
    { pitch: 0, duration: 0.5 },   // long
  ]),
};

/**
 * Sustained note pattern.
 *
 * Single long note to test steady-state quality and loop points.
 */
const sustainedPattern: MelodyPattern = {
  id: 'sustained',
  name: 'Sustained Note',
  description: 'Tests steady-state quality and loop point smoothness',
  notes: createSequentialNotes([
    { pitch: 0, duration: 2.5 },
  ]),
};

/**
 * Octave jump pattern.
 *
 * Low -> High (+12 semitones) -> Low to test extreme pitch shifting.
 */
const octavePattern: MelodyPattern = {
  id: 'octave',
  name: 'Octave Jump',
  description: 'Tests extreme pitch shift quality with octave transitions',
  notes: createSequentialNotes([
    { pitch: 0, duration: 0.5 },   // low
    { pitch: 12, duration: 0.5 },  // high (octave up)
    { pitch: 0, duration: 0.5 },   // low
  ]),
};

/**
 * All available melody patterns for sample preview.
 */
export const MELODY_PATTERNS: MelodyPattern[] = [
  scalePattern,
  cvTestPattern,
  sustainedPattern,
  octavePattern,
];

/**
 * Get a melody pattern by its ID.
 *
 * @param id - The pattern ID to look up
 * @returns The matching pattern, or undefined if not found
 */
export function getMelodyPattern(id: string): MelodyPattern | undefined {
  return MELODY_PATTERNS.find((pattern) => pattern.id === id);
}
