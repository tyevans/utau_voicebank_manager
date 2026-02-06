/**
 * Formant Frequency Tracker for Spectral Envelope Visualization.
 *
 * Performs frame-by-frame analysis of audio to extract formant frequencies
 * (F1, F2, F3) using cepstral spectral envelope estimation and peak picking.
 *
 * Algorithm per frame:
 *   1. Window the frame with a Hann window
 *   2. Compute FFT to get the complex spectrum
 *   3. Compute log magnitude spectrum
 *   4. IFFT to get the cepstrum (real cepstrum)
 *   5. Low-pass lifter: keep only first N cepstral coefficients
 *   6. FFT of liftered cepstrum -> smooth spectral envelope
 *   7. Find peaks in the spectral envelope -> formant frequencies
 *
 * The lifter order controls envelope smoothness: ~sampleRate/1000 is standard
 * for speech (captures vocal tract resonances without harmonic structure).
 *
 * @module formant-tracker
 */

import { fftInterleaved as fft } from './fft.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A single frame of formant analysis results.
 */
export interface FormantFrame {
  /** Time position of this frame in seconds. */
  timeSeconds: number;
  /** First formant frequency in Hz (typically 200-900 Hz for vowels). */
  f1: number;
  /** Second formant frequency in Hz (typically 700-2500 Hz for vowels). */
  f2: number;
  /** Third formant frequency in Hz (typically 1800-3500 Hz for vowels). */
  f3: number;
  /** Confidence/amplitude of F1 peak (0-1 normalized). */
  f1Confidence: number;
  /** Confidence/amplitude of F2 peak (0-1 normalized). */
  f2Confidence: number;
  /** Confidence/amplitude of F3 peak (0-1 normalized). */
  f3Confidence: number;
}

/**
 * Complete formant analysis result for an audio buffer.
 */
export interface FormantAnalysis {
  /** Array of formant frames, one per analysis hop. */
  frames: FormantFrame[];
  /** Sample rate of the analyzed audio. */
  sampleRate: number;
  /** FFT size used for analysis. */
  fftSize: number;
  /** Hop size between frames in samples. */
  hopSize: number;
  /** Total audio duration in seconds. */
  durationSeconds: number;
}

/**
 * Options for formant tracking.
 */
