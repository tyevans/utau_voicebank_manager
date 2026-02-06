import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';

/**
 * Real-time audio level meter with clipping indicator.
 *
 * Renders a horizontal VU-style bar showing current RMS level in dBFS,
 * with green/yellow/red zones, a peak-hold indicator, and a clipping warning.
 * Uses canvas rendering with requestAnimationFrame for smooth 60fps animation.
 *
 * Zones:
 *   Green:  -inf to -12 dBFS (safe)
 *   Yellow: -12 to -3 dBFS (hot)
 *   Red:    -3 to 0 dBFS (danger)
 *
 * Peak hold: A thin line showing the highest recent level, decaying at 12 dB/s.
 * Clipping:  Visual alert when signal exceeds -1 dBFS.
 *
 * @example
 * ```html
 * <uvm-level-meter
 *   .analyser=${analyserNode}
 *   ?active=${isRecording}
 * ></uvm-level-meter>
 * ```
 */
@customElement('uvm-level-meter')
export class UvmLevelMeter extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .meter-section {
      padding: 0 1.5rem 0.75rem;
    }

    .meter-container {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .meter-canvas-wrapper {
      flex: 1;
      height: 14px;
      background-color: var(--sl-color-neutral-900, #0f172a);
      border-radius: 7px;
      overflow: hidden;
      position: relative;
    }

    .meter-canvas {
      width: 100%;
      height: 100%;
      display: block;
    }

    .meter-label {
      font-size: 0.6875rem;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      min-width: 3.25rem;
      text-align: right;
      color: var(--sl-color-neutral-400, #94a3b8);
      transition: color 0.15s ease;
    }

    .meter-label.hot {
      color: var(--sl-color-warning-600, #d97706);
    }

    .meter-label.clip {
      color: #ef4444;
      font-weight: 700;
    }

    .clip-indicator {
      font-size: 0.625rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      padding: 0.0625rem 0.375rem;
      border-radius: 3px;
      background-color: transparent;
      color: var(--sl-color-neutral-500, #64748b);
      transition: background-color 0.1s ease, color 0.1s ease;
      user-select: none;
    }

    .clip-indicator.active {
      background-color: #ef4444;
      color: white;
      animation: clipFlash 0.3s ease;
    }

    @keyframes clipFlash {
      0% { transform: scale(1.15); }
      100% { transform: scale(1); }
    }
  `;

  /**
   * The AnalyserNode to read audio data from.
   */
  @property({ attribute: false })
  analyser: AnalyserNode | null = null;

  /**
   * Whether the meter is actively animating (typically true during recording).
   */
  @property({ type: Boolean })
  active = false;

  @query('.meter-canvas')
  private _canvas!: HTMLCanvasElement;

  @state()
  private _dbLevel = -Infinity;

  @state()
  private _clipping = false;

  /** Peak hold level in dBFS. Decays over time. */
  private _peakHoldDb = -Infinity;

  /** Timestamp of the last peak hold update (ms). */
  private _peakHoldTime = 0;

  /** Timestamp when clipping was last detected (for visual flash duration). */
  private _clipTime = 0;

  /** Animation frame ID for cleanup. */
  private _animationFrameId: number | null = null;

  /** Reusable typed array for analyser data (avoids allocation per frame). */
  private _dataArray: Float32Array<ArrayBuffer> | null = null;

  /** Previous frame timestamp for delta-time calculations. */
  private _lastFrameTime = 0;

  // ---- Lifecycle ----

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopAnimation();
  }

  updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties);

    if (changedProperties.has('active')) {
      if (this.active) {
        this._resetState();
        this._startAnimation();
      } else {
        this._stopAnimation();
        // Draw one final frame to show the idle state
        this._drawMeter(-Infinity, -Infinity);
      }
    }

    if (changedProperties.has('analyser')) {
      // Reallocate data array when analyser changes
      if (this.analyser) {
        this._dataArray = new Float32Array(this.analyser.fftSize);
      } else {
        this._dataArray = null;
      }
    }
  }

  // ---- Animation loop ----

  private _resetState(): void {
    this._peakHoldDb = -Infinity;
    this._peakHoldTime = 0;
    this._clipTime = 0;
    this._clipping = false;
    this._dbLevel = -Infinity;
    this._lastFrameTime = 0;
  }

  private _startAnimation(): void {
    this._stopAnimation();
    this._lastFrameTime = performance.now();

    const animate = (now: number) => {
      if (!this.active || !this.analyser) {
        return;
      }

      const dt = (now - this._lastFrameTime) / 1000; // seconds
      this._lastFrameTime = now;

      // Read time-domain data for RMS calculation
      if (!this._dataArray || this._dataArray.length !== this.analyser.fftSize) {
        this._dataArray = new Float32Array(this.analyser.fftSize);
      }
      this.analyser.getFloatTimeDomainData(this._dataArray);

      // Calculate RMS level
      let sumSquares = 0;
      let peakSample = 0;
      for (let i = 0; i < this._dataArray.length; i++) {
        const sample = this._dataArray[i];
        sumSquares += sample * sample;
        const absSample = Math.abs(sample);
        if (absSample > peakSample) {
          peakSample = absSample;
        }
      }
      const rms = Math.sqrt(sumSquares / this._dataArray.length);

      // Convert to dBFS (full-scale: 1.0 = 0 dBFS)
      const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
      const peakDb = peakSample > 0 ? 20 * Math.log10(peakSample) : -Infinity;

      this._dbLevel = rmsDb;

      // Update peak hold (decay at 12 dB/s)
      if (peakDb > this._peakHoldDb) {
        this._peakHoldDb = peakDb;
        this._peakHoldTime = now;
      } else {
        // Hold for 1 second, then decay
        const holdElapsed = (now - this._peakHoldTime) / 1000;
        if (holdElapsed > 1.0) {
          this._peakHoldDb -= 12 * dt;
        }
      }

      // Clamp peak hold to a minimum
      if (this._peakHoldDb < -60) {
        this._peakHoldDb = -Infinity;
      }

      // Clipping detection: peak exceeds -1 dBFS
      if (peakDb > -1) {
        this._clipTime = now;
        this._clipping = true;
      } else if (this._clipping && now - this._clipTime > 2000) {
        // Clear clipping indicator after 2 seconds of no clips
        this._clipping = false;
      }

      this._drawMeter(rmsDb, this._peakHoldDb);
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

  // ---- Canvas rendering ----

  /**
   * Convert a dBFS value to a normalized 0..1 position on the meter.
   * Range: -60 dBFS = 0, 0 dBFS = 1.
   */
  private _dbToPosition(db: number): number {
    if (db <= -60 || db === -Infinity) return 0;
    if (db >= 0) return 1;
    return (db + 60) / 60;
  }

  /**
   * Draw the level meter onto the canvas.
   */
  private _drawMeter(rmsDb: number, peakHoldDb: number): void {
    if (!this._canvas) return;

    const ctx = this._canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const displayWidth = this._canvas.clientWidth;
    const displayHeight = this._canvas.clientHeight;

    // Only resize if needed (avoids clearing unnecessarily)
    const targetWidth = Math.round(displayWidth * dpr);
    const targetHeight = Math.round(displayHeight * dpr);
    if (this._canvas.width !== targetWidth || this._canvas.height !== targetHeight) {
      this._canvas.width = targetWidth;
      this._canvas.height = targetHeight;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Dark background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, displayWidth, displayHeight);

    // Zone boundaries (normalized positions)
    const yellowStart = this._dbToPosition(-12); // -12 dBFS
    const redStart = this._dbToPosition(-3);     // -3 dBFS

    // Current level position
    const levelPos = this._dbToPosition(rmsDb);
    const levelWidth = levelPos * displayWidth;

    // Draw filled meter bar with segmented colors
    if (levelWidth > 0) {
      const barY = 2;
      const barHeight = displayHeight - 4;

      // Green zone: 0 to yellowStart
      const greenEnd = Math.min(levelWidth, yellowStart * displayWidth);
      if (greenEnd > 0) {
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(0, barY, greenEnd, barHeight);
      }

      // Yellow zone: yellowStart to redStart
      if (levelWidth > yellowStart * displayWidth) {
        const yellowX = yellowStart * displayWidth;
        const yellowEnd = Math.min(levelWidth, redStart * displayWidth);
        if (yellowEnd > yellowX) {
          ctx.fillStyle = '#eab308';
          ctx.fillRect(yellowX, barY, yellowEnd - yellowX, barHeight);
        }
      }

      // Red zone: redStart to end
      if (levelWidth > redStart * displayWidth) {
        const redX = redStart * displayWidth;
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(redX, barY, levelWidth - redX, barHeight);
      }
    }

    // Draw zone separator ticks (subtle vertical lines)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    const tickWidth = 1;

    // -12 dB tick
    const yellowTickX = yellowStart * displayWidth;
    ctx.fillRect(yellowTickX - tickWidth / 2, 0, tickWidth, displayHeight);

    // -3 dB tick
    const redTickX = redStart * displayWidth;
    ctx.fillRect(redTickX - tickWidth / 2, 0, tickWidth, displayHeight);

    // Draw peak hold indicator (thin bright line)
    if (peakHoldDb > -60 && peakHoldDb !== -Infinity) {
      const peakPos = this._dbToPosition(peakHoldDb);
      const peakX = peakPos * displayWidth;

      // Color the peak indicator based on its zone
      if (peakHoldDb > -3) {
        ctx.fillStyle = '#fca5a5'; // light red
      } else if (peakHoldDb > -12) {
        ctx.fillStyle = '#fde047'; // light yellow
      } else {
        ctx.fillStyle = '#86efac'; // light green
      }

      ctx.fillRect(peakX - 1, 0, 2, displayHeight);
    }

    // Draw dB scale markers as subtle text
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.font = `${8 * (1 / dpr) * dpr}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const scaleMarkers = [-48, -36, -24, -12, -6, -3, 0];
    for (const db of scaleMarkers) {
      const x = this._dbToPosition(db) * displayWidth;
      // Only draw if there is enough space (avoid overlapping)
      if (x > 8 && x < displayWidth - 8) {
        ctx.fillText(`${db}`, x, displayHeight - 1);
      }
    }
  }

  // ---- Render ----

  private _formatDb(db: number): string {
    if (db === -Infinity || db < -60) return '-inf';
    return `${db.toFixed(1)} dB`;
  }

  render() {
    const labelClass = this._clipping
      ? 'clip'
      : this._dbLevel > -12
        ? 'hot'
        : '';

    return html`
      <div class="meter-section">
        <div class="meter-container">
          <div class="meter-canvas-wrapper">
            <canvas class="meter-canvas"></canvas>
          </div>
          <span class="meter-label ${labelClass}">
            ${this.active ? this._formatDb(this._dbLevel) : '-inf'}
          </span>
          <span class="clip-indicator ${this._clipping ? 'active' : ''}">
            CLIP
          </span>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-level-meter': UvmLevelMeter;
  }
}
