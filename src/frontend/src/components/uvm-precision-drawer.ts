import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import type SlInput from '@shoelace-style/shoelace/dist/components/input/input.js';

/**
 * Marker type for oto.ini parameters.
 */
type MarkerName = 'offset' | 'consonant' | 'cutoff' | 'preutterance' | 'overlap';

/**
 * Event detail for precision drawer value changes.
 */
export interface PrecisionDrawerChangeDetail {
  name: MarkerName;
  value: number;
}

/**
 * Marker configuration for display.
 */
interface MarkerConfig {
  name: MarkerName;
  label: string;
  color: string;
}

/**
 * Marker definitions with colors from the design system.
 */
const MARKERS: MarkerConfig[] = [
  { name: 'offset', label: 'Offset', color: 'var(--uvm-marker-offset)' },
  { name: 'consonant', label: 'Consonant', color: 'var(--uvm-marker-consonant)' },
  { name: 'cutoff', label: 'Cutoff', color: 'var(--uvm-marker-cutoff)' },
  { name: 'preutterance', label: 'Preutterance', color: 'var(--uvm-marker-preutterance)' },
  { name: 'overlap', label: 'Overlap', color: 'var(--uvm-marker-overlap)' },
];

/**
 * Collapsible drawer for precise numeric editing of oto.ini marker values.
 *
 * Slides up from below the value bar, providing numeric input fields for
 * power users who need precise control over marker positions. Hidden by
 * default for a clean interface.
 *
 * @fires uvm-precision-drawer:change - Fired when any value changes.
 *   Detail: { name: MarkerName, value: number }
 * @fires uvm-precision-drawer:close - Fired when drawer is closed.
 *
 * @example
 * ```html
 * <uvm-precision-drawer
 *   ?open=${this._showPrecision}
 *   .offset=${this._offset}
 *   .consonant=${this._consonant}
 *   .cutoff=${this._cutoff}
 *   .preutterance=${this._preutterance}
 *   .overlap=${this._overlap}
 *   @uvm-precision-drawer:change=${this._onPrecisionChange}
 *   @uvm-precision-drawer:close=${() => this._showPrecision = false}
 * ></uvm-precision-drawer>
 * ```
 */
@customElement('uvm-precision-drawer')
export class UvmPrecisionDrawer extends LitElement {
  static styles = css`
    :host {
      display: block;
      overflow: hidden;
      max-height: 0;
      transition: max-height var(--uvm-duration-normal, 300ms) var(--uvm-ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
    }

    :host([open]) {
      max-height: 120px;
    }

    .drawer {
      background-color: var(--uvm-background, #ffffff);
      border-top: 1px solid var(--uvm-border, #e5e7eb);
      box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.08);
      padding: 16px 24px;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: var(--uvm-text-sm, 0.875rem);
      color: var(--uvm-secondary, #6b7280);
      font-weight: var(--uvm-weight-medium, 500);
    }

    .header-left sl-icon {
      font-size: 1rem;
    }

    .close-button::part(base) {
      font-size: 1rem;
      color: var(--uvm-secondary, #6b7280);
    }

    .close-button::part(base):hover {
      color: var(--uvm-primary, #1f2937);
    }

    .input-row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
    }

    .input-group {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      max-width: 100px;
    }

    .input-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: var(--uvm-text-xs, 0.75rem);
      font-weight: var(--uvm-weight-medium, 500);
      color: var(--uvm-primary, #1f2937);
      margin-bottom: 4px;
    }

    .color-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .color-dot.offset {
      background-color: var(--uvm-marker-offset, #f97316);
    }

    .color-dot.consonant {
      background-color: var(--uvm-marker-consonant, #22c55e);
    }

    .color-dot.cutoff {
      background-color: var(--uvm-marker-cutoff, #ef4444);
    }

    .color-dot.preutterance {
      background-color: var(--uvm-marker-preutterance, #3b82f6);
    }

    .color-dot.overlap {
      background-color: var(--uvm-marker-overlap, #a855f7);
    }

    .input-wrapper {
      width: 100%;
    }

    .input-wrapper sl-input::part(input) {
      font-family: var(--uvm-font-mono, 'JetBrains Mono', monospace);
      font-size: var(--uvm-text-sm, 0.875rem);
      text-align: center;
    }

    .input-wrapper sl-input::part(base) {
      min-height: 32px;
    }

    .unit-label {
      font-size: var(--uvm-text-xs, 0.75rem);
      color: var(--uvm-secondary, #6b7280);
      margin-top: 2px;
    }

    .input-group.has-warning .input-wrapper sl-input::part(base) {
      border-color: #d97706;
      box-shadow: 0 0 0 1px rgba(217, 119, 6, 0.2);
    }

    .warning-dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: #d97706;
      flex-shrink: 0;
    }

    /* Responsive: stack on narrow screens */
    @media (max-width: 639px) {
      :host([open]) {
        max-height: 280px;
      }

      .drawer {
        padding: 12px 16px;
      }

      .input-row {
        flex-wrap: wrap;
        gap: 12px;
      }

      .input-group {
        flex: 0 0 calc(50% - 6px);
        max-width: none;
      }

      .input-group:last-child {
        flex: 0 0 100%;
      }
    }
  `;

