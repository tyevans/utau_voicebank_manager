import { LitElement, html, css } from 'lit';
import type { PropertyValues } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';

/**
 * Marker configuration for oto.ini parameters.
 */
interface MarkerConfig {
  name: string;
  color: string;
  label: string;
  hint: string;
  icon: string;
}

/**
 * Marker configurations for all oto.ini parameters.
 * Each marker includes a human-readable hint explaining its purpose.
 */
const MARKER_CONFIGS: Record<string, MarkerConfig> = {
  offset: {
    name: 'offset',
    color: '#22c55e',
    label: 'Offset',
    hint: 'Start point',
    icon: 'O',
  },
  consonant: {
    name: 'consonant',
    color: '#3b82f6',
    label: 'Consonant',
    hint: 'Fixed region end',
    icon: 'C',
  },
  cutoff: {
    name: 'cutoff',
    color: '#ef4444',
    label: 'Cutoff',
    hint: 'End point',
    icon: 'X',
  },
  preutterance: {
    name: 'preutterance',
    color: '#a855f7',
    label: 'Preutterance',
    hint: 'Note timing',
    icon: 'P',
  },
  overlap: {
    name: 'overlap',
    color: '#f97316',
    label: 'Overlap',
    hint: 'Crossfade',
    icon: 'V',
  },
};

/**
 * Waveform editor component for UTAU voicebank editing.
 *
 * Renders audio waveform using Canvas and Web Audio API with support for
 * zoom, pan, and draggable oto.ini parameter markers.
 *
 * @fires marker-change - Fired when a marker is dragged to a new position
 *
 * @example
 * ```html
 * <uvm-waveform-editor
 *   .audioBuffer=${audioBuffer}
 *   .zoom=${2}
 *   .offset=${100}
 *   .consonant=${250}
 *   .cutoff=${-150}
 *   .preutterance=${80}
 *   .overlap=${30}
 *   @marker-change=${this._onMarkerChange}
 * ></uvm-waveform-editor>
 * ```
 */
