import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import type SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import type SlInput from '@shoelace-style/shoelace/dist/components/input/input.js';

import type { OtoEntry } from '../services/types.js';

/**
 * Event detail for entry-select events.
 */
export interface EntrySelectDetail {
  entry: OtoEntry;
}

/**
 * Event detail for entry-create events.
 */
export interface EntryCreateDetail {
  alias: string;
}

/**
 * Event detail for entry-delete events.
 */
export interface EntryDeleteDetail {
  entry: OtoEntry;
}

/**
 * Entry list panel for managing multiple oto aliases per sample.
 *
 * VCV-style voicebanks have multiple oto entries per WAV file (e.g.,
 * `_akasa.wav` has entries for "a ka" and "a sa"). This component
 * lists, selects, and creates entries for the current sample.
 *
 * @fires entry-select - Fired when an entry is selected. Detail: {entry: OtoEntry}
 * @fires entry-create - Fired when a new entry is requested. Detail: {alias: string}
 * @fires entry-delete - Fired when entry deletion is requested. Detail: {entry: OtoEntry}
 *
 * @example
 * ```html
 * <uvm-entry-list
 *   .entries=${this._entries}
 *   .selectedAlias=${this._currentEntry?.alias}
 *   .loading=${this._loadingEntries}
 *   @entry-select=${this._onEntrySelect}
 *   @entry-create=${this._onEntryCreate}
 *   @entry-delete=${this._onEntryDelete}
 * ></uvm-entry-list>
 * ```
 */
