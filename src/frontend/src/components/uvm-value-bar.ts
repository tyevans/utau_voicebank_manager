import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * Marker configuration for the value bar display.
 */
interface MarkerConfig {
  key: 'offset' | 'consonant' | 'cutoff' | 'preutterance' | 'overlap';
  label: string;
  icon: string;
  color: string;
}

/**
 * Marker definitions with colors from the design system.
 */
const MARKERS: MarkerConfig[] = [
  { key: 'offset', label: 'Offset', icon: 'O', color: 'var(--uvm-marker-offset)' },
  { key: 'consonant', label: 'Consonant', icon: 'C', color: 'var(--uvm-marker-consonant)' },
  { key: 'cutoff', label: 'Cutoff', icon: 'X', color: 'var(--uvm-marker-cutoff)' },
  { key: 'preutterance', label: 'Preutterance', icon: 'P', color: 'var(--uvm-marker-preutterance)' },
  { key: 'overlap', label: 'Overlap', icon: 'V', color: 'var(--uvm-marker-overlap)' },
];

/**
 * Read-only display bar showing oto.ini marker values.
 *
 * Displays the 5 oto.ini parameters (offset, consonant, cutoff, preutterance,
 * overlap) in a horizontal bar with color-coded icons. Values update reactively
 * as markers are dragged in the waveform editor.
 *
 * @example
 * ```html
 * <uvm-value-bar
 *   .offset=${45}
 *   .consonant=${120}
 *   .cutoff=${-140}
 *   .preutterance=${80}
 *   .overlap=${15}
 * ></uvm-value-bar>
 * ```
 */
@customElement('uvm-value-bar')
export class UvmValueBar extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .value-bar {
      display: flex;
      align-items: center;
      justify-content: space-evenly;
      height: 40px;
      background-color: var(--uvm-surface);
      border-top: 1px solid var(--uvm-border);
      padding: 0 8px;
      gap: 4px;
    }

    .value-group {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 6px;
      cursor: default;
      transition: background-color var(--uvm-duration-micro) ease-out;
    }

    .value-group:hover {
      background-color: var(--uvm-border);
    }

    .marker-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      font-size: var(--uvm-text-xs);
      font-weight: var(--uvm-weight-medium);
      color: #ffffff;
      flex-shrink: 0;
    }

    .marker-icon.offset {
      background-color: var(--uvm-marker-offset);
    }

    .marker-icon.consonant {
      background-color: var(--uvm-marker-consonant);
    }

    .marker-icon.cutoff {
      background-color: var(--uvm-marker-cutoff);
    }

    .marker-icon.preutterance {
      background-color: var(--uvm-marker-preutterance);
    }

    .marker-icon.overlap {
      background-color: var(--uvm-marker-overlap);
    }

    .value-text {
      font-family: var(--uvm-font-mono);
      font-size: var(--uvm-text-sm);
      font-weight: var(--uvm-weight-medium);
      color: var(--uvm-primary);
      white-space: nowrap;
      transition: transform var(--uvm-duration-fast) var(--uvm-ease-spring);
    }

    /* Subtle animation when values change */
    .value-group:not(:hover) .value-text {
      transform: scale(1);
    }

    /* Responsive: stack vertically on narrow screens */
    @media (max-width: 639px) {
      .value-bar {
        flex-direction: column;
        height: auto;
        padding: 8px;
        gap: 2px;
      }

      .value-group {
        width: 100%;
        justify-content: space-between;
        padding: 6px 12px;
      }

      .value-text {
        text-align: right;
      }
    }
  `;

  /**
   * Offset marker position in milliseconds.
   * Indicates where playback begins.
   */
  @property({ type: Number })
  offset = 0;

  /**
   * Consonant marker position in milliseconds.
   * Marks the end of the fixed (non-stretched) region.
   */
  @property({ type: Number })
  consonant = 0;

  /**
   * Cutoff marker position in milliseconds.
   * Can be negative (measured from audio end).
   */
  @property({ type: Number })
  cutoff = 0;

  /**
   * Preutterance marker position in milliseconds.
   * How early to start before the note timing.
   */
  @property({ type: Number })
  preutterance = 0;

  /**
   * Overlap marker position in milliseconds.
   * Crossfade duration with the previous note.
   */
  @property({ type: Number })
  overlap = 0;

  /**
   * Get the value for a marker by key.
   */
  private _getMarkerValue(key: MarkerConfig['key']): number {
    switch (key) {
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
    }
  }

  /**
   * Format a value for display with ms suffix.
   */
  private _formatValue(value: number): string {
    // Round to integer for cleaner display
    const rounded = Math.round(value);
    return `${rounded}ms`;
  }

  /**
   * Render a single marker value group.
   */
  private _renderMarkerGroup(marker: MarkerConfig) {
    const value = this._getMarkerValue(marker.key);
    return html`
      <div class="value-group" title="${marker.label}">
        <span class="marker-icon ${marker.key}">${marker.icon}</span>
        <span class="value-text">${this._formatValue(value)}</span>
      </div>
    `;
  }

  render() {
    return html`
      <div class="value-bar" role="status" aria-label="Oto marker values">
        ${MARKERS.map((marker) => this._renderMarkerGroup(marker))}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-value-bar': UvmValueBar;
  }
}
