import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';

/**
 * Keyboard shortcut category.
 */
interface ShortcutCategory {
  title: string;
  icon: string;
  shortcuts: Shortcut[];
}

/**
 * Individual keyboard shortcut.
 */
interface Shortcut {
  keys: string[];
  description: string;
}

/**
 * All keyboard shortcuts organized by category.
 */
const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    title: 'Navigation',
    icon: 'arrow-left-right',
    shortcuts: [
      { keys: ['['], description: 'Previous sample' },
      { keys: [']'], description: 'Next sample' },
      { keys: ['/'], description: 'Open sample browser' },
      { keys: ['Cmd', 'K'], description: 'Open sample browser' },
    ],
  },
  {
    title: 'Editing',
    icon: 'pencil',
    shortcuts: [
      { keys: ['Cmd', 'S'], description: 'Save entry' },
      { keys: ['Cmd', 'Z'], description: 'Undo' },
      { keys: ['Cmd', 'Shift', 'Z'], description: 'Redo' },
      { keys: ['D'], description: 'Run auto-detect' },
      { keys: ['=', '+'], description: 'Toggle precision drawer' },
    ],
  },
  {
    title: 'Playback',
    icon: 'play-circle',
    shortcuts: [
      { keys: ['Space'], description: 'Play / pause' },
      { keys: ['Shift', 'Space'], description: 'Play selection' },
      { keys: ['P'], description: 'Preview with melody' },
    ],
  },
  {
    title: 'Zoom & View',
    icon: 'zoom-in',
    shortcuts: [
      { keys: ['Scroll'], description: 'Pan waveform' },
      { keys: ['Shift', 'Scroll'], description: 'Zoom in / out' },
      { keys: ['0'], description: 'Reset zoom' },
    ],
  },
  {
    title: 'Workflow',
    icon: 'lightning',
    shortcuts: [
      { keys: ['?'], description: 'Show this help' },
      { keys: ['Esc'], description: 'Close dialogs' },
      { keys: ['Tab'], description: 'Auto-advance (when enabled)' },
    ],
  },
];

/**
 * Keyboard shortcuts overlay modal.
 *
 * Displays all available keyboard shortcuts organized by category.
 * Triggered by pressing the ? key.
 *
 * @fires uvm-shortcut-overlay:close - Fired when overlay is closed
 *
 * @example
 * ```html
 * <uvm-shortcut-overlay
 *   ?open=${this._showShortcuts}
 *   @uvm-shortcut-overlay:close=${() => this._showShortcuts = false}
 * ></uvm-shortcut-overlay>
 * ```
 */
@customElement('uvm-shortcut-overlay')
export class UvmShortcutOverlay extends LitElement {
  static styles = css`
    :host {
      display: none;
    }

    :host([open]) {
      display: block;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 1200;
    }

    .backdrop {
      position: absolute;
      inset: 0;
      background-color: rgba(0, 0, 0, 0.5);
      animation: fadeIn var(--uvm-duration-fast, 200ms) ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .modal-container {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: min(720px, 90vw);
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      background: var(--uvm-background, #ffffff);
      border-radius: 12px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      animation: slideUp var(--uvm-duration-normal, 300ms) var(--uvm-ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
      overflow: hidden;
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translate(-50%, -45%);
      }
      to {
        opacity: 1;
        transform: translate(-50%, -50%);
      }
    }

    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.5rem;
      background-color: var(--uvm-surface, #fafafa);
      border-bottom: 1px solid var(--uvm-border, #e5e7eb);
      flex-shrink: 0;
    }

    .modal-header h2 {
      margin: 0;
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--uvm-primary, #1f2937);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .modal-header h2 sl-icon {
      font-size: 1.25rem;
      color: var(--sl-color-primary-600, #2563eb);
    }

    .modal-body {
      flex: 1;
      overflow-y: auto;
      padding: 1.5rem;
    }

    .shortcuts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
    }

    .shortcut-category {
      background: var(--uvm-surface, #fafafa);
      border: 1px solid var(--uvm-border, #e5e7eb);
      border-radius: 8px;
      overflow: hidden;
    }

    .category-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      background-color: var(--uvm-background, #ffffff);
      border-bottom: 1px solid var(--uvm-border, #e5e7eb);
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--uvm-primary, #374151);
    }

    .category-header sl-icon {
      font-size: 1rem;
      color: var(--sl-color-primary-600, #2563eb);
    }

    .shortcut-list {
      padding: 0.5rem 0;
    }

    .shortcut-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 1rem;
      gap: 1rem;
    }

    .shortcut-item:hover {
      background-color: var(--uvm-background, #ffffff);
    }

    .shortcut-description {
      font-size: 0.8125rem;
      color: var(--uvm-primary, #374151);
    }

    .shortcut-keys {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      flex-shrink: 0;
    }

    kbd {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 24px;
      height: 24px;
      padding: 0 0.5rem;
      font-family: var(--uvm-font-mono, monospace);
      font-size: 0.6875rem;
      font-weight: 500;
      color: var(--uvm-primary, #374151);
      background-color: var(--uvm-background, #ffffff);
      border: 1px solid var(--uvm-border, #d1d5db);
      border-radius: 4px;
      box-shadow: 0 1px 0 var(--uvm-border, #d1d5db);
    }

    .key-separator {
      font-size: 0.6875rem;
      color: var(--uvm-secondary, #9ca3af);
    }

    .modal-footer {
      padding: 0.75rem 1.5rem;
      background-color: var(--uvm-surface, #fafafa);
      border-top: 1px solid var(--uvm-border, #e5e7eb);
      text-align: center;
      font-size: 0.75rem;
      color: var(--uvm-secondary, #9ca3af);
    }

    .modal-footer kbd {
      font-size: 0.625rem;
      height: 20px;
      min-width: 20px;
      padding: 0 0.375rem;
    }

    /* Platform-specific key names */
    .platform-note {
      margin-top: 0.25rem;
      font-size: 0.6875rem;
      color: var(--uvm-secondary, #9ca3af);
    }
  `;

