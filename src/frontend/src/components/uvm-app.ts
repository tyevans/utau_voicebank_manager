import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

// Import Shoelace components used in this file
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';

// Set Shoelace base path for assets (icons, etc.)
import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path.js';
setBasePath('/node_modules/@shoelace-style/shoelace/dist');

// Import the editor view component
import './uvm-editor-view.js';

// Import the toast manager for notifications
import './uvm-toast-manager.js';

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
      padding: 0.75rem 1.5rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .app-title {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .app-header-actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .app-header-actions sl-icon-button::part(base) {
      color: white;
      opacity: 0.8;
    }

    .app-header-actions sl-icon-button::part(base):hover {
      opacity: 1;
    }

    .app-main {
      flex: 1;
      padding: 1rem;
      overflow: auto;
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
          <div class="app-header-actions">
            <sl-icon-button
              name="gear"
              label="Settings"
            ></sl-icon-button>
          </div>
        </header>

        <main class="app-main">
          ${this._initialized
            ? html`<uvm-editor-view></uvm-editor-view>`
            : html`<p>Loading...</p>`}
        </main>
        <uvm-toast-manager></uvm-toast-manager>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-app': UvmApp;
  }
}
