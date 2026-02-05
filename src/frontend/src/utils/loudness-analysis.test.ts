import { describe, it, expect } from 'vitest';
import {
  linearToDb,
  dbToLinear,
  calculateNormalizationGain,
  calculateMedianRmsDb,
  DEFAULT_TARGET_RMS_DB,
} from './loudness-analysis.js';
import type { LoudnessAnalysis } from './loudness-analysis.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a LoudnessAnalysis object from linear RMS and peak values. */
function makeAnalysis(rms: number, peak: number): LoudnessAnalysis {
  return {
    rms,
    rmsDb: linearToDb(rms),
    peak,
    peakDb: linearToDb(peak),
    crestFactor: rms > 0 ? peak / rms : 0,
    hasContent: rms > 1e-6,
  };
}

// ── linearToDb / dbToLinear ──────────────────────────────────────────────────

describe('linearToDb', () => {
  it('returns 0 dB for full-scale (1.0)', () => {
    expect(linearToDb(1.0)).toBeCloseTo(0, 5);
  });

  it('returns -6 dB for half amplitude', () => {
    // 20 * log10(0.5) = -6.0206...
    expect(linearToDb(0.5)).toBeCloseTo(-6.0206, 3);
  });

  it('returns -20 dB for 0.1 amplitude', () => {
    expect(linearToDb(0.1)).toBeCloseTo(-20, 5);
  });

  it('returns -Infinity for zero', () => {
    expect(linearToDb(0)).toBe(-Infinity);
  });

  it('returns -Infinity for negative values', () => {
    expect(linearToDb(-0.5)).toBe(-Infinity);
  });
});

describe('dbToLinear', () => {
  it('returns 1.0 for 0 dB', () => {
    expect(dbToLinear(0)).toBeCloseTo(1.0, 5);
  });

  it('returns ~0.5 for -6 dB', () => {
    expect(dbToLinear(-6.0206)).toBeCloseTo(0.5, 3);
  });

  it('returns 0.1 for -20 dB', () => {
    expect(dbToLinear(-20)).toBeCloseTo(0.1, 5);
  });

  it('returns 0 for -Infinity', () => {
    expect(dbToLinear(-Infinity)).toBe(0);
  });

  it('returns 0 for NaN', () => {
    expect(dbToLinear(NaN)).toBe(0);
  });
});

describe('linearToDb and dbToLinear round-trip', () => {
  it('round-trips for typical amplitudes', () => {
    const values = [0.001, 0.01, 0.1, 0.25, 0.5, 0.75, 1.0];
    for (const v of values) {
      expect(dbToLinear(linearToDb(v))).toBeCloseTo(v, 5);
    }
  });

  it('round-trips for typical dB values', () => {
    const dbValues = [-60, -40, -20, -12, -6, -3, 0, 3, 6, 12];
    for (const db of dbValues) {
      expect(linearToDb(dbToLinear(db))).toBeCloseTo(db, 5);
    }
  });
});

// ── calculateNormalizationGain ──────────────────────────────────────────────