  /**
   * Whether the drawer is open/visible.
   */
  @property({ type: Boolean, reflect: true })
  open = false;

  /**
   * Offset marker position in milliseconds.
   */
  @property({ type: Number })
  offset = 0;

  /**
   * Consonant marker position in milliseconds.
   */
  @property({ type: Number })
  consonant = 0;

  /**
   * Cutoff marker position in milliseconds (usually negative).
   */
  @property({ type: Number })
  cutoff = 0;

  /**
   * Preutterance marker position in milliseconds.
   */
  @property({ type: Number })
  preutterance = 0;

  /**
   * Overlap marker position in milliseconds.
   */
  @property({ type: Number })
  overlap = 0;

  /**
   * Set of parameter names that currently have validation warnings.
   * Inputs for these parameters will show a warning indicator.
   */
  @property({ attribute: false })
  warningParameters: Set<string> = new Set();

  /**
   * Reference to the first input for focus management.
   */
  @query('#input-offset')
  private _firstInput!: SlInput;

  /**
   * Get the value for a marker by name.
   */
  private _getMarkerValue(name: MarkerName): number {
    switch (name) {
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
   * Handle input value change.
   */
  private _onInputChange(name: MarkerName, e: Event): void {
    const input = e.target as SlInput;
    const value = parseFloat(input.value) || 0;

    this.dispatchEvent(
      new CustomEvent<PrecisionDrawerChangeDetail>('uvm-precision-drawer:change', {
        bubbles: true,
        composed: true,
        detail: { name, value },
      })
    );
  }

  /**
   * Handle keyboard events in inputs.
   */
  private _onInputKeydown(name: MarkerName, e: KeyboardEvent): void {
    const input = e.target as SlInput;

    if (e.key === 'Escape') {
      e.preventDefault();
      this._close();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      // Move to next input
      const currentIndex = MARKERS.findIndex((m) => m.name === name);
      const nextIndex = (currentIndex + 1) % MARKERS.length;
      const nextInput = this.shadowRoot?.querySelector(
        `#input-${MARKERS[nextIndex].name}`
      ) as SlInput | null;
      nextInput?.focus();
      nextInput?.select();
      return;
    }

    // Arrow key increment/decrement
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const currentValue = parseFloat(input.value) || 0;
      const step = e.shiftKey ? 10 : 1;
      const newValue = e.key === 'ArrowUp' ? currentValue + step : currentValue - step;

      this.dispatchEvent(
        new CustomEvent<PrecisionDrawerChangeDetail>('uvm-precision-drawer:change', {
          bubbles: true,
          composed: true,
          detail: { name, value: newValue },
        })
      );
    }
  }

  /**
   * Close the drawer.
   */
  private _close(): void {
    this.dispatchEvent(
      new CustomEvent('uvm-precision-drawer:close', {
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Focus the first input when drawer opens.
   */
  protected updated(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('open') && this.open) {
      // Wait for transition to complete before focusing
      setTimeout(() => {
        this._firstInput?.focus();
        this._firstInput?.select();
      }, 50);
    }
  }

  /**
   * Render a single input group.
   */
  private _renderInputGroup(marker: MarkerConfig) {
    const value = this._getMarkerValue(marker.name);
    const hasWarning = this.warningParameters.has(marker.name);
    return html`
      <div class="input-group ${hasWarning ? 'has-warning' : ''}">
        <label class="input-label" for="input-${marker.name}">
          <span class="color-dot ${marker.name}"></span>
          ${marker.label}
          ${hasWarning ? html`<span class="warning-dot" title="Parameter out of range" aria-label="Warning"></span>` : nothing}
        </label>
        <div class="input-wrapper">
          <sl-input
            id="input-${marker.name}"
            type="number"
            step="1"
            size="small"
            .value=${String(Math.round(value))}
            @sl-change=${(e: Event) => this._onInputChange(marker.name, e)}
            @keydown=${(e: KeyboardEvent) => this._onInputKeydown(marker.name, e)}
          ></sl-input>
        </div>
        <span class="unit-label">ms</span>
      </div>
    `;
  }

  render() {
    return html`
      <div
        class="drawer"
        role="region"
        aria-label="Precision editing controls"
        aria-hidden=${!this.open}
      >
        <div class="header">
          <div class="header-left">
            <sl-icon name="keyboard"></sl-icon>
            <span>Precision Edit</span>
          </div>
          <sl-icon-button
            class="close-button"
            name="x-lg"
            label="Close precision editor"
            @click=${this._close}
          ></sl-icon-button>
        </div>

        <div class="input-row">
          ${MARKERS.map((marker) => this._renderInputGroup(marker))}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-precision-drawer': UvmPrecisionDrawer;
  }
}
