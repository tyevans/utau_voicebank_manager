/**
 * Cepstral Envelope Extraction for Formant Preservation.
 *
 * When PSOLA pitch-shifts audio, it shifts ALL frequencies equally -- including
 * the vocal tract resonances (formants) that define vowel identity. This creates
 * chipmunk effects (pitch up) or Darth Vader effects (pitch down).
 *
 * Cepstral analysis separates the spectral envelope (formants) from the fine
 * spectral structure (harmonics). By extracting the envelope from both the
 * original and shifted audio, we can compute a correction filter that restores
 * the original formant positions while keeping the new pitch.
 *
 * Algorithm:
 *   Signal -> FFT -> log(|magnitude|) -> IFFT -> cepstrum
 *                                                   |
 *                                         Low-pass lifter (keep first N coefficients)
 *                                                   |
 *                                         FFT -> exp() -> spectral envelope
 *
 * The "lifter" zeros out high-quefrency cepstral coefficients (which encode
 * harmonic structure), leaving only the smooth spectral envelope (formants).
 *
 * This module runs in a Web Worker (no DOM/Web Audio API dependencies).
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Options for cepstral envelope extraction and formant preservation.
 */
export interface CepstralOptions {
  /** FFT size for analysis (default: 2048). Must be power of 2. */
  fftSize?: number;
  /** Hop size between analysis frames in samples (default: fftSize/4) */
  hopSize?: number;
  /** Number of cepstral coefficients to keep (default: ~sampleRate/1000) */
  lifterOrder?: number;
  /**
   * Formant scaling factor (0.0 - 1.0).
   * 0.0 = full preservation (formants stay exactly at original positions)
   * 0.15 = natural scaling (formants shift ~15% of the pitch shift amount)
   * 1.0 = no correction (formants shift fully with pitch, same as plain PSOLA)
   * Default: 0.0
   */
  formantScale?: number;
}

// ---------------------------------------------------------------------------
// FFT Implementation (Cooley-Tukey radix-2 DIT, iterative, in-place)
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
      // Swap complex elements at positions i and j
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

  // Bit-reversal permutation
  bitReversalPermutation(data, n);

  // Butterfly stages
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

        const oddReal = data[oddIdx] * twiddleReal - data[oddIdx + 1] * twiddleImag;
        const oddImag = data[oddIdx] * twiddleImag + data[oddIdx + 1] * twiddleReal;

        data[oddIdx] = data[evenIdx] - oddReal;
        data[oddIdx + 1] = data[evenIdx + 1] - oddImag;
        data[evenIdx] += oddReal;
        data[evenIdx + 1] += oddImag;
      }
    }
  }

  // Scale by 1/N for inverse transform
  if (inverse) {
    for (let i = 0; i < data.length; i++) {
      data[i] /= n;
    }
  }
}

// ---------------------------------------------------------------------------
// Windowing
// ---------------------------------------------------------------------------

/**
 * Pre-computed Hann window cache to avoid reallocation per frame.
 */
const hannWindowCache = new Map<number, Float64Array>();

/**
 * Get or create a Hann window of the specified length.
 */
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
// Cepstral Envelope Extraction
// ---------------------------------------------------------------------------

/**
 * Small constant added to avoid log(0) and division by zero.
 */
const EPSILON = 1e-10;

/**
 * Minimum and maximum bounds for the correction gain per frequency bin.
 * Prevents excessive amplification of noise in spectral nulls.
 */
const MIN_CORRECTION_GAIN = 0.1;
const MAX_CORRECTION_GAIN = 10.0;

/**
 * Extract the spectral envelope from a single frame using cepstral analysis.
 *
 * Steps:
 * 1. Compute FFT of the windowed frame
 * 2. Take log magnitude spectrum
 * 3. Compute IFFT to get the cepstrum
 * 4. Apply lifter (zero high-quefrency coefficients)
 * 5. Compute FFT of liftered cepstrum
 * 6. Exponentiate to get the spectral envelope
 *
 * @param frame - Interleaved complex FFT data [re, im, re, im, ...] (not modified)
 * @param fftSize - Number of complex bins (must be power of 2)
 * @param lifterOrder - Number of low-quefrency cepstral coefficients to keep
 * @returns Float64Array of spectral envelope magnitudes (length = fftSize)
 */
