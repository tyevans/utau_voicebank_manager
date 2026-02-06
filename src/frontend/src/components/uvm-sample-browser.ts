import { LitElement, html, css, nothing } from 'lit';
import { customElement, state, query, property } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/details/details.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

// Import sub-components
import './uvm-voicebank-panel.js';
import './uvm-sample-grid.js';
import './uvm-sample-list-view.js';
import './uvm-batch-operations.js';
import './uvm-phrase-preview.js';

import type { UvmSampleGrid } from './uvm-sample-grid.js';
import type SlInput from '@shoelace-style/shoelace/dist/components/input/input.js';

import { api } from '../services/api.js';
import type { OtoEntry, VoicebankSummary } from '../services/types.js';
import { UvmToastManager } from './uvm-toast-manager.js';

/** View mode for the sample browser */
type SampleViewMode = 'grid' | 'list';

/** LocalStorage key for persisting view mode preference */
const VIEW_MODE_STORAGE_KEY = 'uvm-sample-browser-view-mode';

/**
 * Sample browser component for selecting voicebank samples.
 *
 * Displays as a modal overlay with a two-panel layout: voicebanks on the left
 * and samples in the selected voicebank on the right (as a card grid or list).
 *
 * This component acts as a thin orchestrator, composing:
 * - uvm-voicebank-panel: Voicebank selector/switcher with upload and delete
 * - uvm-sample-grid: Virtual scrolling grid view for samples
 * - uvm-sample-list-view: Compact list view for samples
 * - uvm-batch-operations: Batch ML auto-detection dialog
 *
 * @fires sample-select - Fired when a sample is selected (click or Enter)
 * @fires uvm-sample-browser:close - Fired when user closes the browser
 *
 * @example
 * ```html
 * <uvm-sample-browser
 *   ?open=${this._showBrowser}
 *   @sample-select=${this._onSampleSelect}
 *   @uvm-sample-browser:close=${() => this._showBrowser = false}
 * ></uvm-sample-browser>
 * ```
 */
