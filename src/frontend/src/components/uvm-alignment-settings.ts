import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/range/range.js';
import '@shoelace-style/shoelace/dist/components/radio-group/radio-group.js';
import '@shoelace-style/shoelace/dist/components/radio-button/radio-button.js';
import '@shoelace-style/shoelace/dist/components/details/details.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

/**
 * Method configuration for alignment.
 */
export interface AlignmentMethod {
  name: 'sofa' | 'fa' | 'blind';
  available: boolean;
  displayName: string;
  unavailableReason?: string;
}

/**
 * Event detail for alignment changes.
 */
export interface AlignmentChangeDetail {
  tightness: number;
  methodOverride: 'sofa' | 'fa' | 'blind' | null;
}

/**
 * Alignment settings component with Jony Ive-inspired minimal design.
 *
 * Features a single "Tightness" slider at the primary level, with
 * method override options hidden in an "Advanced" collapsible section.
 *
 * @fires alignment-change - Dispatched when tightness or method changes.
 *   Detail: { tightness: number, methodOverride: string | null }
 *
 * @example
 * ```html
 * <uvm-alignment-settings
 *   .tightness=${0.5}
 *   .methodOverride=${null}
 *   .availableMethods=${[
 *     { name: 'sofa', available: true, displayName: 'SOFA (singing voice)' },
 *     { name: 'fa', available: true, displayName: 'Forced Alignment' },
 *     { name: 'blind', available: true, displayName: 'Energy Detection' }
 *   ]}
 *   @alignment-change=${this._onAlignmentChange}
 * ></uvm-alignment-settings>
 * ```
 */
