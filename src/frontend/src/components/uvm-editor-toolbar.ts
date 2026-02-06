import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/badge/badge.js';

/**
 * Toolbar component that manages keyboard shortcuts and displays detection/status state.
 *
 * This component handles the global keyboard shortcuts that were previously
 * embedded in the editor view:
 * - `[` / `]` for sample navigation
 * - `=` / `+` to toggle precision drawer
 * - `D` for auto-detect
 * - `?` for shortcut overlay
 * - `Ctrl+S` / `Cmd+S` for save
 *
 * It also renders the status indicator (detecting, loading, save success, confidence).
 *
 * @fires editor-toolbar:previous-sample - Navigate to previous sample
 * @fires editor-toolbar:next-sample - Navigate to next sample
 * @fires editor-toolbar:toggle-precision - Toggle precision drawer visibility
 * @fires editor-toolbar:detect - Trigger auto-detection
 * @fires editor-toolbar:show-shortcuts - Show keyboard shortcut overlay
 * @fires editor-toolbar:save - Save current entry
 *
 * @example
 * ```html
 * <uvm-editor-toolbar
 *   .hasSample=${true}
 *   .isDetecting=${false}
 *   .isDirty=${true}
 *   .isSaving=${false}
 *   .saveSuccess=${false}
 *   .loadingEntries=${false}
 *   .lastConfidence=${0.85}
 *   @editor-toolbar:previous-sample=${this._onPrev}
 *   @editor-toolbar:next-sample=${this._onNext}
 * ></uvm-editor-toolbar>
 * ```
 */
@customElement('uvm-editor-toolbar')
export class UvmEditorToolbar extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }

    /* Status indicator */
    .status-indicator {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      font-size: 0.75rem;
      color: var(--uvm-secondary, #6b7280);
      background-color: var(--uvm-surface, #fafafa);
      border-top: 1px solid var(--uvm-border, #e5e7eb);
    }

    .status-indicator.detecting {
      color: var(--sl-color-primary-600, #2563eb);
    }

    .status-indicator.success {
      color: var(--sl-color-success-600, #16a34a);
    }

    .status-indicator.loading {
      color: var(--uvm-secondary, #6b7280);
    }

    .status-indicator sl-spinner {
      font-size: 0.875rem;
      --indicator-color: currentColor;
    }

    .status-indicator sl-icon {
      font-size: 0.875rem;
    }

    .confidence-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.125rem 0.5rem;
      font-size: 0.6875rem;
      font-weight: 500;
      background-color: var(--sl-color-primary-100, #dbeafe);
      color: var(--sl-color-primary-700, #1d4ed8);
      border-radius: 9999px;
    }
  `;

  // ==================== Public Properties ====================

  /** Whether a sample is currently loaded. */
  @property({ type: Boolean })
  hasSample = false;

  /** Whether auto-detection is in progress. */
  @property({ type: Boolean })
  isDetecting = false;

  /** Whether the current entry has unsaved changes. */
  @property({ type: Boolean })
  isDirty = false;

  /** Whether a save operation is in progress. */
  @property({ type: Boolean })
  isSaving = false;

  /** Whether save completed successfully (transient). */
  @property({ type: Boolean })
  saveSuccess = false;

  /** Whether entries are loading. */
  @property({ type: Boolean })
  loadingEntries = false;

  /** Confidence score from last auto-detection, or null. */
  @property({ attribute: false })
  lastConfidence: number | null = null;

  // ==================== Private State ====================

  @state()
  private _boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  // ==================== Lifecycle ====================

  connectedCallback(): void {
    super.connectedCallback();
    this._boundKeyHandler = this._onKeyDown.bind(this);
    document.addEventListener('keydown', this._boundKeyHandler);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._boundKeyHandler) {
      document.removeEventListener('keydown', this._boundKeyHandler);
      this._boundKeyHandler = null;
    }
  }

  // ==================== Keyboard Handling ====================

  /**
   * Handle global keyboard shortcuts for the editor.
   *
   * Note: Ctrl+S and Ctrl+Z/Shift+Z are handled by uvm-context-bar.
   * This component handles the "non-modifier" shortcuts that operate
   * outside of text inputs.
   */
  private _onKeyDown(e: KeyboardEvent): void {
    // Ctrl+S / Cmd+S to save (fallback if context-bar doesn't catch it)
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (this.isDirty && !this.isSaving) {
        this._dispatch('editor-toolbar:save');
      }
      return;
    }

    // Don't trigger shortcuts if user is typing in an input
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    // Sample navigation shortcuts
    if (e.key === '[') {
      e.preventDefault();
      this._dispatch('editor-toolbar:previous-sample');
      return;
    }

    if (e.key === ']') {
      e.preventDefault();
      this._dispatch('editor-toolbar:next-sample');
      return;
    }

    // Toggle precision drawer with = or + key
    if (e.key === '=' || e.key === '+') {
      e.preventDefault();
      this._dispatch('editor-toolbar:toggle-precision');
      return;
    }

    // D key for auto-detect
    if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      if (!this.isDetecting && this.hasSample) {
        this._dispatch('editor-toolbar:detect');
      }
      return;
    }

    // ? key for shortcut overlay
    if (e.key === '?') {
      e.preventDefault();
      this._dispatch('editor-toolbar:show-shortcuts');
      return;
    }
  }

  // ==================== Event Dispatch ====================

  private _dispatch(eventName: string): void {
    this.dispatchEvent(
      new CustomEvent(eventName, {
        bubbles: true,
        composed: true,
      })
    );
  }

  // ==================== Render ====================

  /**
   * Render the status indicator showing detection/save/loading state.
   * This is the only visual element of the toolbar.
   */
  renderStatusIndicator() {
    // Show detecting state
    if (this.isDetecting) {
      return html`
        <div class="status-indicator detecting" role="status" aria-label="Detecting parameters">
          <sl-spinner></sl-spinner>
          <span>Detecting parameters...</span>
        </div>
      `;
    }

    // Show loading entries state
    if (this.loadingEntries) {
      return html`
        <div class="status-indicator loading" role="status" aria-label="Loading entries">
          <sl-spinner></sl-spinner>
          <span>Loading entries...</span>
        </div>
      `;
    }

    // Show save success with confidence
    if (this.saveSuccess) {
      return html`
        <div class="status-indicator success" role="status" aria-label="Entry saved successfully">
          <sl-icon name="check-circle"></sl-icon>
          <span>Saved</span>
          ${this.lastConfidence !== null
            ? html`
                <span class="confidence-badge">
                  <sl-icon name="cpu"></sl-icon>
                  ${Math.round(this.lastConfidence * 100)}% confidence
                </span>
              `
            : null}
        </div>
      `;
    }

    // Show confidence from last detection (if available)
    if (this.lastConfidence !== null) {
      return html`
        <div class="status-indicator">
          <span class="confidence-badge">
            <sl-icon name="cpu"></sl-icon>
            ${Math.round(this.lastConfidence * 100)}% confidence
          </span>
        </div>
      `;
    }

    // No status to show
    return null;
  }

  render() {
    // The toolbar renders its status indicator. Keyboard shortcuts
    // are handled via the document-level event listener.
    return this.renderStatusIndicator();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-editor-toolbar': UvmEditorToolbar;
  }
}