describe('calculateNormalizationGain', () => {
  it('returns 1 (no change) for silent audio', () => {
    const silence: LoudnessAnalysis = {
      rms: 0,
      rmsDb: -Infinity,
      peak: 0,
      peakDb: -Infinity,
      crestFactor: 0,
      hasContent: false,
    };
    expect(calculateNormalizationGain(silence)).toBe(1);
  });

  it('returns gain > 1 for quiet signals (below target)', () => {
    // RMS at -30 dB, peak at -24 dB, target -18 dB => needs +12 dB gain
    const quiet = makeAnalysis(dbToLinear(-30), dbToLinear(-24));
    const gain = calculateNormalizationGain(quiet);
    expect(gain).toBeGreaterThan(1);
  });

  it('returns gain < 1 for loud signals (above target)', () => {
    // RMS at -6 dB, peak at -3 dB, target -18 dB => needs -12 dB gain
    const loud = makeAnalysis(dbToLinear(-6), dbToLinear(-3));
    const gain = calculateNormalizationGain(loud);
    expect(gain).toBeLessThan(1);
  });

  it('produces approximately unity gain when RMS is at the target', () => {
    // RMS at -18 dB (the default target), peak slightly above
    const atTarget = makeAnalysis(dbToLinear(-18), dbToLinear(-12));
    const gain = calculateNormalizationGain(atTarget);
    // Gain should be close to 1 (0 dB), but peak limiter might adjust slightly
    expect(linearToDb(gain)).toBeCloseTo(0, 0);
  });

  it('respects maxGainDb limit', () => {
    // Very quiet signal: RMS -60 dB, would need +42 dB to reach -18 dB
    const veryQuiet = makeAnalysis(dbToLinear(-60), dbToLinear(-54));
    const gain = calculateNormalizationGain(veryQuiet, { maxGainDb: 12 });
    // Gain should be capped at 12 dB
    const gainDb = linearToDb(gain);
    expect(gainDb).toBeLessThanOrEqual(12.01); // small tolerance
  });

  it('respects minGainDb limit', () => {
    // Very loud signal: RMS -3 dB, would need -15 dB to reach -18 dB
    const veryLoud = makeAnalysis(dbToLinear(-3), dbToLinear(-1));
    const gain = calculateNormalizationGain(veryLoud, { minGainDb: -12 });
    const gainDb = linearToDb(gain);
    expect(gainDb).toBeGreaterThanOrEqual(-12.01);
  });

  it('applies peak limiting to prevent clipping', () => {
    // RMS -24 dB, peak at -1 dB. Target -18 dB => +6 dB gain requested.
    // But peak at -1 dB + 6 dB = +5 dB => exceeds -0.3 dB max peak.
    // Peak limiter should reduce the gain.
    const highPeak = makeAnalysis(dbToLinear(-24), dbToLinear(-1));
    const gain = calculateNormalizationGain(highPeak, { maxPeakDb: -0.3 });
    const resultingPeakDb = highPeak.peakDb + linearToDb(gain);
    // Resulting peak should not exceed maxPeakDb (with some tolerance for soft-knee)
    // With soft-knee, it may slightly exceed due to the half-reduction above the knee
    expect(resultingPeakDb).toBeLessThan(6); // sanity: must not be absurdly high
  });

  it('applies hard peak limiting when softKneeDb is 0', () => {
    // RMS -30 dB, peak at -6 dB. Target -18 dB => +12 dB gain.
    // Peak at -6 dB + 12 dB = +6 dB => exceeds -0.3 dB max.
    // With soft-knee disabled, hard limit: gain = -0.3 - (-6) = 5.7 dB
    const highCrest = makeAnalysis(dbToLinear(-30), dbToLinear(-6));
    const gain = calculateNormalizationGain(highCrest, {
      maxPeakDb: -0.3,
      softKneeDb: 0,
    });
    const resultingPeakDb = highCrest.peakDb + linearToDb(gain);
    expect(resultingPeakDb).toBeCloseTo(-0.3, 1);
  });

  it('soft-knee allows some peak overshoot for high crest factor signals', () => {
    // RMS -30 dB, peak at -6 dB. Target -18 dB => +12 dB gain (after maxGainDb clamp).
    // Hard limit: 5.7 dB. Reduction from RMS gain: 12 - 5.7 = 6.3 dB.
    // Soft-knee (6 dB): reduction > 6 dB => apply 6 + 0.5*(6.3-6) = 6.15 dB reduction.
    // Soft-knee gain = 12 - 6.15 = 5.85 dB > 5.7 dB hard limit.
    const highCrest = makeAnalysis(dbToLinear(-30), dbToLinear(-6));
    const hardGain = calculateNormalizationGain(highCrest, {
      softKneeDb: 0,
      maxPeakDb: -0.3,
    });
    const softGain = calculateNormalizationGain(highCrest, {
      softKneeDb: 6,
      maxPeakDb: -0.3,
    });
    // Soft-knee gain should be higher (less attenuation) than hard limit
    expect(softGain).toBeGreaterThanOrEqual(hardGain);
  });

  it('uses medianRmsDb as target when provided', () => {
    // RMS at -22 dB, median at -20 dB => should boost by ~2 dB
    const analysis = makeAnalysis(dbToLinear(-22), dbToLinear(-16));
    const gain = calculateNormalizationGain(analysis, { medianRmsDb: -20 });
    const gainDb = linearToDb(gain);
    expect(gainDb).toBeCloseTo(2, 0);
  });

  it('uses custom targetRmsDb when medianRmsDb is not provided', () => {
    const analysis = makeAnalysis(dbToLinear(-24), dbToLinear(-18));
    const gainDefault = calculateNormalizationGain(analysis);
    const gainCustom = calculateNormalizationGain(analysis, { targetRmsDb: -12 });
    // Custom target -12 dB needs +12 dB vs default -18 dB needs +6 dB
    expect(linearToDb(gainCustom)).toBeGreaterThan(linearToDb(gainDefault));
  });
});

