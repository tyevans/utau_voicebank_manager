import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';

// Import extracted child components
import './uvm-waveform-canvas.js';
import './uvm-spectrogram.js';
import './uvm-formant-overlay.js';
import './uvm-marker-layer.js';
import './uvm-playback-controller.js';

import { MARKER_CONFIGS, MARKER_ORDER } from './uvm-marker-layer.js';
import type { UvmPlaybackController } from './uvm-playback-controller.js';
import type { GhostMarker } from './uvm-marker-layer.js';

/**
 * Represents a snapshot of all marker positions for undo functionality.
 */
interface MarkerSnapshot {
  offset: number;
  consonant: number;
  cutoff: number;
  preutterance: number;
  overlap: number;
  timestamp: number;
}

/**
 * Waveform editor component for UTAU voicebank editing.
 *
 * Orchestrates sub-components for waveform rendering, marker interaction,
 * and audio playback. Owns shared state: undo/redo history, zoom/pan,
 * theme, and the current oto entry values.
 *
 * Sub-components:
 * - uvm-waveform-canvas: Waveform rendering
 * - uvm-spectrogram: FFT spectrogram rendering
 * - uvm-marker-layer: Marker rendering, drag interaction, region shading
 * - uvm-playback-controller: Audio playback, playhead, melody preview
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

    /* Theme toggle button */
    .theme-toggle {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .theme-toggle sl-icon-button::part(base) {
      color: var(--sl-color-neutral-500, #64748b);
      padding: 0.25rem;
    }

    .theme-toggle sl-icon-button::part(base):hover {
      color: var(--sl-color-neutral-700, #334155);
    }

    :host([theme='dark']) .theme-toggle sl-icon-button::part(base) {
      color: var(--sl-color-neutral-400, #94a3b8);
    }

    :host([theme='dark']) .theme-toggle sl-icon-button::part(base):hover {
      color: var(--sl-color-neutral-200, #e2e8f0);
    }

    /* Formant toggle button */
    .formant-toggle {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .formant-btn {
      padding: 0.2rem 0.5rem;
      border: 1px solid var(--sl-color-neutral-200, #e2e8f0);
      background-color: var(--sl-color-neutral-50, #f8fafc);
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.6875rem;
      font-weight: 500;
      line-height: 1.2;
      color: var(--sl-color-neutral-500, #64748b);
      transition: all 0.15s ease;
      letter-spacing: 0.02em;
    }

    .formant-btn:hover {
      background-color: var(--sl-color-neutral-100, #f1f5f9);
      color: var(--sl-color-neutral-700, #334155);
      border-color: var(--sl-color-neutral-300, #cbd5e1);
    }

    .formant-btn.active {
      background-color: var(--sl-color-primary-50, #eff6ff);
      border-color: var(--sl-color-primary-300, #93c5fd);
      color: var(--sl-color-primary-700, #1d4ed8);
    }

    :host([theme='dark']) .formant-btn {
      background-color: var(--sl-color-neutral-700, #334155);
      border-color: var(--sl-color-neutral-600, #475569);
      color: var(--sl-color-neutral-300, #cbd5e1);
    }

    :host([theme='dark']) .formant-btn:hover {
      background-color: var(--sl-color-neutral-600, #475569);
      color: white;
    }

    :host([theme='dark']) .formant-btn.active {
      background-color: var(--sl-color-primary-900, #1e3a5f);
      border-color: var(--sl-color-primary-500, #3b82f6);
      color: var(--sl-color-primary-300, #93c5fd);
    }
  `;

  // ==================== Public Properties ====================

  /** The audio buffer to render as a waveform. */
  @property({ attribute: false })
  audioBuffer: AudioBuffer | null = null;

  /** Zoom level (1-100x magnification). */
  @property({ type: Number })
  zoom = 1;

  /** Offset marker position in milliseconds (playback start). */
  @property({ type: Number })
  offset = 0;

  /** Consonant marker position in milliseconds (fixed region end). */
  @property({ type: Number })
  consonant = 0;

  /** Cutoff position in milliseconds (negative = from end). */
  @property({ type: Number })
  cutoff = 0;

  /** Preutterance position in milliseconds (note timing). */
  @property({ type: Number })
  preutterance = 0;

  /** Overlap position in milliseconds (crossfade point). */
  @property({ type: Number })
  overlap = 0;

  /** Height of the waveform canvas in pixels. */
  @property({ type: Number })
  height = 195;

  /** Whether the audio is currently loading. */
  @property({ type: Boolean })
  loading = false;

  /** Height of the spectrogram panel in pixels. */
  @property({ type: Number })
  spectrogramHeight = 270;

  /**
   * Theme mode for the editor.
   * - 'light': Light background with blue waveform (default)
   * - 'dark': Dark background with cyan waveform
   * - 'auto': Follow system preference
   */
  @property({ type: String, reflect: true })
  theme: 'light' | 'dark' | 'auto' = 'auto';

  // ==================== Private State ====================

  /** Height of the section divider in pixels. */
  private readonly _dividerHeight = 2;

  @query('.canvas-wrapper')
  private _canvasWrapper!: HTMLDivElement;

  @query('uvm-playback-controller')
  private _playbackController!: UvmPlaybackController;

  @state()
  private _canvasWidth = 800;

  @state()
  private _containerWidth = 800;

  /** Currently selected marker for keyboard nudging. */
  @state()
  private _selectedMarker: string | null = null;

  /** Undo history - stores last 5 marker snapshots. */
  @state()
  private _undoHistory: MarkerSnapshot[] = [];

  /** Ghost markers to display during undo visualization. */
  @state()
  private _ghostMarkers: GhostMarker[] = [];

  /** Timer for clearing ghost markers after animation. */
  private _ghostTimer: number | null = null;

  /** Resolved theme based on 'auto' setting and system preference. */
  @state()
  private _resolvedTheme: 'light' | 'dark' = 'light';

  /** Whether the formant overlay is shown on the spectrogram. */
  @state()
  private _showFormants = false;

  /** Playback state mirrored from the playback controller for rendering. */
  @state()
  private _isPlaying = false;

  @state()
  private _playbackPosition = 0;

  /** Media query for system dark mode preference. */
  private _darkModeQuery: MediaQueryList | null = null;

  private _resizeObserver: ResizeObserver | null = null;

  /** Cached wrapper bounding rect left for marker layer coordinate conversion. */
  @state()
  private _wrapperLeft = 0;

  /** Cached wrapper scroll offset for marker layer coordinate conversion. */
  @state()
  private _wrapperScrollLeft = 0;

  // ==================== Lifecycle ====================

  connectedCallback(): void {
    super.connectedCallback();
    this._resizeObserver = new ResizeObserver(this._onResize.bind(this));

    // Set up dark mode detection
    this._darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this._darkModeQuery.addEventListener('change', this._onDarkModeChange);
    this._updateResolvedTheme();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();

    // Clean up dark mode listener
    this._darkModeQuery?.removeEventListener('change', this._onDarkModeChange);

    // Clean up ghost timer
    if (this._ghostTimer !== null) {
      clearTimeout(this._ghostTimer);
      this._ghostTimer = null;
    }
  }

  firstUpdated(): void {
    if (this._canvasWrapper) {
      this._resizeObserver?.observe(this._canvasWrapper);
      this._containerWidth = this._canvasWrapper.clientWidth || 800;
    }
    this._updateCanvasWidth();

    // Add keyboard listener
    this.addEventListener('keydown', this._onKeyDown);
    this.tabIndex = 0;

    // Track scroll changes for marker layer coordinate conversion
    this._canvasWrapper?.addEventListener('scroll', this._onWrapperScroll);
  }

  updated(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('zoom')) {
      this._updateCanvasWidth();
    }

    if (changedProperties.has('theme')) {
      this._updateResolvedTheme();
    }

    // Track marker changes for undo history
    const markerProps = ['offset', 'consonant', 'cutoff', 'preutterance', 'overlap'];
    const markerChanged = markerProps.some(prop => changedProperties.has(prop));

    if (markerChanged && this.audioBuffer) {
      this._saveToUndoHistory();
    }
  }

  // ==================== Resize / Canvas Width ====================

  private _onResize(entries: ResizeObserverEntry[]): void {
    for (const entry of entries) {
      this._containerWidth = entry.contentRect.width;
      this._updateCanvasWidth();
      this._updateWrapperRect();
    }
  }

  private _updateCanvasWidth(): void {
    this._canvasWidth = Math.max(1, Math.floor(this._containerWidth * this.zoom));
  }

  private _updateWrapperRect(): void {
    if (this._canvasWrapper) {
      const rect = this._canvasWrapper.getBoundingClientRect();
      this._wrapperLeft = rect.left;
      this._wrapperScrollLeft = this._canvasWrapper.scrollLeft;
    }
  }

  private _onWrapperScroll = (): void => {
    if (this._canvasWrapper) {
      this._wrapperScrollLeft = this._canvasWrapper.scrollLeft;
    }
  };

  // ==================== Theme ====================

  private _onDarkModeChange = (): void => {
    this._updateResolvedTheme();
  };

  private _updateResolvedTheme(): void {
    if (this.theme === 'auto') {
      this._resolvedTheme = this._darkModeQuery?.matches ? 'dark' : 'light';
    } else {
      this._resolvedTheme = this.theme;
    }
  }

  private _toggleTheme(): void {
    if (this.theme === 'auto') {
      this.theme = this._resolvedTheme === 'dark' ? 'light' : 'dark';
    } else {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
    }

    this.dispatchEvent(
      new CustomEvent('theme-change', {
        detail: { theme: this.theme },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _toggleFormants(): void {
    this._showFormants = !this._showFormants;
  }

  // ==================== Zoom / Pan ====================

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

  // ==================== Keyboard Handling ====================

  private _onKeyDown = (e: KeyboardEvent): void => {
    // Handle Ctrl/Cmd+Z for undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      this._performUndo();
      return;
    }

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
      case 'ArrowRight':
        e.preventDefault();
        if (this._selectedMarker) {
          this._nudgeSelectedMarker(e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey);
        } else {
          if (e.key === 'ArrowLeft') {
            this._panLeft();
          } else {
            this._panRight();
          }
        }
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        if (this._selectedMarker) {
          e.preventDefault();
          this._cycleSelectedMarker(e.key === 'ArrowUp' ? -1 : 1);
        }
        break;
      case ' ':
        e.preventDefault();
        this._playbackController?.togglePlayback();
        break;
      case 'Escape':
        e.preventDefault();
        this._playbackController?.stopAll();
        this._selectedMarker = null;
        break;
      case 'p':
      case 'P':
        e.preventDefault();
        this._playbackController?.togglePreview();
        break;
      case 'd':
      case 'D':
        e.preventDefault();
        this._toggleTheme();
        break;
      case 'f':
      case 'F':
        e.preventDefault();
        this._toggleFormants();
        break;
      case 'Tab':
        if (this.audioBuffer) {
          e.preventDefault();
          this._cycleSelectedMarker(e.shiftKey ? -1 : 1);
        }
        break;
    }
  };

  // ==================== Marker Nudging ====================

  private _nudgeSelectedMarker(direction: number, large: boolean): void {
    if (!this._selectedMarker || !this.audioBuffer) return;

    const step = large ? 10 : 1;
    const delta = direction * step;
    const currentValue = this._getMarkerValue(this._selectedMarker);
    const duration = this.audioBuffer.duration * 1000;

    let newValue: number;

    if (this._selectedMarker === 'cutoff') {
      newValue = currentValue + delta;
      newValue = Math.min(0, Math.max(-duration, newValue));
    } else {
      newValue = currentValue + delta;
      newValue = Math.max(0, Math.min(duration, newValue));
    }

    if (newValue !== currentValue) {
      this._emitMarkerChange(this._selectedMarker, Math.round(newValue));
    }
  }

  private _cycleSelectedMarker(direction: number): void {
    if (!this.audioBuffer) return;

    const currentIndex = this._selectedMarker
      ? MARKER_ORDER.indexOf(this._selectedMarker)
      : -1;

    let nextIndex: number;
    if (currentIndex === -1) {
      nextIndex = direction > 0 ? 0 : MARKER_ORDER.length - 1;
    } else {
      nextIndex = (currentIndex + direction + MARKER_ORDER.length) % MARKER_ORDER.length;
    }

    this._selectedMarker = MARKER_ORDER[nextIndex];
  }

  private _getMarkerValue(markerName: string): number {
    switch (markerName) {
      case 'offset':
        return this.offset;
      case 'consonant':
        return this.consonant;
      case 'cutoff':
        return this.cutoff;
      case 'preutterance':
        return this.preutterance;
      case 'overlap':
        return this.overlap;
      default:
        return 0;
    }
  }

  // ==================== Undo ====================

  private readonly _maxUndoHistory = 5;

  private _saveToUndoHistory(): void {
    const snapshot: MarkerSnapshot = {
      offset: this.offset,
      consonant: this.consonant,
      cutoff: this.cutoff,
      preutterance: this.preutterance,
      overlap: this.overlap,
      timestamp: Date.now(),
    };

    const lastSnapshot = this._undoHistory[this._undoHistory.length - 1];
    if (lastSnapshot) {
      const isSame =
        lastSnapshot.offset === snapshot.offset &&
        lastSnapshot.consonant === snapshot.consonant &&
        lastSnapshot.cutoff === snapshot.cutoff &&
        lastSnapshot.preutterance === snapshot.preutterance &&
        lastSnapshot.overlap === snapshot.overlap;

      if (isSame || snapshot.timestamp - lastSnapshot.timestamp < 100) {
        return;
      }
    }

    this._undoHistory = [...this._undoHistory, snapshot].slice(-this._maxUndoHistory);
  }

  private _performUndo(): void {
    if (this._undoHistory.length < 2) return;

    const previousSnapshot = this._undoHistory[this._undoHistory.length - 2];

    this._showGhostMarkers();

    this._undoHistory = this._undoHistory.slice(0, -1);

    this._emitMarkerChange('offset', previousSnapshot.offset);
    this._emitMarkerChange('consonant', previousSnapshot.consonant);
    this._emitMarkerChange('cutoff', previousSnapshot.cutoff);
    this._emitMarkerChange('preutterance', previousSnapshot.preutterance);
    this._emitMarkerChange('overlap', previousSnapshot.overlap);
  }

  private _showGhostMarkers(): void {
    if (this._ghostTimer !== null) {
      clearTimeout(this._ghostTimer);
    }

    this._ghostMarkers = [
      { name: 'offset', position: this._msToPixel(this.offset), value: this.offset },
      { name: 'consonant', position: this._msToPixel(this.consonant), value: this.consonant },
      { name: 'cutoff', position: this._getCutoffPixel(), value: this.cutoff },
      { name: 'preutterance', position: this._msToPixel(this.preutterance), value: this.preutterance },
      { name: 'overlap', position: this._msToPixel(this.overlap), value: this.overlap },
    ];

    this._ghostTimer = window.setTimeout(() => {
      this._ghostMarkers = [];
      this._ghostTimer = null;
    }, 1000);
  }

  // ==================== Coordinate Helpers (for ghost markers) ====================

  private _msToPixel(ms: number): number {
    if (!this.audioBuffer) return 0;
    const duration = this.audioBuffer.duration * 1000;
    return (ms / duration) * this._canvasWidth;
  }

  private _getCutoffPixel(): number {
    if (!this.audioBuffer) return 0;
    const duration = this.audioBuffer.duration * 1000;
    const effectiveMs = duration + this.cutoff;
    return this._msToPixel(effectiveMs);
  }

  // ==================== Event Handlers from Sub-Components ====================

  private _emitMarkerChange(name: string, value: number): void {
    this.dispatchEvent(
      new CustomEvent('marker-change', {
        detail: { name, value },
        bubbles: true,
        composed: true,
      })
    );
  }

  /** Handle marker-change events from the marker layer. */
  private _onMarkerLayerChange(e: CustomEvent<{ name: string; value: number }>): void {
    e.stopPropagation();
    this._emitMarkerChange(e.detail.name, e.detail.value);
  }

  /** Handle seek events from the marker layer. */
  private _onSeek(e: CustomEvent<{ positionMs: number }>): void {
    e.stopPropagation();
    this._playbackController?.playFromPosition(e.detail.positionMs);
  }

  /** Handle marker-selected events from the marker layer. */
  private _onMarkerSelected(e: CustomEvent<{ name: string | null }>): void {
    e.stopPropagation();
    this._selectedMarker = e.detail.name;
  }

  /** Handle marker-preview events from the marker layer (after drag). */
  private _onMarkerPreview(e: CustomEvent<{ name: string; value: number }>): void {
    e.stopPropagation();
    this._playbackController?.playMarkerPreview(e.detail.name, e.detail.value);
  }

  /** Handle playback-state events from the playback controller. */
  private _onPlaybackState(e: CustomEvent<{ playing: boolean; position: number }>): void {
    e.stopPropagation();
    this._isPlaying = e.detail.playing;
    this._playbackPosition = e.detail.position;

    // Update wrapper rect for marker layer coordinate conversion during playback
    this._updateWrapperRect();
  }

  // ==================== Formatting ====================

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

  // ==================== Render ====================

  render() {
    const duration = this._getDuration();
    const isDark = this._resolvedTheme === 'dark';

    const containerClass = isDark ? 'waveform-container dark' : 'waveform-container';
    const controlsClass = isDark ? 'controls dark' : 'controls';

    return html`
      <div class=${containerClass}>
        <div class=${controlsClass}>
          <uvm-playback-controller
            .audioBuffer=${this.audioBuffer}
            .offset=${this.offset}
            .consonant=${this.consonant}
            .cutoff=${this.cutoff}
            .preutterance=${this.preutterance}
            .overlap=${this.overlap}
            .theme=${this._resolvedTheme}
            @playback-state=${this._onPlaybackState}
          ></uvm-playback-controller>
          <div class="controls-divider"></div>
          <div class="zoom-controls">
            <span class="zoom-label">${this.zoom.toFixed(1)}x</span>
            <div class="zoom-buttons">
              <button class="zoom-btn" @click=${this._zoomOut} title="Zoom out (-)">-</button>
              <button class="zoom-btn" @click=${this._zoomIn} title="Zoom in (+)">+</button>
            </div>
          </div>
          <div class="controls-divider"></div>
          <div class="theme-toggle">
            <sl-icon-button
              name=${isDark ? 'sun' : 'moon'}
              label=${isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              @click=${this._toggleTheme}
              title="Toggle theme (D)"
            ></sl-icon-button>
          </div>
          <div class="controls-divider"></div>
          <div class="formant-toggle">
            <button
              class="formant-btn ${this._showFormants ? 'active' : ''}"
              @click=${this._toggleFormants}
              title="Toggle formant overlay (F)"
              aria-pressed=${this._showFormants ? 'true' : 'false'}
            >F1/F2/F3</button>
          </div>
          <div class="controls-divider"></div>
          <span class="keyboard-hint">${this._selectedMarker
            ? `${MARKER_CONFIGS[this._selectedMarker].label}: Arrow nudge | Shift+Arrow 10ms | Tab next`
            : 'Click to seek | Space play | Ctrl+Z undo | D dark | F formants'}</span>
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
                    <div class="waveform-section" style="height: ${this.height}px;">
                      <uvm-waveform-canvas
                        .audioBuffer=${this.audioBuffer}
                        .width=${this._canvasWidth}
                        .height=${this.height}
                        .theme=${this._resolvedTheme}
                      ></uvm-waveform-canvas>
                    </div>

                    <!-- Section Divider -->
                    <div class="section-divider">
                      <span class="section-label">Spectrogram</span>
                    </div>

                    <!-- Spectrogram Section -->
                    <div class="spectrogram-section" style="height: ${this.spectrogramHeight}px;">
                      <uvm-spectrogram
                        .audioBuffer=${this.audioBuffer}
                        .width=${this._canvasWidth}
                        .height=${this.spectrogramHeight}
                        .theme=${this._resolvedTheme}
                      ></uvm-spectrogram>
                      <uvm-formant-overlay
                        .audioBuffer=${this.audioBuffer}
                        .width=${this._canvasWidth}
                        .height=${this.spectrogramHeight}
                        .visible=${this._showFormants}
                        .theme=${this._resolvedTheme}
                      ></uvm-formant-overlay>
                      <!-- Frequency axis labels -->
                      <div class="freq-axis">
                        <span class="freq-label">8k</span>
                        <span class="freq-label">4k</span>
                        <span class="freq-label">0</span>
                      </div>
                    </div>

                    <!-- Marker Layer spans both sections -->
                    <uvm-marker-layer
                      .audioDurationMs=${this._getDuration()}
                      .canvasWidth=${this._canvasWidth}
                      .waveformHeight=${this.height}
                      .spectrogramHeight=${this.spectrogramHeight}
                      .dividerHeight=${this._dividerHeight}
                      .offset=${this.offset}
                      .consonant=${this.consonant}
                      .cutoff=${this.cutoff}
                      .preutterance=${this.preutterance}
                      .overlap=${this.overlap}
                      .playing=${this._isPlaying}
                      .playbackPosition=${this._playbackPosition}
                      .ghostMarkers=${this._ghostMarkers}
                      .selectedMarker=${this._selectedMarker}
                      .theme=${this._resolvedTheme}
                      .wrapperLeft=${this._wrapperLeft}
                      .scrollLeft=${this._wrapperScrollLeft}
                      @marker-change=${this._onMarkerLayerChange}
                      @seek=${this._onSeek}
                      @marker-selected=${this._onMarkerSelected}
                      @marker-preview=${this._onMarkerPreview}
                    ></uvm-marker-layer>
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
