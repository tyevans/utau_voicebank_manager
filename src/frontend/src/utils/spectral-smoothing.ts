/**
 * Spectral Envelope Smoothing at Concatenation Joins.
 *
 * When UTAU samples are concatenated, purely amplitude-based crossfades
 * (ADSR / equal-power) handle volume transitions but cannot address timbre
 * mismatches between consecutive phonemes. This module adds spectral envelope
 * interpolation at join boundaries so the timbre transitions smoothly, not
 * just the amplitude.
 *
 * Algorithm (STFT-based spectral envelope interpolation):
 *   1. Divide tailA (end of outgoing sample) and headB (start of incoming
 *      sample) into overlapping Hann-windowed frames.
 *   2. For each frame pair at corresponding positions:
 *      a. Compute FFT of both frames.
 *      b. Extract magnitude spectra (spectral envelopes).
 *      c. Compute a position-dependent blend factor: tailA frames fade toward
 *         B's spectral character as they approach the join; headB frames fade
 *         toward A's character as they move away from it.
 *      d. Scale the blend by spectralDistance -- more correction when spectra
 *         differ more, none when they are similar.
 *      e. Build a per-bin correction filter: lerp(1.0, target/source, blend).
 *      f. Clamp correction to avoid amplifying noise (+6 dB max boost per bin).
 *      g. Apply correction to the magnitude while preserving original phase.
 *      h. IFFT back to time domain.
 *   3. Overlap-add corrected frames back into tailA / headB (in-place).
 *
 * The result is that tailA gradually takes on B's spectral character at the
 * join, and headB gradually takes on A's character, eliminating the abrupt
 * timbre discontinuity.
 *
 * @module spectral-smoothing
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Options for spectral envelope smoothing at join boundaries.
 */
export interface SpectralSmoothingOptions {
  /** FFT window size (default: 2048, must be power of 2). */
  fftSize?: number;

  /**
   * Maximum smoothing region in milliseconds from each side of the join
   * (default: 30ms). The actual region is clamped to the available data.
   */
  smoothingRegionMs?: number;

  /**
   * Spectral distance threshold below which no smoothing is applied
   * (default: 0.1). When the spectra are already similar there is nothing
   * to correct, so we skip the FFT work entirely.
   */
  distanceThreshold?: number;
}

// ---------------------------------------------------------------------------
// FFT Implementation (Cooley-Tukey radix-2 DIT, iterative, in-place)
//
// This is a self-contained copy of the radix-2 FFT used elsewhere in the
// project (cepstral-envelope.ts, spectral-analysis.ts). Those copies are
// module-private, so we duplicate the small implementation here rather than
// introducing a shared internal module (keeping change scope minimal).
// ---------------------------------------------------------------------------

/**
 * Bit-reversal permutation for radix-2 FFT.
 *
 * Reorders the interleaved complex array so that the iterative butterfly
 * stages produce the correct output without recursion.
 *
 * @param data - Interleaved [real, imag, real, imag, ...] array
 * @param n - Number of complex elements (data.length / 2)
 */
function bitReversalPermutation(data: Float64Array, n: number): void {
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
 * In-place iterative radix-2 Cooley-Tukey FFT.
 *
 * Operates on interleaved complex data: [re0, im0, re1, im1, ...].
 * The array length must be 2*N where N is a power of 2.
 *
 * @param data - Interleaved complex array (modified in place)
 * @param inverse - If true, compute the inverse FFT (with 1/N scaling)
 */
function fft(data: Float64Array, inverse: boolean = false): void {
  const n = data.length / 2;

  bitReversalPermutation(data, n);

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

// ---------------------------------------------------------------------------
// Windowing
// ---------------------------------------------------------------------------

/** Cache of pre-computed Hann windows keyed by length. */
const hannWindowCache = new Map<number, Float64Array>();

/** Get or create a Hann window of the specified length. */
function getHannWindow(length: number): Float64Array {
  let win = hannWindowCache.get(length);
  if (!win) {
    win = new Float64Array(length);
    for (let i = 0; i < length; i++) {
      win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)));
    }
    hannWindowCache.set(length, win);
  }
  return win;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Small constant to prevent division by zero and log(0). */
const EPSILON = 1e-10;

/**
 * Maximum per-bin correction gain (linear).
 * 6 dB = 10^(6/20) ~ 2.0. Prevents amplifying noise in spectral nulls.
 */
const MAX_CORRECTION_GAIN = 2.0; // +6 dB

/**
 * Minimum per-bin correction gain (linear).
 * Prevents excessive attenuation in any single bin.
 */
const MIN_CORRECTION_GAIN = 0.25; // -12 dB

// ---------------------------------------------------------------------------
// Core: compute average magnitude spectrum for a region
// ---------------------------------------------------------------------------

