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
      padding: 2rem;
    }

    .welcome-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      max-width: 600px;
      width: 100%;
    }

    .welcome-hero {
      margin-bottom: 3rem;
    }

    .welcome-icon {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1.5rem;
      box-shadow: 0 10px 40px rgba(102, 126, 234, 0.3);
    }

    .welcome-icon sl-icon {
      font-size: 3.5rem;
      color: white;
    }

    .welcome-title {
      font-size: 2rem;
      font-weight: 700;
      color: var(--sl-color-neutral-900, #0f172a);
      margin: 0 0 0.75rem;
      line-height: 1.2;
    }

    .welcome-subtitle {
      font-size: 1.125rem;
      color: var(--sl-color-neutral-600, #475569);
      margin: 0;
      line-height: 1.6;
    }

    .cta-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
      margin-bottom: 3rem;
    }

    .cta-button::part(base) {
      font-size: 1.125rem;
      padding: 0.875rem 2rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border: none;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
      transition: all 0.2s ease;
    }

    .cta-button::part(base):hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
    }

    .cta-button sl-icon {
      font-size: 1.25rem;
    }

    .secondary-action {
      font-size: 0.875rem;
      color: var(--sl-color-neutral-500, #64748b);
    }

    .secondary-action sl-button::part(base) {
      color: var(--sl-color-primary-600, #2563eb);
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .secondary-action sl-button::part(base):hover {
      color: var(--sl-color-primary-700, #1d4ed8);
    }

    .hints-section {
      width: 100%;
      padding: 2rem;
      background: linear-gradient(
        180deg,
        var(--sl-color-neutral-50, #f8fafc) 0%,
        var(--sl-color-neutral-100, #f1f5f9) 100%
      );
      border-radius: var(--sl-border-radius-large, 0.5rem);
      border: 1px solid var(--sl-color-neutral-200, #e2e8f0);
    }

    .hints-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--sl-color-neutral-700, #334155);
      margin: 0 0 1.25rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .hints-list {
      display: flex;
      justify-content: center;
      gap: 2rem;
      flex-wrap: wrap;
    }

    .hint-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      min-width: 100px;
    }

    .hint-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background: white;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
      border: 1px solid var(--sl-color-neutral-200, #e2e8f0);
    }

    .hint-icon sl-icon {
      font-size: 1.5rem;
      color: var(--sl-color-primary-600, #2563eb);
    }

    .hint-label {
      font-size: 0.875rem;
      color: var(--sl-color-neutral-600, #475569);
      font-weight: 500;
    }

    /* Responsive adjustments */
    @media (max-width: 640px) {
      :host {
        padding: 1.5rem;
      }

      .welcome-title {
        font-size: 1.5rem;
      }

      .welcome-subtitle {
        font-size: 1rem;
      }

      .welcome-icon {
        width: 100px;
        height: 100px;
      }

      .welcome-icon sl-icon {
        font-size: 2.5rem;
      }

      .hints-list {
        gap: 1.5rem;
      }

      .hint-item {
        min-width: 80px;
      }

      .hints-section {
        padding: 1.5rem;
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
          <div class="welcome-icon">
            <sl-icon name="music-note-beamed"></sl-icon>
          </div>
          <h1 class="welcome-title">Create Your Own Singing Voice</h1>
          <p class="welcome-subtitle">
            Build a custom UTAU voicebank in minutes. Just record a few prompts
            and let our AI handle the rest.
          </p>
        </div>

        <div class="cta-section">
          <sl-button
            class="cta-button"
            variant="primary"
            size="large"
            @click=${this._onStartRecording}
          >
            <sl-icon slot="prefix" name="mic-fill"></sl-icon>
            Start Recording
          </sl-button>
          <div class="secondary-action">
            <span>Already have a voicebank? </span>
            <sl-button variant="text" size="small" @click=${this._onImportVoicebank}>
              Import existing
            </sl-button>
          </div>
        </div>

        <div class="hints-section">
          <h2 class="hints-title">What You'll Need</h2>
          <div class="hints-list">
            <div class="hint-item">
              <div class="hint-icon">
                <sl-icon name="house"></sl-icon>
              </div>
              <span class="hint-label">A quiet room</span>
            </div>
            <div class="hint-item">
              <div class="hint-icon">
                <sl-icon name="clock"></sl-icon>
              </div>
              <span class="hint-label">About 10 minutes</span>
            </div>
            <div class="hint-item">
              <div class="hint-icon">
                <sl-icon name="mic"></sl-icon>
              </div>
              <span class="hint-label">A microphone</span>
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