@customElement('uvm-waveform-editor')
export class UvmWaveformEditor extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
      max-width: 100%;
      overflow: hidden;
    }

    .waveform-container {
      position: relative;
      width: 100%;
      max-width: 100%;
      background-color: white;
      border-radius: var(--sl-border-radius-large, 0.5rem);
      overflow: hidden;
      border: 1px solid var(--sl-color-neutral-100, #f1f5f9);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
    }

    :host([theme='dark']) .waveform-container,
    .waveform-container.dark {
      background-color: var(--sl-color-neutral-900, #1e293b);
      border-color: var(--sl-color-neutral-700, #334155);
    }

    .canvas-wrapper {
      position: relative;
      width: 100%;
      max-width: 100%;
      overflow-x: auto;
      overflow-y: hidden;
    }

    .canvas-area {
      position: relative;
      display: flex;
      flex-direction: column;
      /* Width set dynamically via inline style based on zoom level */
      min-width: 100%;
    }

    .waveform-section {
      position: relative;
      background: linear-gradient(to bottom, rgba(248, 250, 252, 0.5) 0%, rgba(241, 245, 249, 0.3) 100%);
    }

    :host([theme='dark']) .waveform-section {
      background: linear-gradient(to bottom, rgba(30, 41, 59, 0.5) 0%, rgba(51, 65, 85, 0.3) 100%);
    }

    .spectrogram-section {
      position: relative;
      background-color: #ffffff;
    }

    .section-divider {
      height: 2px;
      background: linear-gradient(to right,
        transparent 0%,
        var(--sl-color-neutral-400, #94a3b8) 10%,
        var(--sl-color-neutral-400, #94a3b8) 90%,
        transparent 100%
      );
      position: relative;
    }

    :host([theme='dark']) .section-divider {
      background: linear-gradient(to right,
        transparent 0%,
        var(--sl-color-neutral-500, #64748b) 10%,
        var(--sl-color-neutral-500, #64748b) 90%,
        transparent 100%
      );
    }

    .section-label {
      position: absolute;
      left: 8px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 9px;
      font-weight: 500;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--sl-color-neutral-400, #94a3b8);
      background-color: white;
      padding: 0 6px;
      z-index: 1;
    }

    :host([theme='dark']) .section-label {
      color: var(--sl-color-neutral-400, #94a3b8);
      background-color: var(--sl-color-neutral-900, #1e293b);
    }

    .freq-axis {
      position: absolute;
      left: 0;
      top: 0;
      width: 36px;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 4px 0;
      pointer-events: none;
      z-index: 5;
      background: linear-gradient(to right, rgba(255, 255, 255, 0.9) 0%, transparent 100%);
    }

    .freq-label {
      font-size: 9px;
      font-family: monospace;
      color: rgba(71, 85, 105, 0.9);
      padding-left: 4px;
      line-height: 1;
    }

    canvas {
      display: block;
    }

    .markers-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }

    .marker {
      position: absolute;
      top: 0;
      cursor: ew-resize;
      pointer-events: auto;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .marker-line-waveform {
      width: 2px;
      opacity: 0.85;
      transition: all 0.15s ease;
    }

    .marker-line-spectrogram {
      width: 1px;
      opacity: 0.5;
      background-image: repeating-linear-gradient(
        to bottom,
        currentColor 0px,
        currentColor 4px,
        transparent 4px,
        transparent 8px
      );
      background-color: transparent !important;
      transition: all 0.15s ease;
    }

    .marker:hover .marker-line-waveform,
    .marker.dragging .marker-line-waveform {
      opacity: 1;
      width: 3px;
      box-shadow: 0 0 8px currentColor;
    }

    .marker:hover .marker-line-spectrogram,
    .marker.dragging .marker-line-spectrogram {
      opacity: 0.7;
      width: 2px;
    }

    .marker-handle {
      position: absolute;
      top: 0;
      width: 14px;
      height: 22px;
      border-radius: 0 0 4px 4px;
      cursor: ew-resize;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      color: white;
      font-weight: 600;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
      transition: transform 0.1s ease;
    }

    .marker:hover .marker-handle,
    .marker.dragging .marker-handle {
      transform: scale(1.1);
    }

    .marker-label {
      position: absolute;
      white-space: nowrap;
      font-size: 11px;
      font-weight: 500;
      padding: 4px 8px;
      border-radius: 4px;
      color: white;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      opacity: 0;
      transition: opacity 0.15s ease, transform 0.15s ease;
      pointer-events: none;
      transform: translateY(4px);
    }

    .marker:hover .marker-label,
    .marker.dragging .marker-label {
      opacity: 1;
      transform: translateY(0);
    }

    .marker-label-hint {
      font-size: 10px;
      opacity: 0.85;
      display: block;
      margin-top: 1px;
    }

    .controls {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.625rem 1rem;
      background-color: white;
      border-bottom: 1px solid var(--sl-color-neutral-100, #f1f5f9);
      font-size: 0.8125rem;
    }

    :host([theme='dark']) .controls,
    .controls.dark {
      background-color: var(--sl-color-neutral-800, #1e293b);
      border-color: var(--sl-color-neutral-700, #334155);
    }

    .zoom-controls {
      display: flex;
      align-items: center;
      gap: 0.375rem;
    }

    .zoom-label {
      color: var(--sl-color-neutral-400, #94a3b8);
      font-size: 0.75rem;
      min-width: 3.5rem;
    }

    :host([theme='dark']) .zoom-label {
      color: var(--sl-color-neutral-400, #94a3b8);
    }

    .zoom-buttons {
      display: flex;
      gap: 0.125rem;
    }

    .zoom-btn {
      padding: 0.25rem 0.5rem;
      border: 1px solid var(--sl-color-neutral-200, #e2e8f0);
      background-color: var(--sl-color-neutral-50, #f8fafc);
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.8125rem;
      line-height: 1;
      color: var(--sl-color-neutral-500, #64748b);
      transition: all 0.15s ease;
    }

    .zoom-btn:hover {
      background-color: var(--sl-color-neutral-100, #f1f5f9);
      color: var(--sl-color-neutral-700, #334155);
      border-color: var(--sl-color-neutral-300, #cbd5e1);
    }

    :host([theme='dark']) .zoom-btn {
      background-color: var(--sl-color-neutral-700, #334155);
      border-color: var(--sl-color-neutral-600, #475569);
      color: white;
    }

    :host([theme='dark']) .zoom-btn:hover {
      background-color: var(--sl-color-neutral-600, #475569);
    }

    .time-display {
      margin-left: auto;
      color: var(--sl-color-neutral-400, #94a3b8);
      font-family: monospace;
      font-size: 0.75rem;
    }

    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 150px;
      color: var(--sl-color-neutral-400, #94a3b8);
      font-size: 0.875rem;
    }

    .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 150px;
      gap: 0.75rem;
      color: var(--sl-color-neutral-500, #64748b);
    }

    .loading-state sl-spinner {
      font-size: 2rem;
      --indicator-color: var(--sl-color-primary-500, #3b82f6);
    }

    .loading-state-text {
      font-size: 0.875rem;
    }

    .keyboard-hint {
      font-size: 0.6875rem;
      color: var(--sl-color-neutral-300, #cbd5e1);
      letter-spacing: 0.01em;
    }

    .controls-divider {
      width: 1px;
      height: 16px;
      background-color: var(--sl-color-neutral-200, #e2e8f0);
    }

    .playback-controls {
      display: flex;
      align-items: center;
      gap: 0.375rem;
    }

    .playback-controls sl-icon-button {
      font-size: 1.125rem;
    }

    .playback-controls sl-icon-button::part(base) {
      color: var(--sl-color-neutral-500, #64748b);
      padding: 0.25rem;
    }

    .playback-controls sl-icon-button::part(base):hover {
      color: var(--sl-color-primary-500, #3b82f6);
    }

    :host([theme='dark']) .playback-controls sl-icon-button::part(base) {
      color: var(--sl-color-neutral-300, #cbd5e1);
    }

    :host([theme='dark']) .playback-controls sl-icon-button::part(base):hover {
      color: var(--sl-color-primary-400, #818cf8);
    }

    .playback-time {
      font-family: monospace;
      font-size: 0.75rem;
      color: var(--sl-color-neutral-500, #64748b);
      min-width: 4.5rem;
    }

    :host([theme='dark']) .playback-time {
      color: var(--sl-color-neutral-400, #94a3b8);
    }

    .playhead {
      position: absolute;
      top: 0;
      width: 2px;
      height: 100%;
      background-color: #fbbf24;
      pointer-events: none;
      z-index: 10;
      box-shadow: 0 0 4px rgba(251, 191, 36, 0.5);
    }

    .playhead::before {
      content: '';
      position: absolute;
      top: 0;
      left: -4px;
      width: 10px;
      height: 10px;
      background-color: #fbbf24;
      border-radius: 50%;
    }

    .spectrogram-canvas {
      display: block;
    }
  `;

  /**
   * The audio buffer to render as a waveform.
   */
  @property({ attribute: false })
  audioBuffer: AudioBuffer | null = null;

  /**
   * Zoom level (1-100x magnification).
   */
  @property({ type: Number })
  zoom = 1;

  /**
   * Offset marker position in milliseconds (playback start).
   */
  @property({ type: Number })
  offset = 0;

  /**
   * Consonant marker position in milliseconds (fixed region end).
   */
  @property({ type: Number })
  consonant = 0;

  /**
   * Cutoff position in milliseconds (negative = from end).
   */
  @property({ type: Number })
  cutoff = 0;

  /**
   * Preutterance position in milliseconds (note timing).
   */
  @property({ type: Number })
  preutterance = 0;

  /**
   * Overlap position in milliseconds (crossfade point).
   */
  @property({ type: Number })
  overlap = 0;

  /**
   * Height of the waveform canvas in pixels.
   */
  @property({ type: Number })
  height = 195;

  /**
   * Whether the audio is currently loading.
   */
  @property({ type: Boolean })
  loading = false;

  /**
   * Height of the spectrogram panel in pixels.
   */
  @property({ type: Number })
  spectrogramHeight = 270;

  /**
   * Height of the section divider in pixels.
   */
  private readonly _dividerHeight = 2;

  @query('canvas.waveform-canvas')
  private _canvas!: HTMLCanvasElement;

  @query('canvas.spectrogram-canvas')
  private _spectrogramCanvas!: HTMLCanvasElement;

  @query('.canvas-wrapper')
  private _canvasWrapper!: HTMLDivElement;

  @state()
  private _draggingMarker: string | null = null;

  @state()
  private _canvasWidth = 800;

  @state()
  private _containerWidth = 800;

  @state()
  private _isPlaying = false;

  @state()
  private _playbackPosition = 0; // Current position in ms from start of audio

  @state()
  private _spectrogramData: Float32Array[] | null = null;

  private _resizeObserver: ResizeObserver | null = null;
  private _audioContext: AudioContext | null = null;
  private _sourceNode: AudioBufferSourceNode | null = null;
  private _playbackStartTime = 0; // AudioContext time when playback started
  private _playbackStartPosition = 0; // Position in audio (seconds) where playback started
  private _animationFrameId: number | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this._resizeObserver = new ResizeObserver(this._onResize.bind(this));
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._removeGlobalListeners();
    this._stopPlayback();
    this._cleanupAudioContext();
  }

  firstUpdated(): void {
    if (this._canvasWrapper) {
      this._resizeObserver?.observe(this._canvasWrapper);
      this._containerWidth = this._canvasWrapper.clientWidth || 800;
    }
    this._updateCanvasWidth();
    this._drawWaveform();
    this._drawSpectrogram();

    // Add keyboard listener
    this.addEventListener('keydown', this._onKeyDown);
    this.tabIndex = 0;
  }

  updated(changedProperties: PropertyValues): void {
    if (changedProperties.has('audioBuffer')) {
      this._computeSpectrogram();
    }
    if (
      changedProperties.has('audioBuffer') ||
      changedProperties.has('zoom') ||
      changedProperties.has('height') ||
      changedProperties.has('spectrogramHeight')
    ) {
      this._updateCanvasWidth();
      this._drawWaveform();
      this._drawSpectrogram();
    }
  }

  private _onResize(entries: ResizeObserverEntry[]): void {
    for (const entry of entries) {
      this._containerWidth = entry.contentRect.width;
      this._updateCanvasWidth();
      this._drawWaveform();
      this._drawSpectrogram();
    }
  }

  private _updateCanvasWidth(): void {
    // At 1x zoom, canvas fills container width exactly
    // At higher zoom levels, canvas extends beyond container (with scrolling)
    // Audio data is scaled to fit the canvas width
    this._canvasWidth = Math.max(1, Math.floor(this._containerWidth * this.zoom));
  }

  private _drawWaveform(): void {
    if (!this._canvas) return;

    const ctx = this._canvas.getContext('2d');
    if (!ctx) return;

    const width = this._canvasWidth;
    const height = this.height;
    const dpr = window.devicePixelRatio || 1;

    // Set canvas size with device pixel ratio for crisp rendering
    this._canvas.width = width * dpr;
    this._canvas.height = height * dpr;
    this._canvas.style.width = `${width}px`;
    this._canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    if (!this.audioBuffer) {
      return;
    }

    // Get audio data (use first channel)
    const channelData = this.audioBuffer.getChannelData(0);
    const samples = channelData.length;

    // Calculate samples per pixel
    const samplesPerPixel = samples / width;

    // Draw waveform
    const centerY = height / 2;
    const amplitude = height / 2 - 10;

    // Use semi-transparent blue for waveform
    ctx.fillStyle = 'rgba(59, 130, 246, 0.5)';
    ctx.beginPath();
    ctx.moveTo(0, centerY);

    // Draw upper half with power curve scaling for more dramatic waveform
    for (let x = 0; x < width; x++) {
      const startSample = Math.floor(x * samplesPerPixel);
      const endSample = Math.min(Math.floor((x + 1) * samplesPerPixel), samples);

      let max = 0;
      for (let i = startSample; i < endSample; i++) {
        const absValue = Math.abs(channelData[i]);
        if (absValue > max) max = absValue;
      }

      // Apply power curve to boost quiet content (0.4 exponent compresses dynamic range)
      const scaledMax = Math.pow(max, 0.4);
      const y = centerY - scaledMax * amplitude;
      ctx.lineTo(x, y);
    }

    // Draw lower half (mirror) with power curve scaling
    for (let x = width - 1; x >= 0; x--) {
      const startSample = Math.floor(x * samplesPerPixel);
      const endSample = Math.min(Math.floor((x + 1) * samplesPerPixel), samples);

      let max = 0;
      for (let i = startSample; i < endSample; i++) {
        const absValue = Math.abs(channelData[i]);
        if (absValue > max) max = absValue;
      }

      // Apply power curve to boost quiet content (0.4 exponent compresses dynamic range)
      const scaledMax = Math.pow(max, 0.4);
      const y = centerY + scaledMax * amplitude;
      ctx.lineTo(x, y);
    }

    ctx.closePath();
    ctx.fill();

    // Draw center line
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();
  }

  /**
   * White to blue gradient for spectrogram coloring.
   * Maps a value from 0-1 to an RGB color string matching the waveform color.
   * t=0 -> white (255, 255, 255)
   * t=1 -> blue (59, 130, 246) - matches waveform color
   */
  private _spectrogramColor(t: number): string {
    // Clamp to [0, 1]
    t = Math.max(0, Math.min(1, t));

    // White to blue gradient matching waveform
    const r = Math.round(255 - t * (255 - 59));
    const g = Math.round(255 - t * (255 - 130));
    const b = Math.round(255 - t * (255 - 246));

    return `rgb(${r},${g},${b})`;
  }

  /**
   * Compute spectrogram data from audio buffer using FFT.
   * This is called when audioBuffer changes.
   */
  private _computeSpectrogram(): void {
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
    const numBins = Math.min(fftSize / 2, Math.floor((maxFreq / nyquist) * (fftSize / 2)));

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
      const angle = -2 * Math.PI / len;
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
    if (!this._spectrogramCanvas) return;

    const ctx = this._spectrogramCanvas.getContext('2d');
    if (!ctx) return;

    const width = this._canvasWidth;
    const height = this.spectrogramHeight;
    const dpr = window.devicePixelRatio || 1;

    // Set canvas size with device pixel ratio
    this._spectrogramCanvas.width = width * dpr;
    this._spectrogramCanvas.height = height * dpr;
    this._spectrogramCanvas.style.width = `${width}px`;
    this._spectrogramCanvas.style.height = `${height}px`;
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

  /**
   * Convert milliseconds to pixel position.
   */
  private _msToPixel(ms: number): number {
    if (!this.audioBuffer) return 0;
    const duration = this.audioBuffer.duration * 1000; // duration in ms
    const ratio = ms / duration;
    return ratio * this._canvasWidth;
  }

  /**
   * Convert pixel position to milliseconds.
   */
  private _pixelToMs(pixel: number): number {
    if (!this.audioBuffer) return 0;
    const duration = this.audioBuffer.duration * 1000;
    const ratio = pixel / this._canvasWidth;
    return Math.round(ratio * duration);
  }

  /**
   * Get the effective position for cutoff marker.
   * Cutoff is negative (from end), so we need to convert it.
   */
  private _getCutoffPixel(): number {
    if (!this.audioBuffer) return 0;
    const duration = this.audioBuffer.duration * 1000;
    // Cutoff is negative from end, convert to position from start
    const effectiveMs = duration + this.cutoff;
    return this._msToPixel(effectiveMs);
  }

  private _onMarkerMouseDown(e: MouseEvent, markerName: string): void {
    e.preventDefault();
    this._draggingMarker = markerName;

    // Add global listeners for drag
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
  }

  private _onMouseMove = (e: MouseEvent): void => {
    if (!this._draggingMarker || !this._canvasWrapper) return;

    const rect = this._canvasWrapper.getBoundingClientRect();
    const scrollLeft = this._canvasWrapper.scrollLeft;
    const x = e.clientX - rect.left + scrollLeft;

    // Clamp to canvas bounds
    const clampedX = Math.max(0, Math.min(x, this._canvasWidth));

    let newValue: number;
    if (this._draggingMarker === 'cutoff') {
      // Cutoff is negative from end
      if (!this.audioBuffer) return;
      const duration = this.audioBuffer.duration * 1000;
      const msFromStart = this._pixelToMs(clampedX);
      newValue = Math.round(msFromStart - duration);
    } else {
      newValue = this._pixelToMs(clampedX);
    }

    this._emitMarkerChange(this._draggingMarker, newValue);
  };

  private _onMouseUp = (): void => {
    this._draggingMarker = null;
    this._removeGlobalListeners();
  };

  private _removeGlobalListeners(): void {
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);
  }

  private _emitMarkerChange(name: string, value: number): void {
    this.dispatchEvent(
      new CustomEvent('marker-change', {
        detail: { name, value },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onKeyDown = (e: KeyboardEvent): void => {
    switch (e.key) {
      case '+':
      case '=':
        e.preventDefault();
        this._zoomIn();
        break;
      case '-':
        e.preventDefault();
        this._zoomOut();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this._panLeft();
        break;
      case 'ArrowRight':
        e.preventDefault();
        this._panRight();
        break;
      case ' ':
        e.preventDefault();
        this._togglePlayback();
        break;
      case 'Escape':
        e.preventDefault();
        this._stopPlayback();
        break;
    }
  };

  private _zoomIn(): void {
    const newZoom = Math.min(100, this.zoom * 1.5);
    this._emitZoomChange(newZoom);
  }

  private _zoomOut(): void {
    const newZoom = Math.max(1, this.zoom / 1.5);
    this._emitZoomChange(newZoom);
  }

  private _emitZoomChange(zoom: number): void {
    this.dispatchEvent(
      new CustomEvent('zoom-change', {
        detail: { zoom },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _panLeft(): void {
    if (this._canvasWrapper) {
      this._canvasWrapper.scrollLeft -= 50;
    }
  }

  private _panRight(): void {
    if (this._canvasWrapper) {
      this._canvasWrapper.scrollLeft += 50;
    }
  }

  // ==================== Playback Methods ====================

  /**
   * Toggle playback on/off.
   */
  private _togglePlayback(): void {
    if (this._isPlaying) {
      this._stopPlayback();
    } else {
      this._startPlayback();
    }
  }

  /**
   * Calculate the end time for playback based on cutoff parameter.
   * @returns End time in seconds
   */
  private _getPlaybackEndTime(): number {
    if (!this.audioBuffer) return 0;

    if (this.cutoff < 0) {
      // Negative cutoff: measured from end of audio
      return this.audioBuffer.duration + (this.cutoff / 1000);
    } else if (this.cutoff > 0) {
      // Positive cutoff: absolute position from start
      return this.cutoff / 1000;
    } else {
      // Zero cutoff: play to end
      return this.audioBuffer.duration;
    }
  }

  /**
   * Start audio playback from offset to cutoff position.
   * Creates AudioContext on first call (must be after user interaction).
   */
  private async _startPlayback(): Promise<void> {
    if (!this.audioBuffer) return;

    // Create audio context if needed (must be after user gesture)
    if (!this._audioContext) {
      this._audioContext = new AudioContext();
    }

    // Resume context if it was suspended (browser autoplay policy)
    if (this._audioContext.state === 'suspended') {
      await this._audioContext.resume();
    }

    // Calculate start and end times in seconds
    const startTime = this.offset / 1000;
    const endTime = this._getPlaybackEndTime();
    const duration = Math.max(0, endTime - startTime);

    if (duration <= 0) {
      console.warn('Invalid playback region: offset >= cutoff');
      return;
    }

    // Stop any existing playback
    this._stopSourceNode();

    // Create and configure source node
    this._sourceNode = this._audioContext.createBufferSource();
    this._sourceNode.buffer = this.audioBuffer;
    this._sourceNode.connect(this._audioContext.destination);

    // Store timing info for playhead animation
    this._playbackStartTime = this._audioContext.currentTime;
    this._playbackStartPosition = startTime;
    this._playbackPosition = this.offset;

    // Start playback
    this._sourceNode.start(0, startTime, duration);
    this._isPlaying = true;

    // Handle playback end
    this._sourceNode.onended = () => {
      this._onPlaybackEnded();
    };

    // Start playhead animation
    this._startPlayheadAnimation();
  }

  /**
   * Stop audio playback.
   */
  private _stopPlayback(): void {
    this._stopSourceNode();
    this._stopPlayheadAnimation();
    this._isPlaying = false;
    this._playbackPosition = this.offset;
  }

  /**
   * Stop the audio source node safely.
   */
  private _stopSourceNode(): void {
    if (this._sourceNode) {
      try {
        this._sourceNode.stop();
      } catch {
        // Ignore errors if already stopped
      }
      this._sourceNode.disconnect();
      this._sourceNode = null;
    }
  }

  /**
   * Clean up audio context when component is disconnected.
   */
  private _cleanupAudioContext(): void {
    this._stopSourceNode();
    if (this._audioContext) {
      this._audioContext.close();
      this._audioContext = null;
    }
  }

  /**
   * Handle playback ended event.
   */
  private _onPlaybackEnded(): void {
    this._stopPlayheadAnimation();
    this._isPlaying = false;
    this._sourceNode = null;
    // Reset playhead to start position
    this._playbackPosition = this.offset;
  }

  /**
   * Start the playhead animation loop.
   */
  private _startPlayheadAnimation(): void {
    const animate = (): void => {
      if (!this._isPlaying || !this._audioContext) {
        return;
      }

      // Calculate current position based on audio context time
      const elapsed = this._audioContext.currentTime - this._playbackStartTime;
      const currentPositionSec = this._playbackStartPosition + elapsed;
      this._playbackPosition = currentPositionSec * 1000;

      // Check if we've reached the end
      const endTime = this._getPlaybackEndTime();
      if (currentPositionSec >= endTime) {
        this._playbackPosition = endTime * 1000;
        return;
      }

      this._animationFrameId = requestAnimationFrame(animate);
    };

    this._animationFrameId = requestAnimationFrame(animate);
  }

  /**
   * Stop the playhead animation loop.
   */
  private _stopPlayheadAnimation(): void {
    if (this._animationFrameId !== null) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }
  }

  /**
   * Get the playhead pixel position.
   */
  private _getPlayheadPixel(): number {
    return this._msToPixel(this._playbackPosition);
  }

  // ==================== End Playback Methods ====================

  private _formatTime(ms: number): string {
    const absMs = Math.abs(ms);
    const seconds = Math.floor(absMs / 1000);
    const milliseconds = Math.round(absMs % 1000);
    const sign = ms < 0 ? '-' : '';
    return `${sign}${seconds}.${milliseconds.toString().padStart(3, '0')}s`;
  }

  private _getDuration(): number {
    return this.audioBuffer ? this.audioBuffer.duration * 1000 : 0;
  }

  private _renderMarker(name: string, pixelPosition: number): unknown {
    const config = MARKER_CONFIGS[name];
    if (!config) return null;

    const value = name === 'cutoff' ? this.cutoff : (this as unknown as Record<string, number>)[name];
    const isDragging = this._draggingMarker === name;
    const waveformHeight = this.height;
    const spectrogramHeight = this.spectrogramHeight;
    const totalHeight = waveformHeight + this._dividerHeight + spectrogramHeight;
    // Position label in the middle of waveform section
    const labelBottom = spectrogramHeight + this._dividerHeight + 8;

    return html`
      <div
        class="marker ${isDragging ? 'dragging' : ''}"
        style="left: ${pixelPosition}px; transform: translateX(-50%); color: ${config.color}; height: ${totalHeight}px;"
        @mousedown=${(e: MouseEvent) => this._onMarkerMouseDown(e, name)}
      >
        <!-- Waveform section: solid line -->
        <div
          class="marker-line-waveform"
          style="background-color: ${config.color}; height: ${waveformHeight}px;"
        ></div>
        <!-- Spectrogram section: dashed/transparent line -->
        <div
          class="marker-line-spectrogram"
          style="color: ${config.color}; height: ${spectrogramHeight + this._dividerHeight}px;"
        ></div>
        <!-- Handle at top of waveform only -->
        <div class="marker-handle" style="background-color: ${config.color};">
          ${config.icon}
        </div>
        <!-- Label positioned in waveform area -->
        <div class="marker-label" style="background-color: ${config.color}; bottom: ${labelBottom}px;">
          ${config.label}: ${this._formatTime(value)}
          <span class="marker-label-hint">${config.hint}</span>
        </div>
      </div>
    `;
  }

  render() {
    const duration = this._getDuration();

    return html`
      <div class="waveform-container">
        <div class="controls">
          <div class="playback-controls">
            <sl-icon-button
              name=${this._isPlaying ? 'stop-fill' : 'play-fill'}
              label=${this._isPlaying ? 'Stop' : 'Play'}
              @click=${this._togglePlayback}
              ?disabled=${!this.audioBuffer}
            ></sl-icon-button>
            <span class="playback-time">${this._formatTime(this._playbackPosition)}</span>
          </div>
          <div class="controls-divider"></div>
          <div class="zoom-controls">
            <span class="zoom-label">${this.zoom.toFixed(1)}x</span>
            <div class="zoom-buttons">
              <button class="zoom-btn" @click=${this._zoomOut} title="Zoom out (-)">-</button>
              <button class="zoom-btn" @click=${this._zoomIn} title="Zoom in (+)">+</button>
            </div>
          </div>
          <div class="controls-divider"></div>
          <span class="keyboard-hint">Space play | +/- zoom | arrows pan</span>
          <span class="time-display">${this._formatTime(duration)}</span>
        </div>

        ${this.loading
          ? html`
              <div class="loading-state">
                <sl-spinner></sl-spinner>
                <span class="loading-state-text">Loading audio...</span>
              </div>
            `
          : this.audioBuffer
            ? html`
                <div class="canvas-wrapper">
                  <div class="canvas-area" style="width: ${this._canvasWidth}px;">
                    <!-- Waveform Section -->
                    <div class="waveform-section">
                      <canvas class="waveform-canvas"></canvas>
                    </div>

                    <!-- Section Divider -->
                    <div class="section-divider">
                      <span class="section-label">Spectrogram</span>
                    </div>

                    <!-- Spectrogram Section -->
                    <div class="spectrogram-section">
                      <canvas class="spectrogram-canvas"></canvas>
                      <!-- Frequency axis labels -->
                      <div class="freq-axis">
                        <span class="freq-label">8k</span>
                        <span class="freq-label">4k</span>
                        <span class="freq-label">0</span>
                      </div>
                    </div>

                    <!-- Markers Layer spans both sections -->
                    <div class="markers-layer" style="height: ${this.height + this._dividerHeight + this.spectrogramHeight}px;">
                      ${this._renderMarker('offset', this._msToPixel(this.offset))}
                      ${this._renderMarker('consonant', this._msToPixel(this.consonant))}
                      ${this._renderMarker('cutoff', this._getCutoffPixel())}
                      ${this._renderMarker('preutterance', this._msToPixel(this.preutterance))}
                      ${this._renderMarker('overlap', this._msToPixel(this.overlap))}
                      ${this._isPlaying
                        ? html`<div class="playhead" style="left: ${this._getPlayheadPixel()}px;"></div>`
                        : null}
                    </div>
                  </div>
                </div>
              `
            : html`
                <div class="empty-state">No audio loaded. Load an audio file to view the waveform.</div>
              `}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-waveform-editor': UvmWaveformEditor;
  }
}
