import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';

/**
 * Context bar showing current voicebank/sample with undo/redo/save actions.
 *
 * A minimal top bar that provides:
 * - Breadcrumb navigation: voicebank name > sample name
 * - Quick actions: undo, redo, save
 * - Keyboard shortcuts for all actions
 *
 * The breadcrumb is clickable to open the sample browser overlay.
 *
 * @fires uvm-context-bar:browse - Fired when user clicks breadcrumb to open browser
 * @fires uvm-context-bar:undo - Fired when user clicks undo or presses Cmd/Ctrl+Z
 * @fires uvm-context-bar:redo - Fired when user clicks redo or presses Cmd/Ctrl+Shift+Z
 * @fires uvm-context-bar:save - Fired when user clicks save or presses Cmd/Ctrl+S
 *
 * @example
 * ```html
 * <uvm-context-bar
 *   voicebankName="Kasane Teto CV"
 *   sampleName="_ka.wav"
 *   .canUndo=${true}
 *   .canRedo=${false}
 *   .hasUnsavedChanges=${true}
 *   @uvm-context-bar:browse=${this._openBrowser}
 *   @uvm-context-bar:save=${this._handleSave}
 * ></uvm-context-bar>
 * ```
 */
@customElement('uvm-context-bar')
export class UvmContextBar extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .context-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 48px;
      background-color: var(--uvm-surface, #fafafa);
      border-bottom: 1px solid var(--uvm-border, #e5e7eb);
      padding: 0 16px;
    }

    .breadcrumb {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      margin: -8px -12px;
      border-radius: 6px;
      cursor: pointer;
      transition: background-color var(--uvm-duration-micro, 100ms) ease-out;
      user-select: none;
    }

    .breadcrumb:hover {
      background-color: var(--uvm-border, #e5e7eb);
    }

    .breadcrumb:focus {
      outline: 2px solid var(--sl-color-primary-500, #3b82f6);
      outline-offset: 2px;
    }

    .voicebank-name {
      font-family: var(--uvm-font-sans, Inter, system-ui, sans-serif);
      font-size: var(--uvm-text-sm, 13px);
      font-weight: var(--uvm-weight-regular, 400);
      color: var(--uvm-secondary, #9ca3af);
    }

    .chevron {
      font-size: 12px;
      color: var(--uvm-secondary, #9ca3af);
    }

    .sample-name {
      font-family: var(--uvm-font-sans, Inter, system-ui, sans-serif);
      font-size: var(--uvm-text-sm, 13px);
      font-weight: var(--uvm-weight-medium, 500);
      color: var(--uvm-primary, #1f2937);
    }

    .placeholder {
      font-family: var(--uvm-font-sans, Inter, system-ui, sans-serif);
      font-size: var(--uvm-text-sm, 13px);
      font-weight: var(--uvm-weight-regular, 400);
      color: var(--uvm-secondary, #9ca3af);
      font-style: italic;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .action-button {
      position: relative;
    }

    .action-button::part(base) {
      font-size: 18px;
      color: var(--uvm-secondary, #9ca3af);
      transition: color var(--uvm-duration-micro, 100ms) ease-out;
    }

    .action-button::part(base):hover {
      color: var(--uvm-primary, #1f2937);
    }

    .action-button[disabled]::part(base) {
      color: var(--uvm-border, #e5e7eb);
      cursor: not-allowed;
    }

    .save-button::part(base) {
      color: var(--sl-color-success-600, #16a34a);
    }

    .save-button[disabled]::part(base) {
      color: var(--uvm-border, #e5e7eb);
    }

    .unsaved-indicator {
      position: absolute;
      top: 4px;
      right: 4px;
      width: 6px;
      height: 6px;
      background-color: var(--sl-color-warning-500, #f59e0b);
      border-radius: 50%;
      pointer-events: none;
    }

    .save-spinner {
      font-size: 18px;
      --indicator-color: var(--sl-color-success-600, #16a34a);
    }

    /* Hide spinner when not saving */
    .save-container {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
    }

    /* Keyboard hints (shown on focus) */
    .breadcrumb:focus .keyboard-hint,
    .action-button:focus .keyboard-hint {
      opacity: 1;
    }
  `;

  /**
   * Name of the currently selected voicebank.
   */
  @property({ type: String })
  voicebankName = '';

  /**
   * Name of the currently selected sample.
   */
  @property({ type: String })
  sampleName = '';

  /**
   * Whether undo is available.
   */
  @property({ type: Boolean })
  canUndo = false;

  /**
   * Whether redo is available.
   */
  @property({ type: Boolean })
  canRedo = false;

  /**
   * Whether there are unsaved changes.
   */
  @property({ type: Boolean })
  hasUnsavedChanges = false;

  /**
   * Whether a save operation is in progress.
   */
  @property({ type: Boolean })
  saving = false;

  /**
   * Bound keyboard handler for cleanup.
   */
  private _boundKeyHandler: (e: KeyboardEvent) => void;

  constructor() {
    super();
    this._boundKeyHandler = this._handleKeydown.bind(this);
  }

  connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('keydown', this._boundKeyHandler);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this._boundKeyHandler);
  }

  /**
   * Handle global keyboard shortcuts.
   */
  private _handleKeydown(e: KeyboardEvent): void {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modifier = isMac ? e.metaKey : e.ctrlKey;

    // Cmd/Ctrl+Z - Undo
    if (modifier && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (this.canUndo) {
        this._dispatchUndo();
      }
      return;
    }

    // Cmd/Ctrl+Shift+Z - Redo
    if (modifier && e.key === 'z' && e.shiftKey) {
      e.preventDefault();
      if (this.canRedo) {
        this._dispatchRedo();
      }
      return;
    }

    // Cmd/Ctrl+S - Save
    if (modifier && e.key === 's') {
      e.preventDefault();
      if (!this.saving) {
        this._dispatchSave();
      }
      return;
    }

    // / or Cmd+K - Browse
    if (e.key === '/' || (modifier && e.key === 'k')) {
      // Don't trigger if user is typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      e.preventDefault();
      this._dispatchBrowse();
      return;
    }
  }

  /**
   * Handle breadcrumb click.
   */
  private _onBreadcrumbClick(): void {
    this._dispatchBrowse();
  }

  /**
   * Handle breadcrumb keydown for accessibility.
   */
  private _onBreadcrumbKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this._dispatchBrowse();
    }
  }

  /**
   * Dispatch browse event.
   */
  private _dispatchBrowse(): void {
    this.dispatchEvent(
      new CustomEvent('uvm-context-bar:browse', {
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Dispatch undo event.
   */
  private _dispatchUndo(): void {
    this.dispatchEvent(
      new CustomEvent('uvm-context-bar:undo', {
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Dispatch redo event.
   */
  private _dispatchRedo(): void {
    this.dispatchEvent(
      new CustomEvent('uvm-context-bar:redo', {
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Dispatch save event.
   */
  private _dispatchSave(): void {
    this.dispatchEvent(
      new CustomEvent('uvm-context-bar:save', {
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Render the breadcrumb section.
   */
  private _renderBreadcrumb() {
    const hasSelection = this.voicebankName || this.sampleName;

    if (!hasSelection) {
      return html`
        <div
          class="breadcrumb"
          role="button"
          tabindex="0"
          aria-label="Open sample browser"
          @click=${this._onBreadcrumbClick}
          @keydown=${this._onBreadcrumbKeydown}
        >
          <span class="placeholder">Select a voicebank...</span>
        </div>
      `;
    }

    return html`
      <div
        class="breadcrumb"
        role="button"
        tabindex="0"
        aria-label="Open sample browser. Current: ${this.voicebankName} ${this.sampleName}"
        @click=${this._onBreadcrumbClick}
        @keydown=${this._onBreadcrumbKeydown}
      >
        ${this.voicebankName
          ? html`<span class="voicebank-name">${this.voicebankName}</span>`
          : null}
        ${this.voicebankName && this.sampleName
          ? html`<sl-icon class="chevron" name="chevron-right"></sl-icon>`
          : null}
        ${this.sampleName
          ? html`<span class="sample-name">${this.sampleName}</span>`
          : null}
      </div>
    `;
  }

  /**
   * Render the save button with spinner and unsaved indicator.
   */
  private _renderSaveButton() {
    if (this.saving) {
      return html`
        <div class="save-container">
          <sl-spinner class="save-spinner"></sl-spinner>
        </div>
      `;
    }

    return html`
      <div class="action-button">
        <sl-icon-button
          class="save-button"
          name="check"
          label="Save (Cmd+S)"
          @click=${this._dispatchSave}
        ></sl-icon-button>
        ${this.hasUnsavedChanges ? html`<span class="unsaved-indicator"></span>` : null}
      </div>
    `;
  }

  render() {
    return html`
      <div class="context-bar" role="navigation" aria-label="Context navigation">
        ${this._renderBreadcrumb()}

        <div class="actions" role="toolbar" aria-label="Actions">
          <sl-icon-button
            class="action-button"
            name="arrow-counterclockwise"
            label="Undo (Cmd+Z)"
            ?disabled=${!this.canUndo}
            @click=${this._dispatchUndo}
          ></sl-icon-button>

          <sl-icon-button
            class="action-button"
            name="arrow-clockwise"
            label="Redo (Cmd+Shift+Z)"
            ?disabled=${!this.canRedo}
            @click=${this._dispatchRedo}
          ></sl-icon-button>

          ${this._renderSaveButton()}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-context-bar': UvmContextBar;
  }
}
