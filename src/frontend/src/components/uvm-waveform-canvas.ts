import { LitElement, html, css } from 'lit';
import type { PropertyValues } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';

/**
 * Pure rendering component for audio waveform visualization.
 *
 * This component handles only waveform drawing on a canvas element.
 * It has no knowledge of markers, playback, or user interaction.
 *
 * @example
 * ```html
 * <uvm-waveform-canvas
 *   .audioBuffer=${audioBuffer}
 *   .width=${800}
 *   .height=${200}
 *   .zoom=${1}
 * ></uvm-waveform-canvas>
 * ```
 */
@customElement('uvm-waveform-canvas')
export class UvmWaveformCanvas extends LitElement {
  static styles = css`
    :host {
      display: block;
      overflow: hidden;
    }

    canvas {
      display: block;
    }
  `;

  /**
   * The audio buffer to render as a waveform.
   */
  @property({ attribute: false })
  audioBuffer: AudioBuffer | null = null;

  /**
   * Width of the canvas in CSS pixels.
   */
  @property({ type: Number })
  width = 800;

  /**
   * Height of the canvas in CSS pixels.
   */
  @property({ type: Number })
  height = 200;

  /**
   * Zoom level multiplier (affects how canvas width scales).
   * Note: The parent component typically handles zoom by adjusting width.
   * This property is provided for convenience but width takes precedence.
   */
  @property({ type: Number })
  zoom = 1;

  @query('canvas')
  private _canvas!: HTMLCanvasElement;

  /**
   * Track if a render is already scheduled to avoid redundant frames.
   */
  private _renderScheduled = false;

  /**
   * Throttle timer for rapid property changes (zoom/pan).
   */
  private _throttleTimer: number | null = null;

  /**
   * Throttle delay in milliseconds (~60fps).
   */
  private readonly _throttleDelay = 16;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._throttleTimer !== null) {
      clearTimeout(this._throttleTimer);
      this._throttleTimer = null;
    }
  }

  protected willUpdate(changedProperties: PropertyValues): void {
    // Immediate render for audioBuffer changes (new data loaded)
    if (changedProperties.has('audioBuffer')) {
      this._scheduleRender();
      return;
    }

    // Throttle renders for rapid dimension/zoom changes
    if (
      changedProperties.has('width') ||
      changedProperties.has('height') ||
      changedProperties.has('zoom')
    ) {
      this._scheduleThrottledRender();
    }
  }

  protected firstUpdated(): void {
    this._scheduleRender();
  }

  /**
   * Schedule a throttled render for rapid property changes (zoom/pan).
   * Prevents excessive renders during continuous interactions.
   */
  private _scheduleThrottledRender(): void {
    if (this._throttleTimer !== null) {
      return; // Already scheduled
    }

    this._throttleTimer = window.setTimeout(() => {
      this._throttleTimer = null;
      this._scheduleRender();
    }, this._throttleDelay);
  }

  /**
   * Schedule a waveform render on the next animation frame.
   * Coalesces multiple property changes into a single render.
   */
  private _scheduleRender(): void {
    if (this._renderScheduled) return;
    this._renderScheduled = true;

    requestAnimationFrame(() => {
      this._renderScheduled = false;
      this._drawWaveform();
    });
  }

  /**
   * Draw the waveform to the canvas.
   *
   * Uses a filled polygon approach with power curve scaling to create
   * a visually appealing waveform that emphasizes quieter content.
   */
  private _drawWaveform(): void {
    if (!this._canvas) return;

    const ctx = this._canvas.getContext('2d');
    if (!ctx) return;

    const width = this.width;
    const height = this.height;
    const dpr = window.devicePixelRatio || 1;

    // Set canvas size with device pixel ratio for crisp rendering on HiDPI displays
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

  render() {
    return html`<canvas></canvas>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-waveform-canvas': UvmWaveformCanvas;
  }
}