@customElement('uvm-alignment-settings')
export class UvmAlignmentSettings extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .settings-container {
      padding: 16px 20px;
      background-color: var(--uvm-background, #ffffff);
      border: 1px solid var(--uvm-border, #e5e7eb);
      border-radius: 12px;
    }

    /* Primary control: Tightness slider */
    .tightness-control {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .tightness-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .tightness-label {
      font-size: var(--uvm-text-sm, 13px);
      font-weight: var(--uvm-weight-medium, 500);
      color: var(--uvm-primary, #1f2937);
    }

    .tightness-value {
      font-family: var(--uvm-font-mono, monospace);
      font-size: var(--uvm-text-xs, 11px);
      color: var(--uvm-secondary, #9ca3af);
    }

    .slider-container {
      position: relative;
    }

    .slider-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 4px;
      font-size: var(--uvm-text-xs, 11px);
      color: var(--uvm-secondary, #9ca3af);
    }

    .slider-label {
      transition: color var(--uvm-duration-micro, 100ms) ease-out;
    }

    .slider-label.active {
      color: var(--uvm-primary, #1f2937);
      font-weight: var(--uvm-weight-medium, 500);
    }

    /* Shoelace range customization */
    sl-range {
      --track-color-active: var(--sl-color-primary-600, #2563eb);
      --track-color-inactive: var(--uvm-border, #e5e7eb);
      --track-height: 4px;
      --thumb-size: 18px;
    }

    sl-range::part(form-control) {
      margin: 0;
    }

    /* Advanced section */
    sl-details {
      margin-top: 16px;
    }

    sl-details::part(base) {
      border: none;
      background: transparent;
    }

    sl-details::part(header) {
      padding: 8px 0;
      font-size: var(--uvm-text-xs, 11px);
      font-weight: var(--uvm-weight-medium, 500);
      color: var(--uvm-secondary, #9ca3af);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    sl-details::part(summary-icon) {
      font-size: 14px;
      color: var(--uvm-secondary, #9ca3af);
    }

    sl-details::part(content) {
      padding: 12px 0 0 0;
    }

    /* Method selection */
    .method-section {
      background-color: var(--uvm-surface, #fafafa);
      border: 1px solid var(--uvm-border, #e5e7eb);
      border-radius: 8px;
      padding: 12px 16px;
    }

    .method-label {
      font-size: var(--uvm-text-xs, 11px);
      font-weight: var(--uvm-weight-medium, 500);
      color: var(--uvm-secondary, #9ca3af);
      margin-bottom: 10px;
      display: block;
    }

    .method-options {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .method-option {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
      transition: background-color var(--uvm-duration-micro, 100ms) ease-out;
    }

    .method-option:hover:not(.disabled) {
      background-color: var(--uvm-background, #ffffff);
    }

    .method-option.selected {
      background-color: var(--uvm-background, #ffffff);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    }

    .method-option.disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .method-radio {
      width: 16px;
      height: 16px;
      border: 2px solid var(--uvm-border, #e5e7eb);
      border-radius: 50%;
      flex-shrink: 0;
      position: relative;
      transition: border-color var(--uvm-duration-micro, 100ms) ease-out;
    }

    .method-option:not(.disabled):hover .method-radio {
      border-color: var(--sl-color-primary-400, #60a5fa);
    }

    .method-option.selected .method-radio {
      border-color: var(--sl-color-primary-600, #2563eb);
    }

    .method-option.selected .method-radio::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 8px;
      height: 8px;
      background-color: var(--sl-color-primary-600, #2563eb);
      border-radius: 50%;
    }

    .method-text {
      font-size: var(--uvm-text-sm, 13px);
      color: var(--uvm-primary, #1f2937);
    }

    .method-option.disabled .method-text {
      color: var(--uvm-secondary, #9ca3af);
    }

    /* Reset button */
    .reset-section {
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid var(--uvm-border, #e5e7eb);
    }

    sl-button.reset-button::part(base) {
      font-size: var(--uvm-text-xs, 11px);
      color: var(--uvm-secondary, #9ca3af);
    }

    sl-button.reset-button::part(base):hover {
      color: var(--uvm-primary, #1f2937);
    }

    /* Responsive */
    @media (max-width: 480px) {
      .settings-container {
        padding: 12px 16px;
      }
    }
  `;

  /**
   * Tightness value from 0.0 (loose) to 1.0 (tight).
   * Controls how aggressively the alignment algorithm clips phoneme boundaries.
   */
  @property({ type: Number })
  tightness = 0.5;

  /**
   * Method override. When null, uses automatic selection.
   */
  @property({ attribute: false })
  methodOverride: 'sofa' | 'fa' | 'blind' | null = null;

  /**
   * Available alignment methods with their status.
   */
  @property({ attribute: false })
  availableMethods: AlignmentMethod[] = [
    { name: 'sofa', available: true, displayName: 'SOFA (singing voice)' },
    { name: 'fa', available: true, displayName: 'Forced Alignment' },
    { name: 'blind', available: true, displayName: 'Energy Detection' },
  ];

  /**
   * Whether the advanced section is expanded.
   */
  @state()
  private _advancedOpen = false;

  /**
   * Default values for reset.
   */
  private static readonly DEFAULTS = {
    tightness: 0.5,
    methodOverride: null as 'sofa' | 'fa' | 'blind' | null,
  };

  /**
   * Reset all settings to defaults.
   */
  reset(): void {
    this.tightness = UvmAlignmentSettings.DEFAULTS.tightness;
    this.methodOverride = UvmAlignmentSettings.DEFAULTS.methodOverride;
    this._dispatchChange();
  }

  /**
   * Dispatch the alignment-change event.
   */
  private _dispatchChange(): void {
    this.dispatchEvent(
      new CustomEvent<AlignmentChangeDetail>('alignment-change', {
        detail: {
          tightness: this.tightness,
          methodOverride: this.methodOverride,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Handle tightness slider change.
   */
  private _onTightnessChange(e: Event): void {
    const target = e.target as HTMLInputElement;
    this.tightness = parseFloat(target.value);
    this._dispatchChange();
  }

  /**
   * Handle method selection.
   */
  private _onMethodSelect(method: AlignmentMethod): void {
    if (!method.available) return;

    // Toggle: if clicking the same method, deselect (back to auto)
    if (this.methodOverride === method.name) {
      this.methodOverride = null;
    } else {
      this.methodOverride = method.name;
    }
    this._dispatchChange();
  }

  /**
   * Handle auto method selection.
   */
  private _onAutoSelect(): void {
    this.methodOverride = null;
    this._dispatchChange();
  }

  /**
   * Get display string for current tightness.
   */
  private _getTightnessDisplay(): string {
    const percent = Math.round(this.tightness * 100);
    return `${percent}%`;
  }

  /**
   * Check if current settings differ from defaults.
   */
  private _hasChanges(): boolean {
    return (
      this.tightness !== UvmAlignmentSettings.DEFAULTS.tightness ||
      this.methodOverride !== UvmAlignmentSettings.DEFAULTS.methodOverride
    );
  }

  /**
   * Render a method option.
   */
  private _renderMethodOption(method: AlignmentMethod) {
    const isSelected = this.methodOverride === method.name;
    const classes = [
      'method-option',
      isSelected ? 'selected' : '',
      !method.available ? 'disabled' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const content = html`
      <div
        class=${classes}
        @click=${() => this._onMethodSelect(method)}
        role="radio"
        aria-checked=${isSelected}
        aria-disabled=${!method.available}
        tabindex=${method.available ? 0 : -1}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this._onMethodSelect(method);
          }
        }}
      >
        <div class="method-radio"></div>
        <span class="method-text">${method.displayName}</span>
      </div>
    `;

    // Wrap disabled options in a tooltip explaining why
    if (!method.available && method.unavailableReason) {
      return html`
        <sl-tooltip content=${method.unavailableReason}>
          ${content}
        </sl-tooltip>
      `;
    }

    return content;
  }

  render() {
    const isLoose = this.tightness < 0.33;
    const isTight = this.tightness > 0.67;

    return html`
      <div class="settings-container">
        <!-- Primary: Tightness Slider -->
        <div class="tightness-control">
          <div class="tightness-header">
            <span class="tightness-label">Alignment</span>
            <span class="tightness-value">${this._getTightnessDisplay()}</span>
          </div>

          <div class="slider-container">
            <sl-range
              min="0"
              max="1"
              step="0.01"
              .value=${this.tightness}
              @sl-change=${this._onTightnessChange}
              aria-label="Alignment tightness"
            ></sl-range>

            <div class="slider-labels">
              <span class="slider-label ${isLoose ? 'active' : ''}">Loose</span>
              <span class="slider-label ${isTight ? 'active' : ''}">Tight</span>
            </div>
          </div>
        </div>

        <!-- Advanced: Method Override -->
        <sl-details
          summary="Advanced"
          ?open=${this._advancedOpen}
          @sl-show=${() => (this._advancedOpen = true)}
          @sl-hide=${() => (this._advancedOpen = false)}
        >
          <div class="method-section">
            <span class="method-label">Method</span>

            <div
              class="method-options"
              role="radiogroup"
              aria-label="Alignment method"
            >
              <!-- Auto option -->
              <div
                class="method-option ${this.methodOverride === null ? 'selected' : ''}"
                @click=${this._onAutoSelect}
                role="radio"
                aria-checked=${this.methodOverride === null}
                tabindex="0"
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this._onAutoSelect();
                  }
                }}
              >
                <div class="method-radio"></div>
                <span class="method-text">Auto</span>
              </div>

              <!-- Method options -->
              ${this.availableMethods.map((method) =>
                this._renderMethodOption(method)
              )}
            </div>
          </div>

          <!-- Reset button -->
          ${this._hasChanges()
            ? html`
                <div class="reset-section">
                  <sl-button
                    class="reset-button"
                    variant="text"
                    size="small"
                    @click=${this.reset}
                  >
                    <sl-icon slot="prefix" name="arrow-counterclockwise"></sl-icon>
                    Reset to default
                  </sl-button>
                </div>
              `
            : ''}
        </sl-details>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-alignment-settings': UvmAlignmentSettings;
  }
}