@customElement('uvm-sample-browser')
export class UvmSampleBrowser extends LitElement {
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
      z-index: 1000;
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
      width: min(1000px, 90vw);
      max-height: 80vh;
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
      gap: 0.75rem;
      padding: 0.875rem 1rem;
      background-color: #fafafa;
      border-bottom: 1px solid #e5e7eb;
      flex-shrink: 0;
    }

    .modal-header sl-icon-button {
      flex-shrink: 0;
    }

    .modal-header sl-icon-button::part(base) {
      padding: 0.25rem;
      color: #6b7280;
    }

    .modal-header sl-icon-button::part(base):hover {
      color: #374151;
    }

    .modal-header sl-input {
      flex: 1;
    }

    .modal-header sl-input::part(base) {
      border: none;
      background-color: transparent;
    }

    .modal-header sl-input::part(input) {
      font-size: 0.9375rem;
    }

    .modal-body {
      flex: 1;
      display: flex;
      gap: 1rem;
      padding: 1rem;
      min-height: 0;
      overflow: hidden;
    }

    .modal-footer {
      flex-shrink: 0;
      padding: 0.5rem 1rem;
      font-size: 0.75rem;
      color: #9ca3af;
      background-color: #fafafa;
      border-top: 1px solid #e5e7eb;
    }

    @media (max-width: 768px) {
      .modal-body {
        flex-direction: column;
      }
    }

    /* Samples panel */
    .samples-panel {
      flex: 1;
      min-width: 200px;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background-color: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04);
    }

    @media (max-width: 768px) {
      .samples-panel {
        max-width: 100%;
        flex: 1;
      }
    }

    .panel-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.875rem 1rem;
      background-color: #fafafa;
      border-bottom: 1px solid #e5e7eb;
      font-weight: 600;
      font-size: 0.8125rem;
      color: #374151;
    }

    .panel-header sl-icon {
      font-size: 0.9375rem;
      color: #6b7280;
    }

    .panel-content {
      flex: 1;
      overflow-y: auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }

    .panel-header-actions {
      margin-left: auto;
    }

    .panel-header-actions sl-icon-button {
      font-size: 0.875rem;
    }

    .panel-header-actions sl-icon-button::part(base) {
      padding: 0.25rem;
      color: #6b7280;
    }

    .panel-header-actions sl-icon-button::part(base):hover {
      color: #374151;
    }

    .view-toggle {
      margin-right: 0.25rem;
    }

    .view-toggle::part(base) {
      padding: 0.25rem;
      color: #6b7280;
    }

    .view-toggle::part(base):hover {
      color: #374151;
    }

    .phrase-preview-section {
      flex-shrink: 0;
      border-top: 1px solid #e5e7eb;
      background-color: #fafafa;
    }

    .phrase-preview-section sl-details {
      --border-width: 0;
      --border-radius: 0;
    }

    .phrase-preview-section sl-details::part(base) {
      border: none;
      background-color: transparent;
    }

    .phrase-preview-section sl-details::part(header) {
      padding: 0.875rem 1rem;
      font-size: 0.8125rem;
      font-weight: 600;
      color: #374151;
    }

    .phrase-preview-section sl-details::part(summary-icon) {
      color: #6b7280;
    }

    .phrase-preview-section sl-details::part(content) {
      padding: 0 1rem 1rem;
    }

    .phrase-preview-section .section-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .phrase-preview-section .section-header sl-icon {
      font-size: 1rem;
      color: #6b7280;
    }

    .keyboard-hint {
      flex-shrink: 0;
      padding: 0.5rem 1rem;
      font-size: 0.6875rem;
      color: #9ca3af;
      background-color: #fafafa;
      border-top: 1px solid #e5e7eb;
    }

    /* Empty, loading, error states */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem 1rem;
      text-align: center;
      height: 100%;
      min-height: 180px;
    }

    .empty-state sl-icon {
      font-size: 2rem;
      color: #d1d5db;
      margin-bottom: 0.625rem;
    }

    .empty-state-text {
      font-size: 0.8125rem;
      color: #6b7280;
      max-width: 180px;
      line-height: 1.5;
    }

    .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      height: 100%;
      min-height: 180px;
    }

    .loading-state sl-spinner {
      font-size: 1.75rem;
      --indicator-color: #3b82f6;
    }

    .loading-state-text {
      margin-top: 0.625rem;
      font-size: 0.8125rem;
      color: #6b7280;
    }

    .error-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem 1rem;
      text-align: center;
      height: 100%;
      min-height: 180px;
    }

    .error-state sl-icon {
      font-size: 2rem;
      color: #ef4444;
      margin-bottom: 0.625rem;
    }

    .error-state-text {
      font-size: 0.8125rem;
      color: #dc2626;
      max-width: 180px;
      line-height: 1.5;
    }

    .skeleton-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 0.625rem;
      padding: 1rem 1.25rem;
    }

    .skeleton-chip {
      width: 70px;
      height: 26px;
      border-radius: 9999px;
    }
  `;

  /**
   * Whether the sample browser modal is open.
   */
  @property({ type: Boolean, reflect: true })
  open = false;

  @state()
  private _voicebanks: VoicebankSummary[] = [];

  @state()
  private _selectedVoicebank: string | null = null;

  @state()
  private _samples: string[] = [];

  @state()
  private _selectedSample: string | null = null;

  @state()
  private _loadingVoicebanks = false;

  @state()
  private _loadingSamples = false;

  @state()
  private _voicebanksError: string | null = null;

  @state()
  private _samplesError: string | null = null;

  @state()
  private _sampleOtoMap: Map<string, boolean> = new Map();

  private _sampleOtoEntryMap: Map<string, OtoEntry> = new Map();

  @state()
  private _availableAliases: Set<string> = new Set();

  @state()
  private _showBatchDialog = false;

  @state()
  private _viewMode: SampleViewMode = 'grid';

  @state()
  private _searchQuery = '';

  @query('.search-input')
  private _searchInput!: SlInput;

  @query('uvm-sample-grid')
  private _sampleGrid!: UvmSampleGrid;

  /**
   * Handle global keydown for Escape to close modal and vim-style navigation.
   */
  private _handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.open) return;

    // Don't handle keys if the batch dialog is open
    if (this._showBatchDialog) return;

    // Don't handle if focus is in an input element
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this._close();
      }
      return;
    }

    // Escape to close modal
    if (e.key === 'Escape') {
      e.preventDefault();
      this._close();
      return;
    }

    // Grid view vim-style navigation (hjkl)
    if (this._viewMode === 'grid' && this._selectedVoicebank && this._sampleGrid) {
      const filteredSamples = this._getFilteredSamples();
      if (filteredSamples.length === 0) return;

      switch (e.key) {
        case 'h':
        case 'ArrowLeft':
          e.preventDefault();
          this._sampleGrid.navigateGrid(-1, 0);
          break;
        case 'l':
        case 'ArrowRight':
          e.preventDefault();
          this._sampleGrid.navigateGrid(1, 0);
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          this._sampleGrid.navigateGrid(0, -1);
          break;
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          this._sampleGrid.navigateGrid(0, 1);
          break;
        case 'Enter':
          e.preventDefault();
          this._sampleGrid.activateSelected();
          break;
      }
    }
  };

  connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('keydown', this._handleKeyDown);
    this._loadViewModePreference();
    this._fetchVoicebanks();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this._handleKeyDown);
  }

  protected updated(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('open') && this.open) {
      requestAnimationFrame(() => {
        this._searchInput?.focus();
      });
    }
  }

  // --- Modal management ---

  private _close(): void {
    this.dispatchEvent(new CustomEvent('uvm-sample-browser:close', {
      bubbles: true,
      composed: true,
    }));
  }

  private _onBackdropClick(): void {
    this._close();
  }

  // --- Search ---

  private _onSearchInput(e: Event): void {
    const input = e.target as SlInput;
    this._searchQuery = input.value;
  }

  private _getFilteredSamples(): string[] {
    if (!this._searchQuery.trim()) {
      return this._samples;
    }
    const query = this._searchQuery.toLowerCase().trim();
    return this._samples.filter(sample =>
      this._displayName(sample).toLowerCase().includes(query)
    );
  }

  // --- View mode ---

  private _loadViewModePreference(): void {
    try {
      const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      if (saved === 'grid' || saved === 'list') {
        this._viewMode = saved;
      }
    } catch {
      // localStorage may not be available
    }
  }

  private _toggleViewMode(): void {
    this._viewMode = this._viewMode === 'grid' ? 'list' : 'grid';
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, this._viewMode);
    } catch {
      // localStorage may not be available
    }
  }

  // --- Data fetching ---

  private async _fetchVoicebanks(): Promise<void> {
    this._loadingVoicebanks = true;
    this._voicebanksError = null;

    try {
      this._voicebanks = await api.listVoicebanks();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to load voicebanks';
      this._voicebanksError = errorMessage;
      UvmToastManager.error('Failed to load voicebanks');
    } finally {
      this._loadingVoicebanks = false;
    }
  }

  private async _fetchSamples(voicebankId: string): Promise<void> {
    this._loadingSamples = true;
    this._samplesError = null;
    this._samples = [];
    this._selectedSample = null;
    this._sampleOtoMap.clear();
    this._sampleOtoEntryMap.clear();
    this._availableAliases = new Set();

    try {
      const [samples, otoEntries] = await Promise.all([
        api.listSamples(voicebankId),
        api.getOtoEntries(voicebankId),
      ]);

      this._samples = samples;

      const newOtoMap = new Map<string, boolean>();
      const newOtoEntryMap = new Map<string, OtoEntry>();
      for (const entry of otoEntries) {
        if (!newOtoEntryMap.has(entry.filename)) {
          newOtoEntryMap.set(entry.filename, entry);
        }
      }
      for (const sample of samples) {
        newOtoMap.set(sample, newOtoEntryMap.has(sample));
      }
      this._sampleOtoMap = newOtoMap;
      this._sampleOtoEntryMap = newOtoEntryMap;

      this._availableAliases = new Set(otoEntries.map((e) => e.alias));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to load samples';
      this._samplesError = errorMessage;
      UvmToastManager.error('Failed to load samples');
    } finally {
      this._loadingSamples = false;
    }
  }

  /**
   * Retry loading samples for the currently selected voicebank.
   */
  private _retrySamplesLoad(): void {
    if (this._selectedVoicebank) {
      this._fetchSamples(this._selectedVoicebank);
    }
  }

  // --- Event handlers from sub-components ---

  private _onVoicebankSelect(e: CustomEvent<{ voicebankId: string }>): void {
    const { voicebankId } = e.detail;
    if (this._selectedVoicebank === voicebankId) return;
    this._selectedVoicebank = voicebankId;
    this._searchQuery = '';
    this._fetchSamples(voicebankId);

    this.dispatchEvent(
      new CustomEvent('voicebank-select', {
        detail: { voicebankId },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onVoicebanksChanged(e: CustomEvent<{ deletedVoicebankId?: string }>): void {
    const deletedId = e.detail?.deletedVoicebankId;

    // If the deleted voicebank was selected, clear selection
    if (deletedId && this._selectedVoicebank === deletedId) {
      this._selectedVoicebank = null;
      this._samples = [];
      this._selectedSample = null;
      this._sampleOtoMap.clear();
      this._availableAliases = new Set();
    }

    this._fetchVoicebanks();
  }

  private _onSampleClick(e: CustomEvent<{ filename: string }>): void {
    this._selectedSample = e.detail.filename;
  }

  private _onSampleSelect(e: CustomEvent<{ filename: string }>): void {
    this._emitSampleSelect(e.detail.filename);
  }

  private _onBatchComplete(): void {
    // Refresh samples to update oto status
    if (this._selectedVoicebank) {
      this._fetchSamples(this._selectedVoicebank);
    }
  }

  private _onBatchDialogClose(): void {
    this._showBatchDialog = false;
  }

  // --- Helpers ---

  private _displayName(filename: string): string {
    return filename.replace(/\.wav$/i, '');
  }

  private _getSelectedVoicebankName(): string {
    const vb = this._voicebanks.find((v) => v.id === this._selectedVoicebank);
    return vb?.name ?? '';
  }

  private _getSampleCounts(): { configured: number; total: number } {
    const configured = Array.from(this._sampleOtoMap.values()).filter(Boolean).length;
    return { configured, total: this._samples.length };
  }

  private _emitSampleSelect(filename: string): void {
    if (!this._selectedVoicebank) return;

    this.dispatchEvent(
      new CustomEvent('sample-select', {
        detail: {
          voicebankId: this._selectedVoicebank,
          filename,
        },
        bubbles: true,
        composed: true,
      })
    );

    this._close();
  }

  private _openBatchDialog(): void {
    this._showBatchDialog = true;
  }

  // --- Rendering ---

  render() {
    if (!this.open) {
      return nothing;
    }

    const { configured, total } = this._getSampleCounts();

    return html`
      <div class="backdrop" @click=${this._onBackdropClick} aria-hidden="true"></div>
      <div
        class="modal-container"
        role="dialog"
        aria-label="Sample browser"
        aria-modal="true"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <div class="modal-header">
          <sl-icon-button
            name="x-lg"
            label="Close sample browser"
            @click=${this._close}
          ></sl-icon-button>
          <sl-input
            class="search-input"
            placeholder="Search samples..."
            aria-label="Search samples"
            .value=${this._searchQuery}
            @sl-input=${this._onSearchInput}
            clearable
          >
            <sl-icon name="search" slot="prefix"></sl-icon>
          </sl-input>
        </div>
        <div class="modal-body">
          <uvm-voicebank-panel
            .voicebanks=${this._voicebanks}
            .selectedVoicebankId=${this._selectedVoicebank}
            ?loadingVoicebanks=${this._loadingVoicebanks}
            .voicebanksError=${this._voicebanksError}
            @voicebank-select=${this._onVoicebankSelect}
            @voicebanks-changed=${this._onVoicebanksChanged}
            @voicebanks-retry=${this._fetchVoicebanks}
          ></uvm-voicebank-panel>
          ${this._renderSamplesPanel()}
        </div>
        <div class="modal-footer" role="status" aria-label="Sample configuration progress">
          ${this._selectedVoicebank && total > 0
            ? html`${configured} configured / ${total} total`
            : html`Select a voicebank to browse samples`}
        </div>
      </div>
      <uvm-batch-operations
        ?open=${this._showBatchDialog}
        .voicebankId=${this._selectedVoicebank}
        .voicebankName=${this._getSelectedVoicebankName()}
        .sampleCount=${this._samples.length}
        @batch-complete=${this._onBatchComplete}
        @batch-dialog-close=${this._onBatchDialogClose}
      ></uvm-batch-operations>
    `;
  }

  private _renderSamplesPanel() {
    const filteredSamples = this._getFilteredSamples();

    return html`
      <div class="panel samples-panel" role="region" aria-label="Samples">
        <div class="panel-header">
          <sl-icon name="music-note-list"></sl-icon>
          Samples
          ${this._selectedVoicebank
            ? html`<span style="font-weight: normal; color: #9ca3af; margin-left: 0.25rem;">
                (${this._getSelectedVoicebankName()})
              </span>`
            : null}
          ${this._selectedVoicebank && this._samples.length > 0
            ? html`
                <div class="panel-header-actions">
                  <sl-tooltip content="${this._viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}">
                    <sl-icon-button
                      class="view-toggle"
                      name="${this._viewMode === 'grid' ? 'list-ul' : 'grid-3x3'}"
                      label="${this._viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}"
                      @click=${this._toggleViewMode}
                    ></sl-icon-button>
                  </sl-tooltip>
                  <sl-tooltip content="Auto-detect all samples">
                    <sl-icon-button
                      name="magic"
                      label="Auto-detect all samples"
                      @click=${this._openBatchDialog}
                    ></sl-icon-button>
                  </sl-tooltip>
                </div>
              `
            : null}
        </div>
        <div class="panel-content">
          ${!this._selectedVoicebank
            ? this._renderSelectVoicebankPrompt()
            : this._loadingSamples
              ? this._renderSampleLoadingState()
              : this._samplesError
                ? this._renderErrorState(this._samplesError)
                : filteredSamples.length === 0
                  ? this._searchQuery
                    ? this._renderNoSearchResults()
                    : this._renderEmptySamples()
                  : this._viewMode === 'grid'
                    ? html`
                        <uvm-sample-grid
                          .samples=${filteredSamples}
                          .selectedSample=${this._selectedSample}
                          .voicebankId=${this._selectedVoicebank || ''}
                          .sampleOtoMap=${this._sampleOtoMap}
                          .sampleOtoEntryMap=${this._sampleOtoEntryMap}
                          @sample-click=${this._onSampleClick}
                          @sample-select=${this._onSampleSelect}
                        ></uvm-sample-grid>
                      `
                    : html`
                        <uvm-sample-list-view
                          .samples=${filteredSamples}
                          .selectedSample=${this._selectedSample}
                          .sampleOtoMap=${this._sampleOtoMap}
                          @sample-click=${this._onSampleClick}
                          @sample-select=${this._onSampleSelect}
                        ></uvm-sample-list-view>
                      `}
        </div>
        ${this._selectedVoicebank && this._samples.length > 0
          ? html`
              <div class="phrase-preview-section">
                <sl-details summary="Demo Songs">
                  <span slot="summary" class="section-header">
                    <sl-icon name="music-note-beamed"></sl-icon>
                    Demo Songs
                  </span>
                  <uvm-phrase-preview
                    voicebankId=${this._selectedVoicebank}
                    .availableAliases=${this._availableAliases}
                  ></uvm-phrase-preview>
                </sl-details>
              </div>
            `
          : null}
        ${this._samples.length > 0
          ? html`<div class="keyboard-hint">
              ${this._viewMode === 'grid'
                ? 'Arrow keys or hjkl to navigate, Enter to load'
                : 'Arrow keys to navigate, Enter to load'}
            </div>`
          : null}
      </div>
    `;
  }

  // --- State rendering helpers ---

  private _renderSelectVoicebankPrompt() {
    return html`
      <div class="empty-state">
        <sl-icon name="arrow-left-circle"></sl-icon>
        <div class="empty-state-text">Select a voicebank to view samples.</div>
      </div>
    `;
  }

  private _renderSampleLoadingState() {
    return html`
      <div class="skeleton-chips">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(
          () => html`
            <sl-skeleton class="skeleton-chip" effect="pulse"></sl-skeleton>
          `
        )}
      </div>
    `;
  }

  private _renderErrorState(message: string) {
    return html`
      <div class="error-state">
        <sl-icon name="exclamation-triangle"></sl-icon>
        <div class="error-state-text">${message}</div>
        <sl-button
          size="small"
          variant="default"
          style="margin-top: 0.75rem;"
          @click=${this._retrySamplesLoad}
        >
          <sl-icon slot="prefix" name="arrow-counterclockwise"></sl-icon>
          Retry
        </sl-button>
      </div>
    `;
  }

  private _renderEmptySamples() {
    return html`
      <div class="empty-state">
        <sl-icon name="music-note"></sl-icon>
        <div class="empty-state-text">No samples in this voicebank.</div>
      </div>
    `;
  }

  private _renderNoSearchResults() {
    return html`
      <div class="empty-state">
        <sl-icon name="search"></sl-icon>
        <div class="empty-state-text">No samples match "${this._searchQuery}"</div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-sample-browser': UvmSampleBrowser;
  }
}
