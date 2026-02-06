/**
 * Formant frequency overlay component for the spectrogram.
 *
 * Renders F1, F2, and F3 formant tracks as color-coded lines on top of
 * the spectrogram visualization. The lines follow the formant frequency
 * over time (frame-by-frame analysis).
 *
 * Color coding follows standard convention:
 *   F1 = red    (first formant, related to vowel openness)
 *   F2 = green  (second formant, related to vowel frontness/backness)
 *   F3 = blue   (third formant, related to speaker characteristics)
 *
 * The component pre-computes formant data when the audio buffer changes
 * and caches the results. Rendering uses the cached data to draw lines
 * on a canvas overlay positioned absolutely over the spectrogram.
 *
 * @example
 * ```html
 * <uvm-formant-overlay
 *   .audioBuffer=${audioBuffer}
 *   .width=${800}
 *   .height=${270}
 *   .visible=${true}
 *   .theme=${'light'}
 * ></uvm-formant-overlay>
 * ```
 */
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { query } from 'lit/decorators/query.js';

import { analyzeFormants } from '../utils/formant-tracker.js';
import type { FormantAnalysis } from '../utils/formant-tracker.js';

// ---------------------------------------------------------------------------
// Formant color constants
// ---------------------------------------------------------------------------

/** F1 line color: red. */
const F1_COLOR_LIGHT = 'rgba(220, 38, 38, 0.85)';  // red-600
const F1_COLOR_DARK = 'rgba(248, 113, 113, 0.85)';  // red-400

/** F2 line color: green. */
const F2_COLOR_LIGHT = 'rgba(22, 163, 74, 0.85)';   // green-600
const F2_COLOR_DARK = 'rgba(74, 222, 128, 0.85)';    // green-400

/** F3 line color: blue. */
const F3_COLOR_LIGHT = 'rgba(37, 99, 235, 0.85)';   // blue-600
const F3_COLOR_DARK = 'rgba(96, 165, 250, 0.85)';    // blue-400

/** Line width for formant tracks in CSS pixels. */
const LINE_WIDTH = 2;

/** Minimum confidence threshold to draw a formant point. */
const MIN_CONFIDENCE = 0.1;

/**
 * Maximum frequency displayed in the spectrogram (matches uvm-spectrogram).
 * Used to map formant Hz values to Y pixel coordinates.
 */
const MAX_DISPLAY_FREQ = 8000;

