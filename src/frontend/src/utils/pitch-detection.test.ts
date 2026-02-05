import { describe, it, expect } from 'vitest';
import {
  calculatePitchCorrection,
  calculateOptimalGrainSize,
  C4_FREQUENCY,
} from './pitch-detection.js';

// ── calculatePitchCorrection ────────────────────────────────────────────────

describe('calculatePitchCorrection', () => {
  it('returns 0 when detected frequency equals reference', () => {
    expect(calculatePitchCorrection(C4_FREQUENCY, C4_FREQUENCY)).toBeCloseTo(0, 5);
  });

  it('returns -12 semitones when detected is one octave above reference', () => {
    // Detected at C5 (523.25), reference C4 (261.63) => pitch down 12 semitones
    expect(calculatePitchCorrection(C4_FREQUENCY * 2, C4_FREQUENCY)).toBeCloseTo(-12, 3);
  });

  it('returns +12 semitones when detected is one octave below reference', () => {
    // Detected at C3 (130.81), reference C4 (261.63) => pitch up 12 semitones
    expect(calculatePitchCorrection(C4_FREQUENCY / 2, C4_FREQUENCY)).toBeCloseTo(12, 3);
  });

  it('returns ~-9 semitones for A4 (440Hz) to C4 (261.63Hz)', () => {
    // A4 is 9 semitones above C4
    const correction = calculatePitchCorrection(440, C4_FREQUENCY);
    expect(correction).toBeCloseTo(-9, 0);
  });

  it('returns 0 for zero detected frequency', () => {
    expect(calculatePitchCorrection(0, C4_FREQUENCY)).toBe(0);
  });

  it('returns 0 for negative detected frequency', () => {
    expect(calculatePitchCorrection(-100, C4_FREQUENCY)).toBe(0);
  });

  it('returns 0 for zero reference frequency', () => {
    expect(calculatePitchCorrection(440, 0)).toBe(0);
  });

  it('uses C4 as default reference', () => {
    const withDefault = calculatePitchCorrection(440);
    const withExplicit = calculatePitchCorrection(440, C4_FREQUENCY);
    expect(withDefault).toBeCloseTo(withExplicit, 5);
  });

  it('handles perfect fifth interval (frequency ratio 3:2)', () => {
    // A perfect fifth is 7 semitones. Ratio is 2^(7/12) ~ 1.4983
    const detectedFreq = C4_FREQUENCY * Math.pow(2, 7 / 12);
    const correction = calculatePitchCorrection(detectedFreq, C4_FREQUENCY);
    expect(correction).toBeCloseTo(-7, 3);
  });
});

// ── C4_FREQUENCY constant ───────────────────────────────────────────────────

describe('C4_FREQUENCY', () => {
  it('is 261.63 Hz', () => {
    expect(C4_FREQUENCY).toBeCloseTo(261.63, 2);
  });
});

// ── calculateOptimalGrainSize ───────────────────────────────────────────────

describe('calculateOptimalGrainSize', () => {
  it('returns default grain size for zero pitch period', () => {
    expect(calculateOptimalGrainSize(0)).toBe(0.1);
  });

  it('returns default grain size for negative pitch period', () => {
    expect(calculateOptimalGrainSize(-0.005)).toBe(0.1);
  });

  it('returns 2x pitch period by default', () => {
    // 50 Hz pitch => 20ms period => 40ms grain (within 20-200ms range)
    const period = 1 / 50;
    const grainSize = calculateOptimalGrainSize(period);
    expect(grainSize).toBeCloseTo(period * 2, 5);
  });

  it('respects custom periodMultiplier', () => {
    const period = 1 / 50; // 20ms
    const grainSize = calculateOptimalGrainSize(period, { periodMultiplier: 3.0 });
    expect(grainSize).toBeCloseTo(period * 3, 5);
  });

  it('clamps to minimum grain size', () => {
    // Very high frequency: 2000Hz => 0.5ms period => 1ms grain (below 20ms min)
    const period = 1 / 2000;
    const grainSize = calculateOptimalGrainSize(period);
    expect(grainSize).toBe(0.02); // default min
  });

  it('clamps to maximum grain size', () => {
    // Very low frequency: 10Hz => 100ms period => 200ms grain (at 200ms max)
    const period = 1 / 10;
    const grainSize = calculateOptimalGrainSize(period);
    expect(grainSize).toBe(0.2); // default max
  });

  it('respects custom min and max grain sizes', () => {
    const period = 1 / 2000; // very short
    const grainSize = calculateOptimalGrainSize(period, {
      minGrainSize: 0.005,
      maxGrainSize: 0.5,
    });
    expect(grainSize).toBe(0.005);
  });

  it('returns custom default for invalid pitch', () => {
    const grainSize = calculateOptimalGrainSize(0, { defaultGrainSize: 0.05 });
    expect(grainSize).toBe(0.05);
  });

  it('produces reasonable values for typical vocal range', () => {
    // Female vocal: ~250Hz => 4ms period => 8ms grain (clamped to 20ms min)
    const femalePeriod = 1 / 250;
    expect(calculateOptimalGrainSize(femalePeriod)).toBe(0.02);

    // Male vocal: ~120Hz => 8.3ms period => 16.7ms grain (clamped to 20ms min)
    const malePeriod = 1 / 120;
    expect(calculateOptimalGrainSize(malePeriod)).toBeCloseTo(0.02, 3);

    // Low bass: ~80Hz => 12.5ms period => 25ms grain
    const bassPeriod = 1 / 80;
    const bassGrain = calculateOptimalGrainSize(bassPeriod);
    expect(bassGrain).toBeCloseTo(0.025, 3);
    expect(bassGrain).toBeGreaterThanOrEqual(0.02);
    expect(bassGrain).toBeLessThanOrEqual(0.2);
  });
});