function extractSpectralEnvelope(
  frame: Float64Array,
  fftSize: number,
  lifterOrder: number,
): Float64Array {
  // Work on a copy since FFT is in-place
  const cepstralData = new Float64Array(fftSize * 2);

  // Step 1-2: Log magnitude spectrum (stored as real part, imag = 0)
  for (let k = 0; k < fftSize; k++) {
    const re = frame[k * 2];
    const im = frame[k * 2 + 1];
    const mag = Math.sqrt(re * re + im * im) + EPSILON;
    cepstralData[k * 2] = Math.log(mag);
    cepstralData[k * 2 + 1] = 0;
  }

  // Step 3: IFFT to get cepstrum
  fft(cepstralData, true);

  // Step 4: Lifter -- keep only the first `lifterOrder` coefficients
  // and the DC component. Use a smooth raised-cosine taper at the
  // cutoff to avoid ringing in the spectral domain.
  //
  // The cepstrum is symmetric: quefrency k and N-k contain conjugate
  // information. We zero everything above lifterOrder and below N-lifterOrder
  // with a taper width of ~4 samples for smoothness.
  const taperWidth = Math.min(4, lifterOrder / 2);

  for (let k = 0; k < fftSize; k++) {
    let gain: number;

    if (k <= lifterOrder - taperWidth) {
      // Below the taper region: keep fully
      gain = 1.0;
    } else if (k <= lifterOrder) {
      // Taper region: raised cosine from 1 to 0
      const t = (k - (lifterOrder - taperWidth)) / taperWidth;
      gain = 0.5 * (1 + Math.cos(Math.PI * t));
    } else if (k >= fftSize - lifterOrder) {
      // Symmetric side: mirror of the lower quefrencies
      const mirror = fftSize - k;
      if (mirror <= lifterOrder - taperWidth) {
        gain = 1.0;
      } else if (mirror <= lifterOrder) {
        const t = (mirror - (lifterOrder - taperWidth)) / taperWidth;
        gain = 0.5 * (1 + Math.cos(Math.PI * t));
      } else {
        gain = 0.0;
      }
    } else {
      // High quefrency: zero out
      gain = 0.0;
    }

    cepstralData[k * 2] *= gain;
    cepstralData[k * 2 + 1] *= gain;
  }

  // Step 5: FFT of liftered cepstrum
  fft(cepstralData, false);

  // Step 6: Exponentiate to get spectral envelope magnitude
  const envelope = new Float64Array(fftSize);
  for (let k = 0; k < fftSize; k++) {
    // The imaginary part should be near-zero after liftering a symmetric cepstrum,
    // but we take the real part only for the log-magnitude envelope.
    envelope[k] = Math.exp(cepstralData[k * 2]);
  }

  return envelope;
}

/**
 * Shift a spectral envelope by a given number of semitones.
 *
 * This implements the "natural formant scaling" mode where formants
 * partially follow the pitch shift. A shift of `semitones` moves
 * each frequency bin by the corresponding ratio.
 *
 * @param envelope - Original spectral envelope (length = fftSize)
 * @param semitones - Amount to shift in semitones (positive = up)
 * @param fftSize - FFT size
 * @returns Shifted spectral envelope
 */
