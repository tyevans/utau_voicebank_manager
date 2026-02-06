import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

/**
 * Live waveform visualization component.
 *
 * Renders real-time audio amplitude data from an AnalyserNode onto a canvas.
 * Also supports rendering a static recorded waveform with playback controls.
 *
 * NOTE: This component uses `getByteTimeDomainData()` (amplitude/time domain)
 * rather than `getByteFrequencyData()` (spectrum/frequency domain) to show
 * the actual waveform shape during recording.
 *
 * @fires preview-play - User clicked the preview play button
 * @fires preview-stop - User clicked the preview stop button
 */
@customElement('uvm-live-waveform')
export class UvmLiveWaveform extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .waveform-section {
      padding: 0 1.5rem 1.5rem;
    }

    .waveform-container {
      position: relative;
      height: 56px;
      background-color: var(--sl-color-neutral-900, #0f172a);
      border-radius: 10px;
      overflow: hidden;
    }

    .waveform-canvas {
      width: 100%;
      height: 100%;
    }

    .waveform-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--sl-color-neutral-600, #475569);
      font-size: 0.8125rem;
      font-weight: 300;
    }

    .waveform-preview-container {
      position: relative;
      height: 100%;
      width: 100%;
    }

    .waveform-playback-controls {
      position: absolute;
      bottom: 6px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 0.5rem;
      z-index: 10;
    }

    .waveform-playback-controls sl-button::part(base) {
      background-color: rgba(15, 23, 42, 0.85);
      border: none;
      font-size: 0.75rem;
    }
  `;

  /**
   * The AnalyserNode to read live audio data from.
   * Set by parent when the record engine signals analyser-ready.
   */
  @property({ attribute: false })
  analyser: AnalyserNode | null = null;

  /**
   * Whether the component is actively recording (drives live animation).
   */
  @property({ type: Boolean })
  recording = false;

  /**
   * A decoded AudioBuffer of a completed recording, for static waveform display.
   */
  @property({ attribute: false })
  recordedBuffer: AudioBuffer | null = null;

  /**
   * Whether a preview is currently playing (controls playhead animation).
   */
  @property({ type: Boolean })
  previewPlaying = false;

  /**
   * Normalized playhead position (0..1) during preview playback.
   */
  @property({ type: Number })
  playheadPosition = 0;

  /**
   * Display mode: 'live' for recording, 'recorded' for playback preview, 'empty' for idle.
   */
  @property({ type: String })
  mode: 'live' | 'recorded' | 'empty' | 'processing' = 'empty';

  @query('.waveform-canvas')
  private _canvas!: HTMLCanvasElement;

  @state()
  private _animationFrameId: number | null = null;

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopAnimation();
  }

  updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties);

    if (changedProperties.has('recording')) {
      if (this.recording) {
        this._startLiveAnimation();
      } else {
        this._stopAnimation();
      }
    }

    if (changedProperties.has('mode') || changedProperties.has('recordedBuffer')) {
      if (this.mode === 'recorded' && this.recordedBuffer && this._canvas) {
        requestAnimationFrame(() => {
          this._drawRecordedWaveform();
        });
      }
    }

    if (changedProperties.has('playheadPosition') && this.previewPlaying) {
      this._drawRecordedWaveform();
    }
  }

  // ---- Public API ----

  /**
   * Force a redraw of the recorded waveform (e.g., after canvas becomes visible).
   */
  redrawRecordedWaveform(): void {
    if (this.recordedBuffer && this._canvas) {
      this._drawRecordedWaveform();
    }
  }

  // ---- Live waveform animation ----

  private _startLiveAnimation(): void {
    this._stopAnimation();

    const animate = () => {
      if (!this.recording || !this.analyser) {
        return;
      }

      this._drawLiveWaveform();
      this._animationFrameId = requestAnimationFrame(animate);
    };

    this._animationFrameId = requestAnimationFrame(animate);
  }

  private _stopAnimation(): void {
    if (this._animationFrameId !== null) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }
  }

  /**
   * Draw live time-domain waveform as vertical bars.
   *
   * Uses getByteTimeDomainData() for true amplitude representation.
   * Values are centered at 128 (silence), ranging 0..255.
   */
  private _drawLiveWaveform(): void {
    if (!this._canvas || !this.analyser) return;

    const ctx = this._canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const displayWidth = this._canvas.clientWidth;
    const displayHeight = this._canvas.clientHeight;
    this._canvas.width = displayWidth * dpr;
    this._canvas.height = displayHeight * dpr;
    ctx.scale(dpr, dpr);

    // Clear canvas with dark background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, displayWidth, displayHeight);

    // Read time-domain data (amplitude waveform, not frequency spectrum)
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(dataArray);

    // Draw as amplitude bars -- each bar represents the peak deviation from center
    const numBars = 48;
    const barWidth = (displayWidth / numBars) - 2;
    const barGap = 2;
    const maxBarHeight = displayHeight - 10;
    const step = Math.max(1, Math.floor(dataArray.length / numBars));
    const centerY = displayHeight / 2;

    for (let i = 0; i < numBars; i++) {
      // Compute peak amplitude within this bar's sample range
      let maxDeviation = 0;
      const startIdx = i * step;
      const endIdx = Math.min(startIdx + step, dataArray.length);
      for (let j = startIdx; j < endIdx; j++) {
        // Time-domain values: 128 = silence, 0/255 = max amplitude
        const deviation = Math.abs(dataArray[j] - 128) / 128;
        if (deviation > maxDeviation) maxDeviation = deviation;
      }

      // Bar grows symmetrically from center
      const barHeight = Math.max(4, maxDeviation * maxBarHeight);
      const x = i * (barWidth + barGap) + barGap;
      const y = centerY - barHeight / 2;

      // Color gradient based on amplitude
      const gradient = ctx.createLinearGradient(x, centerY + barHeight / 2, x, y);
      if (maxDeviation < 0.3) {
        gradient.addColorStop(0, '#22c55e');
        gradient.addColorStop(1, '#16a34a');
      } else if (maxDeviation < 0.6) {
        gradient.addColorStop(0, '#22c55e');
        gradient.addColorStop(0.5, '#eab308');
        gradient.addColorStop(1, '#facc15');
      } else {
        gradient.addColorStop(0, '#22c55e');
        gradient.addColorStop(0.4, '#eab308');
        gradient.addColorStop(0.7, '#f97316');
        gradient.addColorStop(1, '#ef4444');
      }

      // Glow effect
      ctx.shadowColor = maxDeviation > 0.4 ? '#f87171' : '#22c55e';
      ctx.shadowBlur = maxDeviation * 15;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // Draw bar with rounded corners
      ctx.fillStyle = gradient;
      ctx.beginPath();
      const radius = Math.min(barWidth / 2, 3);
      ctx.roundRect(x, y, barWidth, barHeight, radius);
      ctx.fill();

      ctx.shadowBlur = 0;
    }
  }

  // ---- Recorded waveform drawing ----

  private _drawRecordedWaveform(): void {
    if (!this._canvas || !this.recordedBuffer) return;

    const ctx = this._canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const displayWidth = this._canvas.clientWidth;
    const displayHeight = this._canvas.clientHeight;
    this._canvas.width = displayWidth * dpr;
    this._canvas.height = displayHeight * dpr;
    ctx.scale(dpr, dpr);

    // Clear canvas with dark background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, displayWidth, displayHeight);

    // Get audio data from buffer
    const channelData = this.recordedBuffer.getChannelData(0);
    const samplesPerPixel = Math.floor(channelData.length / displayWidth);
    const centerY = displayHeight / 2;

    // Create gradient for waveform fill
    const gradient = ctx.createLinearGradient(0, 0, 0, displayHeight);
    gradient.addColorStop(0, 'rgba(248, 113, 113, 0.6)');
    gradient.addColorStop(0.5, 'rgba(248, 113, 113, 0.3)');
    gradient.addColorStop(1, 'rgba(248, 113, 113, 0.6)');

    // Draw filled waveform
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, centerY);

    // Draw top half
    for (let x = 0; x < displayWidth; x++) {
      const startSample = x * samplesPerPixel;
      const endSample = Math.min(startSample + samplesPerPixel, channelData.length);

      let max = 0;
      for (let i = startSample; i < endSample; i++) {
        const sample = Math.abs(channelData[i]);
        if (sample > max) max = sample;
      }

      const y = centerY - (max * centerY * 0.9);
      ctx.lineTo(x, y);
    }

    // Draw bottom half (mirror)
    for (let x = displayWidth - 1; x >= 0; x--) {
      const startSample = x * samplesPerPixel;
      const endSample = Math.min(startSample + samplesPerPixel, channelData.length);

      let max = 0;
      for (let i = startSample; i < endSample; i++) {
        const sample = Math.abs(channelData[i]);
        if (sample > max) max = sample;
      }

      const y = centerY + (max * centerY * 0.9);
      ctx.lineTo(x, y);
    }

    ctx.closePath();
    ctx.fill();

    // Draw center line for the waveform
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);

    for (let x = 0; x < displayWidth; x++) {
      const startSample = x * samplesPerPixel;
      const endSample = Math.min(startSample + samplesPerPixel, channelData.length);

      let max = 0;
      let maxSign = 1;
      for (let i = startSample; i < endSample; i++) {
        const sample = channelData[i];
        if (Math.abs(sample) > max) {
          max = Math.abs(sample);
          maxSign = sample >= 0 ? 1 : -1;
        }
      }

      const y = centerY - (max * maxSign * centerY * 0.9);
      ctx.lineTo(x, y);
    }

    ctx.stroke();

    // Draw playhead if playing
    if (this.previewPlaying) {
      const playheadX = this.playheadPosition * displayWidth;

      ctx.shadowColor = '#f87171';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, displayHeight);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Playhead handle
      ctx.fillStyle = '#f87171';
      ctx.beginPath();
      ctx.arc(playheadX, 8, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Subtle border
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, displayWidth, displayHeight);
  }

  // ---- Event handlers ----

  private _onPreviewPlay(): void {
    this.dispatchEvent(new CustomEvent('preview-play', {
      bubbles: true,
      composed: true,
    }));
  }

  private _onPreviewStop(): void {
    this.dispatchEvent(new CustomEvent('preview-stop', {
      bubbles: true,
      composed: true,
    }));
  }

  // ---- Render ----

  render() {
    return html`
      <div class="waveform-section">
        <div class="waveform-container">
          ${this.mode === 'live'
            ? html`<canvas class="waveform-canvas"></canvas>`
            : this.mode === 'recorded'
              ? html`
                  <div class="waveform-preview-container">
                    <canvas class="waveform-canvas"></canvas>
                    <div class="waveform-playback-controls">
                      ${this.previewPlaying
                        ? html`
                            <sl-button
                              variant="text"
                              size="small"
                              @click=${this._onPreviewStop}
                            >
                              <sl-icon name="stop-fill"></sl-icon>
                              Stop
                            </sl-button>
                          `
                        : html`
                            <sl-button
                              variant="text"
                              size="small"
                              @click=${this._onPreviewPlay}
                            >
                              <sl-icon name="play-fill"></sl-icon>
                              Preview
                            </sl-button>
                          `
                      }
                    </div>
                  </div>
                `
              : this.mode === 'processing'
                ? html`<div class="waveform-empty">Processing...</div>`
                : html`<div class="waveform-empty">Waveform will appear during recording</div>`
          }
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-live-waveform': UvmLiveWaveform;
  }
}
