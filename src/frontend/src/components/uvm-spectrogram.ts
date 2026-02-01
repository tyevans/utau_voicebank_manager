/**
 * Spectrogram visualization component.
 *
 * Computes and renders an FFT spectrogram of audio data using a white-to-blue
 * color gradient. Low frequencies are displayed at the bottom.
 *
 * FFT computation is performed in a Web Worker to avoid blocking the main thread.
 * Falls back to synchronous computation if workers are unavailable.
 *
 * @example
 * ```html
 * <uvm-spectrogram
 *   .audioBuffer=${this._audioBuffer}
 *   .width=${800}
 *   .height=${270}
 *   .zoom=${1}
 * ></uvm-spectrogram>
 * ```
 */
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { query } from 'lit/decorators/query.js';

import type { FFTWorkerOutput, FFTWorkerError } from '../workers/fft-worker.js';

// Import worker with Vite's ?worker suffix for proper bundling
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - Vite handles ?worker imports specially
import FFTWorkerModule from '../workers/fft-worker.js?worker';

@customElement('uvm-spectrogram')
export class UvmSpectrogram extends LitElement {
  static styles = css`
    :host {
      display: block;
      overflow: hidden;
    }

    canvas {
      display: block;
    }
  `;

  /** Audio buffer to visualize. Recomputes spectrogram when changed. */
  @property({ attribute: false })
  audioBuffer: AudioBuffer | null = null;

  /** Width of the canvas in CSS pixels. */
  @property({ type: Number })
  width = 800;

  /** Height of the canvas in CSS pixels. */
  @property({ type: Number })
  height = 270;

  /** Zoom factor for horizontal scaling. */
  @property({ type: Number })
  zoom = 1;

  /**
   * Theme mode for the spectrogram display.
   * - 'light': White to blue gradient (default)
   * - 'dark': Dark purple to cyan gradient for better visibility
   */
  @property({ type: String })
  theme: 'light' | 'dark' = 'light';

  /** Computed spectrogram data (normalized 0-1 magnitudes per frame). */
  @state()
  private _spectrogramData: Float32Array[] | null = null;

  /** Reference to the canvas element. */
  @query('canvas')
  private _canvas!: HTMLCanvasElement;

  /** Track pending animation frame for rendering. */
  private _animationFrameId: number | null = null;

  /** Previous audioBuffer reference for change detection. */
  private _prevAudioBuffer: AudioBuffer | null = null;

  /** Web Worker instance for FFT computation. */
  private _worker: Worker | null = null;

  /** Whether worker is currently computing. */
  @state()
  private _computing = false;

  /** Throttle timer for rapid property changes. */
  private _throttleTimer: number | null = null;

  /** Throttle delay in milliseconds. */
  private readonly _throttleDelay = 16; // ~60fps

