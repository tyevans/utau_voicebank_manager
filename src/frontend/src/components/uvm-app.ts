import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Router } from '@vaadin/router';

// Import Shoelace components used in this file
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

// Set Shoelace base path for assets (icons, etc.)
// In dev mode, Vite serves node_modules directly
// In production, assets are copied to /shoelace by vite-plugin-static-copy
import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path.js';
setBasePath(import.meta.env.DEV ? '/node_modules/@shoelace-style/shoelace/dist' : '/shoelace');

// Import the router initialization
import { initRouter } from '../router.js';

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
  private _currentPath = '/';

  /**
   * Handler for route change events.
   */
  private _routeChangeHandler = (): void => {
    this._currentPath = window.location.pathname;
  };

  connectedCallback(): void {
    super.connectedCallback();

    // Initialize router after first render
    this.updateComplete.then(() => {
      const outlet = this.shadowRoot?.querySelector('.app-main');
      if (outlet) {
        initRouter(outlet as HTMLElement);
      }
    });

    // Listen for route changes to update nav highlighting
    window.addEventListener('vaadin-router-location-changed', this._routeChangeHandler);

    // Set initial path
    this._currentPath = window.location.pathname;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('vaadin-router-location-changed', this._routeChangeHandler);
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
              ?data-active=${this._currentPath === '/'}
              @click=${() => Router.go('/')}
            >
              Home
            </sl-button>
            <sl-button
              size="small"
              ?data-active=${this._currentPath === '/recording'}
              @click=${() => Router.go('/recording')}
            >
              Record
            </sl-button>
            <sl-button
              size="small"
              ?data-active=${this._currentPath.startsWith('/editor')}
              @click=${() => Router.go('/editor')}
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
          <slot></slot>
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
