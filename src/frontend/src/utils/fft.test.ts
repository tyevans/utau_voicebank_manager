import { describe, it, expect } from 'vitest';
import { fftInterleaved, ifftInterleaved, fftSplit } from './fft.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Build an interleaved complex array from separate real/imag arrays.
 * Layout: [re0, im0, re1, im1, ...]
 */
function interleave(real: number[], imag: number[]): Float64Array {
  const n = real.length;
  const data = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    data[i * 2] = real[i];
    data[i * 2 + 1] = imag[i];
  }
  return data;
}

/**
 * Extract real values from interleaved complex array.
 */
function extractReal(data: Float64Array): number[] {
  const n = data.length / 2;
  const real: number[] = [];
  for (let i = 0; i < n; i++) {
    real.push(data[i * 2]);
  }
  return real;
}

/**
 * Extract imaginary values from interleaved complex array.
 */
function extractImag(data: Float64Array): number[] {
  const n = data.length / 2;
  const imag: number[] = [];
  for (let i = 0; i < n; i++) {
    imag.push(data[i * 2 + 1]);
  }
  return imag;
}

/**
 * Compare two arrays element-wise with tolerance.
 */
function expectArrayCloseTo(actual: number[], expected: number[], tolerance = 1e-6): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++) {
    expect(actual[i]).toBeCloseTo(expected[i], -Math.log10(tolerance));
  }
}

// ── fftInterleaved ───────────────────────────────────────────────────────────

describe('fftInterleaved', () => {
  it('computes FFT of DC signal (all ones)', () => {
    // FFT of [1, 1, 1, 1] should have DC bin = 4, all others = 0
    const data = interleave([1, 1, 1, 1], [0, 0, 0, 0]);
    fftInterleaved(data);

    const real = extractReal(data);
    const imag = extractImag(data);

    expect(real[0]).toBeCloseTo(4, 5); // DC bin = sum of all samples
    expect(imag[0]).toBeCloseTo(0, 5);

    // All other bins should be zero
    for (let i = 1; i < 4; i++) {
      expect(real[i]).toBeCloseTo(0, 5);
      expect(imag[i]).toBeCloseTo(0, 5);
    }
  });

  it('computes FFT of impulse signal [1, 0, 0, 0]', () => {
    // FFT of impulse should be flat spectrum: all bins = 1
    const data = interleave([1, 0, 0, 0], [0, 0, 0, 0]);
    fftInterleaved(data);

    const real = extractReal(data);
    const imag = extractImag(data);

    for (let i = 0; i < 4; i++) {
      expect(real[i]).toBeCloseTo(1, 5);
      expect(imag[i]).toBeCloseTo(0, 5);
    }
  });

  it('computes FFT of Nyquist signal [1, -1, 1, -1]', () => {
    // FFT of alternating +1/-1 should have energy only at Nyquist bin (N/2)
    const data = interleave([1, -1, 1, -1], [0, 0, 0, 0]);
    fftInterleaved(data);

    const real = extractReal(data);

    expect(real[0]).toBeCloseTo(0, 5); // DC
    expect(real[2]).toBeCloseTo(4, 5); // Nyquist bin (N/2)
    expect(real[1]).toBeCloseTo(0, 5); // Others
    expect(real[3]).toBeCloseTo(0, 5);
  });

  it('handles N=8 correctly', () => {
    // Cosine at bin 1: x[n] = cos(2*pi*n/8)
    const N = 8;
    const real: number[] = [];
    const imag: number[] = [];
    for (let n = 0; n < N; n++) {
      real.push(Math.cos((2 * Math.PI * n) / N));
      imag.push(0);
    }

    const data = interleave(real, imag);
    fftInterleaved(data);

    const fftReal = extractReal(data);

    // cos(2*pi*n/N) should have energy at bins 1 and N-1 (= 7), each N/2 = 4
    expect(fftReal[1]).toBeCloseTo(4, 4);
    expect(fftReal[7]).toBeCloseTo(4, 4);

    // All other bins should be zero
    expect(fftReal[0]).toBeCloseTo(0, 4);
    for (let i = 2; i <= 6; i++) {
      expect(fftReal[i]).toBeCloseTo(0, 4);
    }
  });

  it('preserves Parseval theorem (energy conservation)', () => {
    // Time domain energy = Frequency domain energy / N
    const N = 16;
    const real: number[] = [];
    const imag: number[] = [];
    let timeDomainEnergy = 0;

    for (let n = 0; n < N; n++) {
      const val = Math.sin((2 * Math.PI * 3 * n) / N) + 0.5 * Math.cos((2 * Math.PI * 7 * n) / N);
      real.push(val);
      imag.push(0);
      timeDomainEnergy += val * val;
    }

    const data = interleave(real, imag);
    fftInterleaved(data);

    let freqDomainEnergy = 0;
    for (let k = 0; k < N; k++) {
      const re = data[k * 2];
      const im = data[k * 2 + 1];
      freqDomainEnergy += re * re + im * im;
    }

    // Parseval's theorem: sum(|x[n]|^2) = (1/N) * sum(|X[k]|^2)
    expect(timeDomainEnergy).toBeCloseTo(freqDomainEnergy / N, 4);
  });
});