  override connectedCallback(): void {
    super.connectedCallback();
    this._initWorker();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._cleanupWorker();
    if (this._animationFrameId !== null) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }
    if (this._throttleTimer !== null) {
      clearTimeout(this._throttleTimer);
      this._throttleTimer = null;
    }
  }

  /**
   * Initialize the Web Worker for FFT computation.
   */
  private _initWorker(): void {
    if (this._worker) return;

    try {
      // FFTWorkerModule is a Worker constructor when using Vite's ?worker import
      if (typeof FFTWorkerModule === 'function') {
        this._worker = new FFTWorkerModule();
        this._worker.onmessage = this._onWorkerMessage.bind(this);
        this._worker.onerror = this._onWorkerError.bind(this);
      }
    } catch (err) {
      console.warn('Failed to initialize FFT worker, using synchronous fallback:', err);
      this._worker = null;
    }
  }

  /**
   * Clean up the Web Worker.
   */
  private _cleanupWorker(): void {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
  }

  /**
   * Handle message from Web Worker with computed spectrogram data.
   */
  private _onWorkerMessage(e: MessageEvent<FFTWorkerOutput | FFTWorkerError>): void {
    this._computing = false;

    if ('error' in e.data) {
      console.warn('FFT worker error:', e.data.error);
      this._spectrogramData = null;
      return;
    }

    this._spectrogramData = e.data.spectrogramData;
    this._scheduleRedraw();
  }

  /**
   * Handle Web Worker error.
   */
  private _onWorkerError(e: ErrorEvent): void {
    console.error('FFT worker error:', e.message);
    this._computing = false;
    // Fall back to synchronous computation
    this._computeSpectrogramSync();
    this._scheduleRedraw();
  }

  override updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties);

    // Recompute spectrogram when audioBuffer changes
    if (changedProperties.has('audioBuffer')) {
      if (this.audioBuffer !== this._prevAudioBuffer) {
        this._prevAudioBuffer = this.audioBuffer;
        this._computeSpectrogram();
        this._scheduleRedraw();
      }
    }

    // Immediate redraw for theme changes
    if (changedProperties.has('theme')) {
      this._scheduleRedraw();
    }

    // Throttle redraws when dimensions or zoom change rapidly
    if (
      changedProperties.has('width') ||
      changedProperties.has('height') ||
      changedProperties.has('zoom')
    ) {
      this._scheduleThrottledRedraw();
    }
  }

  override render() {
    return html`<canvas></canvas>`;
  }

  /**
   * Schedule a throttled redraw for rapid property changes (zoom/pan).
   * Prevents excessive renders during continuous interactions.
   */
  private _scheduleThrottledRedraw(): void {
    if (this._throttleTimer !== null) {
      return; // Already scheduled
    }

    this._throttleTimer = window.setTimeout(() => {
      this._throttleTimer = null;
      this._scheduleRedraw();
    }, this._throttleDelay);
  }

  /**
   * Schedule a redraw using requestAnimationFrame.
   * Coalesces multiple redraw requests into a single frame.
   */
  private _scheduleRedraw(): void {
    if (this._animationFrameId !== null) {
      return; // Already scheduled
    }

    this._animationFrameId = requestAnimationFrame(() => {
      this._animationFrameId = null;
      this._drawSpectrogram();
    });
  }

  /**
   * Get spectrogram color based on theme and intensity.
   *
   * Light mode: White to blue gradient
   * - t=0 -> white (255, 255, 255)
   * - t=1 -> blue (59, 130, 246) - matches waveform color
   *
   * Dark mode: Dark purple to cyan gradient
   * - t=0 -> dark purple (15, 23, 42) - near background
   * - t=1 -> cyan (103, 232, 249) - matches dark mode waveform
   */
  private _spectrogramColor(t: number): string {
    // Clamp to [0, 1]
    t = Math.max(0, Math.min(1, t));

    if (this.theme === 'dark') {
      // Dark mode: dark purple to cyan gradient
      // Low: rgb(15, 23, 42) - slate-900
      // Mid: rgb(88, 28, 135) - purple-800
      // High: rgb(103, 232, 249) - cyan-300

      if (t < 0.5) {
        // Dark purple to purple transition
        const t2 = t * 2;
        const r = Math.round(15 + t2 * (88 - 15));
        const g = Math.round(23 + t2 * (28 - 23));
        const b = Math.round(42 + t2 * (135 - 42));
        return `rgb(${r},${g},${b})`;
      } else {
        // Purple to cyan transition
        const t2 = (t - 0.5) * 2;
        const r = Math.round(88 + t2 * (103 - 88));
        const g = Math.round(28 + t2 * (232 - 28));
        const b = Math.round(135 + t2 * (249 - 135));
        return `rgb(${r},${g},${b})`;
      }
    } else {
      // Light mode: White to blue gradient matching waveform
      const r = Math.round(255 - t * (255 - 59));
      const g = Math.round(255 - t * (255 - 130));
      const b = Math.round(255 - t * (255 - 246));
      return `rgb(${r},${g},${b})`;
    }
  }

  /**
   * Compute spectrogram data from audio buffer.
   * Uses Web Worker if available, otherwise falls back to synchronous computation.
   */
  private _computeSpectrogram(): void {
    if (!this.audioBuffer) {
      this._spectrogramData = null;
      return;
    }

    // Use worker if available
    if (this._worker && !this._computing) {
      this._computing = true;
      const channelData = this.audioBuffer.getChannelData(0);

      // Post message to worker (transfer not possible with getChannelData result)
      this._worker.postMessage({
        channelData: channelData,
        sampleRate: this.audioBuffer.sampleRate,
        fftSize: 2048,
        maxFreq: 8000,
      });
      return;
    }

    // Fallback to synchronous computation
    this._computeSpectrogramSync();
  }

  /**
   * Synchronous spectrogram computation (fallback when worker unavailable).
   */
  private _computeSpectrogramSync(): void {
    if (!this.audioBuffer) {
      this._spectrogramData = null;
      return;
    }

    const channelData = this.audioBuffer.getChannelData(0);
    const sampleRate = this.audioBuffer.sampleRate;
    const fftSize = 2048;
    const hopSize = Math.floor(fftSize / 4); // 75% overlap

    // Number of frequency bins we care about (up to ~8kHz for voice)
    const maxFreq = 8000;
    const nyquist = sampleRate / 2;
    const numBins = Math.min(
      fftSize / 2,
      Math.floor((maxFreq / nyquist) * (fftSize / 2))
    );

    // Number of time frames
    const numFrames = Math.floor((channelData.length - fftSize) / hopSize) + 1;

    if (numFrames <= 0) {
      this._spectrogramData = null;
      return;
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

      // Extract and window the frame
      const real = new Float32Array(fftSize);
      const imag = new Float32Array(fftSize);

      for (let i = 0; i < fftSize; i++) {
        real[i] = channelData[startSample + i] * window[i];
        imag[i] = 0;
      }

      // In-place FFT
      this._fft(real, imag);

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

    this._spectrogramData = spectrogramData;
  }

  /**
   * Simple in-place Cooley-Tukey FFT implementation.
   * Operates on real and imaginary arrays of power-of-2 length.
   */
  private _fft(real: Float32Array, imag: Float32Array): void {
    const n = real.length;

    if (n <= 1) return;

    // Bit-reversal permutation
    let j = 0;
    for (let i = 0; i < n - 1; i++) {
      if (i < j) {
        // Swap real[i] and real[j]
        let temp = real[i];
        real[i] = real[j];
        real[j] = temp;
        // Swap imag[i] and imag[j]
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

  /**
   * Draw the spectrogram visualization.
   * Uses power curve and noise floor for better visual contrast.
   */
  private _drawSpectrogram(): void {
    if (!this._canvas) return;

    const ctx = this._canvas.getContext('2d');
    if (!ctx) return;

    // Apply zoom to width
    const width = this.width * this.zoom;
    const height = this.height;
    const dpr = window.devicePixelRatio || 1;

    // Set canvas size with device pixel ratio
    this._canvas.width = width * dpr;
    this._canvas.height = height * dpr;
    this._canvas.style.width = `${width}px`;
    this._canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Fill with white background (low intensity = white)
    ctx.fillStyle = this._spectrogramColor(0);
    ctx.fillRect(0, 0, width, height);

    if (!this._spectrogramData || this._spectrogramData.length === 0) {
      return;
    }

    const numFrames = this._spectrogramData.length;
    const numBins = this._spectrogramData[0].length;

    // Calculate pixel dimensions for each cell
    const cellWidth = width / numFrames;
    const cellHeight = height / numBins;

    // Noise floor threshold - values below this map to darkest color
    const noiseFloor = 0.15;
    // Power curve exponent - lower values boost mid-range visibility
    const powerCurve = 0.45;

    // Draw spectrogram cells
    for (let frame = 0; frame < numFrames; frame++) {
      const x = frame * cellWidth;
      const frameData = this._spectrogramData[frame];

      for (let bin = 0; bin < numBins; bin++) {
        // Flip y-axis so low frequencies are at bottom
        const y = height - (bin + 1) * cellHeight;
        let value = frameData[bin];

        // Apply noise floor cutoff
        if (value < noiseFloor) {
          value = 0;
        } else {
          // Rescale above noise floor to 0-1 range
          value = (value - noiseFloor) / (1 - noiseFloor);
          // Apply power curve to boost mid-range values (sqrt-like effect)
          value = Math.pow(value, powerCurve);
        }

        ctx.fillStyle = this._spectrogramColor(value);
        ctx.fillRect(x, y, Math.ceil(cellWidth), Math.ceil(cellHeight));
      }
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-spectrogram': UvmSpectrogram;
  }
}
