import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

// Import Shoelace components used in this file
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

// Set Shoelace base path for assets (icons, etc.)
import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path.js';
setBasePath('/node_modules/@shoelace-style/shoelace/dist');

// Import the editor view component
import './uvm-editor-view.js';

// Import the recording session component
import './uvm-recording-session.js';

// Import the toast manager for notifications
import './uvm-toast-manager.js';

/**
 * Application view type.
 */
type AppView = 'editor' | 'recording';

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

    .app-nav {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .app-nav sl-button::part(base) {
      background: rgba(255, 255, 255, 0.15);
      border-color: rgba(255, 255, 255, 0.3);
      color: white;
    }

    .app-nav sl-button::part(base):hover {
      background: rgba(255, 255, 255, 0.25);
      border-color: rgba(255, 255, 255, 0.4);
    }

    .app-nav sl-button[data-active]::part(base) {
      background: rgba(255, 255, 255, 0.3);
      border-color: rgba(255, 255, 255, 0.5);
    }

    .app-main {
      flex: 1;
      padding: 1rem;
      overflow: auto;
    }
  `;

  @state()
  private _initialized = false;

  @state()
  private _currentView: AppView = 'editor';

  connectedCallback(): void {
    super.connectedCallback();
    this._initialized = true;
  }

  /**
   * Switch to the editor view.
   */
  private _showEditor(): void {
    this._currentView = 'editor';
  }

  /**
   * Switch to the recording session view.
   */
  private _showRecording(): void {
    this._currentView = 'recording';
  }

  /**
   * Handle session complete event from recording view.
   */
  private _onSessionComplete(): void {
    // Switch back to editor to see the new voicebank
    this._currentView = 'editor';
  }

  /**
   * Render the current view content.
   */
  private _renderContent() {
    if (!this._initialized) {
      return html`<p>Loading...</p>`;
    }

    switch (this._currentView) {
      case 'recording':
        return html`
          <uvm-recording-session
            @session-complete=${this._onSessionComplete}
            @session-cancelled=${this._showEditor}
          ></uvm-recording-session>
        `;
      case 'editor':
      default:
        return html`<uvm-editor-view></uvm-editor-view>`;
    }
  }

  render() {
    return html`
      <div class="app-container">
        <header class="app-header">
          <h1 class="app-title">
            <sl-icon name="music-note-beamed"></sl-icon>
            UTAU Voicebank Manager
          </h1>
          <nav class="app-nav">
            <sl-button
              size="small"
              ?data-active=${this._currentView === 'editor'}
              @click=${this._showEditor}
            >
              <sl-icon slot="prefix" name="pencil-square"></sl-icon>
              Editor
            </sl-button>
            <sl-button
              size="small"
              ?data-active=${this._currentView === 'recording'}
              @click=${this._showRecording}
            >
              <sl-icon slot="prefix" name="mic-fill"></sl-icon>
              Create Voicebank
            </sl-button>
          </nav>
          <div class="app-header-actions">
            <sl-icon-button
              name="gear"
              label="Settings"
            ></sl-icon-button>
          </div>
        </header>

        <main class="app-main">
          ${this._renderContent()}
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
