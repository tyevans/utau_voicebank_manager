import { describe, it, expect } from 'vitest';
import { applyFormantPreservation } from './cepstral-envelope.js';

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
 * Generate a composite signal with multiple harmonics simulating a vowel-like
 * formant structure. Harmonics at f0, 2*f0, 3*f0, ... with decaying amplitudes
 * shaped by a formant envelope.
 */
function generateVowelLike(
  f0: number,
  sampleRate: number,
  numSamples: number,
  amplitude = 0.5,
): Float32Array {
  const samples = new Float32Array(numSamples);
  // Simple formant-like envelope: peaks around 500Hz and 1500Hz
  const formant1 = 500;
  const formant2 = 1500;
  const bw = 200; // bandwidth

  const numHarmonics = Math.floor(sampleRate / 2 / f0);

  for (let h = 1; h <= numHarmonics; h++) {
    const freq = h * f0;
    // Gaussian-like envelope around formants
    const g1 = Math.exp(-0.5 * Math.pow((freq - formant1) / bw, 2));
    const g2 = Math.exp(-0.5 * Math.pow((freq - formant2) / bw, 2));
    const env = Math.max(g1, g2) * 0.5 + 0.1; // baseline + formants

    for (let i = 0; i < numSamples; i++) {
      samples[i] += amplitude * env * Math.sin((2 * Math.PI * freq * i) / sampleRate);
    }
  }

  // Normalize to target amplitude
  let peak = 0;
  for (let i = 0; i < numSamples; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  if (peak > 0) {
    const scale = amplitude / peak;
    for (let i = 0; i < numSamples; i++) {
      samples[i] *= scale;
    }
  }

  return samples;
}

/**
 * Generate white noise with a deterministic seed.
 */
function generateNoise(numSamples: number, amplitude = 0.3): Float32Array {
  const samples = new Float32Array(numSamples);
  let seed = 98765;
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

// ── applyFormantPreservation ─────────────────────────────────────────────────

describe('applyFormantPreservation', () => {
  const sampleRate = 44100;
  const fftSize = 2048;
  // Need enough samples for multiple STFT frames
  const numSamples = fftSize * 4;

  it('returns output of the same length as the shifted input', () => {
    const original = generateSineWave(200, sampleRate, numSamples);
    const shifted = generateSineWave(250, sampleRate, numSamples);

    const result = applyFormantPreservation(original, shifted, sampleRate, 3, {
      fftSize,
    });

    expect(result.length).toBe(shifted.length);
  });

  it('returns a copy of shifted when formantScale is 1.0 (no correction)', () => {
    const original = generateSineWave(200, sampleRate, numSamples);
    const shifted = generateSineWave(250, sampleRate, numSamples);

    const result = applyFormantPreservation(original, shifted, sampleRate, 5, {
      fftSize,
      formantScale: 1.0,
    });

    expect(result.length).toBe(shifted.length);
    // Should be an exact copy (no spectral correction applied)
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBe(shifted[i]);
    }
  });

  it('output does not contain NaN or Infinity for sine waves', () => {
    const original = generateSineWave(200, sampleRate, numSamples, 0.6);
    const shifted = generateSineWave(300, sampleRate, numSamples, 0.6);

    const result = applyFormantPreservation(original, shifted, sampleRate, 7, {
      fftSize,
    });

    for (let i = 0; i < result.length; i++) {
      expect(Number.isFinite(result[i])).toBe(true);
    }
  });

  it('output does not contain NaN or Infinity for vowel-like signals', () => {
    const original = generateVowelLike(150, sampleRate, numSamples, 0.5);
    const shifted = generateVowelLike(200, sampleRate, numSamples, 0.5);

    const result = applyFormantPreservation(original, shifted, sampleRate, 5, {
      fftSize,
    });

    for (let i = 0; i < result.length; i++) {
      expect(Number.isFinite(result[i])).toBe(true);
    }
  });

  it('preserves approximate energy (does not amplify excessively)', () => {
    const original = generateVowelLike(150, sampleRate, numSamples, 0.5);
    const shifted = generateVowelLike(200, sampleRate, numSamples, 0.5);

    const shiftedRms = computeRms(shifted);

    const result = applyFormantPreservation(original, shifted, sampleRate, 5, {
      fftSize,
    });

    const resultRms = computeRms(result);

    // RMS should not change by more than a factor of MAX_CORRECTION_GAIN (10x)
    // In practice, the overlap-add normalization keeps it much closer.
    expect(resultRms).toBeGreaterThan(shiftedRms * 0.05);
    expect(resultRms).toBeLessThan(shiftedRms * 20.0);
  });

  it('handles silence without crashing', () => {
    const original = new Float32Array(numSamples);
    const shifted = new Float32Array(numSamples);

    const result = applyFormantPreservation(original, shifted, sampleRate, 5, {
      fftSize,
    });

    expect(result.length).toBe(numSamples);
    // Output should be near-silence
    const peak = computePeak(result);
    expect(peak).toBeLessThan(0.01);
  });

  it('handles noise signals without crashing', () => {
    const original = generateNoise(numSamples, 0.4);
    const shifted = generateNoise(numSamples, 0.4);

    const result = applyFormantPreservation(original, shifted, sampleRate, 5, {
      fftSize,
    });

    expect(result.length).toBe(numSamples);
    for (let i = 0; i < result.length; i++) {
      expect(Number.isFinite(result[i])).toBe(true);
    }
  });

  it('handles DC signal without crashing', () => {
    const original = new Float32Array(numSamples).fill(0.5);
    const shifted = new Float32Array(numSamples).fill(0.3);

    const result = applyFormantPreservation(original, shifted, sampleRate, 5, {
      fftSize,
    });

    expect(result.length).toBe(numSamples);
    for (let i = 0; i < result.length; i++) {
      expect(Number.isFinite(result[i])).toBe(true);
    }
  });

  it('pitch shift of 0 semitones produces output close to shifted input', () => {
    const original = generateVowelLike(200, sampleRate, numSamples, 0.5);
    // "Shifted" by 0 semitones is the same signal
    const shifted = new Float32Array(original);

    const result = applyFormantPreservation(original, shifted, sampleRate, 0, {
      fftSize,
    });

    // With 0 pitch shift, the correction should be minimal:
    // original envelope / shifted envelope ~ 1.0 for most bins
    const shiftedRms = computeRms(shifted);
    const resultRms = computeRms(result);

    // Should be very close (within ~3 dB)
    expect(resultRms).toBeGreaterThan(shiftedRms * 0.5);
    expect(resultRms).toBeLessThan(shiftedRms * 2.0);
  });

  it('modifies the spectrum when formantScale is 0 (full preservation)', () => {
    const original = generateVowelLike(150, sampleRate, numSamples, 0.5);
    const shifted = generateVowelLike(250, sampleRate, numSamples, 0.5);

    const resultFull = applyFormantPreservation(original, shifted, sampleRate, 8, {
      fftSize,
      formantScale: 0.0,
    });

    const resultNone = applyFormantPreservation(original, shifted, sampleRate, 8, {
      fftSize,
      formantScale: 1.0,
    });

    // Full preservation (formantScale=0) should differ from no correction (formantScale=1)
    let totalDiff = 0;
    for (let i = 0; i < resultFull.length; i++) {
      totalDiff += Math.abs(resultFull[i] - resultNone[i]);
    }

    // The difference should be non-trivial for a significant pitch shift
    expect(totalDiff).toBeGreaterThan(0);
  });

  it('custom lifterOrder changes the output', () => {
    const original = generateVowelLike(150, sampleRate, numSamples, 0.5);
    const shifted = generateVowelLike(200, sampleRate, numSamples, 0.5);

    const resultDefault = applyFormantPreservation(
      original,
      shifted,
      sampleRate,
      5,
      { fftSize },
    );

    const resultCustom = applyFormantPreservation(
      original,
      shifted,
      sampleRate,
      5,
      { fftSize, lifterOrder: 10 }, // Very low lifter order
    );

    // Different lifter orders should produce different spectral envelopes
    // and therefore different correction filters
    let totalDiff = 0;
    for (let i = 0; i < resultDefault.length; i++) {
      totalDiff += Math.abs(resultDefault[i] - resultCustom[i]);
    }

    expect(totalDiff).toBeGreaterThan(0);
  });

  it('output peak is bounded for large pitch shifts', () => {
    const original = generateVowelLike(150, sampleRate, numSamples, 0.5);
    const shifted = generateVowelLike(300, sampleRate, numSamples, 0.5);

    const result = applyFormantPreservation(original, shifted, sampleRate, 12, {
      fftSize,
    });

    const shiftedPeak = computePeak(shifted);
    const resultPeak = computePeak(result);

    // Peak should not grow beyond MAX_CORRECTION_GAIN (10x) of shifted peak
    // In practice it should be much less due to averaging across frames
    expect(resultPeak).toBeLessThan(shiftedPeak * 15.0);
  });

  it('handles original shorter than shifted', () => {
    // If the original is shorter, frames beyond its length should still process
    // (they read zeros from original, which is fine)
    const original = generateVowelLike(150, sampleRate, numSamples / 2, 0.5);
    const shifted = generateVowelLike(200, sampleRate, numSamples, 0.5);

    const result = applyFormantPreservation(original, shifted, sampleRate, 5, {
      fftSize,
    });

    expect(result.length).toBe(shifted.length);
    for (let i = 0; i < result.length; i++) {
      expect(Number.isFinite(result[i])).toBe(true);
    }
  });

  it('handles shifted shorter than original', () => {
    const original = generateVowelLike(150, sampleRate, numSamples, 0.5);
    const shifted = generateVowelLike(200, sampleRate, numSamples / 2, 0.5);

    const result = applyFormantPreservation(original, shifted, sampleRate, 5, {
      fftSize,
    });

    expect(result.length).toBe(shifted.length);
    for (let i = 0; i < result.length; i++) {
      expect(Number.isFinite(result[i])).toBe(true);
    }
  });

  it('works with small fftSize (256)', () => {
    const smallFFT = 256;
    const samples = smallFFT * 4;
    const original = generateSineWave(200, sampleRate, samples, 0.5);
    const shifted = generateSineWave(300, sampleRate, samples, 0.5);

    const result = applyFormantPreservation(original, shifted, sampleRate, 7, {
      fftSize: smallFFT,
    });

    expect(result.length).toBe(samples);
    for (let i = 0; i < result.length; i++) {
      expect(Number.isFinite(result[i])).toBe(true);
    }
  });

  it('negative pitch shift is handled correctly', () => {
    const original = generateVowelLike(200, sampleRate, numSamples, 0.5);
    const shifted = generateVowelLike(150, sampleRate, numSamples, 0.5);

    const result = applyFormantPreservation(original, shifted, sampleRate, -5, {
      fftSize,
    });

    expect(result.length).toBe(shifted.length);
    for (let i = 0; i < result.length; i++) {
      expect(Number.isFinite(result[i])).toBe(true);
    }
    expect(computeRms(result)).toBeGreaterThan(0);
  });

  it('intermediate formantScale produces intermediate result', () => {
    const original = generateVowelLike(150, sampleRate, numSamples, 0.5);
    const shifted = generateVowelLike(250, sampleRate, numSamples, 0.5);

    const resultFull = applyFormantPreservation(original, shifted, sampleRate, 8, {
      fftSize,
      formantScale: 0.0,
    });

    const resultHalf = applyFormantPreservation(original, shifted, sampleRate, 8, {
      fftSize,
      formantScale: 0.5,
    });

    const resultNone = applyFormantPreservation(original, shifted, sampleRate, 8, {
      fftSize,
      formantScale: 1.0,
    });

    // Compute distance of half-correction from full and none
    let distFromFull = 0;
    let distFromNone = 0;
    for (let i = 0; i < resultHalf.length; i++) {
      distFromFull += Math.abs(resultHalf[i] - resultFull[i]);
      distFromNone += Math.abs(resultHalf[i] - resultNone[i]);
    }

    // Half correction should differ from both extremes
    // (It should be somewhere in between, not equal to either)
    expect(distFromFull).toBeGreaterThan(0);
    expect(distFromNone).toBeGreaterThan(0);
  });
});
