import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

// Import Shoelace components used in this file
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

// Set Shoelace base path for assets (icons, etc.)
import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path.js';
setBasePath('/node_modules/@shoelace-style/shoelace/dist');

/**
 * Root application component for UTAU Voicebank Manager.
 *
 * This component serves as the main entry point and layout container
 * for the voicebank manager application.
 */
@customElement('uvm-app')
export class UvmApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
    }

    .app-container {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }

    .app-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 2rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .app-title {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .app-main {
      flex: 1;
      padding: 2rem;
    }

    .placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      min-height: 400px;
      text-align: center;
      color: #64748b;
    }

    .placeholder-icon {
      font-size: 4rem;
      margin-bottom: 1rem;
      opacity: 0.5;
    }

    .placeholder-text {
      font-size: 1.25rem;
      margin-bottom: 0.5rem;
    }

    .placeholder-subtext {
      font-size: 0.875rem;
      opacity: 0.7;
    }
  `;

  @state()
  private _initialized = false;

  connectedCallback(): void {
    super.connectedCallback();
    this._initialized = true;
  }

  render() {
    return html`
      <div class="app-container">
        <header class="app-header">
          <h1 class="app-title">
            <sl-icon name="music-note-beamed"></sl-icon>
            UTAU Voicebank Manager
          </h1>
        </header>

        <main class="app-main">
          ${this._initialized
            ? html`
                <div class="placeholder">
                  <div class="placeholder-icon">
                    <sl-icon name="folder-plus"></sl-icon>
                  </div>
                  <p class="placeholder-text">Welcome to UTAU Voicebank Manager</p>
                  <p class="placeholder-subtext">
                    Create and manage voicebanks for UTAU and OpenUTAU synthesizers
                  </p>
                </div>
              `
            : html`<p>Loading...</p>`}
        </main>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-app': UvmApp;
  }
}