export interface FormantTrackingOptions {
  /** FFT size for analysis (default: 2048). Must be power of 2. */
  fftSize?: number;
  /** Hop size between frames in samples (default: ~10ms worth of samples). */
  hopSize?: number;
  /** Number of low-quefrency cepstral coefficients to keep (default: sampleRate/1000). */
  lifterOrder?: number;
  /** Minimum frequency to consider for F1 in Hz (default: 150). */
  f1MinHz?: number;
  /** Maximum frequency to consider for F1 in Hz (default: 900). */
  f1MaxHz?: number;
  /** Minimum frequency to consider for F2 in Hz (default: 700). */
  f2MinHz?: number;
  /** Maximum frequency to consider for F2 in Hz (default: 2800). */
  f2MaxHz?: number;
  /** Minimum frequency to consider for F3 in Hz (default: 1800). */
  f3MinHz?: number;
  /** Maximum frequency to consider for F3 in Hz (default: 4000). */
  f3MaxHz?: number;
  /**
   * Maximum frequency displayed in the spectrogram (default: 8000).
   * Used to clamp formant frequencies to the visible range.
   */
  maxDisplayFreq?: number;
  /**
   * Minimum RMS energy threshold to consider a frame voiced (default: 0.005).
   * Frames below this threshold will have formants set to 0 (unvoiced).
   */
  energyThreshold?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Small constant to avoid log(0). */
const EPSILON = 1e-10;

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
// Spectral envelope extraction (cepstral method)
// ---------------------------------------------------------------------------

/**
 * Extract the smooth spectral envelope from a windowed frame using cepstral analysis.
 *
 * Returns the log-magnitude spectral envelope for the positive frequency bins
 * (0 to fftSize/2). The envelope captures vocal tract resonances (formants)
 * while suppressing harmonic fine structure.
 *
 * @param windowedFrame - Time-domain samples already multiplied by a window function
 * @param fftSize - FFT size (must be power of 2, same as windowedFrame.length)
 * @param lifterOrder - Number of low-quefrency cepstral coefficients to retain
 * @returns Log-magnitude spectral envelope array of length fftSize/2 + 1
 */
function extractEnvelope(
  windowedFrame: Float64Array,
  fftSize: number,
  lifterOrder: number,
): Float64Array {
  // Pack windowed frame into interleaved complex format
  const data = new Float64Array(fftSize * 2);
  for (let i = 0; i < fftSize; i++) {
    data[i * 2] = windowedFrame[i];
    data[i * 2 + 1] = 0;
  }

  // Step 1: Forward FFT
  fft(data, false);

  // Step 2: Log magnitude spectrum -> store in interleaved format for IFFT
  const logMag = new Float64Array(fftSize * 2);
  for (let k = 0; k < fftSize; k++) {
    const re = data[k * 2];
    const im = data[k * 2 + 1];
    const mag = Math.sqrt(re * re + im * im) + EPSILON;
    logMag[k * 2] = Math.log(mag);
    logMag[k * 2 + 1] = 0;
  }

  // Step 3: IFFT to get cepstrum
  fft(logMag, true);

  // Step 4: Low-pass lifter with smooth taper
  const taperWidth = Math.min(4, Math.floor(lifterOrder / 2));

  for (let k = 0; k < fftSize; k++) {
    let gain: number;

    if (k <= lifterOrder - taperWidth) {
      gain = 1.0;
    } else if (k <= lifterOrder) {
      const t = (k - (lifterOrder - taperWidth)) / taperWidth;
      gain = 0.5 * (1 + Math.cos(Math.PI * t));
    } else if (k >= fftSize - lifterOrder) {
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
      gain = 0.0;
    }

    logMag[k * 2] *= gain;
    logMag[k * 2 + 1] *= gain;
  }

  // Step 5: FFT of liftered cepstrum -> log spectral envelope
  fft(logMag, false);

  // Step 6: Extract the log-magnitude envelope for positive frequencies
  const halfPlus1 = (fftSize >> 1) + 1;
  const envelope = new Float64Array(halfPlus1);
  for (let k = 0; k < halfPlus1; k++) {
    // Real part is the log magnitude envelope; imaginary should be near-zero
    envelope[k] = logMag[k * 2];
  }

  return envelope;
}

// ---------------------------------------------------------------------------
// Peak picking for formant detection
// ---------------------------------------------------------------------------

/**
 * Detected peak in the spectral envelope.
 */
interface EnvelopePeak {
  /** Frequency bin index of the peak. */
  bin: number;
  /** Frequency in Hz. */
  frequencyHz: number;
  /** Log-magnitude amplitude at the peak. */
  amplitude: number;
}

/**
 * Find peaks (local maxima) in the spectral envelope within a frequency range.
 *
 * A peak is defined as a bin whose envelope value is greater than both its
 * neighbors. Peaks are returned sorted by amplitude (strongest first).
 *
 * @param envelope - Log-magnitude spectral envelope
 * @param sampleRate - Audio sample rate
 * @param fftSize - FFT size
 * @param minHz - Minimum frequency to search
 * @param maxHz - Maximum frequency to search
 * @returns Array of detected peaks sorted by amplitude descending
 */
function findPeaks(
  envelope: Float64Array,
  sampleRate: number,
  fftSize: number,
  minHz: number,
  maxHz: number,
): EnvelopePeak[] {
  const binWidth = sampleRate / fftSize;
  const minBin = Math.max(1, Math.floor(minHz / binWidth));
  const maxBin = Math.min(envelope.length - 2, Math.ceil(maxHz / binWidth));

  const peaks: EnvelopePeak[] = [];

  for (let k = minBin; k <= maxBin; k++) {
    if (envelope[k] > envelope[k - 1] && envelope[k] > envelope[k + 1]) {
      // Parabolic interpolation for sub-bin accuracy
      const alpha = envelope[k - 1];
      const beta = envelope[k];
      const gamma = envelope[k + 1];
      const denominator = alpha - 2 * beta + gamma;

      let peakBin = k;
      if (Math.abs(denominator) > EPSILON) {
        const offset = 0.5 * (alpha - gamma) / denominator;
        peakBin = k + Math.max(-0.5, Math.min(0.5, offset));
      }

      peaks.push({
        bin: peakBin,
        frequencyHz: peakBin * binWidth,
        amplitude: beta,
      });
    }
  }

  // Sort by amplitude descending
  peaks.sort((a, b) => b.amplitude - a.amplitude);

  return peaks;
}

/**
 * Compute RMS energy of a frame (for voicing detection).
 */
function computeFrameRms(frame: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    sum += frame[i] * frame[i];
  }
  return Math.sqrt(sum / frame.length);
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Analyze formant frequencies across an audio buffer.
 *
 * Performs frame-by-frame cepstral analysis to extract the spectral envelope,
 * then picks peaks in the envelope corresponding to F1, F2, and F3 formants.
 *
 * The analysis is designed for voice/singing audio typical of UTAU voicebanks.
 * Unvoiced frames (below the energy threshold) will have formant values of 0.
 *
 * @param channelData - Mono audio samples (Float32Array from AudioBuffer.getChannelData)
 * @param sampleRate - Audio sample rate in Hz
 * @param options - Analysis options
 * @returns FormantAnalysis containing per-frame formant frequencies
 *
 * @example
 * ```typescript
 * const analysis = analyzeFormants(
 *   audioBuffer.getChannelData(0),
 *   audioBuffer.sampleRate,
 *   { fftSize: 2048 }
 * );
 * for (const frame of analysis.frames) {
 *   console.log(`t=${frame.timeSeconds.toFixed(3)}s F1=${frame.f1}Hz F2=${frame.f2}Hz F3=${frame.f3}Hz`);
 * }
 * ```
 */
export function analyzeFormants(
  channelData: Float32Array,
  sampleRate: number,
  options?: FormantTrackingOptions,
): FormantAnalysis {
  const fftSize = options?.fftSize ?? 2048;
  // Default hop size: ~10ms
  const hopSize = options?.hopSize ?? Math.round(sampleRate * 0.01);
  const lifterOrder = options?.lifterOrder ?? Math.round(sampleRate / 1000);
  const maxDisplayFreq = options?.maxDisplayFreq ?? 8000;
  const energyThreshold = options?.energyThreshold ?? 0.005;

  // Formant frequency search ranges
  const f1MinHz = options?.f1MinHz ?? 150;
  const f1MaxHz = options?.f1MaxHz ?? 900;
  const f2MinHz = options?.f2MinHz ?? 700;
  const f2MaxHz = options?.f2MaxHz ?? 2800;
  const f3MinHz = options?.f3MinHz ?? 1800;
  const f3MaxHz = options?.f3MaxHz ?? 4000;

  const hannWin = getHannWindow(fftSize);
  const numFrames = Math.max(0, Math.floor((channelData.length - fftSize) / hopSize) + 1);

  const frames: FormantFrame[] = [];
  const durationSeconds = channelData.length / sampleRate;

  // Track the maximum envelope amplitude across all frames for confidence normalization
  let globalMaxAmplitude = -Infinity;

  // First pass: compute envelopes and find peaks
  interface RawFrame {
    timeSeconds: number;
    f1Peak: EnvelopePeak | null;
    f2Peak: EnvelopePeak | null;
    f3Peak: EnvelopePeak | null;
    voiced: boolean;
  }

  const rawFrames: RawFrame[] = [];

  for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
    const startSample = frameIdx * hopSize;
    const timeSeconds = (startSample + fftSize / 2) / sampleRate;

    // Extract and window the frame
    const windowedFrame = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      windowedFrame[i] = channelData[startSample + i] * hannWin[i];
    }