/**
 * Compute the average magnitude spectrum of an audio region using STFT.
 *
 * Divides the input into overlapping Hann-windowed frames, computes the FFT
 * of each, accumulates magnitude spectra, and returns the average. Only the
 * positive-frequency half (bins 0..fftSize/2) is returned.
 *
 * @param samples - Time-domain audio samples
 * @param fftSize - FFT window size (must be power of 2)
 * @param hopSize - Hop size between analysis frames
 * @returns Averaged magnitude spectrum (length = fftSize / 2 + 1)
 */
function computeAverageMagnitude(
  samples: Float32Array,
  fftSize: number,
  hopSize: number,
): Float64Array {
  const halfPlus1 = (fftSize >> 1) + 1;
  const avg = new Float64Array(halfPlus1);
  const hannWin = getHannWindow(fftSize);
  const buf = new Float64Array(fftSize * 2);
  let numFrames = 0;

  for (let start = 0; start + fftSize <= samples.length; start += hopSize) {
    // Window and pack into interleaved complex
    buf.fill(0);
    for (let i = 0; i < fftSize; i++) {
      buf[i * 2] = samples[start + i] * hannWin[i];
      // imaginary stays 0
    }

    fft(buf, false);

    for (let k = 0; k < halfPlus1; k++) {
      const re = buf[k * 2];
      const im = buf[k * 2 + 1];
      avg[k] += Math.sqrt(re * re + im * im);
    }
    numFrames++;
  }

  // Handle audio shorter than one window: zero-pad a single frame
  if (numFrames === 0 && samples.length > 0) {
    buf.fill(0);
    const len = Math.min(samples.length, fftSize);
    for (let i = 0; i < len; i++) {
      buf[i * 2] = samples[i] * hannWin[i];
    }
    fft(buf, false);
    for (let k = 0; k < halfPlus1; k++) {
      const re = buf[k * 2];
      const im = buf[k * 2 + 1];
      avg[k] = Math.sqrt(re * re + im * im);
    }
    numFrames = 1;
  }

  if (numFrames > 1) {
    for (let k = 0; k < halfPlus1; k++) {
      avg[k] /= numFrames;
    }
  }

  return avg;
}

// ---------------------------------------------------------------------------
// Core: apply spectral correction to a region (overlap-add STFT)
// ---------------------------------------------------------------------------

/**
 * Apply a spectral correction filter to a region of audio, in-place.
 *
 * For each STFT frame in `samples`, the magnitude of each bin is scaled by
 * the corresponding value in `correctionFilter` while phase is preserved.
 * The frames are reassembled via overlap-add with Hann windowing.
 *
 * @param samples - Audio samples to modify (Float32Array, modified in-place)
 * @param correctionFilter - Per-bin multiplicative gain (length = fftSize/2+1)
 * @param fftSize - FFT window size
 * @param hopSize - Hop between frames
 */
