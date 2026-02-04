import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';

import { api } from '../services/api.js';
import { getSharedAudioContext } from '../services/audio-context.js';

/**
 * Sample card component with mini-waveform visualization.
 *
 * Displays a compact card for a voicebank sample with:
 * - Mini waveform visualization (~100x40px)
 * - Sample name
 * - Status indicator (green/gray dot)
 * - Hover state with preview playback
 *
 * @fires sample-click - Fired when the card is clicked
 * @fires sample-dblclick - Fired when the card is double-clicked
 *
 * @example
 * ```html
 * <uvm-sample-card
 *   filename="ka.wav"
 *   voicebankId="my-voicebank"
 *   ?hasOto=${true}
 *   ?selected=${false}
 *   @sample-click=${this._onSampleClick}
 * ></uvm-sample-card>
 * ```
 */
@customElement('uvm-sample-card')
export class UvmSampleCard extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .card {
      width: 120px;
      height: 80px;
      display: flex;
      flex-direction: column;
      background-color: var(--uvm-surface, #fafafa);
      border: 1px solid var(--uvm-border, #e5e7eb);
      border-radius: 8px;
      cursor: pointer;
      overflow: hidden;
      transition: transform var(--uvm-duration-fast, 200ms) var(--uvm-ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)),
                  box-shadow var(--uvm-duration-fast, 200ms) ease-out,
                  border-color var(--uvm-duration-fast, 200ms) ease-out;
      user-select: none;
    }

    .card:hover {
      transform: scale(1.02) translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      border-color: #d1d5db;
    }

    .card:focus {
      outline: 2px solid #3b82f6;
      outline-offset: 2px;
    }

    .card.selected {
      border-color: #3b82f6;
      background-color: #eff6ff;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
    }

