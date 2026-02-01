/**
 * uvm-marker-handle.ts
 *
 * A reusable component for rendering a single oto.ini marker
 * (offset, consonant, cutoff, preutterance, overlap).
 *
 * The parent waveform editor creates 5 instances of this component,
 * one for each marker type.
 */

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * Event detail for marker drag events.
 */
export interface MarkerDragDetail {
  name: string;
  clientX?: number;
}

/**
 * A draggable marker handle for oto.ini parameter visualization.
 *
 * @fires uvm-marker:dragstart - When drag begins
 * @fires uvm-marker:drag - During drag movement
 * @fires uvm-marker:dragend - When drag ends
 *
 * @csspart line-waveform - The solid line in the waveform section
 * @csspart line-spectrogram - The dashed line in the spectrogram section
 * @csspart handle - The circular drag handle
 * @csspart label - The tooltip label showing value
 *
 * @cssprop --uvm-duration-fast - Animation duration (default: 200ms)
 * @cssprop --uvm-ease-spring - Spring easing function
 */
@customElement('uvm-marker-handle')
export class UvmMarkerHandle extends LitElement {
  static styles = css`
    :host {
      position: absolute;
      top: 0;
      pointer-events: auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: ew-resize;
      transform: translateX(-50%);
      /* Default transition for position changes */
      transition: left var(--uvm-duration-fast, 200ms)
        var(--uvm-ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
    }

    /* Disable position transition during drag */
    :host([dragging]) {
      transition: none;
    }

    /* High confidence: quick, decisive spring animation */
    :host([confidence="high"]) {
      transition: left 150ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    /* Medium confidence: moderate animation */
    :host([confidence="medium"]) {
      transition: left 250ms cubic-bezier(0.25, 1, 0.5, 1);
    }

    /* Low confidence: slow, tentative drift */
    :host([confidence="low"]) {
      transition: left 400ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    /* Respect reduced motion preference */
    @media (prefers-reduced-motion: reduce) {
      :host,
      :host([confidence="high"]),
      :host([confidence="medium"]),
      :host([confidence="low"]) {
        transition: none;
      }

      .marker-line-waveform,
      .marker-line-spectrogram,
      .marker-handle,
      .marker-label,
      .confidence-indicator {
        transition: none;
        animation: none;
      }

      :host([selected]) .marker-line-waveform {
        animation: none;
        box-shadow: 0 0 12px currentColor;
      }
    }

    .marker-line-waveform {
      width: 2px;
      opacity: 0.85;
      transition: all var(--uvm-duration-fast, 200ms)
        var(--uvm-ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
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
      transition: all var(--uvm-duration-fast, 200ms)
        var(--uvm-ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
    }

    :host(:hover) .marker-line-waveform,
    :host([dragging]) .marker-line-waveform,
    :host([selected]) .marker-line-waveform {
      opacity: 1;
      width: 3px;
      box-shadow: 0 0 8px currentColor;
    }

    :host([selected]) .marker-line-waveform {
      animation: pulse-glow 1.5s ease-in-out infinite;
    }

    @keyframes pulse-glow {
      0%, 100% { box-shadow: 0 0 8px currentColor; }
      50% { box-shadow: 0 0 16px currentColor; }
    }

    :host(:hover) .marker-line-spectrogram,
    :host([dragging]) .marker-line-spectrogram,
    :host([selected]) .marker-line-spectrogram {
      opacity: 0.7;
      width: 2px;
    }

    .marker-handle {
      position: absolute;
      top: -8px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      cursor: ew-resize;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      color: white;
      font-weight: 500;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
      transition: transform var(--uvm-duration-fast, 200ms)
        var(--uvm-ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
      z-index: 10;
    }

    :host(:hover) .marker-handle,
    :host([dragging]) .marker-handle,
    :host([selected]) .marker-handle {
      transform: scale(1.15);
    }

    /* Confidence indicator ring around handle */
    .confidence-indicator {
      position: absolute;
      top: -12px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 2px solid transparent;
      opacity: 0;
      transition: opacity var(--uvm-duration-fast, 200ms) ease-out;
      pointer-events: none;
      z-index: 9;
    }

    :host([confidence="high"]) .confidence-indicator {
      border-color: var(--uvm-success, #22c55e);
      opacity: 0.8;
      animation: confidence-pulse-high 0.5s ease-out;
    }

    :host([confidence="medium"]) .confidence-indicator {
      border-color: var(--uvm-warning, #f59e0b);
      opacity: 0.6;
      animation: confidence-pulse-medium 0.8s ease-out;
    }

    :host([confidence="low"]) .confidence-indicator {
      border-color: var(--uvm-secondary, #9ca3af);
      opacity: 0.4;
      animation: confidence-pulse-low 1.2s ease-out;
    }

    @keyframes confidence-pulse-high {
      0% { transform: scale(1.5); opacity: 0; }
      50% { opacity: 0.8; }
      100% { transform: scale(1); opacity: 0.8; }
    }

    @keyframes confidence-pulse-medium {
      0% { transform: scale(1.3); opacity: 0; }
      60% { opacity: 0.6; }
      100% { transform: scale(1); opacity: 0.6; }
    }

    @keyframes confidence-pulse-low {
      0% { transform: scale(1.2); opacity: 0; }
      70% { opacity: 0.4; }
      100% { transform: scale(1); opacity: 0.4; }
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
      transition:
        opacity var(--uvm-duration-fast, 200ms)
          var(--uvm-ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)),
        transform var(--uvm-duration-fast, 200ms)
          var(--uvm-ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
      pointer-events: none;
      transform: translateY(4px);
    }

    :host(:hover) .marker-label,
    :host([dragging]) .marker-label,
    :host([selected]) .marker-label {
      opacity: 1;
      transform: translateY(0);
    }

    .marker-label-hint {
      font-size: 10px;
      opacity: 0.85;
      display: block;
      margin-top: 1px;
    }

    /* Confidence badge in label */
    .confidence-badge {
      display: inline-block;
      font-size: 9px;
      padding: 1px 4px;
      border-radius: 3px;
      margin-left: 4px;
      background-color: rgba(255, 255, 255, 0.2);
    }

    :host([confidence="high"]) .confidence-badge {
      background-color: rgba(34, 197, 94, 0.3);
    }

    :host([confidence="medium"]) .confidence-badge {
      background-color: rgba(245, 158, 11, 0.3);
    }

    :host([confidence="low"]) .confidence-badge {
      background-color: rgba(156, 163, 175, 0.3);
    }
  `;