    // Check if frame has sufficient energy (voicing detection)
    const rms = computeFrameRms(windowedFrame);
    if (rms < energyThreshold) {
      rawFrames.push({
        timeSeconds,
        f1Peak: null,
        f2Peak: null,
        f3Peak: null,
        voiced: false,
      });
      continue;
    }

    // Extract spectral envelope
    const envelope = extractEnvelope(windowedFrame, fftSize, lifterOrder);

    // Find formant peaks in their respective frequency ranges
    const f1Peaks = findPeaks(envelope, sampleRate, fftSize, f1MinHz, f1MaxHz);
    const f2Peaks = findPeaks(envelope, sampleRate, fftSize, f2MinHz, f2MaxHz);
    const f3Peaks = findPeaks(envelope, sampleRate, fftSize, f3MinHz, f3MaxHz);

    // Select the strongest peak in each range
    const f1Peak = f1Peaks.length > 0 ? f1Peaks[0] : null;
    const f2Peak = f2Peaks.length > 0 ? f2Peaks[0] : null;
    const f3Peak = f3Peaks.length > 0 ? f3Peaks[0] : null;

    // Track global max amplitude for normalization
    if (f1Peak && f1Peak.amplitude > globalMaxAmplitude) globalMaxAmplitude = f1Peak.amplitude;
    if (f2Peak && f2Peak.amplitude > globalMaxAmplitude) globalMaxAmplitude = f2Peak.amplitude;
    if (f3Peak && f3Peak.amplitude > globalMaxAmplitude) globalMaxAmplitude = f3Peak.amplitude;

    rawFrames.push({
      timeSeconds,
      f1Peak,
      f2Peak,
      f3Peak,
      voiced: true,
    });
  }

  // Second pass: build output frames with normalized confidence values
  const amplitudeRange = globalMaxAmplitude > -Infinity ? globalMaxAmplitude : 1;

  for (const raw of rawFrames) {
    if (!raw.voiced) {
      frames.push({
        timeSeconds: raw.timeSeconds,
        f1: 0,
        f2: 0,
        f3: 0,
        f1Confidence: 0,
        f2Confidence: 0,
        f3Confidence: 0,
      });
      continue;
    }

    // Clamp frequencies to the display range
    const clamp = (hz: number) => Math.min(hz, maxDisplayFreq);

    frames.push({
      timeSeconds: raw.timeSeconds,
      f1: raw.f1Peak ? clamp(raw.f1Peak.frequencyHz) : 0,
      f2: raw.f2Peak ? clamp(raw.f2Peak.frequencyHz) : 0,
      f3: raw.f3Peak ? clamp(raw.f3Peak.frequencyHz) : 0,
      f1Confidence: raw.f1Peak
        ? Math.max(0, Math.min(1, raw.f1Peak.amplitude / amplitudeRange))
        : 0,
      f2Confidence: raw.f2Peak
        ? Math.max(0, Math.min(1, raw.f2Peak.amplitude / amplitudeRange))
        : 0,
      f3Confidence: raw.f3Peak
        ? Math.max(0, Math.min(1, raw.f3Peak.amplitude / amplitudeRange))
        : 0,
    });
  }

  return {
    frames,
    sampleRate,
    fftSize,
    hopSize,
    durationSeconds,
  };
}