@customElement('uvm-formant-overlay')
export class UvmFormantOverlay extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: none;
    }

    canvas {
      display: block;
    }

    .legend {
      position: absolute;
      top: 6px;
      right: 6px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      background: rgba(255, 255, 255, 0.85);
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 10px;
      font-family: monospace;
      line-height: 1.4;
      pointer-events: none;
      z-index: 2;
    }

    :host([theme='dark']) .legend,
    .legend.dark {
      background: rgba(15, 23, 42, 0.85);
      color: rgba(226, 232, 240, 0.9);
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .legend-swatch {
      width: 12px;
      height: 2px;
      border-radius: 1px;
    }
  `;

  /** Audio buffer to analyze for formants. Recomputes analysis when changed. */
  @property({ attribute: false })
  audioBuffer: AudioBuffer | null = null;

  /** Width of the overlay canvas in CSS pixels. */
  @property({ type: Number })
  width = 800;

  /** Height of the overlay canvas in CSS pixels. */
  @property({ type: Number })
  height = 270;

  /** Whether the formant overlay is visible. */
  @property({ type: Boolean })
  visible = false;

  /**
   * Theme mode for formant line colors.
   * Brighter colors in dark mode for visibility against dark spectrogram.
   */
  @property({ type: String, reflect: true })
  theme: 'light' | 'dark' = 'light';

  /** Cached formant analysis result. */
  @state()
  private _formantData: FormantAnalysis | null = null;

  /** Reference to the previous audioBuffer for change detection. */
  private _prevAudioBuffer: AudioBuffer | null = null;

  /** Reference to the canvas element. */
  @query('canvas')
  private _canvas!: HTMLCanvasElement;

  /** Pending animation frame ID. */
  private _animationFrameId: number | null = null;

  /** Throttle timer for rapid dimension changes. */
  private _throttleTimer: number | null = null;

  /** Throttle delay in milliseconds. */
  private readonly _throttleDelay = 16;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._animationFrameId !== null) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }
    if (this._throttleTimer !== null) {
      clearTimeout(this._throttleTimer);
      this._throttleTimer = null;
    }
  }

  override updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties);

    // Recompute formants when audioBuffer changes
    if (changedProperties.has('audioBuffer')) {
      if (this.audioBuffer !== this._prevAudioBuffer) {
        this._prevAudioBuffer = this.audioBuffer;
        this._computeFormants();
      }
    }

    // Immediate redraw for visibility or theme changes
    if (changedProperties.has('visible') || changedProperties.has('theme')) {
      this._scheduleRedraw();
    }

    // Throttled redraw for dimension changes
    if (changedProperties.has('width') || changedProperties.has('height')) {
      this._scheduleThrottledRedraw();
    }
  }

  // ---------------------------------------------------------------------------
  // Formant computation
  // ---------------------------------------------------------------------------

  /**
   * Compute formant analysis for the current audio buffer.
   * This is called once per audio buffer change and cached.
   */
  private _computeFormants(): void {
    if (!this.audioBuffer) {
      this._formantData = null;
      this._scheduleRedraw();
      return;
    }

    const channelData = this.audioBuffer.getChannelData(0);
    const sampleRate = this.audioBuffer.sampleRate;

    this._formantData = analyzeFormants(channelData, sampleRate, {
      fftSize: 2048,
      maxDisplayFreq: MAX_DISPLAY_FREQ,
    });

    this._scheduleRedraw();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /** Schedule a throttled redraw for rapid property changes. */
  private _scheduleThrottledRedraw(): void {
    if (this._throttleTimer !== null) {
      return;
    }
    this._throttleTimer = window.setTimeout(() => {
      this._throttleTimer = null;
      this._scheduleRedraw();
    }, this._throttleDelay);
  }

  /** Schedule a redraw on the next animation frame. */
  private _scheduleRedraw(): void {
    if (this._animationFrameId !== null) {
      return;
    }
    this._animationFrameId = requestAnimationFrame(() => {
      this._animationFrameId = null;
      this._drawFormants();
    });
  }

  /**
   * Map a frequency in Hz to a Y pixel coordinate on the canvas.
   * Low frequencies are at the bottom (matching spectrogram orientation).
   */
  private _freqToY(freqHz: number): number {
    const ratio = freqHz / MAX_DISPLAY_FREQ;
    // Invert: 0 Hz at bottom (height), MAX_DISPLAY_FREQ at top (0)
    return this.height * (1 - ratio);
  }

  /**
   * Draw formant tracks on the canvas.
   */
  private _drawFormants(): void {
    if (!this._canvas) return;

    const ctx = this._canvas.getContext('2d');
    if (!ctx) return;

    const width = this.width;
    const height = this.height;
    const dpr = window.devicePixelRatio || 1;

    // Set canvas size with device pixel ratio
    this._canvas.width = width * dpr;
    this._canvas.height = height * dpr;
    this._canvas.style.width = `${width}px`;
    this._canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Clear canvas (transparent overlay)
    ctx.clearRect(0, 0, width, height);

    // Do not draw if not visible or no data
    if (!this.visible || !this._formantData || this._formantData.frames.length === 0) {
      return;
    }

    const frames = this._formantData.frames;
    const duration = this._formantData.durationSeconds;
    const isDark = this.theme === 'dark';

    // Color selection based on theme
    const f1Color = isDark ? F1_COLOR_DARK : F1_COLOR_LIGHT;
    const f2Color = isDark ? F2_COLOR_DARK : F2_COLOR_LIGHT;
    const f3Color = isDark ? F3_COLOR_DARK : F3_COLOR_LIGHT;

    // Draw each formant track
    this._drawFormantTrack(ctx, frames, 'f3', f3Color, width, duration);
    this._drawFormantTrack(ctx, frames, 'f2', f2Color, width, duration);
    this._drawFormantTrack(ctx, frames, 'f1', f1Color, width, duration);
  }

  /**
   * Draw a single formant track as a connected line with gaps for unvoiced frames.
   *
   * @param ctx - Canvas 2D context
   * @param frames - Array of formant frames
   * @param formant - Which formant to draw ('f1', 'f2', or 'f3')
   * @param color - CSS color for the line
   * @param width - Canvas width
   * @param duration - Total audio duration in seconds
   */
  private _drawFormantTrack(
    ctx: CanvasRenderingContext2D,
    frames: FormantAnalysis['frames'],
    formant: 'f1' | 'f2' | 'f3',
    color: string,
    width: number,
    duration: number,
  ): void {
    const confidenceKey = `${formant}Confidence` as 'f1Confidence' | 'f2Confidence' | 'f3Confidence';

    ctx.strokeStyle = color;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    let inSegment = false;

    ctx.beginPath();

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const freq = frame[formant];
      const confidence = frame[confidenceKey];

      // Skip frames with no formant or low confidence
      if (freq <= 0 || confidence < MIN_CONFIDENCE) {
        if (inSegment) {
          // End the current segment
          ctx.stroke();
          ctx.beginPath();
          inSegment = false;
        }
        continue;
      }

      const x = (frame.timeSeconds / duration) * width;
      const y = this._freqToY(freq);

      if (!inSegment) {
        ctx.moveTo(x, y);
        inSegment = true;
      } else {
        ctx.lineTo(x, y);
      }
    }

    if (inSegment) {
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------------------
  // Template
  // ---------------------------------------------------------------------------

  override render() {
    const isDark = this.theme === 'dark';
    const legendClass = isDark ? 'legend dark' : 'legend';

    return html`
      <canvas></canvas>
      ${this.visible ? html`
        <div class=${legendClass}>
          <div class="legend-item">
            <span class="legend-swatch" style="background: ${isDark ? F1_COLOR_DARK : F1_COLOR_LIGHT}"></span>
            <span>F1</span>
          </div>
          <div class="legend-item">
            <span class="legend-swatch" style="background: ${isDark ? F2_COLOR_DARK : F2_COLOR_LIGHT}"></span>
            <span>F2</span>
          </div>
          <div class="legend-item">
            <span class="legend-swatch" style="background: ${isDark ? F3_COLOR_DARK : F3_COLOR_LIGHT}"></span>
            <span>F3</span>
          </div>
        </div>
      ` : ''}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-formant-overlay': UvmFormantOverlay;
  }
}