  /**
   * The marker name identifier (e.g., 'offset', 'consonant', 'cutoff', 'preutterance', 'overlap').
   */
  @property({ type: String })
  name = '';

  /**
   * Human-readable label for the marker (e.g., 'Offset', 'Consonant').
   */
  @property({ type: String })
  label = '';

  /**
   * Single character icon displayed in the handle (e.g., 'O', 'C', 'X', 'P', 'V').
   */
  @property({ type: String })
  icon = '';

  /**
   * Hint text shown below the label (e.g., 'Start point', 'Fixed region end').
   */
  @property({ type: String })
  hint = '';

  /**
   * CSS color value for the marker (e.g., 'var(--uvm-marker-offset)').
   */
  @property({ type: String })
  color = '';

  /**
   * Horizontal position in pixels from the left edge of the container.
   */
  @property({ type: Number })
  position = 0;

  /**
   * The marker value in milliseconds (displayed in the label).
   */
  @property({ type: Number })
  value = 0;

  /**
   * Height of the waveform section in pixels.
   */
  @property({ type: Number })
  waveformHeight = 200;

  /**
   * Height of the spectrogram section in pixels.
   */
  @property({ type: Number })
  spectrogramHeight = 270;

  /**
   * Height of the divider between waveform and spectrogram in pixels.
   */
  @property({ type: Number })
  dividerHeight = 4;

