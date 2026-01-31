import { LitElement, html, css } from 'lit';
import type { PropertyValues } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

/**
 * Marker configuration for oto.ini parameters.
 */
interface MarkerConfig {
  name: string;
  color: string;
  label: string;
}

/**
 * Marker configurations for all oto.ini parameters.
 */
const MARKER_CONFIGS: Record<string, MarkerConfig> = {
  offset: { name: 'offset', color: '#22c55e', label: 'Offset' },
  consonant: { name: 'consonant', color: '#3b82f6', label: 'Consonant' },
  cutoff: { name: 'cutoff', color: '#ef4444', label: 'Cutoff' },
  preutterance: { name: 'preutterance', color: '#a855f7', label: 'Preutterance' },
  overlap: { name: 'overlap', color: '#f97316', label: 'Overlap' },
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
    }

    .waveform-container {
      position: relative;
      width: 100%;
      background-color: var(--sl-color-neutral-100, #f1f5f9);
      border-radius: var(--sl-border-radius-medium, 0.375rem);
      overflow: hidden;
      border: 1px solid var(--sl-color-neutral-200, #e2e8f0);
    }

    :host([theme='dark']) .waveform-container,
    .waveform-container.dark {
      background-color: var(--sl-color-neutral-900, #1e293b);
      border-color: var(--sl-color-neutral-700, #334155);
    }

    .canvas-wrapper {
      position: relative;
      width: 100%;
      overflow-x: auto;
      overflow-y: hidden;
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
      height: 100%;
      cursor: ew-resize;
      pointer-events: auto;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .marker-line {
      width: 2px;
      height: 100%;
      opacity: 0.8;
      transition: opacity 0.15s ease;
    }

    .marker:hover .marker-line,
    .marker.dragging .marker-line {
      opacity: 1;
      width: 3px;
    }

    .marker-handle {
      position: absolute;
      top: 0;
      width: 12px;
      height: 20px;
      border-radius: 0 0 4px 4px;
      cursor: ew-resize;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 8px;
      color: white;
      font-weight: bold;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    }

    .marker-label {
      position: absolute;
      bottom: 4px;
      white-space: nowrap;
      font-size: 10px;
      font-weight: 500;
      padding: 2px 4px;
      border-radius: 2px;
      color: white;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
      opacity: 0;
      transition: opacity 0.15s ease;
      pointer-events: none;
    }

    .marker:hover .marker-label,
    .marker.dragging .marker-label {
      opacity: 1;
    }

    .controls {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.5rem 1rem;
      background-color: var(--sl-color-neutral-50, #f8fafc);
      border-bottom: 1px solid var(--sl-color-neutral-200, #e2e8f0);
      font-size: 0.875rem;
    }

    :host([theme='dark']) .controls,
    .controls.dark {
      background-color: var(--sl-color-neutral-800, #1e293b);
      border-color: var(--sl-color-neutral-700, #334155);
    }

    .zoom-controls {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .zoom-label {
      color: var(--sl-color-neutral-600, #475569);
      min-width: 4rem;
    }

    :host([theme='dark']) .zoom-label {
      color: var(--sl-color-neutral-400, #94a3b8);
    }

    .zoom-buttons {
      display: flex;
      gap: 0.25rem;
    }

    .zoom-btn {
      padding: 0.25rem 0.5rem;
      border: 1px solid var(--sl-color-neutral-300, #cbd5e1);
      background-color: white;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.875rem;
      line-height: 1;
      transition: background-color 0.15s ease;
    }

    .zoom-btn:hover {
      background-color: var(--sl-color-neutral-100, #f1f5f9);
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
      color: var(--sl-color-neutral-500, #64748b);
      font-family: monospace;
    }

    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 150px;
      color: var(--sl-color-neutral-400, #94a3b8);
      font-size: 0.875rem;
    }

    .keyboard-hint {
      font-size: 0.75rem;
      color: var(--sl-color-neutral-400, #94a3b8);
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
  height = 150;

  @query('canvas')
  private _canvas!: HTMLCanvasElement;

  @query('.canvas-wrapper')
  private _canvasWrapper!: HTMLDivElement;

  @state()
  private _draggingMarker: string | null = null;

  @state()
  private _canvasWidth = 800;

  @state()
  private _containerWidth = 800;

  private _resizeObserver: ResizeObserver | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this._resizeObserver = new ResizeObserver(this._onResize.bind(this));
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._removeGlobalListeners();
  }

  firstUpdated(): void {
    if (this._canvasWrapper) {
      this._resizeObserver?.observe(this._canvasWrapper);
      this._containerWidth = this._canvasWrapper.clientWidth || 800;
    }
    this._updateCanvasWidth();
    this._drawWaveform();

    // Add keyboard listener
    this.addEventListener('keydown', this._onKeyDown);
    this.tabIndex = 0;
  }

  updated(changedProperties: PropertyValues): void {
    if (
      changedProperties.has('audioBuffer') ||
      changedProperties.has('zoom') ||
      changedProperties.has('height')
    ) {
      this._updateCanvasWidth();
      this._drawWaveform();
    }
  }

  private _onResize(entries: ResizeObserverEntry[]): void {
    for (const entry of entries) {
      this._containerWidth = entry.contentRect.width;
      this._updateCanvasWidth();
      this._drawWaveform();
    }
  }

  private _updateCanvasWidth(): void {
    if (!this.audioBuffer) {
      this._canvasWidth = this._containerWidth;
      return;
    }
    // Base width is container width, scaled by zoom
    this._canvasWidth = Math.max(this._containerWidth, this._containerWidth * this.zoom);
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

    // Draw upper half
    for (let x = 0; x < width; x++) {
      const startSample = Math.floor(x * samplesPerPixel);
      const endSample = Math.min(Math.floor((x + 1) * samplesPerPixel), samples);

      let max = 0;
      for (let i = startSample; i < endSample; i++) {
        const absValue = Math.abs(channelData[i]);
        if (absValue > max) max = absValue;
      }

      const y = centerY - max * amplitude;
      ctx.lineTo(x, y);
    }

    // Draw lower half (mirror)
    for (let x = width - 1; x >= 0; x--) {
      const startSample = Math.floor(x * samplesPerPixel);
      const endSample = Math.min(Math.floor((x + 1) * samplesPerPixel), samples);

      let max = 0;
      for (let i = startSample; i < endSample; i++) {
        const absValue = Math.abs(channelData[i]);
        if (absValue > max) max = absValue;
      }

      const y = centerY + max * amplitude;
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

    return html`
      <div
        class="marker ${isDragging ? 'dragging' : ''}"
        style="left: ${pixelPosition}px; transform: translateX(-50%);"
        @mousedown=${(e: MouseEvent) => this._onMarkerMouseDown(e, name)}
      >
        <div class="marker-line" style="background-color: ${config.color};"></div>
        <div class="marker-handle" style="background-color: ${config.color};">
          ${config.label.charAt(0)}
        </div>
        <div class="marker-label" style="background-color: ${config.color};">
          ${config.label}: ${this._formatTime(value)}
        </div>
      </div>
    `;
  }

  render() {
    const duration = this._getDuration();

    return html`
      <div class="waveform-container">
        <div class="controls">
          <div class="zoom-controls">
            <span class="zoom-label">Zoom: ${this.zoom.toFixed(1)}x</span>
            <div class="zoom-buttons">
              <button class="zoom-btn" @click=${this._zoomOut} title="Zoom out (-)">-</button>
              <button class="zoom-btn" @click=${this._zoomIn} title="Zoom in (+)">+</button>
            </div>
          </div>
          <span class="keyboard-hint">Keys: +/- zoom, arrows pan</span>
          <span class="time-display">Duration: ${this._formatTime(duration)}</span>
        </div>

        ${this.audioBuffer
          ? html`
              <div class="canvas-wrapper">
                <canvas></canvas>
                <div class="markers-layer">
                  ${this._renderMarker('offset', this._msToPixel(this.offset))}
                  ${this._renderMarker('consonant', this._msToPixel(this.consonant))}
                  ${this._renderMarker('cutoff', this._getCutoffPixel())}
                  ${this._renderMarker('preutterance', this._msToPixel(this.preutterance))}
                  ${this._renderMarker('overlap', this._msToPixel(this.overlap))}
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
