/**
 * Shared FFT utilities (Cooley-Tukey radix-2 DIT, iterative, in-place).
 *
 * Two API styles are provided to match the calling conventions used across
 * the codebase:
 *
 * 1. **Interleaved complex (Float64Array)** -- `fftInterleaved` / `ifftInterleaved`
 *    Data layout: [re0, im0, re1, im1, ...], array length = 2*N.
 *    Used by cepstral-envelope.ts and spectral-smoothing.ts.
 *
 * 2. **Split real/imag (Float32Array)** -- `fftSplit`
 *    Separate `real` and `imag` arrays of length N.
 *    Used by spectral-analysis.ts and fft-worker.ts.
 *
 * In both cases N must be a power of 2 and the transform is performed
 * in-place.
 *
 * @module fft
 */

// ---------------------------------------------------------------------------
// Interleaved complex API (Float64Array)
// ---------------------------------------------------------------------------

/**
 * Bit-reversal permutation for radix-2 FFT (interleaved complex layout).
 *
 * Reorders the interleaved complex array so that the iterative butterfly
 * stages produce the correct output without recursion.
 *
 * @param data - Interleaved [real, imag, real, imag, ...] array
 * @param n - Number of complex elements (data.length / 2)
 */
function bitReversalPermutationInterleaved(data: Float64Array, n: number): void {
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const ri = i * 2;
      const rj = j * 2;
      const tmpReal = data[ri];
      const tmpImag = data[ri + 1];
      data[ri] = data[rj];
      data[ri + 1] = data[rj + 1];
      data[rj] = tmpReal;
      data[rj + 1] = tmpImag;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }
}

/**
 * In-place iterative radix-2 Cooley-Tukey FFT (interleaved complex layout).
 *
 * Operates on interleaved complex data: [re0, im0, re1, im1, ...].
 * The array length must be 2*N where N is a power of 2.
 *
 * @param data - Interleaved complex array (modified in place)
 * @param inverse - If true, compute the inverse FFT (with 1/N scaling)
 */
export function fftInterleaved(data: Float64Array, inverse: boolean = false): void {
  const n = data.length / 2;

  bitReversalPermutationInterleaved(data, n);

  const sign = inverse ? 1 : -1;

  for (let size = 2; size <= n; size *= 2) {
    const halfSize = size / 2;
    const angleStep = (sign * 2 * Math.PI) / size;

    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < halfSize; j++) {
        const angle = angleStep * j;
        const twiddleReal = Math.cos(angle);
        const twiddleImag = Math.sin(angle);

        const evenIdx = (i + j) * 2;
        const oddIdx = (i + j + halfSize) * 2;

        const oddReal =
          data[oddIdx] * twiddleReal - data[oddIdx + 1] * twiddleImag;
        const oddImag =
          data[oddIdx] * twiddleImag + data[oddIdx + 1] * twiddleReal;

        data[oddIdx] = data[evenIdx] - oddReal;
        data[oddIdx + 1] = data[evenIdx + 1] - oddImag;
        data[evenIdx] += oddReal;
        data[evenIdx + 1] += oddImag;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < data.length; i++) {
      data[i] /= n;
    }
  }
}

/**
 * Convenience alias: inverse FFT using the interleaved complex layout.
 *
 * Equivalent to `fftInterleaved(data, true)`.
 *
 * @param data - Interleaved complex array (modified in place)
 */
export function ifftInterleaved(data: Float64Array): void {
  fftInterleaved(data, true);
}

// ---------------------------------------------------------------------------
// Split real/imag API (Float32Array)
// ---------------------------------------------------------------------------

/**
 * In-place iterative radix-2 Cooley-Tukey FFT (split real/imag layout).
 *
 * Operates on separate real and imaginary Float32Arrays of length N
 * (N must be a power of 2). Forward transform only.
 *
 * @param real - Real part of input (modified in place)
 * @param imag - Imaginary part of input (modified in place)
 */
export function fftSplit(real: Float32Array, imag: Float32Array): void {
  const n = real.length;

  if (n <= 1) return;

  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      let temp = real[i];
      real[i] = real[j];
      real[j] = temp;
      temp = imag[i];
      imag[i] = imag[j];
      imag[j] = temp;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Cooley-Tukey iterative FFT
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let curReal = 1;
      let curImag = 0;

      for (let k = 0; k < halfLen; k++) {
        const evenIdx = i + k;
        const oddIdx = i + k + halfLen;

        const tReal = curReal * real[oddIdx] - curImag * imag[oddIdx];
        const tImag = curReal * imag[oddIdx] + curImag * real[oddIdx];

        real[oddIdx] = real[evenIdx] - tReal;
        imag[oddIdx] = imag[evenIdx] - tImag;
        real[evenIdx] = real[evenIdx] + tReal;
        imag[evenIdx] = imag[evenIdx] + tImag;

        // Update twiddle factor
        const newReal = curReal * wReal - curImag * wImag;
        const newImag = curReal * wImag + curImag * wReal;
        curReal = newReal;
        curImag = newImag;
      }
    }
  }
}
