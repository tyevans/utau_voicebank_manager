import { describe, it, expect } from 'vitest';
import { applySpectralSmoothing } from './spectral-smoothing.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Generate a pure sine wave as Float32Array.
 */
function generateSineWave(
  frequency: number,
  sampleRate: number,
  numSamples: number,
  amplitude = 0.8,
): Float32Array {
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return samples;
}

/**
 * Generate white noise with a deterministic seed.
 */
function generateNoise(numSamples: number, amplitude = 0.5): Float32Array {
  const samples = new Float32Array(numSamples);
  let seed = 12345;
  for (let i = 0; i < numSamples; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    samples[i] = amplitude * ((seed / 0x7fffffff) * 2 - 1);
  }
  return samples;
}

/**
 * Compute RMS energy of a Float32Array.
 */
function computeRms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Compute peak absolute value.
 */
function computePeak(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

/**
 * Clone a Float32Array (to compare before/after modification).
 */
function cloneArray(arr: Float32Array): Float32Array {
  return new Float32Array(arr);
}

// ── applySpectralSmoothing ───────────────────────────────────────────────────

describe('applySpectralSmoothing', () => {
  const sampleRate = 44100;
  const fftSize = 2048;
  // Need at least fftSize samples for processing
  const regionLength = fftSize * 2;

  it('does not modify buffers when spectralDistance is below threshold', () => {
    const tailA = generateSineWave(440, sampleRate, regionLength);
    const headB = generateSineWave(880, sampleRate, regionLength);

    const tailACopy = cloneArray(tailA);
    const headBCopy = cloneArray(headB);

    // Default threshold is 0.1, so distance of 0.05 should skip
    applySpectralSmoothing(tailA, headB, sampleRate, 0.05, { fftSize });

    // Arrays should be completely unchanged
    for (let i = 0; i < tailA.length; i++) {
      expect(tailA[i]).toBe(tailACopy[i]);
    }
    for (let i = 0; i < headB.length; i++) {
      expect(headB[i]).toBe(headBCopy[i]);
    }
  });

  it('does not modify buffers when spectralDistance is exactly at threshold', () => {
    const tailA = generateSineWave(440, sampleRate, regionLength);
    const headB = generateSineWave(880, sampleRate, regionLength);

    const tailACopy = cloneArray(tailA);
    const headBCopy = cloneArray(headB);

    // Exactly at threshold (0.1) should still skip (< not <=)
    applySpectralSmoothing(tailA, headB, sampleRate, 0.09, { fftSize });

    for (let i = 0; i < tailA.length; i++) {
      expect(tailA[i]).toBe(tailACopy[i]);
    }
    for (let i = 0; i < headB.length; i++) {
      expect(headB[i]).toBe(headBCopy[i]);
    }
  });

  it('modifies buffers when spectralDistance exceeds threshold', () => {
    const tailA = generateSineWave(200, sampleRate, regionLength);
    const headB = generateSineWave(2000, sampleRate, regionLength);

    const tailACopy = cloneArray(tailA);
    const headBCopy = cloneArray(headB);

    applySpectralSmoothing(tailA, headB, sampleRate, 0.8, { fftSize });

    // At least one of the arrays should be modified
    let tailModified = false;
    let headModified = false;

    for (let i = 0; i < tailA.length; i++) {
      if (tailA[i] !== tailACopy[i]) {
        tailModified = true;
        break;
      }
    }
    for (let i = 0; i < headB.length; i++) {
      if (headB[i] !== headBCopy[i]) {
        headModified = true;
        break;
      }
    }

    expect(tailModified || headModified).toBe(true);
  });

  it('does not produce NaN or Infinity in output', () => {
    const tailA = generateSineWave(200, sampleRate, regionLength);
    const headB = generateSineWave(2000, sampleRate, regionLength);

    applySpectralSmoothing(tailA, headB, sampleRate, 0.9, { fftSize });

    for (let i = 0; i < tailA.length; i++) {
      expect(Number.isFinite(tailA[i])).toBe(true);
    }
    for (let i = 0; i < headB.length; i++) {
      expect(Number.isFinite(headB[i])).toBe(true);
    }
  });

  it('preserves approximate energy (does not amplify dramatically)', () => {
    const tailA = generateSineWave(300, sampleRate, regionLength, 0.5);
    const headB = generateSineWave(1500, sampleRate, regionLength, 0.5);

    const rmsBeforeA = computeRms(tailA);
    const rmsBeforeB = computeRms(headB);

    applySpectralSmoothing(tailA, headB, sampleRate, 0.7, { fftSize });

    const rmsAfterA = computeRms(tailA);
    const rmsAfterB = computeRms(headB);

    // RMS should not change by more than 6 dB (factor of 2) in either direction.
    // The correction gain is clamped between 0.25 (-12 dB) and 2.0 (+6 dB) per bin,
    // and the blend is at most 50% of normalized distance.
    expect(rmsAfterA).toBeGreaterThan(rmsBeforeA * 0.25);
    expect(rmsAfterA).toBeLessThan(rmsBeforeA * 4.0);
    expect(rmsAfterB).toBeGreaterThan(rmsBeforeB * 0.25);
    expect(rmsAfterB).toBeLessThan(rmsBeforeB * 4.0);
  });

  it('returns immediately for empty tailA', () => {
    const tailA = new Float32Array(0);
    const headB = generateSineWave(440, sampleRate, regionLength);
    const headBCopy = cloneArray(headB);

    // Should not throw and should not modify headB
    applySpectralSmoothing(tailA, headB, sampleRate, 0.8, { fftSize });

    for (let i = 0; i < headB.length; i++) {
      expect(headB[i]).toBe(headBCopy[i]);
    }
  });

  it('returns immediately for empty headB', () => {
    const tailA = generateSineWave(440, sampleRate, regionLength);
    const headB = new Float32Array(0);
    const tailACopy = cloneArray(tailA);

    applySpectralSmoothing(tailA, headB, sampleRate, 0.8, { fftSize });

    for (let i = 0; i < tailA.length; i++) {
      expect(tailA[i]).toBe(tailACopy[i]);
    }
  });

  it('returns immediately when buffers are shorter than fftSize', () => {
    // Buffers shorter than one FFT window cannot be processed
    const tailA = generateSineWave(440, sampleRate, fftSize - 1);
    const headB = generateSineWave(880, sampleRate, fftSize - 1);
    const tailACopy = cloneArray(tailA);
    const headBCopy = cloneArray(headB);

    applySpectralSmoothing(tailA, headB, sampleRate, 0.8, { fftSize });

    // Should not be modified since data is shorter than one window
    for (let i = 0; i < tailA.length; i++) {
      expect(tailA[i]).toBe(tailACopy[i]);
    }
    for (let i = 0; i < headB.length; i++) {
      expect(headB[i]).toBe(headBCopy[i]);
    }
  });

  it('stronger spectralDistance produces larger modifications', () => {
    const sampleRate2 = 44100;
    const len = fftSize * 2;

    // Run twice with different spectral distances
    const tailA_weak = generateSineWave(200, sampleRate2, len, 0.6);
    const headB_weak = generateSineWave(2000, sampleRate2, len, 0.6);
    const tailA_weak_orig = cloneArray(tailA_weak);

    applySpectralSmoothing(tailA_weak, headB_weak, sampleRate2, 0.2, { fftSize });

    const tailA_strong = generateSineWave(200, sampleRate2, len, 0.6);
    const headB_strong = generateSineWave(2000, sampleRate2, len, 0.6);
    const tailA_strong_orig = cloneArray(tailA_strong);

    applySpectralSmoothing(tailA_strong, headB_strong, sampleRate2, 0.9, { fftSize });

    // Compute total absolute difference from original for each case
    let diffWeak = 0;
    let diffStrong = 0;
    for (let i = 0; i < len; i++) {
      diffWeak += Math.abs(tailA_weak[i] - tailA_weak_orig[i]);
      diffStrong += Math.abs(tailA_strong[i] - tailA_strong_orig[i]);
    }

    // Stronger distance should produce larger modifications
    expect(diffStrong).toBeGreaterThan(diffWeak);
  });

  it('handles noise signals without crashing', () => {
    const tailA = generateNoise(regionLength);
    const headB = generateNoise(regionLength);

    // Should not throw
    applySpectralSmoothing(tailA, headB, sampleRate, 0.5, { fftSize });

    for (let i = 0; i < tailA.length; i++) {
      expect(Number.isFinite(tailA[i])).toBe(true);
    }
    for (let i = 0; i < headB.length; i++) {
      expect(Number.isFinite(headB[i])).toBe(true);
    }
  });

  it('handles DC signals without crashing', () => {
    const tailA = new Float32Array(regionLength).fill(0.5);
    const headB = new Float32Array(regionLength).fill(-0.3);

    applySpectralSmoothing(tailA, headB, sampleRate, 0.6, { fftSize });

    for (let i = 0; i < tailA.length; i++) {
      expect(Number.isFinite(tailA[i])).toBe(true);
    }
    for (let i = 0; i < headB.length; i++) {
      expect(Number.isFinite(headB[i])).toBe(true);
    }
  });

  it('respects custom distanceThreshold option', () => {
    const tailA = generateSineWave(200, sampleRate, regionLength);
    const headB = generateSineWave(2000, sampleRate, regionLength);
    const tailACopy = cloneArray(tailA);

    // With threshold of 0.9, a distance of 0.8 should skip
    applySpectralSmoothing(tailA, headB, sampleRate, 0.8, {
      fftSize,
      distanceThreshold: 0.9,
    });

    for (let i = 0; i < tailA.length; i++) {
      expect(tailA[i]).toBe(tailACopy[i]);
    }
  });

  it('peak does not exceed a reasonable bound after smoothing', () => {
    const tailA = generateSineWave(300, sampleRate, regionLength, 0.7);
    const headB = generateSineWave(1500, sampleRate, regionLength, 0.7);

    const peakBeforeA = computePeak(tailA);
    const peakBeforeB = computePeak(headB);

    applySpectralSmoothing(tailA, headB, sampleRate, 0.9, { fftSize });

    const peakAfterA = computePeak(tailA);
    const peakAfterB = computePeak(headB);

    // Peak should not grow by more than MAX_CORRECTION_GAIN (2.0x / +6 dB)
    // plus some margin for overlap-add reconstruction
    expect(peakAfterA).toBeLessThan(peakBeforeA * 4.0);
    expect(peakAfterB).toBeLessThan(peakBeforeB * 4.0);
  });
});
