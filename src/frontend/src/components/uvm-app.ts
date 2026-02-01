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

// Import the welcome view component
import './uvm-welcome-view.js';

// Import the toast manager for notifications
import './uvm-toast-manager.js';

/**
 * localStorage key for persisting voicebank state.
 */
const STORAGE_KEY_HAS_VOICEBANKS = 'uvm_has_voicebanks';

/**
 * Application view type.
 */
type AppView = 'welcome' | 'editor' | 'recording';

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
      background: var(--sl-color-neutral-50, #f8fafc);
    }

    .app-container {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }

    /* The header now defers to the content. Quiet. Functional. Invisible until needed. */
    .app-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.875rem 1.5rem;
      background: white;
      border-bottom: 1px solid var(--sl-color-neutral-200, #e2e8f0);
    }

    .app-title {
      margin: 0;
      font-size: 0.9375rem;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--sl-color-neutral-700, #334155);
      letter-spacing: -0.01em;
    }

    .app-title sl-icon {
      color: var(--sl-color-neutral-400, #94a3b8);
    }

    .app-header-actions {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .app-header-actions sl-icon-button::part(base) {
      color: var(--sl-color-neutral-400, #94a3b8);
    }

    .app-header-actions sl-icon-button::part(base):hover {
      color: var(--sl-color-neutral-600, #475569);
    }

    .app-nav {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .app-nav sl-button::part(base) {
      background: transparent;
      border: none;
      color: var(--sl-color-neutral-500, #64748b);
      font-weight: 400;
      font-size: 0.875rem;
      padding: 0.5rem 0.875rem;
      border-radius: 6px;
    }

    .app-nav sl-button::part(base):hover {
      background: var(--sl-color-neutral-100, #f1f5f9);
      color: var(--sl-color-neutral-700, #334155);
    }

    .app-nav sl-button[data-active]::part(base) {
      background: var(--sl-color-neutral-100, #f1f5f9);
      color: var(--sl-color-neutral-900, #0f172a);
      font-weight: 500;
    }

    .app-main {
      flex: 1;
      padding: 0;
      overflow: auto;
      background: white;
    }
  `;

  @state()
  private _initialized = false;

  @state()
  private _currentView: AppView = 'welcome';

  @state()
  private _hasVoicebanks = false;

  connectedCallback(): void {
    super.connectedCallback();

    // Check if user has created voicebanks before
    const hasVoicebanks =
      localStorage.getItem(STORAGE_KEY_HAS_VOICEBANKS) === 'true';
    this._hasVoicebanks = hasVoicebanks;

    // Set initial view based on state
    this._currentView = hasVoicebanks ? 'editor' : 'welcome';

    this._initialized = true;
  }

  /**
   * Switch to the welcome view.
   */
  private _showWelcome(): void {
    this._currentView = 'welcome';
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
   * Handle start recording event from welcome view.
   */
  private _onStartRecordingFromWelcome(): void {
    this._currentView = 'recording';
  }

  /**
   * Handle import voicebank event from welcome view.
   */
  private _onImportVoicebank(): void {
    // Switch to editor view which has upload capability
    this._currentView = 'editor';
  }

  /**
   * Handle session complete event from recording view.
   */
  private _onSessionComplete(): void {
    // Mark that we now have voicebanks and persist to localStorage
    this._hasVoicebanks = true;
    localStorage.setItem(STORAGE_KEY_HAS_VOICEBANKS, 'true');
    this._currentView = 'editor';
  }

  /**
   * Handle open-editor event from recording session success screen.
   */
  private _onOpenEditor(): void {
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
      case 'welcome':
        return html`
          <uvm-welcome-view
            @start-recording=${this._onStartRecordingFromWelcome}
            @import-voicebank=${this._onImportVoicebank}
          ></uvm-welcome-view>
        `;
      case 'recording':
        return html`
          <uvm-recording-session
            @session-complete=${this._onSessionComplete}
            @session-cancelled=${this._hasVoicebanks
              ? this._showEditor
              : this._showWelcome}
            @open-editor=${this._onOpenEditor}
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
            <sl-icon name="soundwave"></sl-icon>
            Voicebank Studio
          </h1>
          <nav class="app-nav">
            <sl-button
              size="small"
              ?data-active=${this._currentView === 'welcome'}
              @click=${this._showWelcome}
            >
              Home
            </sl-button>
            <sl-button
              size="small"
              ?data-active=${this._currentView === 'recording'}
              @click=${this._showRecording}
            >
              Record
            </sl-button>
            <sl-button
              size="small"
              ?data-active=${this._currentView === 'editor'}
              @click=${this._showEditor}
            >
              Editor
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
