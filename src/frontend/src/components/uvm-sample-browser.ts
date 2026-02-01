import { LitElement, html, css, nothing } from 'lit';
import { customElement, state, query, property } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/badge/badge.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/details/details.js';

/** View mode for the sample browser */
type SampleViewMode = 'grid' | 'list';

/** LocalStorage key for persisting view mode preference */
const VIEW_MODE_STORAGE_KEY = 'uvm-sample-browser-view-mode';

import { api, ApiError, getDefaultApiUrl } from '../services/api.js';
import type { BatchOtoResult, VoicebankSummary } from '../services/types.js';
import './uvm-upload-zone.js';
import './uvm-phrase-preview.js';
import type { UvmUploadZone } from './uvm-upload-zone.js';
import { UvmToastManager } from './uvm-toast-manager.js';
import { getNonEmptyGroups, type PhonemeFamily } from '../utils/phoneme-groups.js';
import type SlInput from '@shoelace-style/shoelace/dist/components/input/input.js';

/**
 * Sample browser component for selecting voicebank samples.
 *
 * Displays as a modal overlay with a two-panel layout: voicebanks on the left
 * and samples in the selected voicebank on the right (as a chip grid).
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

    /* Responsive: stack on mobile */
    @media (max-width: 768px) {
      .modal-body {
        flex-direction: column;
      }
    }

    .panel {
      display: flex;
      flex-direction: column;
      background-color: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04);
      overflow: hidden;
      min-height: 0;
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
    }

    /* Voicebank panel - narrower and compact */
    .voicebank-panel {
      flex: 0 0 180px;
      min-width: 160px;
      max-width: 200px;
    }

    .samples-panel {
      flex: 1;
      min-width: 200px;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .samples-panel .panel-content {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }

    @media (max-width: 768px) {
      .voicebank-panel,
      .samples-panel {
        max-width: 100%;
        flex: 1;
      }
    }

    /* Voicebank list styling */
    .voicebank-list {
      list-style: none;
      margin: 0;
      padding: 0.5rem 0;
    }

    .voicebank-item {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      padding: 0.625rem 1rem;
      cursor: pointer;
      border-bottom: 1px solid #f3f4f6;
      transition: all 0.15s ease;
    }

    .voicebank-item:last-child {
      border-bottom: none;
    }

    .voicebank-item:hover {
      background-color: #f9fafb;
    }

    .voicebank-item.selected {
      background-color: #eff6ff;
      border-left: 3px solid #3b82f6;
      padding-left: calc(1rem - 3px);
    }

    .voicebank-item:focus {
      outline: 2px solid #3b82f6;
      outline-offset: -2px;
    }

    .voicebank-icon {
      flex-shrink: 0;
      font-size: 1rem;
      color: #9ca3af;
    }

    .voicebank-item.selected .voicebank-icon {
      color: #3b82f6;
    }

    .voicebank-content {
      flex: 1;
      min-width: 0;
    }

    .voicebank-name {
      font-size: 0.8125rem;
      font-weight: 500;
      color: #1f2937;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .voicebank-meta {
      font-size: 0.6875rem;
      color: #9ca3af;
      margin-top: 0.125rem;
    }

    .voicebank-badges {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      flex-shrink: 0;
    }

    .voicebank-badges sl-badge::part(base) {
      font-size: 0.625rem;
      padding: 0.125rem 0.375rem;
    }

    /* Sample chips container */
    .sample-chips-container {
      padding: 0.75rem 1rem;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }

    .sample-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 0.625rem;
      align-content: flex-start;
    }

    /* Phoneme group sections */
    .phoneme-groups {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .phoneme-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .phoneme-group-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.25rem 0;
      border-bottom: 1px solid #e5e7eb;
    }

    .phoneme-group-label {
      font-size: 0.6875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
    }

    .phoneme-group-count {
      font-size: 0.625rem;
      color: #9ca3af;
      font-weight: 400;
    }

    .phoneme-group-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem 0.5rem;
      padding-left: 0.25rem;
    }

    /* Individual sample chip */
    .sample-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.25rem 0.625rem;
      background-color: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 500;
      color: #374151;
      cursor: pointer;
      transition: all 0.15s ease;
      user-select: none;
      max-width: 120px;
    }

    .sample-chip:hover {
      background-color: #e5e7eb;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
      transform: translateY(-1px);
    }

    .sample-chip:focus {
      outline: 2px solid #3b82f6;
      outline-offset: 1px;
    }

    .sample-chip.selected {
      background-color: #3b82f6;
      border-color: #2563eb;
      color: #ffffff;
      box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3);
    }

    .sample-chip.selected:hover {
      background-color: #2563eb;
    }

    .sample-chip-name {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Has-oto indicator dot */
    .oto-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: #22c55e;
      flex-shrink: 0;
    }

    .sample-chip.selected .oto-dot {
      background-color: #86efac;
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

    .skeleton-list {
      padding: 0.5rem 0;
    }

    .skeleton-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
    }

    .skeleton-icon {
      flex-shrink: 0;
    }

    .skeleton-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .skeleton-item sl-skeleton {
      --border-radius: 4px;
    }

    /* Skeleton chips for samples */
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

    .keyboard-hint {
      flex-shrink: 0;
      padding: 0.5rem 1rem;
      font-size: 0.6875rem;
      color: #9ca3af;
      background-color: #fafafa;
      border-top: 1px solid #e5e7eb;
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

    .upload-dialog-body {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .upload-dialog-footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
    }

    .upload-alert {
      margin-bottom: 1rem;
    }

    .delete-btn {
      opacity: 0;
      transition: opacity 0.15s ease;
      font-size: 0.75rem;
      color: #9ca3af;
    }

    .delete-btn::part(base) {
      padding: 0.125rem;
    }

    .delete-btn:hover {
      color: #ef4444;
    }

    .voicebank-item:hover .delete-btn,
    .voicebank-item:focus-within .delete-btn {
      opacity: 1;
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

    /* View toggle button styling */
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

    /* List view styles */
    .sample-list-container {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }

    .sample-list {
      display: flex;
      flex-direction: column;
    }

    .sample-list-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 1rem;
      border-bottom: 1px solid #f3f4f6;
      cursor: pointer;
      transition: background-color 0.15s ease;
    }

    .sample-list-item:last-child {
      border-bottom: none;
    }

    .sample-list-item:hover {
      background-color: #f9fafb;
    }

    .sample-list-item:focus {
      outline: 2px solid #3b82f6;
      outline-offset: -2px;
    }

    .sample-list-item.selected {
      background-color: #eff6ff;
      border-left: 3px solid #3b82f6;
      padding-left: calc(1rem - 3px);
    }

    .sample-list-alias {
      font-size: 0.8125rem;
      font-weight: 500;
      color: #1f2937;
      min-width: 80px;
    }

    .sample-list-item.selected .sample-list-alias {
      color: #1d4ed8;
    }

    .sample-list-filename {
      flex: 1;
      font-size: 0.75rem;
      color: #6b7280;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .sample-list-status {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      flex-shrink: 0;
    }

    .sample-list-status sl-badge::part(base) {
      font-size: 0.625rem;
      padding: 0.125rem 0.375rem;
    }

    .sample-list-oto-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: #22c55e;
    }

    .sample-list-no-oto {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: #d1d5db;
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

  @state()
  private _availableAliases: Set<string> = new Set();

  @state()
  private _showUploadDialog = false;

  @state()
  private _uploadName = '';

  @state()
  private _uploadFiles: File[] = [];

  @state()
  private _isUploading = false;

  @state()
  private _uploadError: string | null = null;

  @state()
  private _showDeleteDialog = false;

  @state()
  private _voicebankToDelete: VoicebankSummary | null = null;

  @state()
  private _isDeleting = false;

  @state()
  private _showBatchDialog = false;

  @state()
  private _isBatchProcessing = false;

  @state()
  private _batchOverwriteExisting = false;

  @state()
  private _isDownloading = false;

  @state()
  private _batchResult: BatchOtoResult | null = null;

  @state()
  private _viewMode: SampleViewMode = 'grid';

  @state()
  private _searchQuery = '';

  @query('uvm-upload-zone')
  private _uploadZone!: UvmUploadZone;

  @query('.search-input')
  private _searchInput!: SlInput;

  /**
   * Handle global keydown for Escape to close modal.
   */
  private _handleKeyDown = (e: KeyboardEvent): void => {
    if (this.open && e.key === 'Escape') {
      // Don't close if a nested dialog is open
      if (this._showUploadDialog || this._showDeleteDialog || this._showBatchDialog) {
        return;
      }
      e.preventDefault();
      this._close();
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

  /**
   * Focus the search input when modal opens.
   */
  protected updated(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('open') && this.open) {
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        this._searchInput?.focus();
      });
    }
  }

  /**
   * Close the modal and emit close event.
   */
  private _close(): void {
    this.dispatchEvent(new CustomEvent('uvm-sample-browser:close', {
      bubbles: true,
      composed: true,
    }));
  }

  /**
   * Handle backdrop click to close modal.
   */
  private _onBackdropClick(): void {
    this._close();
  }

  /**
   * Handle search input changes.
   */
  private _onSearchInput(e: Event): void {
    const input = e.target as SlInput;
    this._searchQuery = input.value;
  }

  /**
   * Get filtered samples based on search query.
   */
  private _getFilteredSamples(): string[] {
    if (!this._searchQuery.trim()) {
      return this._samples;
    }
    const query = this._searchQuery.toLowerCase().trim();
    return this._samples.filter(sample =>
      this._displayName(sample).toLowerCase().includes(query)
    );
  }

  /**
   * Load the view mode preference from localStorage.
   */
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

  /**
   * Toggle between grid and list view modes.
   */
  private _toggleViewMode(): void {
    this._viewMode = this._viewMode === 'grid' ? 'list' : 'grid';
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, this._viewMode);
    } catch {
      // localStorage may not be available
    }
  }

  /**
   * Fetch all voicebanks from the API.
   */
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

  /**
   * Download the selected voicebank as a ZIP file.
   */
  private async _downloadVoicebank(): Promise<void> {
    if (!this._selectedVoicebank || this._isDownloading) return;

    this._isDownloading = true;

    try {
      const voicebankId = this._selectedVoicebank;
      const voicebankName = this._getSelectedVoicebankName();
      const downloadUrl = `${getDefaultApiUrl()}/voicebanks/${encodeURIComponent(voicebankId)}/download`;

      // Create a temporary anchor element and trigger download
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `${voicebankName}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      UvmToastManager.success(`Downloading "${voicebankName}"...`);
    } catch (error) {
      console.error('Failed to download voicebank:', error);
      UvmToastManager.error('Failed to download voicebank');
    } finally {
      // Reset after a short delay to allow the download to start
      setTimeout(() => {
        this._isDownloading = false;
      }, 1000);
    }
  }

  /**
   * Fetch samples for the selected voicebank.
   */
  private async _fetchSamples(voicebankId: string): Promise<void> {
    this._loadingSamples = true;
    this._samplesError = null;
    this._samples = [];
    this._selectedSample = null;
    this._sampleOtoMap.clear();
    this._availableAliases = new Set();

    try {
      // Fetch samples and oto entries in parallel
      const [samples, otoEntries] = await Promise.all([
        api.listSamples(voicebankId),
        api.getOtoEntries(voicebankId),
      ]);

      this._samples = samples;

      // Build a set of filenames that have oto entries
      const filesWithOto = new Set(otoEntries.map((e) => e.filename));
      const newOtoMap = new Map<string, boolean>();
      for (const sample of samples) {
        newOtoMap.set(sample, filesWithOto.has(sample));
      }
      this._sampleOtoMap = newOtoMap;

      // Build a set of all available aliases for phrase preview
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
   * Handle voicebank selection.
   */
  private _onVoicebankClick(voicebankId: string): void {
    if (this._selectedVoicebank === voicebankId) return;
    this._selectedVoicebank = voicebankId;
    this._searchQuery = ''; // Clear search when switching voicebanks
    this._fetchSamples(voicebankId);

    // Emit event to notify parent of voicebank selection
    this.dispatchEvent(
      new CustomEvent('voicebank-select', {
        detail: { voicebankId },
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Handle sample click (select and load sample).
   */
  private _onSampleClick(filename: string): void {
    this._selectedSample = filename;
    this._emitSampleSelect(filename);
  }

  /**
   * Handle keyboard navigation on samples.
   */
  private _onSampleKeyDown(e: KeyboardEvent, filename: string): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      this._emitSampleSelect(filename);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      this._navigateSample(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this._navigateSample(-1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      // Navigate down by row (approximately 5-6 chips per row)
      this._navigateSample(5);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._navigateSample(-5);
    }
  }

  /**
   * Handle keyboard navigation on voicebanks.
   */
  private _onVoicebankKeyDown(e: KeyboardEvent, voicebankId: string): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this._onVoicebankClick(voicebankId);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._navigateVoicebank(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._navigateVoicebank(-1);
    }
  }

  /**
   * Navigate to next/previous voicebank.
   */
  private _navigateVoicebank(direction: number): void {
    if (this._voicebanks.length === 0) return;

    const currentIndex = this._selectedVoicebank
      ? this._voicebanks.findIndex((v) => v.id === this._selectedVoicebank)
      : -1;

    const newIndex = Math.max(
      0,
      Math.min(this._voicebanks.length - 1, currentIndex + direction)
    );

    const newVoicebank = this._voicebanks[newIndex];
    if (newVoicebank) {
      this._onVoicebankClick(newVoicebank.id);
      this._focusVoicebankItem(newVoicebank.id);
    }
  }

  /**
   * Navigate to next/previous sample.
   */
  private _navigateSample(direction: number): void {
    const filteredSamples = this._getFilteredSamples();
    if (filteredSamples.length === 0) return;

    const currentIndex = this._selectedSample
      ? filteredSamples.indexOf(this._selectedSample)
      : -1;

    const newIndex = Math.max(
      0,
      Math.min(filteredSamples.length - 1, currentIndex + direction)
    );

    const newSample = filteredSamples[newIndex];
    if (newSample) {
      this._selectedSample = newSample;
      this._focusSampleItem(newSample);
    }
  }

  /**
   * Focus a voicebank list item by ID.
   */
  private _focusVoicebankItem(voicebankId: string): void {
    const item = this.shadowRoot?.querySelector(
      `[data-voicebank-id="${voicebankId}"]`
    ) as HTMLElement | null;
    item?.focus();
  }

  /**
   * Focus a sample chip by filename.
   */
  private _focusSampleItem(filename: string): void {
    const item = this.shadowRoot?.querySelector(
      `[data-sample-filename="${filename}"]`
    ) as HTMLElement | null;
    item?.focus();
  }

  /**
   * Emit the sample-select event and close the modal.
   */
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

    // Close the modal after selection
    this._close();
  }

  /**
   * Strip .wav extension from filename for display.
   */
  private _displayName(filename: string): string {
    return filename.replace(/\.wav$/i, '');
  }

  /**
   * Get configured vs total sample counts.
   */
  private _getSampleCounts(): { configured: number; total: number } {
    const configured = Array.from(this._sampleOtoMap.values()).filter(Boolean).length;
    return { configured, total: this._samples.length };
  }

  /**
   * Render the voicebanks panel.
   */
  private _renderVoicebanksPanel() {
    return html`
      <div class="panel voicebank-panel">
        <div class="panel-header">
          <sl-icon name="folder2"></sl-icon>
          Voicebanks
          <div class="panel-header-actions">
            ${this._selectedVoicebank
              ? html`
                  <sl-tooltip content="Download voicebank as ZIP">
                    <sl-icon-button
                      name="download"
                      label="Download voicebank"
                      ?disabled=${this._isDownloading}
                      @click=${this._downloadVoicebank}
                    ></sl-icon-button>
                  </sl-tooltip>
                `
              : null}
            <sl-icon-button
              name="plus-lg"
              label="Upload voicebank"
              @click=${this._openUploadDialog}
            ></sl-icon-button>
          </div>
        </div>
        <div class="panel-content">
          ${this._loadingVoicebanks
            ? this._renderVoicebankLoadingState()
            : this._voicebanksError
              ? this._renderErrorState(this._voicebanksError)
              : this._voicebanks.length === 0
                ? this._renderEmptyVoicebanks()
                : this._renderVoicebankList()}
        </div>
      </div>
    `;
  }

  /**
   * Render the voicebank list items.
   */
  private _renderVoicebankList() {
    return html`
      <ul class="voicebank-list" role="listbox" aria-label="Voicebanks">
        ${this._voicebanks.map(
          (vb) => html`
            <li
              class="voicebank-item ${this._selectedVoicebank === vb.id
                ? 'selected'
                : ''}"
              role="option"
              aria-selected=${this._selectedVoicebank === vb.id}
              tabindex="0"
              data-voicebank-id=${vb.id}
              @click=${() => this._onVoicebankClick(vb.id)}
              @keydown=${(e: KeyboardEvent) => this._onVoicebankKeyDown(e, vb.id)}
            >
              <sl-icon class="voicebank-icon" name="folder-fill"></sl-icon>
              <div class="voicebank-content">
                <div class="voicebank-name">${vb.name}</div>
                <div class="voicebank-meta">${vb.sample_count} samples</div>
              </div>
              <div class="voicebank-badges">
                ${vb.has_oto
                  ? html`<sl-badge variant="success" pill>oto</sl-badge>`
                  : null}
                <sl-icon-button
                  name="trash"
                  label="Delete voicebank"
                  class="delete-btn"
                  @click=${(e: Event) => this._openDeleteDialog(vb, e)}
                ></sl-icon-button>
              </div>
            </li>
          `
        )}
      </ul>
    `;
  }

  /**
   * Render the samples panel.
   */
  private _renderSamplesPanel() {
    const filteredSamples = this._getFilteredSamples();

    return html`
      <div class="panel samples-panel">
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
                    ? this._renderSampleChips(filteredSamples)
                    : this._renderSampleList(filteredSamples)}
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
              Double-click or Enter to load sample
            </div>`
          : null}
      </div>
    `;
  }

  /**
   * Get the name of the selected voicebank.
   */
  private _getSelectedVoicebankName(): string {
    const vb = this._voicebanks.find((v) => v.id === this._selectedVoicebank);
    return vb?.name ?? '';
  }

  /**
   * Render the sample chips grid, grouped by phoneme family.
   */
  private _renderSampleChips(samples: string[]) {
    const groups = getNonEmptyGroups(samples);

    return html`
      <div class="sample-chips-container">
        <div class="phoneme-groups" role="listbox" aria-label="Samples">
          ${groups.map(({ family, samples: groupSamples }) =>
            this._renderPhonemeGroup(family, groupSamples)
          )}
        </div>
      </div>
    `;
  }

  /**
   * Render a single phoneme group with its samples.
   */
  private _renderPhonemeGroup(family: PhonemeFamily, samples: string[]) {
    return html`
      <div class="phoneme-group" role="group" aria-label="${family.label}">
        <div class="phoneme-group-header">
          <span class="phoneme-group-label">${family.label}</span>
          <span class="phoneme-group-count">(${samples.length})</span>
        </div>
        <div class="phoneme-group-chips">
          ${samples.map(
            (filename) => html`
              <div
                class="sample-chip ${this._selectedSample === filename
                  ? 'selected'
                  : ''}"
                role="option"
                aria-selected=${this._selectedSample === filename}
                tabindex="0"
                data-sample-filename=${filename}
                @click=${() => this._onSampleClick(filename)}
                @keydown=${(e: KeyboardEvent) => this._onSampleKeyDown(e, filename)}
                title=${filename}
              >
                ${this._sampleOtoMap.get(filename)
                  ? html`<span class="oto-dot"></span>`
                  : null}
                <span class="sample-chip-name">${this._displayName(filename)}</span>
              </div>
            `
          )}
        </div>
      </div>
    `;
  }

  /**
   * Render the sample list view (compact table format).
   * Samples are sorted alphabetically by display name for easy sequential editing.
   */
  private _renderSampleList(samples: string[]) {
    // Sort samples alphabetically by display name for list view
    const sortedSamples = [...samples].sort((a, b) =>
      this._displayName(a).localeCompare(this._displayName(b), undefined, { sensitivity: 'base' })
    );

    return html`
      <div class="sample-list-container">
        <div class="sample-list" role="listbox" aria-label="Samples">
          ${sortedSamples.map(
            (filename) => html`
              <div
                class="sample-list-item ${this._selectedSample === filename ? 'selected' : ''}"
                role="option"
                aria-selected=${this._selectedSample === filename}
                tabindex="0"
                data-sample-filename=${filename}
                @click=${() => this._onSampleClick(filename)}
                @keydown=${(e: KeyboardEvent) => this._onSampleListKeyDown(e, filename, sortedSamples)}
              >
                <span class="sample-list-alias">${this._displayName(filename)}</span>
                <span class="sample-list-filename">${filename}</span>
                <div class="sample-list-status">
                  ${this._sampleOtoMap.get(filename)
                    ? html`
                        <sl-tooltip content="Has oto entry">
                          <span class="sample-list-oto-dot"></span>
                        </sl-tooltip>
                      `
                    : html`
                        <sl-tooltip content="No oto entry">
                          <span class="sample-list-no-oto"></span>
                        </sl-tooltip>
                      `}
                </div>
              </div>
            `
          )}
        </div>
      </div>
    `;
  }

  /**
   * Handle keyboard navigation in list view.
   * Uses Up/Down arrows instead of the grid's 2D navigation.
   */
  private _onSampleListKeyDown(e: KeyboardEvent, filename: string, sortedSamples: string[]): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      this._emitSampleSelect(filename);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const currentIndex = sortedSamples.indexOf(filename);
      const nextIndex = Math.min(sortedSamples.length - 1, currentIndex + 1);
      const nextSample = sortedSamples[nextIndex];
      if (nextSample) {
        this._selectedSample = nextSample;
        this._focusSampleItem(nextSample);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const currentIndex = sortedSamples.indexOf(filename);
      const prevIndex = Math.max(0, currentIndex - 1);
      const prevSample = sortedSamples[prevIndex];
      if (prevSample) {
        this._selectedSample = prevSample;
        this._focusSampleItem(prevSample);
      }
    }
  }

  /**
   * Render loading state for voicebanks (skeleton list).
   */
  private _renderVoicebankLoadingState() {
    return html`
      <div class="skeleton-list">
        ${[1, 2, 3].map(
          () => html`
            <div class="skeleton-item">
              <sl-skeleton class="skeleton-icon" effect="pulse" style="width: 1rem; height: 1rem;"></sl-skeleton>
              <div class="skeleton-content">
                <sl-skeleton effect="pulse" style="width: 75%; height: 0.8125rem;"></sl-skeleton>
                <sl-skeleton effect="pulse" style="width: 40%; height: 0.6875rem;"></sl-skeleton>
              </div>
            </div>
          `
        )}
      </div>
    `;
  }

  /**
   * Render loading state for samples (skeleton chips).
   */
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

  /**
   * Render error state.
   */
  private _renderErrorState(message: string) {
    return html`
      <div class="error-state">
        <sl-icon name="exclamation-triangle"></sl-icon>
        <div class="error-state-text">${message}</div>
      </div>
    `;
  }

  /**
   * Render empty voicebanks state.
   */
  private _renderEmptyVoicebanks() {
    return html`
      <div class="empty-state">
        <sl-icon name="folder-plus"></sl-icon>
        <div class="empty-state-text">
          No voicebanks yet. Upload one to get started.
        </div>
      </div>
    `;
  }

  /**
   * Render empty samples state.
   */
  private _renderEmptySamples() {
    return html`
      <div class="empty-state">
        <sl-icon name="music-note"></sl-icon>
        <div class="empty-state-text">No samples in this voicebank.</div>
      </div>
    `;
  }

  /**
   * Render no search results state.
   */
  private _renderNoSearchResults() {
    return html`
      <div class="empty-state">
        <sl-icon name="search"></sl-icon>
        <div class="empty-state-text">No samples match "${this._searchQuery}"</div>
      </div>
    `;
  }

  /**
   * Render prompt to select a voicebank.
   */
  private _renderSelectVoicebankPrompt() {
    return html`
      <div class="empty-state">
        <sl-icon name="arrow-left-circle"></sl-icon>
        <div class="empty-state-text">Select a voicebank to view samples.</div>
      </div>
    `;
  }

  render() {
    if (!this.open) {
      return nothing;
    }

    const { configured, total } = this._getSampleCounts();

    return html`
      <div class="backdrop" @click=${this._onBackdropClick}></div>
      <div class="modal-container" @click=${(e: Event) => e.stopPropagation()}>
        <div class="modal-header">
          <sl-icon-button
            name="x-lg"
            label="Close"
            @click=${this._close}
          ></sl-icon-button>
          <sl-input
            class="search-input"
            placeholder="Search samples..."
            .value=${this._searchQuery}
            @sl-input=${this._onSearchInput}
            clearable
          >
            <sl-icon name="search" slot="prefix"></sl-icon>
          </sl-input>
        </div>
        <div class="modal-body">
          ${this._renderVoicebanksPanel()}
          ${this._renderSamplesPanel()}
        </div>
        <div class="modal-footer">
          ${this._selectedVoicebank && total > 0
            ? html`${configured} configured / ${total} total`
            : html`Select a voicebank to browse samples`}
        </div>
      </div>
      ${this._renderUploadDialog()}
      ${this._renderDeleteDialog()}
      ${this._renderBatchDialog()}
    `;
  }

  /**
   * Render the upload dialog.
   */
  private _renderUploadDialog() {
    return html`
      <sl-dialog
        label="Upload Voicebank"
        ?open=${this._showUploadDialog}
        @sl-request-close=${this._onUploadDialogClose}
      >
        <div class="upload-dialog-body">
          ${this._uploadError
            ? html`
                <sl-alert class="upload-alert" variant="danger" open>
                  <sl-icon slot="icon" name="exclamation-triangle"></sl-icon>
                  ${this._uploadError}
                </sl-alert>
              `
            : null}

          <sl-input
            label="Voicebank Name"
            placeholder="My Voicebank"
            .value=${this._uploadName}
            @sl-input=${this._onUploadNameChange}
            ?disabled=${this._isUploading}
            required
          ></sl-input>

          <uvm-upload-zone
            accept=".zip"
            ?disabled=${this._isUploading}
            ?uploading=${this._isUploading}
            @files-selected=${this._onFilesSelected}
          ></uvm-upload-zone>
        </div>

        <div slot="footer" class="upload-dialog-footer">
          <sl-button
            @click=${this._closeUploadDialog}
            ?disabled=${this._isUploading}
          >
            Cancel
          </sl-button>
          <sl-button
            variant="primary"
            ?disabled=${!this._canUpload}
            ?loading=${this._isUploading}
            @click=${this._uploadVoicebank}
          >
            Upload
          </sl-button>
        </div>
      </sl-dialog>
    `;
  }

  /**
   * Check if upload can proceed (name and files selected).
   */
  private get _canUpload(): boolean {
    return (
      this._uploadName.trim().length > 0 &&
      this._uploadFiles.length > 0 &&
      !this._isUploading
    );
  }

  /**
   * Open the upload dialog.
   */
  private _openUploadDialog(): void {
    this._showUploadDialog = true;
    this._uploadName = '';
    this._uploadFiles = [];
    this._uploadError = null;
  }

  /**
   * Close the upload dialog.
   */
  private _closeUploadDialog(): void {
    if (this._isUploading) return;
    this._showUploadDialog = false;
    this._uploadName = '';
    this._uploadFiles = [];
    this._uploadError = null;
    this._uploadZone?.clearSelection();
  }

  /**
   * Handle dialog close request (e.g., clicking overlay or pressing Escape).
   */
  private _onUploadDialogClose(e: Event): void {
    if (this._isUploading) {
      e.preventDefault();
      return;
    }
    this._closeUploadDialog();
  }

  /**
   * Handle upload name input change.
   */
  private _onUploadNameChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    this._uploadName = input.value;
  }

  /**
   * Handle files selected from upload zone.
   */
  private _onFilesSelected(e: CustomEvent<{ files: FileList }>): void {
    this._uploadFiles = Array.from(e.detail.files);
    this._uploadError = null;
  }

  /**
   * Upload the voicebank.
   */
  private async _uploadVoicebank(): Promise<void> {
    if (!this._canUpload) return;

    this._isUploading = true;
    this._uploadError = null;

    try {
      const voicebank = await api.createVoicebank(this._uploadName.trim(), this._uploadFiles);

      // Refresh voicebank list
      await this._fetchVoicebanks();

      // Close dialog and reset
      this._showUploadDialog = false;
      this._uploadName = '';
      this._uploadFiles = [];
      this._uploadZone?.clearSelection();

      // Show success toast
      UvmToastManager.success(`Voicebank "${voicebank.name}" uploaded successfully`);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.isConflict()) {
          this._uploadError = 'A voicebank with this name already exists.';
          UvmToastManager.error('A voicebank with this name already exists');
        } else if (error.isValidationError()) {
          this._uploadError = error.message || 'Invalid upload. Please check your file.';
          UvmToastManager.error('Invalid upload. Please check your file.');
        } else {
          this._uploadError = error.message || 'Upload failed. Please try again.';
          UvmToastManager.error(`Upload failed: ${error.message}`);
        }
      } else {
        this._uploadError = 'An unexpected error occurred. Please try again.';
        UvmToastManager.error('Upload failed unexpectedly');
      }
    } finally {
      this._isUploading = false;
    }
  }

  /**
   * Open the delete confirmation dialog.
   */
  private _openDeleteDialog(vb: VoicebankSummary, e: Event): void {
    e.stopPropagation(); // Don't select the voicebank
    this._voicebankToDelete = vb;
    this._showDeleteDialog = true;
  }

  /**
   * Close the delete confirmation dialog.
   */
  private _closeDeleteDialog(): void {
    if (this._isDeleting) return;
    this._showDeleteDialog = false;
    this._voicebankToDelete = null;
  }

  /**
   * Handle dialog close request.
   */
  private _onDeleteDialogClose(e: Event): void {
    if (this._isDeleting) {
      e.preventDefault();
      return;
    }
    this._closeDeleteDialog();
  }

  /**
   * Delete the voicebank.
   */
  private async _deleteVoicebank(): Promise<void> {
    if (!this._voicebankToDelete) return;

    this._isDeleting = true;

    try {
      await api.deleteVoicebank(this._voicebankToDelete.id);
      const deletedName = this._voicebankToDelete.name;

      // If this was the selected voicebank, clear selection
      if (this._selectedVoicebank === this._voicebankToDelete.id) {
        this._selectedVoicebank = null;
        this._samples = [];
        this._selectedSample = null;
        this._sampleOtoMap.clear();
        this._availableAliases = new Set();
      }

      // Refresh voicebank list
      await this._fetchVoicebanks();

      // Close dialog
      this._showDeleteDialog = false;
      this._voicebankToDelete = null;

      // Show success toast
      UvmToastManager.success(`Voicebank "${deletedName}" deleted`);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.isNotFound()) {
          UvmToastManager.error('Voicebank not found');
        } else {
          UvmToastManager.error(`Failed to delete: ${error.message}`);
        }
      } else {
        UvmToastManager.error('Failed to delete voicebank');
      }
    } finally {
      this._isDeleting = false;
    }
  }

  /**
   * Render the delete confirmation dialog.
   */
  private _renderDeleteDialog() {
    return html`
      <sl-dialog
        label="Delete Voicebank"
        ?open=${this._showDeleteDialog}
        @sl-request-close=${this._onDeleteDialogClose}
      >
        <p style="margin: 0; color: #374151;">
          Are you sure you want to delete <strong>${this._voicebankToDelete?.name}</strong>?
          This will permanently remove all samples and configuration.
        </p>

        <div slot="footer" class="upload-dialog-footer">
          <sl-button
            @click=${this._closeDeleteDialog}
            ?disabled=${this._isDeleting}
          >
            Cancel
          </sl-button>
          <sl-button
            variant="danger"
            ?loading=${this._isDeleting}
            @click=${this._deleteVoicebank}
          >
            Delete
          </sl-button>
        </div>
      </sl-dialog>
    `;
  }

  /**
   * Open the batch autodetect dialog.
   */
  private _openBatchDialog(): void {
    this._showBatchDialog = true;
    this._batchResult = null;
    this._batchOverwriteExisting = false;
  }

  /**
   * Close the batch autodetect dialog.
   */
  private _closeBatchDialog(): void {
    if (this._isBatchProcessing) return;
    this._showBatchDialog = false;
    this._batchResult = null;
    this._batchOverwriteExisting = false;
  }

  /**
   * Handle batch dialog close request.
   */
  private _onBatchDialogClose(e: Event): void {
    if (this._isBatchProcessing) {
      e.preventDefault();
      return;
    }
    this._closeBatchDialog();
  }

  /**
   * Toggle overwrite existing checkbox.
   */
  private _onOverwriteChange(e: Event): void {
    const checkbox = e.target as HTMLInputElement;
    this._batchOverwriteExisting = checkbox.checked;
  }

  /**
   * Run batch autodetect on all samples.
   */
  private async _runBatchAutodetect(): Promise<void> {
    if (!this._selectedVoicebank) return;

    this._isBatchProcessing = true;
    this._batchResult = null;

    try {
      const result = await api.batchGenerateOto(
        this._selectedVoicebank,
        this._batchOverwriteExisting
      );

      this._batchResult = result;

      // Refresh the oto status indicators
      await this._fetchSamples(this._selectedVoicebank);

      // Show success toast
      if (result.processed > 0) {
        UvmToastManager.success(
          `Auto-detected ${result.processed} samples (${Math.round(result.average_confidence * 100)}% avg confidence)`
        );
      } else if (result.skipped === result.total_samples) {
        UvmToastManager.info('All samples already have oto entries');
      }
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 503) {
          UvmToastManager.error('ML model not available. Please try again later.');
        } else {
          UvmToastManager.error(`Batch autodetect failed: ${error.message}`);
        }
      } else {
        UvmToastManager.error('Batch autodetect failed unexpectedly');
      }
    } finally {
      this._isBatchProcessing = false;
    }
  }

  /**
   * Render the batch autodetect dialog.
   */
  private _renderBatchDialog() {
    const voicebankName = this._getSelectedVoicebankName();

    return html`
      <sl-dialog
        label="Auto-detect All Samples"
        ?open=${this._showBatchDialog}
        @sl-request-close=${this._onBatchDialogClose}
        style="--width: 28rem;"
      >
        ${this._batchResult
          ? this._renderBatchResult()
          : this._renderBatchConfirmation(voicebankName)}

        <div slot="footer" class="upload-dialog-footer">
          ${this._batchResult
            ? html`
                <sl-button variant="primary" @click=${this._closeBatchDialog}>
                  Done
                </sl-button>
              `
            : html`
                <sl-button
                  @click=${this._closeBatchDialog}
                  ?disabled=${this._isBatchProcessing}
                >
                  Cancel
                </sl-button>
                <sl-button
                  variant="primary"
                  ?loading=${this._isBatchProcessing}
                  @click=${this._runBatchAutodetect}
                >
                  ${this._isBatchProcessing ? 'Processing...' : 'Start'}
                </sl-button>
              `}
        </div>
      </sl-dialog>
    `;
  }

  /**
   * Render the batch confirmation content.
   */
  private _renderBatchConfirmation(voicebankName: string) {
    return html`
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <p style="margin: 0; color: #374151;">
          Run ML-based phoneme detection on all <strong>${this._samples.length}</strong> samples
          in <strong>${voicebankName}</strong> to automatically generate oto.ini entries.
        </p>

        <sl-alert variant="primary" open>
          <sl-icon slot="icon" name="info-circle"></sl-icon>
          This may take a while for large voicebanks. Each sample is processed through the ML pipeline.
        </sl-alert>

        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
          <input
            type="checkbox"
            .checked=${this._batchOverwriteExisting}
            @change=${this._onOverwriteChange}
            ?disabled=${this._isBatchProcessing}
          />
          <span style="color: #374151; font-size: 0.875rem;">
            Overwrite existing entries
          </span>
        </label>

        ${this._isBatchProcessing
          ? html`
              <div style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; background: #f9fafb; border-radius: 0.5rem;">
                <sl-spinner style="font-size: 1.25rem; --indicator-color: #3b82f6;"></sl-spinner>
                <span style="color: #6b7280; font-size: 0.875rem;">
                  Processing samples... This may take a few minutes.
                </span>
              </div>
            `
          : null}
      </div>
    `;
  }

  /**
   * Render the batch result summary.
   */
  private _renderBatchResult() {
    const result = this._batchResult!;

    return html`
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <sl-alert
          variant=${result.processed > 0 ? 'success' : result.skipped > 0 ? 'primary' : 'warning'}
          open
        >
          <sl-icon slot="icon" name=${result.processed > 0 ? 'check-circle' : 'info-circle'}></sl-icon>
          ${result.processed > 0
            ? `Successfully processed ${result.processed} samples`
            : result.skipped > 0
              ? 'All samples already have oto entries'
              : 'No samples were processed'}
        </sl-alert>

        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.75rem;">
          <div style="padding: 0.75rem; background: #f0fdf4; border-radius: 0.5rem; text-align: center;">
            <div style="font-size: 1.5rem; font-weight: 600; color: #16a34a;">${result.processed}</div>
            <div style="font-size: 0.75rem; color: #6b7280;">Processed</div>
          </div>
          <div style="padding: 0.75rem; background: #f0f9ff; border-radius: 0.5rem; text-align: center;">
            <div style="font-size: 1.5rem; font-weight: 600; color: #0284c7;">${result.skipped}</div>
            <div style="font-size: 0.75rem; color: #6b7280;">Skipped</div>
          </div>
          <div style="padding: 0.75rem; background: #fef2f2; border-radius: 0.5rem; text-align: center;">
            <div style="font-size: 1.5rem; font-weight: 600; color: #dc2626;">${result.failed}</div>
            <div style="font-size: 0.75rem; color: #6b7280;">Failed</div>
          </div>
          <div style="padding: 0.75rem; background: #faf5ff; border-radius: 0.5rem; text-align: center;">
            <div style="font-size: 1.5rem; font-weight: 600; color: #7c3aed;">
              ${result.processed > 0 ? Math.round(result.average_confidence * 100) : '-'}%
            </div>
            <div style="font-size: 0.75rem; color: #6b7280;">Avg Confidence</div>
          </div>
        </div>

        ${result.failed_files.length > 0
          ? html`
              <details style="margin-top: 0.5rem;">
                <summary style="cursor: pointer; color: #dc2626; font-size: 0.875rem;">
                  ${result.failed_files.length} failed file(s)
                </summary>
                <ul style="margin: 0.5rem 0 0; padding-left: 1.5rem; color: #6b7280; font-size: 0.8125rem;">
                  ${result.failed_files.map((f) => html`<li>${f}</li>`)}
                </ul>
              </details>
            `
          : null}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-sample-browser': UvmSampleBrowser;
  }
}
