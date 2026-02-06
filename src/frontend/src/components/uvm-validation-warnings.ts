import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import type { OtoValidationWarning } from './uvm-oto-manager.js';

/**
 * Displays validation warnings for oto parameters that exceed WAV duration.
 *
 * Shows a collapsible warning strip below the value bar. Each warning
 * indicates which parameter is out of range and by how much. Warnings
 * are non-blocking -- they do not prevent saving.
 *
 * @example
 * ```html
 * <uvm-validation-warnings
 *   .warnings=${this._validationWarnings}
 * ></uvm-validation-warnings>
 * ```
 */
@customElement('uvm-validation-warnings')
export class UvmValidationWarnings extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    :host(:empty),
    .hidden {
      display: none;
    }

    .warnings-strip {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      background-color: #fffbeb;
      border-top: 1px solid #fde68a;
      border-bottom: 1px solid #fde68a;
      font-size: 0.8125rem;
      color: #92400e;
      line-height: 1.4;
    }

    .warning-icon {
      flex-shrink: 0;
      font-size: 1rem;
      color: #d97706;
    }

    .warning-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      background-color: rgba(217, 119, 6, 0.08);
      border-radius: 4px;
      white-space: nowrap;
    }

    .warning-param {
      font-weight: 600;
      text-transform: capitalize;
    }

    .warning-separator {
      width: 1px;
      height: 14px;
      background-color: #fde68a;
      flex-shrink: 0;
    }

    /* Accessible: reduce motion for users who prefer it */
    @media (prefers-reduced-motion: reduce) {
      .warnings-strip {
        transition: none;
      }
    }
  `;

  /**
   * Array of validation warnings to display.
   * An empty array hides the component.
   */
  @property({ attribute: false })
  warnings: OtoValidationWarning[] = [];

  render() {
    if (!this.warnings || this.warnings.length === 0) {
      return nothing;
    }

    return html`
      <div
        class="warnings-strip"
        role="alert"
        aria-live="polite"
        aria-label="Parameter validation warnings"
      >
        <sl-icon name="exclamation-triangle" class="warning-icon"></sl-icon>
        ${this.warnings.map(
          (warning, index) => html`
            ${index > 0 ? html`<span class="warning-separator" aria-hidden="true"></span>` : nothing}
            <span class="warning-item">
              <span class="warning-param">${warning.parameter}:</span>
              ${warning.message}
            </span>
          `
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-validation-warnings': UvmValidationWarnings;
  }
}