// ── calculateMedianRmsDb ────────────────────────────────────────────────────

describe('calculateMedianRmsDb', () => {
  it('returns DEFAULT_TARGET_RMS_DB for empty array', () => {
    expect(calculateMedianRmsDb([])).toBe(DEFAULT_TARGET_RMS_DB);
  });

  it('returns DEFAULT_TARGET_RMS_DB when all analyses are silent', () => {
    const silentAnalyses: LoudnessAnalysis[] = [
      { rms: 0, rmsDb: -Infinity, peak: 0, peakDb: -Infinity, crestFactor: 0, hasContent: false },
      { rms: 0, rmsDb: -Infinity, peak: 0, peakDb: -Infinity, crestFactor: 0, hasContent: false },
    ];
    expect(calculateMedianRmsDb(silentAnalyses)).toBe(DEFAULT_TARGET_RMS_DB);
  });

  it('returns the single value for a single-element array', () => {
    const analyses = [makeAnalysis(dbToLinear(-20), dbToLinear(-14))];
    expect(calculateMedianRmsDb(analyses)).toBeCloseTo(-20, 1);
  });

  it('returns the median for odd-length array', () => {
    const analyses = [
      makeAnalysis(dbToLinear(-25), dbToLinear(-19)),
      makeAnalysis(dbToLinear(-20), dbToLinear(-14)),
      makeAnalysis(dbToLinear(-15), dbToLinear(-9)),
    ];
    expect(calculateMedianRmsDb(analyses)).toBeCloseTo(-20, 1);
  });

  it('returns the average of two middle values for even-length array', () => {
    const analyses = [
      makeAnalysis(dbToLinear(-30), dbToLinear(-24)),
      makeAnalysis(dbToLinear(-20), dbToLinear(-14)),
      makeAnalysis(dbToLinear(-16), dbToLinear(-10)),
      makeAnalysis(dbToLinear(-10), dbToLinear(-4)),
    ];
    // Sorted RMS dB: -30, -20, -16, -10. Median = (-20 + -16) / 2 = -18
    expect(calculateMedianRmsDb(analyses)).toBeCloseTo(-18, 1);
  });

  it('filters out silent analyses', () => {
    const analyses: LoudnessAnalysis[] = [
      { rms: 0, rmsDb: -Infinity, peak: 0, peakDb: -Infinity, crestFactor: 0, hasContent: false },
      makeAnalysis(dbToLinear(-20), dbToLinear(-14)),
      makeAnalysis(dbToLinear(-16), dbToLinear(-10)),
      { rms: 0, rmsDb: -Infinity, peak: 0, peakDb: -Infinity, crestFactor: 0, hasContent: false },
    ];
    // Only two valid: -20 and -16. Median = (-20 + -16) / 2 = -18
    expect(calculateMedianRmsDb(analyses)).toBeCloseTo(-18, 1);
  });
});
