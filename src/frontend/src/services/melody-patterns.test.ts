import { describe, it, expect } from 'vitest';
import { MELODY_PATTERNS, getMelodyPattern } from './melody-patterns.js';
import type { MelodyPattern } from './melody-patterns.js';

// ── MELODY_PATTERNS array ───────────────────────────────────────────────────

describe('MELODY_PATTERNS', () => {
  it('contains at least one pattern', () => {
    expect(MELODY_PATTERNS.length).toBeGreaterThan(0);
  });

  it('has unique IDs for all patterns', () => {
    const ids = MELODY_PATTERNS.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('all patterns have required fields', () => {
    for (const pattern of MELODY_PATTERNS) {
      expect(pattern.id).toBeTruthy();
      expect(pattern.name).toBeTruthy();
      expect(pattern.description).toBeTruthy();
      expect(pattern.notes.length).toBeGreaterThan(0);
    }
  });

  it('all notes have non-negative startTime', () => {
    for (const pattern of MELODY_PATTERNS) {
      for (const note of pattern.notes) {
        expect(note.startTime).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('all notes have positive duration', () => {
    for (const pattern of MELODY_PATTERNS) {
      for (const note of pattern.notes) {
        expect(note.duration).toBeGreaterThan(0);
      }
    }
  });

  it('notes within each pattern are in chronological order', () => {
    for (const pattern of MELODY_PATTERNS) {
      for (let i = 1; i < pattern.notes.length; i++) {
        expect(pattern.notes[i].startTime).toBeGreaterThanOrEqual(
          pattern.notes[i - 1].startTime
        );
      }
    }
  });

  it('notes within each pattern do not overlap', () => {
    for (const pattern of MELODY_PATTERNS) {
      for (let i = 1; i < pattern.notes.length; i++) {
        const prevEnd = pattern.notes[i - 1].startTime + pattern.notes[i - 1].duration;
        expect(pattern.notes[i].startTime).toBeGreaterThanOrEqual(prevEnd - 1e-9);
      }
    }
  });
});

// ── Known patterns ──────────────────────────────────────────────────────────

describe('scale pattern', () => {
  let scale: MelodyPattern | undefined;

  it('exists', () => {
    scale = MELODY_PATTERNS.find((p) => p.id === 'scale');
    expect(scale).toBeDefined();
  });

  it('has 15 notes (up and down the major scale)', () => {
    scale = MELODY_PATTERNS.find((p) => p.id === 'scale');
    expect(scale!.notes).toHaveLength(15);
  });

  it('starts and ends on pitch 0 (tonic)', () => {
    scale = MELODY_PATTERNS.find((p) => p.id === 'scale');
    expect(scale!.notes[0].pitch).toBe(0);
    expect(scale!.notes[scale!.notes.length - 1].pitch).toBe(0);
  });

  it('reaches pitch 12 (octave) at the top', () => {
    scale = MELODY_PATTERNS.find((p) => p.id === 'scale');
    const maxPitch = Math.max(...scale!.notes.map((n) => n.pitch));
    expect(maxPitch).toBe(12);
  });
});

describe('sustained pattern', () => {
  it('has exactly one note', () => {
    const sustained = MELODY_PATTERNS.find((p) => p.id === 'sustained');
    expect(sustained).toBeDefined();
    expect(sustained!.notes).toHaveLength(1);
  });

  it('has a long duration (>= 2 seconds)', () => {
    const sustained = MELODY_PATTERNS.find((p) => p.id === 'sustained');
    expect(sustained!.notes[0].duration).toBeGreaterThanOrEqual(2);
  });
});

describe('octave pattern', () => {
  it('contains an octave jump (+12 semitones)', () => {
    const octave = MELODY_PATTERNS.find((p) => p.id === 'octave');
    expect(octave).toBeDefined();
    const pitches = octave!.notes.map((n) => n.pitch);
    expect(pitches).toContain(0);
    expect(pitches).toContain(12);
  });
});

describe('cv-test pattern', () => {
  it('exists and has notes at the same pitch', () => {
    const cvTest = MELODY_PATTERNS.find((p) => p.id === 'cv-test');
    expect(cvTest).toBeDefined();
    const uniquePitches = new Set(cvTest!.notes.map((n) => n.pitch));
    expect(uniquePitches.size).toBe(1);
  });

  it('has varied durations (both short and long notes)', () => {
    const cvTest = MELODY_PATTERNS.find((p) => p.id === 'cv-test');
    const durations = cvTest!.notes.map((n) => n.duration);
    const minDuration = Math.min(...durations);
    const maxDuration = Math.max(...durations);
    expect(maxDuration).toBeGreaterThan(minDuration * 2);
  });
});

// ── getMelodyPattern ────────────────────────────────────────────────────────

describe('getMelodyPattern', () => {
  it('returns the correct pattern for a valid ID', () => {
    const pattern = getMelodyPattern('scale');
    expect(pattern).toBeDefined();
    expect(pattern!.id).toBe('scale');
    expect(pattern!.name).toBe('Diatonic Scale');
  });

  it('returns undefined for an unknown ID', () => {
    expect(getMelodyPattern('nonexistent')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(getMelodyPattern('')).toBeUndefined();
  });

  it('finds all known pattern IDs', () => {
    const knownIds = ['scale', 'cv-test', 'sustained', 'octave'];
    for (const id of knownIds) {
      expect(getMelodyPattern(id)).toBeDefined();
    }
  });
});