  /**
   * Whether the overlay is open.
   */
  @property({ type: Boolean, reflect: true })
  open = false;

  connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('keydown', this._handleKeyDown);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this._handleKeyDown);
  }

  private _handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.open) return;

    if (e.key === 'Escape' || e.key === '?') {
      e.preventDefault();
      this._close();
    }
  };

  private _close(): void {
    this.dispatchEvent(
      new CustomEvent('uvm-shortcut-overlay:close', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onBackdropClick(): void {
    this._close();
  }

  /**
   * Format key name for display, handling platform differences.
   */
  private _formatKey(key: string): string {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

    switch (key) {
      case 'Cmd':
        return isMac ? '\u2318' : 'Ctrl';
      case 'Shift':
        return isMac ? '\u21E7' : 'Shift';
      case 'Alt':
        return isMac ? '\u2325' : 'Alt';
      case 'Space':
        return 'Space';
      case 'Scroll':
        return 'Scroll';
      case 'Esc':
        return 'Esc';
      case 'Tab':
        return 'Tab';
      default:
        return key;
    }
  }

  /**
   * Render a single shortcut item.
   */
  private _renderShortcut(shortcut: Shortcut) {
    return html`
      <div class="shortcut-item">
        <span class="shortcut-description">${shortcut.description}</span>
        <div class="shortcut-keys">
          ${shortcut.keys.map((key, index) => html`
            ${index > 0 ? html`<span class="key-separator">+</span>` : nothing}
            <kbd>${this._formatKey(key)}</kbd>
          `)}
        </div>
      </div>
    `;
  }

  /**
   * Render a shortcut category.
   */
  private _renderCategory(category: ShortcutCategory) {
    return html`
      <div class="shortcut-category">
        <div class="category-header">
          <sl-icon name=${category.icon}></sl-icon>
          ${category.title}
        </div>
        <div class="shortcut-list">
          ${category.shortcuts.map(s => this._renderShortcut(s))}
        </div>
      </div>
    `;
  }

  render() {
    if (!this.open) {
      return nothing;
    }

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

    return html`
      <div class="backdrop" @click=${this._onBackdropClick}></div>
      <div class="modal-container" @click=${(e: Event) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>
            <sl-icon name="keyboard"></sl-icon>
            Keyboard Shortcuts
          </h2>
          <sl-icon-button
            name="x-lg"
            label="Close"
            @click=${this._close}
          ></sl-icon-button>
        </div>

        <div class="modal-body">
          <div class="shortcuts-grid">
            ${SHORTCUT_CATEGORIES.map(cat => this._renderCategory(cat))}
          </div>
        </div>

        <div class="modal-footer">
          Press <kbd>?</kbd> or <kbd>Esc</kbd> to close
          ${!isMac
            ? html`<div class="platform-note">Note: "Cmd" on Mac, "Ctrl" on Windows/Linux</div>`
            : nothing}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-shortcut-overlay': UvmShortcutOverlay;
  }
}