function shiftEnvelope(
  envelope: Float64Array,
  semitones: number,
  fftSize: number,
): Float64Array {
  if (Math.abs(semitones) < 0.01) {
    // No meaningful shift, return a copy
    return new Float64Array(envelope);
  }

  const ratio = Math.pow(2, semitones / 12);
  const shifted = new Float64Array(fftSize);

  // Only process up to Nyquist (fftSize/2 + 1), mirror the rest
  const halfN = fftSize / 2;

  for (let k = 0; k <= halfN; k++) {
    // The source frequency bin for this target bin
    const sourceK = k / ratio;
    const kLow = Math.floor(sourceK);
    const kHigh = kLow + 1;
    const frac = sourceK - kLow;

    if (kLow >= 0 && kHigh <= halfN) {
      // Linear interpolation between adjacent bins
      shifted[k] = envelope[kLow] * (1 - frac) + envelope[kHigh] * frac;
    } else if (kLow >= 0 && kLow <= halfN) {
      shifted[k] = envelope[kLow];
    } else {
      // Out of range: use the nearest edge value
      shifted[k] = envelope[Math.max(0, Math.min(halfN, Math.round(sourceK)))];
    }
  }

  // Mirror for negative frequencies
  for (let k = halfN + 1; k < fftSize; k++) {
    shifted[k] = shifted[fftSize - k];
  }

  return shifted;
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Apply formant preservation to PSOLA-shifted audio.
 *
 * Takes the original (unshifted) audio and the PSOLA-shifted result,
 * extracts spectral envelopes from both using cepstral analysis, and
 * applies a correction filter to the shifted audio so its formants
 * match the original.
 *
 * The processing uses an overlap-add STFT framework:
 * 1. Window the shifted audio into overlapping frames (Hann window)
 * 2. For each frame, compute FFT and extract cepstral spectral envelope
 * 3. Find the corresponding frame in the original audio
 * 4. Compute the correction: originalEnvelope / shiftedEnvelope
 * 5. Apply correction to the shifted spectrum
 * 6. IFFT and overlap-add to reconstruct the output
 *
 * @param original - Original audio samples (Float32Array)
 * @param shifted - PSOLA-shifted audio samples (Float32Array)
 * @param sampleRate - Sample rate in Hz
 * @param pitchShift - Applied pitch shift in semitones
 * @param options - Cepstral analysis options
 * @returns Formant-corrected audio samples (Float32Array)
 */
export function applyFormantPreservation(
  original: Float32Array,
  shifted: Float32Array,
  sampleRate: number,
  pitchShift: number,
  options?: CepstralOptions,
): Float32Array {
  const fftSize = options?.fftSize ?? 2048;
  const hopSize = options?.hopSize ?? (fftSize / 4);
  const lifterOrder = options?.lifterOrder ?? Math.round(sampleRate / 1000);
  const formantScale = options?.formantScale ?? 0.0;

  // If formantScale is 1.0, no correction is needed (formants follow pitch fully)
  if (formantScale >= 1.0) {
    return new Float32Array(shifted);
  }

  const outputLength = shifted.length;
  const output = new Float64Array(outputLength);
  const windowSum = new Float64Array(outputLength);

  // Get the analysis window
  const hannWin = getHannWindow(fftSize);

  // Buffers for FFT (reused across frames to reduce allocation)
  const shiftedFFT = new Float64Array(fftSize * 2);
  const originalFFT = new Float64Array(fftSize * 2);

  // The formant shift for natural scaling mode:
  // If formantScale > 0, we shift the original envelope by
  // pitchShift * formantScale semitones before computing the correction.
  // This allows formants to partially follow the pitch shift.
  const envelopeShiftSemitones = formantScale > 0 ? pitchShift * formantScale : 0;

  // Number of frames
  const numFrames = Math.ceil((outputLength - fftSize) / hopSize) + 1;

  for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
    const frameStart = frameIdx * hopSize;

    // --- Shifted frame: window, FFT, extract envelope ---
    // Zero the FFT buffer
    shiftedFFT.fill(0);
    for (let i = 0; i < fftSize; i++) {
      const sampleIdx = frameStart + i;
      if (sampleIdx < outputLength) {
        shiftedFFT[i * 2] = shifted[sampleIdx] * hannWin[i];
      }
      // Imaginary part stays 0
    }

    // Copy for envelope extraction (FFT modifies in place)
    const shiftedFFTCopy = new Float64Array(shiftedFFT);
    fft(shiftedFFTCopy, false);
    const shiftedEnvelope = extractSpectralEnvelope(shiftedFFTCopy, fftSize, lifterOrder);

    // --- Original frame: window, FFT, extract envelope ---
    // Map the shifted frame position back to the original audio.
    // PSOLA with timeStretch=1.0 preserves duration, so positions align directly.
    // For time-stretched audio, the mapping would need adjustment.
    const origFrameStart = frameStart;

    originalFFT.fill(0);
    for (let i = 0; i < fftSize; i++) {
      const sampleIdx = origFrameStart + i;
      if (sampleIdx >= 0 && sampleIdx < original.length) {
        originalFFT[i * 2] = original[sampleIdx] * hannWin[i];
      }
    }

    const originalFFTCopy = new Float64Array(originalFFT);
    fft(originalFFTCopy, false);
    let originalEnvelope = extractSpectralEnvelope(originalFFTCopy, fftSize, lifterOrder);

    // --- Apply natural formant scaling if requested ---
    if (envelopeShiftSemitones !== 0) {
      originalEnvelope = shiftEnvelope(originalEnvelope, envelopeShiftSemitones, fftSize);
    }

    // --- Compute and apply the correction filter ---
    // FFT the actual shifted frame (not the copy used for envelope)
    fft(shiftedFFT, false);

    for (let k = 0; k < fftSize; k++) {
      // Correction = originalEnvelope / shiftedEnvelope
      let correctionGain = originalEnvelope[k] / (shiftedEnvelope[k] + EPSILON);

      // Clamp to prevent extreme amplification or attenuation
      correctionGain = Math.max(MIN_CORRECTION_GAIN, Math.min(MAX_CORRECTION_GAIN, correctionGain));

      // Apply correction to both real and imaginary parts (scales magnitude, preserves phase)
      shiftedFFT[k * 2] *= correctionGain;
      shiftedFFT[k * 2 + 1] *= correctionGain;
    }

    // --- IFFT back to time domain ---
    fft(shiftedFFT, true);

    // --- Overlap-add to output ---
    for (let i = 0; i < fftSize; i++) {
      const sampleIdx = frameStart + i;
      if (sampleIdx < outputLength) {
        output[sampleIdx] += shiftedFFT[i * 2] * hannWin[i];
        windowSum[sampleIdx] += hannWin[i] * hannWin[i];
      }
    }
  }

  // Normalize by window sum to compensate for overlapping windows
  const result = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    if (windowSum[i] > 1e-6) {
      result[i] = output[i] / windowSum[i];
    } else {
      // Fallback: use shifted audio directly where no windows overlap
      result[i] = shifted[i];
    }
  }

  return result;
}