@customElement('uvm-entry-list')
export class UvmEntryList extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .entry-list {
      display: flex;
      flex-direction: column;
      background-color: var(--sl-color-neutral-50, #f8fafc);
      border: 1px solid var(--sl-color-neutral-200, #e2e8f0);
      border-radius: var(--sl-border-radius-medium, 0.375rem);
      overflow: hidden;
    }

    .entry-list-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      background-color: var(--sl-color-neutral-100, #f1f5f9);
      border-bottom: 1px solid var(--sl-color-neutral-200, #e2e8f0);
      font-weight: 600;
      font-size: 0.8125rem;
      color: var(--sl-color-neutral-700, #334155);
    }

    .entry-list-header span {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .entry-list-header sl-icon-button::part(base) {
      font-size: 0.875rem;
      padding: 0.25rem;
    }

    .entries {
      max-height: 200px;
      overflow-y: auto;
    }

    .entry-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      cursor: pointer;
      border-bottom: 1px solid var(--sl-color-neutral-100, #f1f5f9);
      transition: background-color 0.15s ease;
    }

    .entry-item:last-child {
      border-bottom: none;
    }

    .entry-item:hover {
      background-color: var(--sl-color-neutral-100, #f1f5f9);
    }

    .entry-item:hover .entry-delete {
      opacity: 1;
    }

    .entry-item.selected {
      background-color: var(--sl-color-primary-50, #eff6ff);
      border-left: 3px solid var(--sl-color-primary-500, #3b82f6);
      padding-left: calc(0.75rem - 3px);
    }

    .entry-item.selected:hover {
      background-color: var(--sl-color-primary-100, #dbeafe);
    }

    .entry-info {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      min-width: 0;
      flex: 1;
    }

    .alias {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--sl-color-neutral-800, #1e293b);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .timing {
      font-size: 0.6875rem;
      color: var(--sl-color-neutral-500, #64748b);
      font-family: monospace;
    }

    .entry-delete {
      opacity: 0;
      transition: opacity 0.15s ease;
      flex-shrink: 0;
    }

    .entry-delete::part(base) {
      font-size: 0.75rem;
      color: var(--sl-color-danger-500, #ef4444);
      padding: 0.25rem;
    }

    .entry-delete::part(base):hover {
      color: var(--sl-color-danger-600, #dc2626);
    }

    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1.5rem 1rem;
      text-align: center;
      color: var(--sl-color-neutral-400, #9ca3af);
      font-size: 0.8125rem;
    }

    .empty-icon {
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
    }

    .loading-state {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }

    .loading-state sl-spinner {
      font-size: 1.25rem;
      --indicator-color: var(--sl-color-primary-500, #3b82f6);
    }

    /* Dialog styles */
    .dialog-content {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .dialog-hint {
      font-size: 0.75rem;
      color: var(--sl-color-neutral-500, #64748b);
      line-height: 1.5;
      background-color: var(--sl-color-neutral-50, #f8fafc);
      padding: 0.75rem;
      border-radius: var(--sl-border-radius-small, 0.25rem);
      border: 1px solid var(--sl-color-neutral-200, #e2e8f0);
    }

    .dialog-hint strong {
      color: var(--sl-color-neutral-700, #334155);
    }

    .dialog-footer {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
    }
  `;

  /**
   * List of oto entries for the current file.
   */
  @property({ type: Array })
  entries: OtoEntry[] = [];

  /**
   * Currently selected entry alias (for highlighting).
   */
  @property({ type: String, attribute: 'selected-alias' })
  selectedAlias: string | null = null;

  /**
   * Whether entries are currently being loaded.
   */
  @property({ type: Boolean })
  loading = false;

  /**
   * Value of the new alias input field.
   */
  @state()
  private _newAlias = '';

  /**
   * Whether the create dialog is currently creating.
   */
  @state()
  private _isCreating = false;

  /**
   * Reference to the new entry dialog.
   */
  @query('#new-entry-dialog')
  private _dialog!: SlDialog;

  /**
   * Reference to the alias input field.
   */
  @query('#alias-input')
  private _aliasInput!: SlInput;

  /**
   * Handle click on the add button - show the new entry dialog.
   */
  private _onCreateClick(): void {
    this._newAlias = '';
    this._dialog.show();
    // Focus the input after the dialog opens
    this._dialog.addEventListener(
      'sl-after-show',
      () => {
        this._aliasInput?.focus();
      },
      { once: true }
    );
  }

  /**
   * Close the new entry dialog.
   */
  private _closeDialog(): void {
    this._dialog.hide();
    this._newAlias = '';
  }

  /**
   * Handle alias input change.
   */
  private _onAliasInput(e: Event): void {
    const input = e.target as SlInput;
    this._newAlias = input.value;
  }

  /**
   * Handle keydown in the alias input (Enter to create).
   */
  private _onAliasKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && this._newAlias.trim()) {
      e.preventDefault();
      this._createEntry();
    }
  }

  /**
   * Create a new entry with the entered alias.
   */
  private _createEntry(): void {
    const alias = this._newAlias.trim();
    if (!alias) return;

    // Check for duplicate alias
    if (this.entries.some((entry) => entry.alias === alias)) {
      // Could show an error, but for now just don't create
      return;
    }

    this._isCreating = true;

    this.dispatchEvent(
      new CustomEvent<EntryCreateDetail>('entry-create', {
        detail: { alias },
        bubbles: true,
        composed: true,
      })
    );

    // Close dialog - parent will handle actual creation
    this._closeDialog();
    this._isCreating = false;
  }

  /**
   * Select an entry.
   */
  private _selectEntry(entry: OtoEntry): void {
    this.dispatchEvent(
      new CustomEvent<EntrySelectDetail>('entry-select', {
        detail: { entry },
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Delete an entry.
   */
  private _deleteEntry(e: Event, entry: OtoEntry): void {
    // Stop propagation to prevent selecting the entry
    e.stopPropagation();

    this.dispatchEvent(
      new CustomEvent<EntryDeleteDetail>('entry-delete', {
        detail: { entry },
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Format timing info for display.
   */
  private _formatTiming(entry: OtoEntry): string {
    return `${entry.offset}ms - ${Math.abs(entry.cutoff)}ms`;
  }

  /**
   * Render the entry list items.
   */
  private _renderEntries() {
    if (this.loading) {
      return html`
        <div class="loading-state">
          <sl-spinner></sl-spinner>
        </div>
      `;
    }

    if (this.entries.length === 0) {
      return html`
        <div class="empty">
          <span class="empty-icon">--</span>
          No aliases yet
        </div>
      `;
    }

    return html`
      <div class="entries">
        ${this.entries.map(
          (entry) => html`
            <div
              class="entry-item ${entry.alias === this.selectedAlias ? 'selected' : ''}"
              @click=${() => this._selectEntry(entry)}
            >
              <div class="entry-info">
                <span class="alias">${entry.alias}</span>
                <span class="timing">${this._formatTiming(entry)}</span>
              </div>
              <sl-icon-button
                class="entry-delete"
                name="trash"
                label="Delete alias"
                @click=${(e: Event) => this._deleteEntry(e, entry)}
              ></sl-icon-button>
            </div>
          `
        )}
      </div>
    `;
  }

  /**
   * Render the new entry dialog.
   */
  private _renderDialog() {
    return html`
      <sl-dialog id="new-entry-dialog" label="New Alias">
        <div class="dialog-content">
          <sl-input
            id="alias-input"
            label="Alias"
            placeholder="a ka"
            .value=${this._newAlias}
            @sl-input=${this._onAliasInput}
            @keydown=${this._onAliasKeydown}
            required
          ></sl-input>

          <div class="dialog-hint">
            <strong>VCV format:</strong> "[vowel] [consonant][vowel]"<br />
            Examples: "a ka", "i ki", "u ku", "e ke", "o ko"<br /><br />
            <strong>CV format:</strong> "- [consonant][vowel]"<br />
            Examples: "- ka", "- sa", "- ta"
          </div>
        </div>

        <div slot="footer" class="dialog-footer">
          <sl-button variant="default" @click=${this._closeDialog}> Cancel </sl-button>
          <sl-button
            variant="primary"
            ?disabled=${!this._newAlias.trim() || this._isCreating}
            ?loading=${this._isCreating}
            @click=${this._createEntry}
          >
            Create
          </sl-button>
        </div>
      </sl-dialog>
    `;
  }

  render() {
    return html`
      <div class="entry-list">
        <div class="entry-list-header">
          <span>Aliases (${this.entries.length})</span>
          <sl-icon-button
            name="plus-lg"
            label="Add alias"
            ?disabled=${this.loading}
            @click=${this._onCreateClick}
          ></sl-icon-button>
        </div>

        ${this._renderEntries()}
      </div>

      ${this._renderDialog()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-entry-list': UvmEntryList;
  }
}
