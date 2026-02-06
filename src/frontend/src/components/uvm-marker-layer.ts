/**
 * uvm-marker-layer.ts
 *
 * Renders oto.ini marker handles, region shading, and ghost markers
 * on top of the waveform/spectrogram canvas stack.
 *
 * Handles marker drag interaction by listening to uvm-marker-handle events
 * and converting pixel positions to millisecond values. Also manages
 * click-to-seek and marker selection for keyboard nudging.
 *
 * Communication: receives marker values as properties from the parent;
 * emits `marker-change`, `seek`, and `marker-selected` events upward.
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import './uvm-marker-handle.js';
import type { MarkerDragDetail } from './uvm-marker-handle.js';

/**
 * Ghost marker for undo visualization.
 */
export interface GhostMarker {
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

/** Ordered list of marker names for Tab cycling. */
const MARKER_ORDER = ['offset', 'overlap', 'preutterance', 'consonant', 'cutoff'];

export { MARKER_CONFIGS, MARKER_ORDER };

/**
 * Overlay layer that renders oto.ini markers, region shading,
 * ghost markers, and a playback playhead on top of the waveform.
 *
 * @fires marker-change - When a marker is dragged to a new position
 * @fires seek - When the user clicks on the waveform to seek
 * @fires marker-selected - When a marker becomes selected (for keyboard nudging)
 * @fires marker-preview - When a marker drag completes and preview should play
 */
@customElement('uvm-marker-layer')
export class UvmMarkerLayer extends LitElement {
  static styles = css`
    :host {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }

    .interaction-surface {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: auto;
      cursor: pointer;
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

    /* Playhead indicator */
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

    /* Playback region glow animation */
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

    /* Ghost markers for undo visualization */
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

  // ==================== Public Properties ====================

  /** Audio buffer duration in milliseconds (needed for coordinate conversion). */
  @property({ type: Number })
  audioDurationMs = 0;

  /** Total canvas width in pixels. */
  @property({ type: Number })
  canvasWidth = 800;

  /** Height of the waveform section in pixels. */
  @property({ type: Number })
  waveformHeight = 195;

  /** Height of the spectrogram section in pixels. */
  @property({ type: Number })
  spectrogramHeight = 270;

  /** Height of the section divider in pixels. */
  @property({ type: Number })
  dividerHeight = 2;

  /** Offset marker position in milliseconds. */
  @property({ type: Number })
  offset = 0;

  /** Consonant marker position in milliseconds. */
  @property({ type: Number })
  consonant = 0;

  /** Cutoff position in milliseconds (negative = from end). */
  @property({ type: Number })
  cutoff = 0;

  /** Preutterance position in milliseconds. */
  @property({ type: Number })
  preutterance = 0;

  /** Overlap position in milliseconds. */
  @property({ type: Number })
  overlap = 0;

  /** Whether audio is currently playing (controls playhead/glow rendering). */
  @property({ type: Boolean })
  playing = false;

  /** Playback position in milliseconds from start of audio. */
  @property({ type: Number })
  playbackPosition = 0;

  /** Current amplitude level (0-1) for playback glow intensity. */
  @property({ type: Number })
  currentAmplitude = 0;

  /** Ghost markers to display during undo visualization. */
  @property({ attribute: false })
  ghostMarkers: GhostMarker[] = [];

  /** Currently selected marker name (for keyboard nudging highlight). */
  @property({ type: String })
  selectedMarker: string | null = null;

  /** Theme for dark mode styling. */
  @property({ type: String, reflect: true })
  theme: 'light' | 'dark' = 'light';

  /** Scroll offset of the parent canvas wrapper (needed for drag coordinate conversion). */
  @property({ type: Number })
  scrollLeft = 0;

  /** Bounding rect left of the parent canvas wrapper (needed for drag coordinate conversion). */
  @property({ type: Number })
  wrapperLeft = 0;

  // ==================== Private State ====================

  @state()
  private _draggingMarker: string | null = null;

  /**
   * Starting value (ms) of a marker when drag begins.
   * Used to detect if marker actually moved before emitting preview event.
   */
  private _dragStartValue: number | null = null;

  /**
   * Track mousedown position to detect click vs drag for seek.
   */
  private _mouseDownX: number | null = null;
  private _mouseDownY: number | null = null;

  // ==================== Lifecycle ====================

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('mouseup', this._onSurfaceMouseUp);
  }

  // ==================== Coordinate Conversion ====================

  /** Convert milliseconds to pixel position. */
  private _msToPixel(ms: number): number {
    if (this.audioDurationMs <= 0) return 0;
    return (ms / this.audioDurationMs) * this.canvasWidth;
  }

  /** Convert pixel position to milliseconds. */
  private _pixelToMs(pixel: number): number {
    if (this.audioDurationMs <= 0) return 0;
    return Math.round((pixel / this.canvasWidth) * this.audioDurationMs);
  }

  /** Get effective pixel position for cutoff marker (negative from end). */
  private _getCutoffPixel(): number {
    if (this.audioDurationMs <= 0) return 0;
    const effectiveMs = this.audioDurationMs + this.cutoff;
    return this._msToPixel(effectiveMs);
  }

  /** Get the playhead pixel position. */
  private _getPlayheadPixel(): number {
    return this._msToPixel(this.playbackPosition);
  }

  /** Get current value (ms) of a marker by name. */
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

  private _onMarkerDragStart(e: CustomEvent<MarkerDragDetail>): void {
    this._draggingMarker = e.detail.name;
    this._dragStartValue = this._getMarkerValue(e.detail.name);
  }

  private _onMarkerDrag(e: CustomEvent<MarkerDragDetail>): void {
    if (!this._draggingMarker || e.detail.clientX === undefined) return;

    const x = e.detail.clientX - this.wrapperLeft + this.scrollLeft;
    const clampedX = Math.max(0, Math.min(x, this.canvasWidth));

    let newValue: number;
    if (this._draggingMarker === 'cutoff') {
      const msFromStart = this._pixelToMs(clampedX);
      newValue = Math.round(msFromStart - this.audioDurationMs);
      newValue = Math.min(0, Math.max(-this.audioDurationMs, newValue));
    } else {
      newValue = Math.round(Math.max(0, this._pixelToMs(clampedX)));
    }

    this._emitMarkerChange(this._draggingMarker, newValue);
  }

  private _onMarkerDragEnd(_e: CustomEvent<MarkerDragDetail>): void {
    const markerName = this._draggingMarker;
    const startValue = this._dragStartValue;

    if (markerName && startValue !== null) {
      const endValue = this._getMarkerValue(markerName);
      const moved = Math.abs(endValue - startValue) > 1;

      if (moved) {
        this.dispatchEvent(
          new CustomEvent('marker-preview', {
            detail: { name: markerName, value: endValue },
            bubbles: true,
            composed: true,
          })
        );
      }

      // Select this marker for keyboard nudging
      this.dispatchEvent(
        new CustomEvent('marker-selected', {
          detail: { name: markerName },
          bubbles: true,
          composed: true,
        })
      );
    }

    this._draggingMarker = null;
    this._dragStartValue = null;
  }

  // ==================== Click-to-Seek ====================

  private _onSurfaceMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    this._mouseDownX = e.clientX;
    this._mouseDownY = e.clientY;
    document.addEventListener('mouseup', this._onSurfaceMouseUp);
  };

  private _onSurfaceMouseUp = (e: MouseEvent): void => {
    document.removeEventListener('mouseup', this._onSurfaceMouseUp);

    if (this._draggingMarker) {
      this._mouseDownX = null;
      this._mouseDownY = null;
      return;
    }

    if (this._mouseDownX === null || this._mouseDownY === null) return;

    const deltaX = Math.abs(e.clientX - this._mouseDownX);
    const deltaY = Math.abs(e.clientY - this._mouseDownY);
    const clickThreshold = 5;

    if (deltaX <= clickThreshold && deltaY <= clickThreshold) {
      this._seekToClickPosition(e);
    }

    this._mouseDownX = null;
    this._mouseDownY = null;
  };

  private _seekToClickPosition(e: MouseEvent): void {
    if (this.audioDurationMs <= 0) return;

    // Clear selected marker when clicking on the waveform background
    this.dispatchEvent(
      new CustomEvent('marker-selected', {
        detail: { name: null },
        bubbles: true,
        composed: true,
      })
    );

    const x = e.clientX - this.wrapperLeft + this.scrollLeft;
    const clampedX = Math.max(0, Math.min(x, this.canvasWidth));
    const seekPositionMs = this._pixelToMs(clampedX);

    this.dispatchEvent(
      new CustomEvent('seek', {
        detail: { positionMs: seekPositionMs },
        bubbles: true,
        composed: true,
      })
    );
  }

  // ==================== Event Emitters ====================

  private _emitMarkerChange(name: string, value: number): void {
    this.dispatchEvent(
      new CustomEvent('marker-change', {
        detail: { name, value },
        bubbles: true,
        composed: true,
      })
    );
  }

  // ==================== Render Helpers ====================

  private _renderRegions(): unknown {
    if (this.audioDurationMs <= 0) return null;

    const offsetPixel = this._msToPixel(this.offset);
    const consonantPixel = this._msToPixel(this.consonant);
    const cutoffPixel = this._getCutoffPixel();
    const totalHeight = this.waveformHeight + this.dividerHeight + this.spectrogramHeight;

    return html`
      <div class="region-shading" style="height: ${totalHeight}px;">
        <div
          class="region region-excluded"
          style="left: 0; width: ${offsetPixel}px;"
        ></div>
        <div
          class="region region-fixed"
          style="left: ${offsetPixel}px; width: ${Math.max(0, consonantPixel - offsetPixel)}px;"
        ></div>
        <div
          class="region region-excluded"
          style="left: ${cutoffPixel}px; right: 0;"
        ></div>
      </div>
    `;
  }

  private _renderPlaybackGlow(): unknown {
    if (!this.playing || this.audioDurationMs <= 0) return null;

    const offsetPixel = this._msToPixel(this.offset);
    const cutoffPixel = this._getCutoffPixel();
    const totalHeight = this.waveformHeight + this.dividerHeight + this.spectrogramHeight;
    const glowClass = this.currentAmplitude > 0.5 ? 'playback-glow loud' : 'playback-glow';

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

  private _renderGhostMarkers(): unknown {
    if (this.ghostMarkers.length === 0) return null;

    const totalHeight = this.waveformHeight + this.dividerHeight + this.spectrogramHeight;

    return this.ghostMarkers.map((ghost) => {
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

  private _renderMarkers(): unknown {
    if (this.audioDurationMs <= 0) return null;

    const markers = [
      { name: 'offset', position: this._msToPixel(this.offset), value: this.offset },
      { name: 'consonant', position: this._msToPixel(this.consonant), value: this.consonant },
      { name: 'cutoff', position: this._getCutoffPixel(), value: this.cutoff },
      { name: 'preutterance', position: this._msToPixel(this.preutterance), value: this.preutterance },
      { name: 'overlap', position: this._msToPixel(this.overlap), value: this.overlap },
    ];

    return markers.map((m) => {
      const config = MARKER_CONFIGS[m.name];
      const isSelected = this.selectedMarker === m.name;
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
          .waveformHeight=${this.waveformHeight}
          .spectrogramHeight=${this.spectrogramHeight}
          .dividerHeight=${this.dividerHeight}
          ?dragging=${isDragging}
          ?selected=${isSelected}
          @uvm-marker:dragstart=${this._onMarkerDragStart}
          @uvm-marker:drag=${this._onMarkerDrag}
          @uvm-marker:dragend=${this._onMarkerDragEnd}
        ></uvm-marker-handle>
      `;
    });
  }

  private _renderPlayhead(): unknown {
    if (!this.playing) return null;
    return html`<div class="playhead" style="left: ${this._getPlayheadPixel()}px;"></div>`;
  }

  // ==================== Main Render ====================

  render() {
    return html`
      <div class="interaction-surface" @mousedown=${this._onSurfaceMouseDown}></div>
      ${this._renderRegions()}
      ${this._renderPlaybackGlow()}
      ${this._renderGhostMarkers()}
      ${this._renderMarkers()}
      ${this._renderPlayhead()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-marker-layer': UvmMarkerLayer;
  }
}