// ── ifftInterleaved ──────────────────────────────────────────────────────────

describe('ifftInterleaved', () => {
  it('is the inverse of fftInterleaved (round trip)', () => {
    const original = [0.5, -0.3, 0.8, -0.1, 0.2, -0.7, 0.4, -0.6];
    const data = interleave(original, [0, 0, 0, 0, 0, 0, 0, 0]);

    // Forward FFT
    fftInterleaved(data);

    // Inverse FFT
    ifftInterleaved(data);

    // Should recover original signal
    const recovered = extractReal(data);
    expectArrayCloseTo(recovered, original, 1e-10);

    // Imaginary parts should be near zero
    const recoveredImag = extractImag(data);
    for (const v of recoveredImag) {
      expect(Math.abs(v)).toBeLessThan(1e-10);
    }
  });

  it('round trips a complex signal', () => {
    const real = [1, 2, 3, 4];
    const imag = [0.5, -0.5, 0.5, -0.5];
    const data = interleave(real, imag);

    fftInterleaved(data);
    ifftInterleaved(data);

    expectArrayCloseTo(extractReal(data), real, 1e-10);
    expectArrayCloseTo(extractImag(data), imag, 1e-10);
  });
});

// ── fftSplit ─────────────────────────────────────────────────────────────────

describe('fftSplit', () => {
  it('computes FFT of DC signal (all ones)', () => {
    const real = new Float32Array([1, 1, 1, 1]);
    const imag = new Float32Array([0, 0, 0, 0]);

    fftSplit(real, imag);

    expect(real[0]).toBeCloseTo(4, 3); // DC bin
    expect(imag[0]).toBeCloseTo(0, 3);

    for (let i = 1; i < 4; i++) {
      expect(real[i]).toBeCloseTo(0, 3);
      expect(imag[i]).toBeCloseTo(0, 3);
    }
  });

  it('computes FFT of impulse signal [1, 0, 0, 0]', () => {
    const real = new Float32Array([1, 0, 0, 0]);
    const imag = new Float32Array([0, 0, 0, 0]);

    fftSplit(real, imag);

    // All bins should be 1+0i
    for (let i = 0; i < 4; i++) {
      expect(real[i]).toBeCloseTo(1, 3);
      expect(imag[i]).toBeCloseTo(0, 3);
    }
  });

  it('agrees with fftInterleaved for the same input', () => {
    const N = 8;
    const realVals: number[] = [];
    for (let n = 0; n < N; n++) {
      realVals.push(Math.sin((2 * Math.PI * 2 * n) / N) + 0.3);
    }

    // fftInterleaved
    const interleaved = interleave(realVals, new Array(N).fill(0));
    fftInterleaved(interleaved);

    // fftSplit
    const splitReal = new Float32Array(realVals);
    const splitImag = new Float32Array(N);
    fftSplit(splitReal, splitImag);

    // Results should agree (within Float32 precision)
    for (let k = 0; k < N; k++) {
      expect(splitReal[k]).toBeCloseTo(interleaved[k * 2], 3);
      expect(splitImag[k]).toBeCloseTo(interleaved[k * 2 + 1], 3);
    }
  });

  it('handles N=1 input gracefully', () => {
    const real = new Float32Array([5]);
    const imag = new Float32Array([0]);

    fftSplit(real, imag);

    // N=1: output should equal input
    expect(real[0]).toBeCloseTo(5, 5);
    expect(imag[0]).toBeCloseTo(0, 5);
  });

  it('preserves energy (Parseval theorem)', () => {
    const N = 16;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    let timeDomainEnergy = 0;

    for (let n = 0; n < N; n++) {
      real[n] = Math.cos((2 * Math.PI * 5 * n) / N);
      timeDomainEnergy += real[n] * real[n];
    }

    fftSplit(real, imag);

    let freqDomainEnergy = 0;
    for (let k = 0; k < N; k++) {
      freqDomainEnergy += real[k] * real[k] + imag[k] * imag[k];
    }

    expect(timeDomainEnergy).toBeCloseTo(freqDomainEnergy / N, 2);
  });
});