  /**
   * Whether the marker is currently being dragged.
   */
  @property({ type: Boolean, reflect: true })
  dragging = false;

  /**
   * Whether the marker is currently selected for keyboard nudging.
   */
  @property({ type: Boolean, reflect: true })
  selected = false;

  /**
   * Confidence level for auto-detected positions.
   * Affects animation speed and visual feedback.
   * - 'high' (>0.8): Quick, decisive movement
   * - 'medium' (0.5-0.8): Moderate animation
   * - 'low' (<0.5): Slow, tentative drift
   * - null: No confidence indicator (manual positioning)
   */
  @property({ type: String, reflect: true })
  confidence: 'high' | 'medium' | 'low' | null = null;

  render() {
    // Position label in the middle of waveform section
    const labelBottom = this.spectrogramHeight + this.dividerHeight + 8;

    // Format confidence for display
    const confidenceLabel = this.confidence === 'high' ? 'High'
      : this.confidence === 'medium' ? 'Med'
      : this.confidence === 'low' ? 'Low'
      : null;

    return html`
      <div
        class="marker-line-waveform"
        part="line-waveform"
        style="background-color: ${this.color}; height: ${this.waveformHeight}px;"
      ></div>
      <div
        class="marker-line-spectrogram"
        part="line-spectrogram"
        style="color: ${this.color}; height: ${this.spectrogramHeight + this.dividerHeight}px;"
      ></div>
      ${this.confidence ? html`<div class="confidence-indicator"></div>` : null}
      <div
        class="marker-handle"
        part="handle"
        style="background-color: ${this.color};"
      >
        ${this.icon}
      </div>
      <div
        class="marker-label"
        part="label"
        style="background-color: ${this.color}; bottom: ${labelBottom}px;"
      >
        ${this.label}: ${this._formatTime(this.value)}
        ${confidenceLabel ? html`<span class="confidence-badge">${confidenceLabel}</span>` : null}
        <span class="marker-label-hint">${this.hint}</span>
      </div>
    `;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('mousedown', this._onMouseDown);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('mousedown', this._onMouseDown);
    // Clean up any lingering listeners
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);
  }

  updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties);

    // Update host element styles when position or color changes
    if (changedProperties.has('position')) {
      this.style.left = `${this.position}px`;
    }
    if (changedProperties.has('color')) {
      this.style.color = this.color;
    }
    if (
      changedProperties.has('waveformHeight') ||
      changedProperties.has('spectrogramHeight') ||
      changedProperties.has('dividerHeight')
    ) {
      const totalHeight =
        this.waveformHeight + this.dividerHeight + this.spectrogramHeight;
      this.style.height = `${totalHeight}px`;
    }
  }

  /**
   * Format milliseconds for display.
   */
  private _formatTime(ms: number): string {
    // Cutoff values are negative (measured from end)
    return `${ms.toFixed(0)} ms`;
  }

  /**
   * Handle mousedown to start dragging.
   */
  private _onMouseDown = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();

    this.dragging = true;

    this.dispatchEvent(
      new CustomEvent<MarkerDragDetail>('uvm-marker:dragstart', {
        bubbles: true,
        composed: true,
        detail: { name: this.name },
      })
    );

    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
  };

  /**
   * Handle mousemove during drag.
   */
  private _onMouseMove = (e: MouseEvent): void => {
    this.dispatchEvent(
      new CustomEvent<MarkerDragDetail>('uvm-marker:drag', {
        bubbles: true,
        composed: true,
        detail: { name: this.name, clientX: e.clientX },
      })
    );
  };

  /**
   * Handle mouseup to end dragging.
   */
  private _onMouseUp = (): void => {
    this.dragging = false;

    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);

    this.dispatchEvent(
      new CustomEvent<MarkerDragDetail>('uvm-marker:dragend', {
        bubbles: true,
        composed: true,
        detail: { name: this.name },
      })
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-marker-handle': UvmMarkerHandle;
  }
}