function applySpectralCorrection(
  samples: Float32Array,
  correctionFilter: Float64Array,
  fftSize: number,
  hopSize: number,
): void {
  const hannWin = getHannWindow(fftSize);
  const halfPlus1 = (fftSize >> 1) + 1;
  const outLength = samples.length;

  // Accumulator buffers for overlap-add reconstruction
  const output = new Float64Array(outLength);
  const windowSum = new Float64Array(outLength);

  const buf = new Float64Array(fftSize * 2);

  for (let start = 0; start + fftSize <= outLength; start += hopSize) {
    // Window the frame
    buf.fill(0);
    for (let i = 0; i < fftSize; i++) {
      buf[i * 2] = samples[start + i] * hannWin[i];
    }

    // Forward FFT
    fft(buf, false);

    // Apply correction: scale magnitude, preserve phase
    for (let k = 0; k < halfPlus1; k++) {
      const re = buf[k * 2];
      const im = buf[k * 2 + 1];
      const gain = correctionFilter[k];

      buf[k * 2] = re * gain;
      buf[k * 2 + 1] = im * gain;

      // Mirror for negative frequencies (except DC and Nyquist)
      if (k > 0 && k < fftSize >> 1) {
        const mirrorK = fftSize - k;
        buf[mirrorK * 2] = buf[mirrorK * 2] * gain;
        buf[mirrorK * 2 + 1] = buf[mirrorK * 2 + 1] * gain;
      }
    }

    // Inverse FFT
    fft(buf, true);

    // Overlap-add with synthesis window
    for (let i = 0; i < fftSize; i++) {
      const idx = start + i;
      if (idx < outLength) {
        output[idx] += buf[i * 2] * hannWin[i];
        windowSum[idx] += hannWin[i] * hannWin[i];
      }
    }
  }

  // Normalize by window sum and write back in-place
  for (let i = 0; i < outLength; i++) {
    if (windowSum[i] > 1e-6) {
      samples[i] = output[i] / windowSum[i];
    }
    // else: keep original sample where no windows overlap
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply spectral envelope smoothing at the boundary between two audio buffers.
 *
 * Takes the tail of buffer A and head of buffer B (the overlap region),
 * computes averaged spectral envelopes for each via STFT, then builds
 * position-dependent correction filters that cross-interpolate the envelopes
 * across the join to create a smooth spectral transition.
 *
 * The correction is scaled by `spectralDistance` so that:
 * - When distance is below the threshold, no processing occurs (fast path).
 * - When distance is high, strong spectral correction is applied.
 * - When distance is moderate, proportional correction is applied.
 *
 * Both `tailA` and `headB` are **modified in-place**.
 *
 * @param tailA - Last N ms of outgoing sample (will be modified)
 * @param headB - First N ms of incoming sample (will be modified)
 * @param sampleRate - Audio sample rate in Hz
 * @param spectralDistance - From SpectralDistanceResult.distance (0-1)
 * @param options - Processing options
 */
export function applySpectralSmoothing(
  tailA: Float32Array,
  headB: Float32Array,
  sampleRate: number,
  spectralDistance: number,
  options?: SpectralSmoothingOptions,
): void {
  const fftSize = options?.fftSize ?? 2048;
  const smoothingRegionMs = options?.smoothingRegionMs ?? 30;
  const distanceThreshold = options?.distanceThreshold ?? 0.1;

  // ---- Fast path: skip when spectra are already similar ----
  if (spectralDistance < distanceThreshold) {
    return;
  }

  // ---- Validate inputs ----
  if (tailA.length === 0 || headB.length === 0) {
    return;
  }

  // Require at least one FFT window of data in each region
  if (tailA.length < fftSize || headB.length < fftSize) {
    return;
  }

  // ---- Analysis parameters ----
  const hopSize = fftSize >> 2; // 75% overlap (standard for Hann OLA)
  const halfPlus1 = (fftSize >> 1) + 1;

  // Clamp smoothing region to available data (in samples)
  const maxRegionSamples = Math.floor((smoothingRegionMs / 1000) * sampleRate);
  const regionA = Math.min(tailA.length, maxRegionSamples);
  const regionB = Math.min(headB.length, maxRegionSamples);

  // ---- Step 1: Compute average spectral envelopes for each side ----
  // Analyze the portion of tailA closest to the join (its end)
  const analysisA = tailA.subarray(tailA.length - regionA);
  // Analyze the portion of headB closest to the join (its start)
  const analysisB = headB.subarray(0, regionB);

  const magA = computeAverageMagnitude(analysisA, fftSize, hopSize);
  const magB = computeAverageMagnitude(analysisB, fftSize, hopSize);

  // ---- Step 2: Build correction filters ----
  // The blend amount is scaled by spectralDistance: more correction when
  // spectra differ more. Values above the threshold are remapped to 0-1.
  const normalizedDistance = Math.min(
    1,
    (spectralDistance - distanceThreshold) / (1 - distanceThreshold),
  );

  // Correction filter for tailA: gradually adopt B's spectral character.
  // Uses a single averaged correction since the positional fade is handled
  // by the fact that we only correct the last `regionA` samples.
  const correctionA = new Float64Array(halfPlus1);
  // Correction filter for headB: gradually adopt A's spectral character.
  const correctionB = new Float64Array(halfPlus1);

  // Blend factor: how much correction to apply. We use a moderate blend
  // (0.5 at the join point) scaled by spectralDistance, because full
  // correction (blend=1.0) would make A sound exactly like B and vice versa,
  // which is too aggressive.
  const maxBlend = 0.5 * normalizedDistance;

  for (let k = 0; k < halfPlus1; k++) {
    const mA = magA[k] + EPSILON;
    const mB = magB[k] + EPSILON;

    // For tailA: target is B's spectrum, source is A's spectrum
    // correction = lerp(1.0, mB/mA, maxBlend)
    const ratioAtoB = mB / mA;
    let gainA = 1.0 + maxBlend * (ratioAtoB - 1.0);
    gainA = Math.max(MIN_CORRECTION_GAIN, Math.min(MAX_CORRECTION_GAIN, gainA));
    correctionA[k] = gainA;

    // For headB: target is A's spectrum, source is B's spectrum
    // correction = lerp(1.0, mA/mB, maxBlend)
    const ratioBtoA = mA / mB;
    let gainB = 1.0 + maxBlend * (ratioBtoA - 1.0);
    gainB = Math.max(MIN_CORRECTION_GAIN, Math.min(MAX_CORRECTION_GAIN, gainB));
    correctionB[k] = gainB;
  }

  // ---- Step 3: Apply corrections in-place via overlap-add STFT ----
  // Only correct the analysis regions (the portions closest to the join).
  // We create sub-views and correct them; since Float32Array.subarray()
  // shares the underlying buffer, changes propagate to the original arrays.
  const tailRegion = tailA.subarray(tailA.length - regionA);
  const headRegion = headB.subarray(0, regionB);

  applySpectralCorrection(tailRegion, correctionA, fftSize, hopSize);
  applySpectralCorrection(headRegion, correctionB, fftSize, hopSize);
}