    .card.selected:hover {
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2), 0 0 0 2px rgba(59, 130, 246, 0.2);
    }

    .waveform-container {
      flex: 1;
      min-height: 0;
      position: relative;
      background-color: var(--uvm-background, #ffffff);
      overflow: hidden;
    }

    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }

    .loading-indicator {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: rgba(255, 255, 255, 0.8);
    }

    .loading-indicator::after {
      content: '';
      width: 12px;
      height: 12px;
      border: 2px solid #e5e7eb;
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .preview-indicator {
      position: absolute;
      top: 4px;
      right: 4px;
      width: 8px;
      height: 8px;
      background-color: #3b82f6;
      border-radius: 50%;
      animation: pulse 1s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(0.9); }
    }

    .card-footer {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      background-color: var(--uvm-surface, #fafafa);
      border-top: 1px solid var(--uvm-border, #e5e7eb);
    }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .status-dot.configured {
      background-color: #22c55e;
    }

    .status-dot.pending {
      background-color: #d1d5db;
    }

    .sample-name {
      flex: 1;
      font-size: 11px;
      font-weight: 500;
      color: var(--uvm-primary, #1f2937);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .card.selected .sample-name {
      color: #1d4ed8;
    }
  `;

  /**
   * The WAV filename for this sample.
   */
  @property({ type: String })
  filename = '';

  /**
   * The voicebank ID containing this sample.
   */
  @property({ type: String })
  voicebankId = '';

  /**
   * Whether this sample has an oto.ini entry configured.
   */
  @property({ type: Boolean })
  hasOto = false;

  /**
   * Whether this card is currently selected.
   */
  @property({ type: Boolean, reflect: true })
  selected = false;

  /**
   * Oto offset for preview playback (ms).
   */
  @property({ type: Number })
  otoOffset = 0;

  @state()
  private _audioBuffer: AudioBuffer | null = null;

  @state()
  private _loading = false;

  @state()
  private _isPlayingPreview = false;

  @state()
  private _isVisible = false;

  @query('canvas')
  private _canvas!: HTMLCanvasElement;

  private _audioContext: AudioContext | null = null;
  private _sourceNode: AudioBufferSourceNode | null = null;
  private _hoverTimer: number | null = null;
  private _intersectionObserver: IntersectionObserver | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    // Set up intersection observer for lazy loading
    this._intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !this._isVisible) {
            this._isVisible = true;
            this._loadAudio();
          }
        }
      },
      { rootMargin: '100px' } // Load when within 100px of viewport
    );
    this._intersectionObserver.observe(this);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopPreview();
    this._clearHoverTimer();
    if (this._intersectionObserver) {
      this._intersectionObserver.disconnect();
      this._intersectionObserver = null;
    }
  }

  protected updated(changedProperties: Map<string, unknown>): void {
    if (
      (changedProperties.has('voicebankId') || changedProperties.has('filename')) &&
      this._isVisible
    ) {
      this._loadAudio();
    }
    if (changedProperties.has('_audioBuffer') && this._audioBuffer && this._canvas) {
      this._drawWaveform();
    }
  }

  /**
   * Load audio data for waveform rendering.
   */
  private async _loadAudio(): Promise<void> {
    if (!this.voicebankId || !this.filename) return;
    if (this._loading) return;

    this._loading = true;

    try {
      // Get shared AudioContext
      if (!this._audioContext) {
        this._audioContext = getSharedAudioContext();
      }

      // Resume if suspended
      if (this._audioContext.state === 'suspended') {
        await this._audioContext.resume();
      }

      this._audioBuffer = await api.loadSampleAsAudioBuffer(
        this.voicebankId,
        this.filename,
        this._audioContext
      );
    } catch (error) {
      console.warn('Failed to load audio for sample card:', this.filename, error);
      this._audioBuffer = null;
    } finally {
      this._loading = false;
    }
  }

  /**
   * Draw a simplified mini-waveform on the canvas.
   */
  private _drawWaveform(): void {
    if (!this._canvas || !this._audioBuffer) return;

    const ctx = this._canvas.getContext('2d');
    if (!ctx) return;

    const rect = this._canvas.getBoundingClientRect();
    const width = rect.width || 118; // Default if not mounted
    const height = rect.height || 44;
    const dpr = window.devicePixelRatio || 1;

    // Set canvas size for crisp rendering
    this._canvas.width = width * dpr;
    this._canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Get audio data
    const channelData = this._audioBuffer.getChannelData(0);
    const samples = channelData.length;
    const samplesPerPixel = samples / width;

    const centerY = height / 2;
    const amplitude = height / 2 - 2;

    // Use semi-transparent blue for waveform
    ctx.fillStyle = this.selected
      ? 'rgba(37, 99, 235, 0.6)'
      : 'rgba(59, 130, 246, 0.5)';
    ctx.beginPath();
    ctx.moveTo(0, centerY);

    // Draw upper half with simplified sampling
    for (let x = 0; x < width; x++) {
      const startSample = Math.floor(x * samplesPerPixel);
      const endSample = Math.min(Math.floor((x + 1) * samplesPerPixel), samples);

      let max = 0;
      // Sample every 4th sample for performance
      const step = Math.max(1, Math.floor((endSample - startSample) / 4));
      for (let i = startSample; i < endSample; i += step) {
        const absValue = Math.abs(channelData[i]);
        if (absValue > max) max = absValue;
      }

      // Apply power curve for visual appeal
      const scaledMax = Math.pow(max, 0.5);
      const y = centerY - scaledMax * amplitude;
      ctx.lineTo(x, y);
    }

    // Draw lower half (mirror)
    for (let x = width - 1; x >= 0; x--) {
      const startSample = Math.floor(x * samplesPerPixel);
      const endSample = Math.min(Math.floor((x + 1) * samplesPerPixel), samples);

      let max = 0;
      const step = Math.max(1, Math.floor((endSample - startSample) / 4));
      for (let i = startSample; i < endSample; i += step) {
        const absValue = Math.abs(channelData[i]);
        if (absValue > max) max = absValue;
      }

      const scaledMax = Math.pow(max, 0.5);
      const y = centerY + scaledMax * amplitude;
      ctx.lineTo(x, y);
    }

    ctx.closePath();
    ctx.fill();

    // Draw center line
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();
  }

  /**
   * Handle mouse enter - start hover timer for preview.
   */
  private _onMouseEnter(): void {
    this._clearHoverTimer();
    this._hoverTimer = window.setTimeout(() => {
      this._playPreview();
    }, 300);
  }

  /**
   * Handle mouse leave - cancel preview and timer.
   */
  private _onMouseLeave(): void {
    this._clearHoverTimer();
    this._stopPreview();
  }

  /**
   * Clear the hover timer if active.
   */
  private _clearHoverTimer(): void {
    if (this._hoverTimer !== null) {
      clearTimeout(this._hoverTimer);
      this._hoverTimer = null;
    }
  }

  /**
   * Play a 500ms preview of the sample.
   */
  private async _playPreview(): Promise<void> {
    if (!this._audioBuffer || !this._audioContext) return;
    if (this._isPlayingPreview) return;

    try {
      // Resume audio context if needed
      if (this._audioContext.state === 'suspended') {
        await this._audioContext.resume();
      }

      this._isPlayingPreview = true;

      // Create source node
      const source = this._audioContext.createBufferSource();
      source.buffer = this._audioBuffer;
      source.connect(this._audioContext.destination);

      // Calculate start time from offset (convert ms to seconds)
      const offsetSec = Math.max(0, this.otoOffset / 1000);
      const duration = 0.5; // 500ms preview

      source.start(0, offsetSec, duration);
      this._sourceNode = source;

      // Auto-stop indicator after duration
      source.onended = () => {
        this._isPlayingPreview = false;
        this._sourceNode = null;
      };
    } catch (error) {
      console.warn('Failed to play preview:', error);
      this._isPlayingPreview = false;
    }
  }

  /**
   * Stop the preview playback.
   */
  private _stopPreview(): void {
    if (this._sourceNode) {
      try {
        this._sourceNode.stop();
      } catch {
        // Already stopped
      }
      this._sourceNode = null;
    }
    this._isPlayingPreview = false;
  }

  /**
   * Handle card click.
   */
  private _onClick(): void {
    this.dispatchEvent(
      new CustomEvent('sample-click', {
        detail: { filename: this.filename },
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Handle card double-click.
   */
  private _onDblClick(): void {
    this.dispatchEvent(
      new CustomEvent('sample-dblclick', {
        detail: { filename: this.filename },
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Handle keyboard events.
   */
  private _onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.dispatchEvent(
        new CustomEvent('sample-dblclick', {
          detail: { filename: this.filename },
          bubbles: true,
          composed: true,
        })
      );
    }
  }

  /**
   * Get display name (filename without .wav extension).
   */
  private _displayName(): string {
    return this.filename.replace(/\.wav$/i, '');
  }

  render() {
    return html`
      <div
        class="card ${this.selected ? 'selected' : ''}"
        tabindex="0"
        role="option"
        aria-selected=${this.selected}
        @click=${this._onClick}
        @dblclick=${this._onDblClick}
        @keydown=${this._onKeyDown}
        @mouseenter=${this._onMouseEnter}
        @mouseleave=${this._onMouseLeave}
      >
        <div class="waveform-container">
          <canvas></canvas>
          ${this._loading ? html`<div class="loading-indicator"></div>` : null}
          ${this._isPlayingPreview ? html`<div class="preview-indicator"></div>` : null}
        </div>
        <div class="card-footer">
          <span class="status-dot ${this.hasOto ? 'configured' : 'pending'}"></span>
          <span class="sample-name" title=${this.filename}>${this._displayName()}</span>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-sample-card': UvmSampleCard;
  }
}
