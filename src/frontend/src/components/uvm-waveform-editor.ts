import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';

// Import extracted child components
import './uvm-waveform-canvas.js';
import './uvm-spectrogram.js';
import './uvm-marker-handle.js';

// Import melody preview services
import { MelodyPlayer, MELODY_PATTERNS, getMelodyPattern } from '../services/index.js';
import type { OtoEntry } from '../services/index.js';
import type { MarkerDragDetail } from './uvm-marker-handle.js';

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
 * Ghost marker for undo visualization.
 */
interface GhostMarker {
  name: string;
  position: number;
  value: number;
}

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
    color: 'var(--uvm-marker-offset, #22c55e)',
    label: 'Offset',
    hint: 'Start point',
    icon: 'O',
  },
  consonant: {
    name: 'consonant',
    color: 'var(--uvm-marker-consonant, #3b82f6)',
    label: 'Consonant',
    hint: 'Fixed region end',
    icon: 'C',
  },
  cutoff: {
    name: 'cutoff',
    color: 'var(--uvm-marker-cutoff, #ef4444)',
    label: 'Cutoff',
    hint: 'End point',
    icon: 'X',
  },
  preutterance: {
    name: 'preutterance',
    color: 'var(--uvm-marker-preutterance, #a855f7)',
    label: 'Preutterance',
    hint: 'Note timing',
    icon: 'P',
  },
  overlap: {
    name: 'overlap',
    color: 'var(--uvm-marker-overlap, #f97316)',
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

    .markers-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }

    /* Region shading styles */
    .region-shading {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 100%;
      pointer-events: none;
      z-index: 1;
    }

    .region {
      position: absolute;
      top: 0;
      height: 100%;
    }

    .region-fixed {
      background-color: rgba(59, 130, 246, 0.08);
    }

    .region-excluded {
      background: repeating-linear-gradient(
        -45deg,
        transparent,
        transparent 4px,
        rgba(156, 163, 175, 0.15) 4px,
        rgba(156, 163, 175, 0.15) 8px
      );
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

    .preview-controls {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .preview-controls sl-select {
      min-width: 120px;
    }

    .preview-controls sl-select::part(combobox) {
      font-size: 0.75rem;
      min-height: 1.75rem;
    }

    .preview-btn {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.25rem 0.5rem;
      border: 1px solid var(--sl-color-neutral-200, #e2e8f0);
      background-color: var(--sl-color-neutral-50, #f8fafc);
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.75rem;
      line-height: 1;
      color: var(--sl-color-neutral-600, #475569);
      transition: all 0.15s ease;
    }

    .preview-btn:hover {
      background-color: var(--sl-color-neutral-100, #f1f5f9);
      color: var(--sl-color-neutral-700, #334155);
      border-color: var(--sl-color-neutral-300, #cbd5e1);
    }

    .preview-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .preview-btn.playing {
      background-color: var(--sl-color-primary-50, #eff6ff);
      border-color: var(--sl-color-primary-300, #93c5fd);
      color: var(--sl-color-primary-600, #2563eb);
    }

    .preview-btn.playing:hover {
      background-color: var(--sl-color-primary-100, #dbeafe);
    }

    :host([theme='dark']) .preview-btn {
      background-color: var(--sl-color-neutral-700, #334155);
      border-color: var(--sl-color-neutral-600, #475569);
      color: var(--sl-color-neutral-200, #e2e8f0);
    }

    :host([theme='dark']) .preview-btn:hover {
      background-color: var(--sl-color-neutral-600, #475569);
      color: white;
    }

    :host([theme='dark']) .preview-btn.playing {
      background-color: var(--sl-color-primary-900, #1e3a8a);
      border-color: var(--sl-color-primary-700, #1d4ed8);
      color: var(--sl-color-primary-200, #bfdbfe);
    }

    .preview-btn sl-icon {
      font-size: 0.875rem;
    }

    /* ========================================
       Playback Region Glow Animation
       ======================================== */

    .playback-glow {
      position: absolute;
      top: 0;
      height: 100%;
      pointer-events: none;
      z-index: 2;
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(59, 130, 246, 0.08) 20%,
        rgba(59, 130, 246, 0.15) 50%,
        rgba(59, 130, 246, 0.08) 80%,
        transparent 100%
      );
      animation: playback-breathe 2s ease-in-out infinite;
    }

    :host([theme='dark']) .playback-glow {
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(103, 232, 249, 0.1) 20%,
        rgba(103, 232, 249, 0.2) 50%,
        rgba(103, 232, 249, 0.1) 80%,
        transparent 100%
      );
    }

    @keyframes playback-breathe {
      0%, 100% {
        opacity: 0.6;
        filter: blur(8px);
      }
      50% {
        opacity: 1;
        filter: blur(12px);
      }
    }

    /* Amplitude-responsive glow intensity via CSS variable */
    .playback-glow.loud {
      animation: playback-breathe-loud 1.5s ease-in-out infinite;
    }

    @keyframes playback-breathe-loud {
      0%, 100% {
        opacity: 0.8;
        filter: blur(10px);
      }
      50% {
        opacity: 1;
        filter: blur(16px);
      }
    }

    /* ========================================
       Ghost Markers for Undo Visualization
       ======================================== */

    .ghost-marker {
      position: absolute;
      top: 0;
      width: 2px;
      pointer-events: none;
      z-index: 3;
      opacity: 0.3;
      border-left: 2px dashed;
      animation: ghost-fade 1s ease-out forwards;
    }

    .ghost-marker-handle {
      position: absolute;
      top: -8px;
      left: -7px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      border: 2px dashed;
      background: transparent;
    }

    @keyframes ghost-fade {
      0% {
        opacity: 0.5;
      }
      70% {
        opacity: 0.3;
      }
      100% {
        opacity: 0;
      }
    }

    /* ========================================
       Theme Toggle Button
       ======================================== */

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

    /* ========================================
       Reduced Motion Support
       ======================================== */

    @media (prefers-reduced-motion: reduce) {
      .playback-glow,
      .ghost-marker {
        animation: none;
      }

      .playback-glow {
        opacity: 0.8;
        filter: blur(10px);
      }

      .ghost-marker {
        opacity: 0.3;
      }
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
   * Theme mode for the editor.
   * - 'light': Light background with blue waveform (default)
   * - 'dark': Dark background with cyan waveform
   * - 'auto': Follow system preference
   */
  @property({ type: String, reflect: true })
  theme: 'light' | 'dark' | 'auto' = 'auto';

  /**
   * Height of the section divider in pixels.
   */
  private readonly _dividerHeight = 2;

  @query('.canvas-wrapper')
  private _canvasWrapper!: HTMLDivElement;

  @state()
  private _draggingMarker: string | null = null;

  /**
   * Currently selected marker for keyboard nudging.
   * Set when a marker is dragged, cleared when clicking elsewhere.
   */
  @state()
  private _selectedMarker: string | null = null;

  /**
   * Starting position (in ms) of marker when drag begins.
   * Used to detect if marker actually moved before playing preview.
   */
  private _dragStartValue: number | null = null;

  /**
   * Track mousedown position to detect click vs drag for seek functionality.
   */
  private _mouseDownX: number | null = null;
  private _mouseDownY: number | null = null;

  /**
   * Source node for marker preview playback.
   * Separate from main playback to avoid conflicts.
   */
  private _previewSourceNode: AudioBufferSourceNode | null = null;

  @state()
  private _canvasWidth = 800;

  @state()
  private _containerWidth = 800;

  @state()
  private _isPlaying = false;

  @state()
  private _playbackPosition = 0; // Current position in ms from start of audio

  @state()
  private _melodyPlayer: MelodyPlayer | null = null;

  @state()
  private _selectedPatternId: string = 'scale';

  @state()
  private _isPreviewPlaying: boolean = false;

  /**
   * Undo history - stores last 5 marker snapshots.
   */
  @state()
  private _undoHistory: MarkerSnapshot[] = [];

  /**
   * Ghost markers to display during undo visualization.
   */
  @state()
  private _ghostMarkers: GhostMarker[] = [];

  /**
   * Timer for clearing ghost markers after animation.
   */
  private _ghostTimer: number | null = null;

  /**
   * Current amplitude level (0-1) for playback glow intensity.
   */
  @state()
  private _currentAmplitude = 0;

  /**
   * Resolved theme based on 'auto' setting and system preference.
   */
  @state()
  private _resolvedTheme: 'light' | 'dark' = 'light';

  /**
   * Media query for system dark mode preference.
   */
  private _darkModeQuery: MediaQueryList | null = null;

  private _resizeObserver: ResizeObserver | null = null;
  private _audioContext: AudioContext | null = null;
  private _sourceNode: AudioBufferSourceNode | null = null;
  private _playbackStartTime = 0; // AudioContext time when playback started
  private _playbackStartPosition = 0; // Position in audio (seconds) where playback started
  private _animationFrameId: number | null = null;

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
    this._removeCanvasListeners();
    this._stopPlayback();
    this._stopPreview();
    this._stopMarkerPreview();
    this._cleanupAudioContext();

    // Clean up dark mode listener
    this._darkModeQuery?.removeEventListener('change', this._onDarkModeChange);

    // Clean up ghost timer
    if (this._ghostTimer !== null) {
      clearTimeout(this._ghostTimer);
      this._ghostTimer = null;
    }
  }

  /**
   * Handle system dark mode preference change.
   */
  private _onDarkModeChange = (): void => {
    this._updateResolvedTheme();
  };

  /**
   * Update the resolved theme based on current settings.
   */
  private _updateResolvedTheme(): void {
    if (this.theme === 'auto') {
      this._resolvedTheme = this._darkModeQuery?.matches ? 'dark' : 'light';
    } else {
      this._resolvedTheme = this.theme;
    }
  }

  /**
   * Remove canvas click-to-seek listeners.
   */
  private _removeCanvasListeners(): void {
    document.removeEventListener('mouseup', this._onCanvasMouseUp);
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
  }

  updated(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('zoom')) {
      this._updateCanvasWidth();
    }

    // Update resolved theme when theme property changes
    if (changedProperties.has('theme')) {
      this._updateResolvedTheme();
    }

    // Track marker changes for undo history
    const markerProps = ['offset', 'consonant', 'cutoff', 'preutterance', 'overlap'];
    const markerChanged = markerProps.some(prop => changedProperties.has(prop));

    if (markerChanged && this.audioBuffer) {
      // Only save to history if not during a drag operation
      if (!this._draggingMarker) {
        this._saveToUndoHistory();
      }
    }
  }

  private _onResize(entries: ResizeObserverEntry[]): void {
    for (const entry of entries) {
      this._containerWidth = entry.contentRect.width;
      this._updateCanvasWidth();
    }
  }

  private _updateCanvasWidth(): void {
    // At 1x zoom, canvas fills container width exactly
    // At higher zoom levels, canvas extends beyond container (with scrolling)
    // Audio data is scaled to fit the canvas width
    this._canvasWidth = Math.max(1, Math.floor(this._containerWidth * this.zoom));
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

  /**
   * Get the current value (in ms) of a marker by name.
   */
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

  // ==================== Marker Drag Event Handlers ====================

  /**
   * Handle marker drag start event from uvm-marker-handle.
   */
  private _onMarkerDragStart(e: CustomEvent<MarkerDragDetail>): void {
    this._draggingMarker = e.detail.name;
    this._dragStartValue = this._getMarkerValue(e.detail.name);
  }

  /**
   * Handle marker drag event from uvm-marker-handle.
   */
  private _onMarkerDrag(e: CustomEvent<MarkerDragDetail>): void {
    if (!this._draggingMarker || !this._canvasWrapper || e.detail.clientX === undefined) return;

    const rect = this._canvasWrapper.getBoundingClientRect();
    const scrollLeft = this._canvasWrapper.scrollLeft;
    const x = e.detail.clientX - rect.left + scrollLeft;

    // Clamp to canvas bounds
    const clampedX = Math.max(0, Math.min(x, this._canvasWidth));

    let newValue: number;
    if (this._draggingMarker === 'cutoff') {
      // Cutoff is negative from end
      if (!this.audioBuffer) return;
      const duration = this.audioBuffer.duration * 1000;
      const msFromStart = this._pixelToMs(clampedX);
      newValue = Math.round(msFromStart - duration);
      // Clamp cutoff to valid range
      newValue = Math.min(0, Math.max(-duration, newValue));
    } else {
      newValue = Math.round(Math.max(0, this._pixelToMs(clampedX)));
    }

    this._emitMarkerChange(this._draggingMarker, newValue);
  }

  /**
   * Handle marker drag end event from uvm-marker-handle.
   */
  private _onMarkerDragEnd(_e: CustomEvent<MarkerDragDetail>): void {
    const markerName = this._draggingMarker;
    const startValue = this._dragStartValue;

    // Check if marker actually moved before playing preview
    if (markerName && startValue !== null) {
      const endValue = this._getMarkerValue(markerName);
      const moved = Math.abs(endValue - startValue) > 1; // Threshold of 1ms

      if (moved) {
        this._playMarkerPreview(markerName, endValue);
      }

      // Select this marker for keyboard nudging
      this._selectedMarker = markerName;
    }

    this._draggingMarker = null;
    this._dragStartValue = null;
  }

  // ==================== Click-to-Seek Methods ====================

  /**
   * Handle mousedown on the canvas area for click-to-seek.
   * Records the initial position to distinguish clicks from drags.
   */
  private _onCanvasMouseDown = (e: MouseEvent): void => {
    // Only track left-clicks on the background (not on markers)
    if (e.button !== 0) return;

    // Store the position for click detection
    this._mouseDownX = e.clientX;
    this._mouseDownY = e.clientY;

    // Add listeners for click detection
    document.addEventListener('mouseup', this._onCanvasMouseUp);
  };

  /**
   * Handle mouseup to complete click-to-seek if it was a click (not drag).
   */
  private _onCanvasMouseUp = (e: MouseEvent): void => {
    // Remove the listener
    document.removeEventListener('mouseup', this._onCanvasMouseUp);

    // If we were dragging a marker, don't seek
    if (this._draggingMarker) {
      this._mouseDownX = null;
      this._mouseDownY = null;
      return;
    }

    // Check if this was a click (minimal movement)
    if (this._mouseDownX === null || this._mouseDownY === null) return;

    const deltaX = Math.abs(e.clientX - this._mouseDownX);
    const deltaY = Math.abs(e.clientY - this._mouseDownY);
    const clickThreshold = 5; // pixels

    if (deltaX <= clickThreshold && deltaY <= clickThreshold) {
      // This was a click - seek to position
      this._seekToClickPosition(e);
    }

    this._mouseDownX = null;
    this._mouseDownY = null;
  };

  /**
   * Seek playback to the clicked position on the waveform.
   * Starts playback from the clicked position to the cutoff point.
   * Also clears any selected marker.
   */
  private _seekToClickPosition(e: MouseEvent): void {
    if (!this.audioBuffer || !this._canvasWrapper) return;

    // Clear selected marker when clicking on the waveform background
    this._selectedMarker = null;

    // Calculate X position relative to canvas
    const rect = this._canvasWrapper.getBoundingClientRect();
    const scrollLeft = this._canvasWrapper.scrollLeft;
    const x = e.clientX - rect.left + scrollLeft;

    // Clamp to canvas bounds
    const clampedX = Math.max(0, Math.min(x, this._canvasWidth));

    // Convert to milliseconds
    const seekPositionMs = this._pixelToMs(clampedX);

    // Start playback from clicked position
    this._playFromPosition(seekPositionMs);
  }

  /**
   * Start playback from a specific position (in ms) to the cutoff point.
   * If already playing, stops current playback and restarts from new position.
   */
  private async _playFromPosition(positionMs: number): Promise<void> {
    if (!this.audioBuffer) return;

    // Stop any existing playback
    this._stopPlayback();
    this._stopMarkerPreview();

    // Create audio context if needed
    if (!this._audioContext) {
      this._audioContext = new AudioContext();
    }

    // Resume context if suspended
    if (this._audioContext.state === 'suspended') {
      await this._audioContext.resume();
    }

    // Calculate playback range
    const startTime = positionMs / 1000;
    const endTime = this._getPlaybackEndTime();
    const duration = Math.max(0, endTime - startTime);

    if (duration <= 0) {
      // Clicked position is past cutoff - play nothing
      return;
    }

    // Create and configure source node
    this._sourceNode = this._audioContext.createBufferSource();
    this._sourceNode.buffer = this.audioBuffer;
    this._sourceNode.connect(this._audioContext.destination);

    // Store timing info for playhead animation
    this._playbackStartTime = this._audioContext.currentTime;
    this._playbackStartPosition = startTime;
    this._playbackPosition = positionMs;

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

  // ==================== End Click-to-Seek Methods ====================

  // ==================== Marker Preview Methods ====================

  /**
   * Play a short audio preview centered on a marker position.
   * Called after a marker drag is released to provide instant feedback.
   *
   * @param markerName - Name of the marker that was dragged
   * @param markerValue - Current value of the marker in ms
   */
  private async _playMarkerPreview(markerName: string, markerValue: number): Promise<void> {
    if (!this.audioBuffer) return;

    // Stop any existing preview
    this._stopMarkerPreview();

    // Create audio context if needed
    if (!this._audioContext) {
      this._audioContext = new AudioContext();
    }

    // Resume context if suspended
    if (this._audioContext.state === 'suspended') {
      await this._audioContext.resume();
    }

    const duration = this.audioBuffer.duration * 1000; // Total duration in ms
    const previewDuration = 500; // 500ms preview duration
    const halfPreview = previewDuration / 2;

    let startMs: number;
    let endMs: number;

    switch (markerName) {
      case 'offset':
      case 'preutterance':
        // Play from marker position for ~500ms
        startMs = Math.max(0, markerValue);
        endMs = Math.min(duration, startMs + previewDuration);
        break;

      case 'consonant':
        // Play the consonant region (from offset to consonant marker)
        // If consonant region is short, extend preview a bit after
        startMs = Math.max(0, this.offset);
        endMs = Math.min(duration, Math.max(markerValue, this.offset + previewDuration));
        break;

      case 'cutoff':
        // Cutoff is negative from end; play ~500ms ending at cutoff
        // Convert cutoff to absolute position
        const cutoffPosition = duration + markerValue; // markerValue is negative
        endMs = Math.max(0, Math.min(duration, cutoffPosition));
        startMs = Math.max(0, endMs - previewDuration);
        break;

      case 'overlap':
        // Play the overlap region centered on the overlap marker
        startMs = Math.max(0, markerValue - halfPreview);
        endMs = Math.min(duration, markerValue + halfPreview);
        break;

      default:
        return;
    }

    // Ensure we have valid range
    const playDuration = (endMs - startMs) / 1000; // Convert to seconds
    if (playDuration <= 0) return;

    // Create and configure source node
    this._previewSourceNode = this._audioContext.createBufferSource();
    this._previewSourceNode.buffer = this.audioBuffer;
    this._previewSourceNode.connect(this._audioContext.destination);

    // Start playback
    this._previewSourceNode.start(0, startMs / 1000, playDuration);

    // Handle playback end
    this._previewSourceNode.onended = () => {
      this._previewSourceNode = null;
    };
  }

  /**
   * Stop any active marker preview playback.
   */
  private _stopMarkerPreview(): void {
    if (this._previewSourceNode) {
      try {
        this._previewSourceNode.stop();
      } catch {
        // Ignore errors if already stopped
      }
      this._previewSourceNode.disconnect();
      this._previewSourceNode = null;
    }
  }

  // ==================== End Marker Preview Methods ====================

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
        // If a marker is selected, nudge it; otherwise pan
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
        // Cycle through markers when one is selected
        if (this._selectedMarker) {
          e.preventDefault();
          this._cycleSelectedMarker(e.key === 'ArrowUp' ? -1 : 1);
        }
        break;
      case ' ':
        e.preventDefault();
        this._togglePlayback();
        break;
      case 'Escape':
        e.preventDefault();
        this._stopPlayback();
        this._stopPreview();
        this._stopMarkerPreview();
        // Also deselect marker on Escape
        this._selectedMarker = null;
        break;
      case 'p':
      case 'P':
        e.preventDefault();
        this._togglePreview();
        break;
      case 'd':
      case 'D':
        // Toggle dark mode with 'd' key
        e.preventDefault();
        this._toggleTheme();
        break;
      case 'Tab':
        // Allow Tab to cycle through markers without preventing default navigation
        if (this.audioBuffer) {
          e.preventDefault();
          this._cycleSelectedMarker(e.shiftKey ? -1 : 1);
        }
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

  /**
   * List of marker names in order for cycling.
   */
  private readonly _markerOrder = ['offset', 'overlap', 'preutterance', 'consonant', 'cutoff'];

  /**
   * Nudge the selected marker by a delta amount.
   * @param direction - Direction to nudge (-1 for left, +1 for right)
   * @param large - Whether to use large step (10ms) or small step (1ms)
   */
  private _nudgeSelectedMarker(direction: number, large: boolean): void {
    if (!this._selectedMarker || !this.audioBuffer) return;

    const step = large ? 10 : 1;
    const delta = direction * step;
    const currentValue = this._getMarkerValue(this._selectedMarker);
    const duration = this.audioBuffer.duration * 1000;

    let newValue: number;

    if (this._selectedMarker === 'cutoff') {
      // Cutoff is negative from end
      newValue = currentValue + delta;
      // Clamp cutoff to valid range (must be negative or zero)
      newValue = Math.min(0, Math.max(-duration, newValue));
    } else {
      // Other markers are positive from start
      newValue = currentValue + delta;
      // Clamp to valid range
      newValue = Math.max(0, Math.min(duration, newValue));
    }

    // Only emit if value changed
    if (newValue !== currentValue) {
      this._emitMarkerChange(this._selectedMarker, Math.round(newValue));
    }
  }

  /**
   * Cycle to the next or previous marker.
   * @param direction - Direction to cycle (-1 for previous, +1 for next)
   */
  private _cycleSelectedMarker(direction: number): void {
    if (!this.audioBuffer) return;

    const currentIndex = this._selectedMarker
      ? this._markerOrder.indexOf(this._selectedMarker)
      : -1;

    let nextIndex: number;
    if (currentIndex === -1) {
      // No marker selected, start with first or last
      nextIndex = direction > 0 ? 0 : this._markerOrder.length - 1;
    } else {
      // Cycle to next/previous
      nextIndex = (currentIndex + direction + this._markerOrder.length) % this._markerOrder.length;
    }

    this._selectedMarker = this._markerOrder[nextIndex];
  }

  // ==================== Undo Methods ====================

  /**
   * Maximum number of undo history entries to keep.
   */
  private readonly _maxUndoHistory = 5;

  /**
   * Save current marker positions to undo history.
   */
  private _saveToUndoHistory(): void {
    const snapshot: MarkerSnapshot = {
      offset: this.offset,
      consonant: this.consonant,
      cutoff: this.cutoff,
      preutterance: this.preutterance,
      overlap: this.overlap,
      timestamp: Date.now(),
    };

    // Don't save duplicate snapshots (within 100ms)
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

    // Add to history, keeping only last N entries
    this._undoHistory = [...this._undoHistory, snapshot].slice(-this._maxUndoHistory);
  }

  /**
   * Perform undo operation - restore previous marker positions.
   */
  private _performUndo(): void {
    if (this._undoHistory.length < 2) {
      // Need at least 2 entries: current and previous
      return;
    }

    // Get the previous snapshot (second to last)
    const previousSnapshot = this._undoHistory[this._undoHistory.length - 2];

    // Create ghost markers showing current positions before undo
    this._showGhostMarkers();

    // Remove the current snapshot from history
    this._undoHistory = this._undoHistory.slice(0, -1);

    // Emit marker changes to restore previous positions
    this._emitMarkerChange('offset', previousSnapshot.offset);
    this._emitMarkerChange('consonant', previousSnapshot.consonant);
    this._emitMarkerChange('cutoff', previousSnapshot.cutoff);
    this._emitMarkerChange('preutterance', previousSnapshot.preutterance);
    this._emitMarkerChange('overlap', previousSnapshot.overlap);
  }

  /**
   * Show ghost markers at current positions before undo.
   */
  private _showGhostMarkers(): void {
    // Clear any existing timer
    if (this._ghostTimer !== null) {
      clearTimeout(this._ghostTimer);
    }

    // Create ghost markers from current positions
    this._ghostMarkers = [
      { name: 'offset', position: this._msToPixel(this.offset), value: this.offset },
      { name: 'consonant', position: this._msToPixel(this.consonant), value: this.consonant },
      { name: 'cutoff', position: this._getCutoffPixel(), value: this.cutoff },
      { name: 'preutterance', position: this._msToPixel(this.preutterance), value: this.preutterance },
      { name: 'overlap', position: this._msToPixel(this.overlap), value: this.overlap },
    ];

    // Clear ghost markers after animation (1 second)
    this._ghostTimer = window.setTimeout(() => {
      this._ghostMarkers = [];
      this._ghostTimer = null;
    }, 1000);
  }

  // ==================== Theme Methods ====================

  /**
   * Toggle between light and dark theme.
   */
  private _toggleTheme(): void {
    if (this.theme === 'auto') {
      // When in auto, switch to opposite of current resolved theme
      this.theme = this._resolvedTheme === 'dark' ? 'light' : 'dark';
    } else {
      // Toggle between light and dark
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
    }

    // Emit event for parent components
    this.dispatchEvent(
      new CustomEvent('theme-change', {
        detail: { theme: this.theme },
        bubbles: true,
        composed: true,
      })
    );
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

  // ==================== Melody Preview Methods ====================

  /**
   * Build an OtoEntry from the component's individual oto properties.
   * The MelodyPlayer needs a complete OtoEntry object.
   */
  private _buildCurrentOtoEntry(): OtoEntry {
    return {
      filename: 'sample.wav', // Placeholder - not used by MelodyPlayer
      alias: 'sample',        // Placeholder - not used by MelodyPlayer
      offset: this.offset,
      consonant: this.consonant,
      cutoff: this.cutoff,
      preutterance: this.preutterance,
      overlap: this.overlap,
    };
  }

  /**
   * Toggle melody preview on/off.
   */
  private _togglePreview(): void {
    if (this._isPreviewPlaying) {
      this._stopPreview();
    } else {
      this._startPreview();
    }
  }

  /**
   * Start melody preview with the selected pattern.
   */
  private _startPreview(): void {
    if (!this.audioBuffer) return;

    // Stop regular playback if active
    if (this._isPlaying) {
      this._stopPlayback();
    }

    // Initialize AudioContext if needed
    if (!this._audioContext) {
      this._audioContext = new AudioContext();
    }

    // Resume context if suspended (browser autoplay policy)
    if (this._audioContext.state === 'suspended') {
      this._audioContext.resume();
    }

    // Initialize MelodyPlayer if needed (reuses existing audioContext)
    if (!this._melodyPlayer) {
      this._melodyPlayer = new MelodyPlayer(this._audioContext);
    }

    const pattern = getMelodyPattern(this._selectedPatternId);
    if (!pattern) return;

    const otoEntry = this._buildCurrentOtoEntry();

    this._melodyPlayer.playSequence(pattern.notes, {
      otoEntry,
      audioBuffer: this.audioBuffer,
    });
    this._isPreviewPlaying = true;

    // Calculate total pattern duration and schedule end
    const totalDuration = pattern.notes.reduce((max, note) => {
      return Math.max(max, note.startTime + note.duration);
    }, 0);

    // Check periodically if playback has ended
    const checkInterval = setInterval(() => {
      if (!this._melodyPlayer?.isPlaying) {
        this._isPreviewPlaying = false;
        clearInterval(checkInterval);
      }
    }, 100);

    // Fallback: stop after pattern duration + buffer
    setTimeout(() => {
      clearInterval(checkInterval);
      if (this._isPreviewPlaying && !this._melodyPlayer?.isPlaying) {
        this._isPreviewPlaying = false;
      }
    }, (totalDuration + 0.5) * 1000);
  }

  /**
   * Stop melody preview.
   */
  private _stopPreview(): void {
    this._melodyPlayer?.stop();
    this._isPreviewPlaying = false;
  }

  /**
   * Handle pattern selection change.
   */
  private _onPatternChange(e: Event): void {
    const select = e.target as HTMLSelectElement;
    this._selectedPatternId = select.value;
  }

  // ==================== End Melody Preview Methods ====================

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

  /**
   * Render region shading for the waveform.
   * Shows excluded regions (before offset, after cutoff) with diagonal stripes,
   * and the fixed region (offset to consonant) with a light blue tint.
   */
  private _renderRegions(): unknown {
    if (!this.audioBuffer) return null;

    const offsetPixel = this._msToPixel(this.offset);
    const consonantPixel = this._msToPixel(this.consonant);
    const cutoffPixel = this._getCutoffPixel();
    const totalHeight = this.height + this._dividerHeight + this.spectrogramHeight;

    return html`
      <div class="region-shading" style="height: ${totalHeight}px;">
        <!-- Before offset - excluded -->
        <div
          class="region region-excluded"
          style="left: 0; width: ${offsetPixel}px;"
        ></div>

        <!-- Offset to Consonant - fixed region -->
        <div
          class="region region-fixed"
          style="left: ${offsetPixel}px; width: ${Math.max(0, consonantPixel - offsetPixel)}px;"
        ></div>

        <!-- Consonant to Cutoff - stretchable (no shading) -->

        <!-- After Cutoff - excluded -->
        <div
          class="region region-excluded"
          style="left: ${cutoffPixel}px; right: 0;"
        ></div>
      </div>
    `;
  }

  /**
   * Render all 5 oto.ini markers using uvm-marker-handle components.
   */
  private _renderMarkers(): unknown {
    if (!this.audioBuffer) return null;

    const markers = [
      { name: 'offset', position: this._msToPixel(this.offset), value: this.offset },
      { name: 'consonant', position: this._msToPixel(this.consonant), value: this.consonant },
      { name: 'cutoff', position: this._getCutoffPixel(), value: this.cutoff },
      { name: 'preutterance', position: this._msToPixel(this.preutterance), value: this.preutterance },
      { name: 'overlap', position: this._msToPixel(this.overlap), value: this.overlap },
    ];

    return markers.map((m) => {
      const config = MARKER_CONFIGS[m.name];
      const isSelected = this._selectedMarker === m.name;
      const isDragging = this._draggingMarker === m.name;
      return html`
        <uvm-marker-handle
          name=${m.name}
          label=${config.label}
          icon=${config.icon}
          hint=${isSelected ? 'Arrow keys to nudge' : config.hint}
          color=${config.color}
          .position=${m.position}
          .value=${m.value}
          .waveformHeight=${this.height}
          .spectrogramHeight=${this.spectrogramHeight}
          .dividerHeight=${this._dividerHeight}
          ?dragging=${isDragging}
          ?selected=${isSelected}
          @uvm-marker:dragstart=${this._onMarkerDragStart}
          @uvm-marker:drag=${this._onMarkerDrag}
          @uvm-marker:dragend=${this._onMarkerDragEnd}
        ></uvm-marker-handle>
      `;
    });
  }

  /**
   * Render the playhead indicator.
   */
  private _renderPlayhead(): unknown {
    if (!this._isPlaying) return null;
    return html`<div class="playhead" style="left: ${this._getPlayheadPixel()}px;"></div>`;
  }

  /**
   * Render the playback glow effect during audio playback.
   * The glow covers the active playback region (offset to cutoff).
   */
  private _renderPlaybackGlow(): unknown {
    if (!this._isPlaying || !this.audioBuffer) return null;

    const offsetPixel = this._msToPixel(this.offset);
    const cutoffPixel = this._getCutoffPixel();
    const totalHeight = this.height + this._dividerHeight + this.spectrogramHeight;

    // Determine glow intensity class based on amplitude
    const glowClass = this._currentAmplitude > 0.5 ? 'playback-glow loud' : 'playback-glow';

    return html`
      <div
        class=${glowClass}
        style="
          left: ${offsetPixel}px;
          width: ${Math.max(0, cutoffPixel - offsetPixel)}px;
          height: ${totalHeight}px;
        "
      ></div>
    `;
  }

  /**
   * Render ghost markers showing previous positions during undo.
   */
  private _renderGhostMarkers(): unknown {
    if (this._ghostMarkers.length === 0) return null;

    const totalHeight = this.height + this._dividerHeight + this.spectrogramHeight;

    return this._ghostMarkers.map((ghost) => {
      const config = MARKER_CONFIGS[ghost.name];
      return html`
        <div
          class="ghost-marker"
          style="
            left: ${ghost.position}px;
            height: ${totalHeight}px;
            border-color: ${config.color};
          "
        >
          <div
            class="ghost-marker-handle"
            style="border-color: ${config.color};"
          ></div>
        </div>
      `;
    });
  }

  render() {
    const duration = this._getDuration();
    const isDark = this._resolvedTheme === 'dark';

    // Determine container class based on theme
    const containerClass = isDark ? 'waveform-container dark' : 'waveform-container';
    const controlsClass = isDark ? 'controls dark' : 'controls';

    return html`
      <div class=${containerClass}>
        <div class=${controlsClass}>
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
          <div class="preview-controls">
            <sl-select
              size="small"
              value=${this._selectedPatternId}
              @sl-change=${this._onPatternChange}
              ?disabled=${!this.audioBuffer}
            >
              ${MELODY_PATTERNS.map(
                (p) => html`<sl-option value=${p.id}>${p.name}</sl-option>`
              )}
            </sl-select>
            <button
              class="preview-btn ${this._isPreviewPlaying ? 'playing' : ''}"
              @click=${this._togglePreview}
              ?disabled=${!this.audioBuffer}
              title="Preview with melody pattern (P)"
            >
              <sl-icon name=${this._isPreviewPlaying ? 'stop-fill' : 'music-note-beamed'}></sl-icon>
              ${this._isPreviewPlaying ? 'Stop' : 'Preview'}
            </button>
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
          <span class="keyboard-hint">${this._selectedMarker
            ? `${MARKER_CONFIGS[this._selectedMarker].label}: Arrow nudge | Shift+Arrow 10ms | Tab next`
            : 'Click to seek | Space play | Ctrl+Z undo | D dark mode'}</span>
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
                  <div class="canvas-area" style="width: ${this._canvasWidth}px; cursor: pointer;" @mousedown=${this._onCanvasMouseDown}>
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
                      <!-- Frequency axis labels -->
                      <div class="freq-axis">
                        <span class="freq-label">8k</span>
                        <span class="freq-label">4k</span>
                        <span class="freq-label">0</span>
                      </div>
                    </div>

                    <!-- Markers Layer spans both sections -->
                    <div class="markers-layer" style="height: ${this.height + this._dividerHeight + this.spectrogramHeight}px;">
                      ${this._renderRegions()}
                      ${this._renderPlaybackGlow()}
                      ${this._renderGhostMarkers()}
                      ${this._renderMarkers()}
                      ${this._renderPlayhead()}
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
