import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

/**
 * Welcome view component for first-time users.
 *
 * This component serves as the landing experience, providing
 * a friendly introduction to voicebank creation with clear
 * calls to action.
 *
 * @fires start-recording - Fired when the user clicks the "Start Recording" button
 * @fires import-voicebank - Fired when the user clicks the "Import existing voicebank" link
 *
 * @example
 * ```html
 * <uvm-welcome-view
 *   @start-recording=${this._onStartRecording}
 *   @import-voicebank=${this._onImportVoicebank}
 * ></uvm-welcome-view>
 * ```
 */
@customElement('uvm-welcome-view')
export class UvmWelcomeView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100%;
      padding: 3rem 2rem;
    }

    .welcome-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      max-width: 480px;
      width: 100%;
    }

    /* We've removed the unnecessary icon container. The title speaks for itself. */
    .welcome-hero {
      margin-bottom: 4rem;
    }

    .welcome-title {
      font-size: 2.5rem;
      font-weight: 600;
      color: var(--sl-color-neutral-900, #0f172a);
      margin: 0 0 1rem;
      line-height: 1.15;
      letter-spacing: -0.02em;
    }

    .welcome-subtitle {
      font-size: 1.125rem;
      color: var(--sl-color-neutral-500, #64748b);
      margin: 0;
      line-height: 1.7;
      font-weight: 400;
    }

    /* The primary action is unmistakably clear. One button. One purpose. */
    .cta-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.5rem;
      margin-bottom: 4rem;
    }

    .cta-button::part(base) {
      font-size: 1rem;
      font-weight: 500;
      padding: 1rem 2.5rem;
      background: var(--sl-color-neutral-900, #0f172a);
      border: none;
      border-radius: 9999px;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }

    .cta-button::part(base):hover {
      transform: scale(1.02);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    }

    .cta-button::part(base):active {
      transform: scale(0.98);
    }

    .cta-button sl-icon {
      font-size: 1.125rem;
    }

    .secondary-action {
      font-size: 0.875rem;
      color: var(--sl-color-neutral-400, #94a3b8);
    }

    .secondary-action sl-button::part(base) {
      color: var(--sl-color-neutral-500, #64748b);
      font-weight: 400;
    }

    .secondary-action sl-button::part(base):hover {
      color: var(--sl-color-neutral-700, #334155);
    }

    /* The hints section defers to content with quiet confidence */
    .hints-section {
      width: 100%;
      padding: 0;
      background: transparent;
      border: none;
    }

    .hints-list {
      display: flex;
      justify-content: center;
      gap: 3rem;
    }

    .hint-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
    }

    .hint-icon {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--sl-color-neutral-100, #f1f5f9);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .hint-icon sl-icon {
      font-size: 1.25rem;
      color: var(--sl-color-neutral-500, #64748b);
    }

    .hint-label {
      font-size: 0.8125rem;
      color: var(--sl-color-neutral-500, #64748b);
      font-weight: 400;
    }

    /* Responsive adjustments */
    @media (max-width: 640px) {
      :host {
        padding: 2rem 1.5rem;
      }

      .welcome-title {
        font-size: 1.875rem;
      }

      .welcome-subtitle {
        font-size: 1rem;
      }

      .hints-list {
        gap: 2rem;
      }
    }
  `;

  /**
   * Handle start recording button click.
   */
  private _onStartRecording(): void {
    this.dispatchEvent(
      new CustomEvent('start-recording', {
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Handle import voicebank action.
   */
  private _onImportVoicebank(): void {
    this.dispatchEvent(
      new CustomEvent('import-voicebank', {
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    return html`
      <div class="welcome-container">
        <div class="welcome-hero">
          <h1 class="welcome-title">Create Your Singing Voice</h1>
          <p class="welcome-subtitle">
            Record a few sounds. Our AI does the rest.
            Your voice, ready for UTAU in minutes.
          </p>
        </div>

        <div class="cta-section">
          <sl-button
            class="cta-button"
            variant="primary"
            size="large"
            @click=${this._onStartRecording}
          >
            Begin Recording
          </sl-button>
          <div class="secondary-action">
            <sl-button variant="text" size="small" @click=${this._onImportVoicebank}>
              or import existing voicebank
            </sl-button>
          </div>
        </div>

        <div class="hints-section">
          <div class="hints-list">
            <div class="hint-item">
              <div class="hint-icon">
                <sl-icon name="volume-off"></sl-icon>
              </div>
              <span class="hint-label">Quiet space</span>
            </div>
            <div class="hint-item">
              <div class="hint-icon">
                <sl-icon name="clock"></sl-icon>
              </div>
              <span class="hint-label">10 minutes</span>
            </div>
            <div class="hint-item">
              <div class="hint-icon">
                <sl-icon name="mic"></sl-icon>
              </div>
              <span class="hint-label">Microphone</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-welcome-view': UvmWelcomeView;
  }
}
