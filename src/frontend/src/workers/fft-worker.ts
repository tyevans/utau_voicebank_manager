/**
 * FFT Web Worker for spectrogram computation.
 *
 * Performs expensive FFT calculations off the main thread to keep
 * the UI responsive during audio analysis.
 *
 * @example
 * ```typescript
 * import FFTWorker from './workers/fft-worker?worker';
 *
 * const worker = new FFTWorker();
 * worker.postMessage({
 *   channelData: audioBuffer.getChannelData(0),
 *   sampleRate: audioBuffer.sampleRate,
 *   fftSize: 2048,
 *   maxFreq: 8000,
 * });
 *
 * worker.onmessage = (e) => {
 *   const { spectrogramData, numBins } = e.data;
 *   // Use spectrogramData for rendering
 * };
 * ```
 */

import { fftSplit as fft } from '../utils/fft.js';

export interface FFTWorkerInput {
  channelData: Float32Array;
  sampleRate: number;
  fftSize?: number;
  maxFreq?: number;
}

export interface FFTWorkerOutput {
  spectrogramData: Float32Array[];
  numBins: number;
  numFrames: number;
}

export interface FFTWorkerError {
  error: string;
}

/**
 * Compute spectrogram data from audio channel data.
 * Returns normalized magnitudes (0-1) for each time frame.
 */
function computeSpectrogram(
  channelData: Float32Array,
  sampleRate: number,
  fftSize: number,
  maxFreq: number
): FFTWorkerOutput | null {
  const hopSize = Math.floor(fftSize / 4); // 75% overlap

  // Number of frequency bins we care about (up to maxFreq for voice)
  const nyquist = sampleRate / 2;
  const numBins = Math.min(
    fftSize / 2,
    Math.floor((maxFreq / nyquist) * (fftSize / 2))
  );

  // Number of time frames (include partial final frames; they get zero-padded)
  const numFrames = Math.max(0, Math.ceil(channelData.length / hopSize));

  if (numFrames <= 0) {
    return null;
  }

  // Pre-compute Hanning window
  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  // Compute FFT for each frame
  const spectrogramData: Float32Array[] = [];

  for (let frame = 0; frame < numFrames; frame++) {
    const startSample = frame * hopSize;

    // Extract and window the frame (zero-pad if frame extends past buffer)
    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);
    const frameSamples = Math.min(fftSize, channelData.length - startSample);

    for (let i = 0; i < frameSamples; i++) {
      real[i] = channelData[startSample + i] * window[i];
    }
    // Remaining samples (frameSamples..fftSize) are already zero from Float32Array init

    // In-place FFT
    fft(real, imag);

    // Compute magnitude spectrum (only positive frequencies)
    const magnitudes = new Float32Array(numBins);
    for (let i = 0; i < numBins; i++) {
      const mag = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
      // Convert to dB scale with some normalization
      magnitudes[i] = 20 * Math.log10(Math.max(mag, 1e-10));
    }

    spectrogramData.push(magnitudes);
  }

  // Normalize spectrogram data to 0-1 range
  let minVal = Infinity;
  let maxVal = -Infinity;

  for (const frame of spectrogramData) {
    for (let i = 0; i < frame.length; i++) {
      if (frame[i] < minVal) minVal = frame[i];
      if (frame[i] > maxVal) maxVal = frame[i];
    }
  }

  const range = maxVal - minVal || 1;

  for (const frame of spectrogramData) {
    for (let i = 0; i < frame.length; i++) {
      frame[i] = (frame[i] - minVal) / range;
    }
  }

  return { spectrogramData, numBins, numFrames };
}

// Worker message handler
self.onmessage = (e: MessageEvent<FFTWorkerInput>) => {
  try {
    const { channelData, sampleRate, fftSize = 2048, maxFreq = 8000 } = e.data;

    const result = computeSpectrogram(channelData, sampleRate, fftSize, maxFreq);

    if (result) {
      self.postMessage(result);
    } else {
      self.postMessage({ error: 'Not enough audio data for spectrogram' } as FFTWorkerError);
    }
  } catch (err) {
    self.postMessage({
      error: err instanceof Error ? err.message : 'Unknown error in FFT worker',
    } as FFTWorkerError);
  }
};

// Export empty object for TypeScript module compatibility
export {};
