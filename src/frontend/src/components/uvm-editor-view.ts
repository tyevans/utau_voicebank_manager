import { LitElement, html, css } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';
import '@shoelace-style/shoelace/dist/components/badge/badge.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/button-group/button-group.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import type SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

// Import child components
import './uvm-sample-browser.js';
import './uvm-waveform-editor.js';
import './uvm-entry-list.js';

import { api, ApiError } from '../services/api.js';
import type { EntryCreateDetail, EntryDeleteDetail, EntrySelectDetail } from './uvm-entry-list.js';
import type { OtoEntry } from '../services/types.js';
import { UvmToastManager } from './uvm-toast-manager.js';

/**
 * Default oto parameter values for new entries.
 */
const DEFAULT_OTO_VALUES = {
  offset: 0,
  consonant: 100,
  cutoff: -50,
  preutterance: 50,
  overlap: 20,
};

/**
 * Event detail for sample-select events from the sample browser.
 */
interface SampleSelectDetail {
  voicebankId: string;
  filename: string;
}

/**
 * Event detail for marker-change events from the waveform editor.
 */
interface MarkerChangeDetail {
  name: string;
  value: number;
}

/**
 * Main editor view component that integrates sample browser, waveform editor,
 * and oto parameter editing into a cohesive workflow.
 *
 * Layout:
 * - Left sidebar: Sample browser (voicebanks and samples list)
 * - Main area: Waveform editor with oto markers
 * - Right sidebar: Oto parameter input panel
 *
 * @example
 * ```html
 * <uvm-editor-view></uvm-editor-view>
 * ```
 */
@customElement('uvm-editor-view')
export class UvmEditorView extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    .editor-layout {
      display: grid;
      grid-template-columns: minmax(280px, 320px) 1fr minmax(250px, 300px);
      grid-template-rows: 1fr;
      gap: 1rem;
      height: 100%;
      min-height: 500px;
    }

    @media (max-width: 1024px) {
      .editor-layout {
        grid-template-columns: 1fr;
        grid-template-rows: auto auto auto;
      }
    }

    .sidebar {
      display: flex;
      flex-direction: column;
      background-color: var(--sl-color-neutral-50, #f8fafc);
      border: 1px solid var(--sl-color-neutral-200, #e2e8f0);
      border-radius: var(--sl-border-radius-medium, 0.375rem);
      overflow: hidden;
    }

    .sidebar-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      background-color: var(--sl-color-neutral-100, #f1f5f9);
      border-bottom: 1px solid var(--sl-color-neutral-200, #e2e8f0);
      font-weight: 600;
      font-size: 0.875rem;
      color: var(--sl-color-neutral-700, #334155);
    }

    .sidebar-header sl-icon {
      font-size: 1rem;
    }

    .sidebar-content {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
    }

    .main-area {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .waveform-section {
      flex: 1;
      min-height: 200px;
    }

    .params-panel {
      background-color: var(--sl-color-neutral-50, #f8fafc);
      border: 1px solid var(--sl-color-neutral-200, #e2e8f0);
      border-radius: var(--sl-border-radius-medium, 0.375rem);
      overflow: hidden;
    }

    .params-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      background-color: var(--sl-color-neutral-100, #f1f5f9);
      border-bottom: 1px solid var(--sl-color-neutral-200, #e2e8f0);
    }

    .params-header-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 600;
      font-size: 0.875rem;
      color: var(--sl-color-neutral-700, #334155);
    }

    .params-header sl-icon {
      font-size: 1rem;
    }

    .params-content {
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .param-group {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .param-label {
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--sl-color-neutral-600, #475569);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .param-color-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .entry-selector {
      margin-bottom: 0.75rem;
    }

    .entry-selector sl-select::part(combobox) {
      font-size: 0.875rem;
    }

    .sample-info {
      padding: 0.75rem 1rem;
      background-color: var(--sl-color-neutral-100, #f1f5f9);
      border-bottom: 1px solid var(--sl-color-neutral-200, #e2e8f0);
    }

    .sample-info-filename {
      font-weight: 600;
      font-size: 0.875rem;
      color: var(--sl-color-neutral-800, #1e293b);
      margin-bottom: 0.25rem;
    }

    .sample-info-voicebank {
      font-size: 0.75rem;
      color: var(--sl-color-neutral-500, #64748b);
    }

    .loading-overlay {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      text-align: center;
      color: var(--sl-color-neutral-500, #64748b);
    }

    .loading-overlay sl-spinner {
      font-size: 2rem;
      --indicator-color: var(--sl-color-primary-500, #3b82f6);
      margin-bottom: 0.75rem;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      text-align: center;
      height: 100%;
      min-height: 200px;
    }

    .empty-state sl-icon {
      font-size: 3rem;
      color: var(--sl-color-neutral-300, #cbd5e1);
      margin-bottom: 1rem;
    }

    .empty-state-text {
      font-size: 0.875rem;
      color: var(--sl-color-neutral-500, #64748b);
      max-width: 250px;
      line-height: 1.5;
    }

    .error-message {
      margin-bottom: 1rem;
    }

    sl-input::part(input) {
      font-family: monospace;
    }

    sl-input::part(base) {
      font-size: 0.875rem;
    }

    .action-buttons {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .action-buttons sl-button-group {
      width: 100%;
    }

    .action-buttons sl-button-group sl-button {
      flex: 1;
    }

    .action-buttons sl-button-group sl-button::part(base) {
      width: 100%;
    }

    .save-hint {
      font-size: 0.75rem;
      color: var(--sl-color-neutral-400, #9ca3af);
      text-align: center;
    }

    .confidence-badge {
      display: flex;
      justify-content: center;
      margin-top: 0.25rem;
    }

    .confidence-badge sl-badge {
      font-size: 0.75rem;
    }

    .dialog-footer {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
    }

    #unsaved-dialog::part(body) {
      padding: 1rem 1.5rem;
    }

    #unsaved-dialog p {
      margin: 0;
      color: var(--sl-color-neutral-700, #334155);
    }

    .skeleton-params {
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .skeleton-param-group {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .skeleton-param-group sl-skeleton {
      --border-radius: var(--sl-border-radius-small);
    }

    .sidebar-section {
      margin-bottom: 1rem;
    }

    .sidebar-section:last-child {
      margin-bottom: 0;
    }
  `;

  // Current selection state
  @state()
  private _currentVoicebankId: string | null = null;

  @state()
  private _currentFilename: string | null = null;

  // Oto entries for the current file
  @state()
  private _otoEntries: OtoEntry[] = [];

  @state()
  private _selectedEntryIndex = 0;

  // Current entry values (local state for editing)
  @state()
  private _currentEntry: OtoEntry | null = null;

  // Audio state
  @state()
  private _audioBuffer: AudioBuffer | null = null;

  @state()
  private _audioContext: AudioContext | null = null;

  // Loading states
  @state()
  private _loadingAudio = false;

  @state()
  private _loadingEntries = false;

  // Zoom level for waveform
  @state()
  private _zoom = 1;

  // Error state
  @state()
  private _error: string | null = null;

  // Save state tracking
  @state()
  private _isDirty = false;

  @state()
  private _isSaving = false;

  @state()
  private _saveSuccess = false;

  // Auto-detect state
  @state()
  private _isDetecting = false;

  @state()
  private _lastConfidence: number | null = null;

  // Original entry to detect changes and determine create vs update
  private _originalEntry: OtoEntry | null = null;

  // Pending sample selection (used when prompting to save)
  private _pendingSampleSelect: SampleSelectDetail | null = null;

  // Reference to unsaved changes dialog
  @query('#unsaved-dialog')
  private _unsavedDialog!: SlDialog;

  connectedCallback(): void {
    super.connectedCallback();
    // Add keyboard listener for Ctrl+S / Cmd+S
    this._boundKeyHandler = this._onKeyDown.bind(this);
    document.addEventListener('keydown', this._boundKeyHandler);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._cleanupAudioContext();
    // Remove keyboard listener
    if (this._boundKeyHandler) {
      document.removeEventListener('keydown', this._boundKeyHandler);
    }
  }

  private _boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  /**
   * Handle keyboard events for save shortcut.
   */
  private _onKeyDown(e: KeyboardEvent): void {
    // Ctrl+S or Cmd+S to save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (this._isDirty && !this._isSaving) {
        this._saveEntry();
      }
    }
  }

  /**
   * Handle sample selection from the sample browser.
   */
  private async _onSampleSelect(e: CustomEvent<SampleSelectDetail>): Promise<void> {
    const { voicebankId, filename } = e.detail;

    // Skip if same sample is selected
    if (this._currentVoicebankId === voicebankId && this._currentFilename === filename) {
      return;
    }

    // Check for unsaved changes
    if (this._isDirty) {
      this._pendingSampleSelect = { voicebankId, filename };
      this._unsavedDialog.show();
      return;
    }

    await this._loadSample(voicebankId, filename);
  }

  /**
   * Load a sample (audio and oto entries).
   */
  private async _loadSample(voicebankId: string, filename: string): Promise<void> {
    this._currentVoicebankId = voicebankId;
    this._currentFilename = filename;
    this._error = null;
    this._selectedEntryIndex = 0;
    this._isDirty = false;
    this._originalEntry = null;
    this._lastConfidence = null;

    // Load audio and oto entries in parallel
    await Promise.all([
      this._loadAudio(voicebankId, filename),
      this._loadOtoEntries(voicebankId, filename),
    ]);
  }

  /**
   * Handle unsaved dialog "Discard" action.
   */
  private _onDiscardChanges(): void {
    this._unsavedDialog.hide();
    this._isDirty = false;

    if (this._pendingSampleSelect) {
      const { voicebankId, filename } = this._pendingSampleSelect;
      this._pendingSampleSelect = null;
      this._loadSample(voicebankId, filename);
    }
  }

  /**
   * Handle unsaved dialog "Save" action.
   */
  private async _onSaveAndContinue(): Promise<void> {
    await this._saveEntry();
    this._unsavedDialog.hide();

    if (this._pendingSampleSelect && !this._isDirty) {
      const { voicebankId, filename } = this._pendingSampleSelect;
      this._pendingSampleSelect = null;
      this._loadSample(voicebankId, filename);
    }
  }

  /**
   * Handle unsaved dialog "Cancel" action.
   */
  private _onCancelNavigation(): void {
    this._unsavedDialog.hide();
    this._pendingSampleSelect = null;
  }

  /**
   * Load audio file as AudioBuffer.
   */
  private async _loadAudio(voicebankId: string, filename: string): Promise<void> {
    this._loadingAudio = true;
    this._audioBuffer = null;

    try {
      // Create AudioContext on first use (must be after user gesture)
      if (!this._audioContext) {
        this._audioContext = new AudioContext();
      }

      // Resume if suspended (browser autoplay policy)
      if (this._audioContext.state === 'suspended') {
        await this._audioContext.resume();
      }

      this._audioBuffer = await api.loadSampleAsAudioBuffer(
        voicebankId,
        filename,
        this._audioContext
      );
    } catch (error) {
      console.error('Failed to load audio:', error);
      if (error instanceof ApiError) {
        if (error.isNotFound()) {
          this._error = 'Sample not found';
          UvmToastManager.error('Sample not found');
        } else {
          this._error = error.message;
          UvmToastManager.error(`Failed to load audio: ${error.message}`);
        }
      } else {
        this._error = error instanceof Error ? error.message : 'Failed to load audio';
        UvmToastManager.error('Failed to load audio');
      }
    } finally {
      this._loadingAudio = false;
    }
  }

  /**
   * Load oto entries for the current file.
   */
  private async _loadOtoEntries(voicebankId: string, filename: string): Promise<void> {
    this._loadingEntries = true;
    this._otoEntries = [];

    try {
      this._otoEntries = await api.getOtoEntriesForFile(voicebankId, filename);

      if (this._otoEntries.length > 0) {
        // Use existing entry
        this._currentEntry = { ...this._otoEntries[0] };
        this._originalEntry = { ...this._otoEntries[0] };
      } else {
        // Create default entry (new, not yet saved)
        this._currentEntry = this._createDefaultEntry(filename);
        this._originalEntry = null;
      }
    } catch (error) {
      // If no entries exist, create default (new entry, not yet saved)
      this._currentEntry = this._createDefaultEntry(filename);
      this._originalEntry = null;
      console.warn('No oto entries found, using defaults:', error);
    } finally {
      this._loadingEntries = false;
    }
  }

  /**
   * Create a default oto entry for a new file.
   */
  private _createDefaultEntry(filename: string): OtoEntry {
    // Generate default alias from filename (remove extension and leading underscore)
    const baseName = filename.replace(/\.wav$/i, '').replace(/^_/, '');
    const alias = `- ${baseName}`;

    return {
      filename,
      alias,
      ...DEFAULT_OTO_VALUES,
    };
  }

  /**
   * Handle marker changes from the waveform editor.
   */
  private _onMarkerChange(e: CustomEvent<MarkerChangeDetail>): void {
    if (!this._currentEntry) return;

    const { name, value } = e.detail;

    // Update the local entry state
    this._currentEntry = {
      ...this._currentEntry,
      [name]: value,
    };

    // Mark as dirty
    this._isDirty = true;
    this._saveSuccess = false;
  }

  /**
   * Handle zoom changes from the waveform editor.
   */
  private _onZoomChange(e: CustomEvent<{ zoom: number }>): void {
    this._zoom = e.detail.zoom;
  }

  /**
   * Handle parameter input changes.
   */
  private _onParamChange(paramName: keyof OtoEntry, e: Event): void {
    if (!this._currentEntry) return;

    const input = e.target as HTMLInputElement;
    const value = parseFloat(input.value) || 0;

    this._currentEntry = {
      ...this._currentEntry,
      [paramName]: value,
    };

    // Mark as dirty
    this._isDirty = true;
    this._saveSuccess = false;
  }

  /**
   * Save the current oto entry to the API.
   */
  private async _saveEntry(): Promise<void> {
    if (!this._currentEntry || !this._currentVoicebankId) return;

    this._isSaving = true;
    this._saveSuccess = false;
    this._error = null;

    try {
      const isNew = this._originalEntry === null;

      if (isNew) {
        // Create new entry
        const created = await api.createOtoEntry(this._currentVoicebankId, {
          filename: this._currentEntry.filename,
          alias: this._currentEntry.alias,
          offset: this._currentEntry.offset,
          consonant: this._currentEntry.consonant,
          cutoff: this._currentEntry.cutoff,
          preutterance: this._currentEntry.preutterance,
          overlap: this._currentEntry.overlap,
        });

        // Update local state with server response
        this._currentEntry = { ...created };
        this._originalEntry = { ...created };

        // Update oto entries list
        this._otoEntries = [...this._otoEntries, created];
      } else {
        // Update existing entry (we know _originalEntry is not null here)
        const updated = await api.updateOtoEntry(
          this._currentVoicebankId,
          this._currentEntry.filename,
          this._originalEntry!.alias, // Use original alias for lookup
          {
            offset: this._currentEntry.offset,
            consonant: this._currentEntry.consonant,
            cutoff: this._currentEntry.cutoff,
            preutterance: this._currentEntry.preutterance,
            overlap: this._currentEntry.overlap,
          }
        );

        // Update local state with server response
        this._currentEntry = { ...updated };
        this._originalEntry = { ...updated };

        // Update the entry in the list
        this._otoEntries = this._otoEntries.map((entry, i) =>
          i === this._selectedEntryIndex ? updated : entry
        );
      }

      this._isDirty = false;
      this._saveSuccess = true;

      // Show success toast
      UvmToastManager.success('Entry saved');

      // Clear success indicator after 2 seconds
      setTimeout(() => {
        this._saveSuccess = false;
      }, 2000);
    } catch (error) {
      console.error('Failed to save oto entry:', error);
      if (error instanceof ApiError) {
        if (error.isNotFound()) {
          UvmToastManager.error('Sample not found');
        } else if (error.isConflict()) {
          UvmToastManager.error('An entry with this alias already exists');
        } else {
          UvmToastManager.error(error.message);
        }
        this._error = error.message;
      } else {
        UvmToastManager.error('Failed to save entry');
        this._error = error instanceof Error ? error.message : 'Failed to save entry';
      }
    } finally {
      this._isSaving = false;
    }
  }

  /**
   * Handle entry selection from the entry list component.
   */
  private _onEntryListSelect(e: CustomEvent<EntrySelectDetail>): void {
    const { entry } = e.detail;
    const index = this._otoEntries.findIndex((ent) => ent.alias === entry.alias);

    if (index >= 0) {
      this._selectedEntryIndex = index;
      this._currentEntry = { ...this._otoEntries[index] };
      this._originalEntry = { ...this._otoEntries[index] };
      this._isDirty = false;
      this._saveSuccess = false;
      this._lastConfidence = null;
    }
  }

  /**
   * Handle entry creation request from the entry list component.
   */
  private async _onEntryCreate(e: CustomEvent<EntryCreateDetail>): Promise<void> {
    const { alias } = e.detail;

    if (!this._currentVoicebankId || !this._currentFilename) return;

    // Create new entry with default values
    const newEntry = {
      filename: this._currentFilename,
      alias,
      ...DEFAULT_OTO_VALUES,
    };

    try {
      const created = await api.createOtoEntry(this._currentVoicebankId, newEntry);
      UvmToastManager.success(`Created alias "${alias}"`);

      // Add to entries list
      this._otoEntries = [...this._otoEntries, created];

      // Select the new entry
      this._selectedEntryIndex = this._otoEntries.length - 1;
      this._currentEntry = { ...created };
      this._originalEntry = { ...created };
      this._isDirty = false;
      this._saveSuccess = false;
      this._lastConfidence = null;
    } catch (error) {
      console.error('Failed to create oto entry:', error);
      if (error instanceof ApiError) {
        if (error.isConflict()) {
          UvmToastManager.error(`An entry with alias "${alias}" already exists`);
        } else {
          UvmToastManager.error(error.message);
        }
      } else {
        UvmToastManager.error('Failed to create entry');
      }
    }
  }

  /**
   * Handle entry deletion request from the entry list component.
   */
  private async _onEntryDelete(e: CustomEvent<EntryDeleteDetail>): Promise<void> {
    const { entry } = e.detail;

    if (!this._currentVoicebankId) return;

    // Confirm deletion
    if (!confirm(`Delete alias "${entry.alias}"?`)) return;

    try {
      await api.deleteOtoEntry(this._currentVoicebankId, entry.filename, entry.alias);
      UvmToastManager.success(`Deleted alias "${entry.alias}"`);

      // Remove from entries list
      const deletedIndex = this._otoEntries.findIndex((ent) => ent.alias === entry.alias);
      this._otoEntries = this._otoEntries.filter((ent) => ent.alias !== entry.alias);

      // If the deleted entry was selected, select another entry
      if (this._currentEntry?.alias === entry.alias) {
        if (this._otoEntries.length > 0) {
          // Select the previous entry, or the first one if we deleted the first
          const newIndex = Math.max(0, deletedIndex - 1);
          this._selectedEntryIndex = newIndex;
          this._currentEntry = { ...this._otoEntries[newIndex] };
          this._originalEntry = { ...this._otoEntries[newIndex] };
        } else {
          // No more entries, create a default one
          this._currentEntry = this._createDefaultEntry(this._currentFilename!);
          this._originalEntry = null;
          this._selectedEntryIndex = 0;
        }
        this._isDirty = false;
        this._saveSuccess = false;
        this._lastConfidence = null;
      } else if (deletedIndex < this._selectedEntryIndex) {
        // Adjust index if we deleted an entry before the selected one
        this._selectedEntryIndex--;
      }
    } catch (error) {
      console.error('Failed to delete oto entry:', error);
      if (error instanceof ApiError) {
        UvmToastManager.error(error.message);
      } else {
        UvmToastManager.error('Failed to delete entry');
      }
    }
  }

  /**
   * Auto-detect oto parameters using ML phoneme detection.
   */
  private async _autoDetect(): Promise<void> {
    if (!this._currentVoicebankId || !this._currentFilename) return;

    this._isDetecting = true;
    this._error = null;

    try {
      const suggestion = await api.suggestOto(
        this._currentVoicebankId,
        this._currentFilename,
        this._currentEntry?.alias
      );

      // Apply suggested values
      this._currentEntry = {
        filename: suggestion.filename,
        alias: suggestion.alias,
        offset: suggestion.offset,
        consonant: suggestion.consonant,
        cutoff: suggestion.cutoff,
        preutterance: suggestion.preutterance,
        overlap: suggestion.overlap,
      };

      this._lastConfidence = suggestion.confidence;
      this._isDirty = true;
      this._saveSuccess = false;

      // Show success toast with confidence info
      const confidencePercent = Math.round(suggestion.confidence * 100);
      UvmToastManager.success(`Parameters detected (${confidencePercent}% confidence)`);
    } catch (error) {
      console.error('Failed to auto-detect oto parameters:', error);
      if (error instanceof ApiError) {
        if (error.isNotFound()) {
          UvmToastManager.error('Sample not found');
        } else if (error.status === 503) {
          UvmToastManager.error('ML service is not available');
        } else {
          UvmToastManager.error(error.message);
        }
        this._error = error.message;
      } else {
        UvmToastManager.error('Failed to auto-detect parameters');
        this._error = error instanceof Error ? error.message : 'Failed to auto-detect parameters';
      }
      this._lastConfidence = null;
    } finally {
      this._isDetecting = false;
    }
  }

  /**
   * Get the badge variant based on confidence level.
   */
  private _getConfidenceVariant(): 'success' | 'warning' | 'danger' | 'neutral' {
    if (this._lastConfidence === null) return 'neutral';
    if (this._lastConfidence >= 0.8) return 'success';
    if (this._lastConfidence >= 0.5) return 'warning';
    return 'danger';
  }

  /**
   * Clean up audio context when component is disconnected.
   */
  private _cleanupAudioContext(): void {
    if (this._audioContext) {
      this._audioContext.close();
      this._audioContext = null;
    }
  }

  /**
   * Render the sample browser sidebar.
   */
  private _renderSampleBrowser() {
    return html`
      <uvm-sample-browser
        @sample-select=${this._onSampleSelect}
      ></uvm-sample-browser>
    `;
  }

  /**
   * Render the main waveform editing area.
   */
  private _renderMainArea() {
    if (!this._currentFilename) {
      return html`
        <div class="empty-state">
          <sl-icon name="waveform"></sl-icon>
          <div class="empty-state-text">
            Select a sample from the browser to start editing.
            Double-click or press Enter on a sample to load it.
          </div>
        </div>
      `;
    }

    if (this._error && !this._loadingAudio) {
      return html`
        <sl-alert variant="danger" open class="error-message">
          <sl-icon slot="icon" name="exclamation-octagon"></sl-icon>
          ${this._error}
        </sl-alert>
      `;
    }

    return html`
      <uvm-waveform-editor
        .audioBuffer=${this._audioBuffer}
        .zoom=${this._zoom}
        .loading=${this._loadingAudio}
        .offset=${this._currentEntry?.offset ?? 0}
        .consonant=${this._currentEntry?.consonant ?? 0}
        .cutoff=${this._currentEntry?.cutoff ?? 0}
        .preutterance=${this._currentEntry?.preutterance ?? 0}
        .overlap=${this._currentEntry?.overlap ?? 0}
        @marker-change=${this._onMarkerChange}
        @zoom-change=${this._onZoomChange}
      ></uvm-waveform-editor>
    `;
  }

  /**
   * Render the oto parameters sidebar.
   */
  private _renderParamsPanel() {
    if (!this._currentFilename) {
      return html`
        <div class="params-panel">
          <div class="params-header">
            <div class="params-header-title">
              <sl-icon name="sliders"></sl-icon>
              Parameters
            </div>
          </div>
          <div class="empty-state">
            <sl-icon name="hand-index"></sl-icon>
            <div class="empty-state-text">
              Select a sample to edit its oto parameters.
            </div>
          </div>
        </div>
      `;
    }

    if (this._loadingEntries) {
      return html`
        <div class="params-panel">
          <div class="params-header">
            <div class="params-header-title">
              <sl-icon name="sliders"></sl-icon>
              Parameters
            </div>
          </div>
          <div class="skeleton-params">
            <div class="skeleton-param-group">
              <sl-skeleton effect="pulse" style="width: 30%; height: 0.75rem;"></sl-skeleton>
              <sl-skeleton effect="pulse" style="width: 100%; height: 2rem;"></sl-skeleton>
            </div>
            <sl-divider></sl-divider>
            ${[1, 2, 3, 4, 5].map(
              () => html`
                <div class="skeleton-param-group">
                  <sl-skeleton effect="pulse" style="width: 50%; height: 0.75rem;"></sl-skeleton>
                  <sl-skeleton effect="pulse" style="width: 100%; height: 2rem;"></sl-skeleton>
                </div>
              `
            )}
            <sl-divider></sl-divider>
            <sl-skeleton effect="pulse" style="width: 100%; height: 2.5rem;"></sl-skeleton>
          </div>
        </div>
      `;
    }

    return html`
      <div class="params-panel">
        <div class="params-header">
          <div class="params-header-title">
            <sl-icon name="sliders"></sl-icon>
            Parameters
          </div>
          ${this._renderStatusBadge()}
        </div>

        ${this._currentFilename && this._currentVoicebankId
          ? html`
              <div class="sample-info">
                <div class="sample-info-filename">
                  ${this._currentFilename}${this._isDirty ? ' *' : ''}
                </div>
                <div class="sample-info-voicebank">${this._currentVoicebankId}</div>
              </div>
            `
          : null}

        <div class="params-content">
          <div class="sidebar-section">
            <uvm-entry-list
              .entries=${this._otoEntries}
              .selectedAlias=${this._currentEntry?.alias ?? null}
              .loading=${this._loadingEntries}
              @entry-select=${this._onEntryListSelect}
              @entry-create=${this._onEntryCreate}
              @entry-delete=${this._onEntryDelete}
            ></uvm-entry-list>
          </div>

          <sl-divider></sl-divider>

          <div class="param-group">
            <label class="param-label">
              <span class="param-color-indicator" style="background-color: #22c55e;"></span>
              Offset (ms)
            </label>
            <sl-input
              type="number"
              value=${this._currentEntry?.offset ?? 0}
              size="small"
              @sl-change=${(e: Event) => this._onParamChange('offset', e)}
            ></sl-input>
          </div>

          <div class="param-group">
            <label class="param-label">
              <span class="param-color-indicator" style="background-color: #3b82f6;"></span>
              Consonant (ms)
            </label>
            <sl-input
              type="number"
              value=${this._currentEntry?.consonant ?? 0}
              size="small"
              @sl-change=${(e: Event) => this._onParamChange('consonant', e)}
            ></sl-input>
          </div>

          <div class="param-group">
            <label class="param-label">
              <span class="param-color-indicator" style="background-color: #ef4444;"></span>
              Cutoff (ms)
            </label>
            <sl-input
              type="number"
              value=${this._currentEntry?.cutoff ?? 0}
              size="small"
              @sl-change=${(e: Event) => this._onParamChange('cutoff', e)}
            ></sl-input>
          </div>

          <div class="param-group">
            <label class="param-label">
              <span class="param-color-indicator" style="background-color: #a855f7;"></span>
              Preutterance (ms)
            </label>
            <sl-input
              type="number"
              value=${this._currentEntry?.preutterance ?? 0}
              size="small"
              @sl-change=${(e: Event) => this._onParamChange('preutterance', e)}
            ></sl-input>
          </div>

          <div class="param-group">
            <label class="param-label">
              <span class="param-color-indicator" style="background-color: #f97316;"></span>
              Overlap (ms)
            </label>
            <sl-input
              type="number"
              value=${this._currentEntry?.overlap ?? 0}
              size="small"
              @sl-change=${(e: Event) => this._onParamChange('overlap', e)}
            ></sl-input>
          </div>

          <sl-divider></sl-divider>

          <div class="action-buttons">
            <sl-button-group>
              <sl-button
                variant="default"
                ?disabled=${!this._currentFilename || this._isDetecting}
                ?loading=${this._isDetecting}
                @click=${this._autoDetect}
              >
                <sl-icon slot="prefix" name="magic"></sl-icon>
                Auto-detect
              </sl-button>
              <sl-button
                variant=${this._saveSuccess ? 'success' : 'primary'}
                ?disabled=${!this._isDirty || this._isSaving}
                ?loading=${this._isSaving}
                @click=${this._saveEntry}
              >
                <sl-icon slot="prefix" name=${this._saveSuccess ? 'check-lg' : 'floppy'}></sl-icon>
                ${this._saveSuccess ? 'Saved' : 'Save'}
              </sl-button>
            </sl-button-group>
            <span class="save-hint">Ctrl+S to save</span>
            ${this._lastConfidence !== null ? html`
              <div class="confidence-badge">
                <sl-tooltip content="ML detection confidence">
                  <sl-badge variant=${this._getConfidenceVariant()}>
                    ${Math.round(this._lastConfidence * 100)}% confident
                  </sl-badge>
                </sl-tooltip>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render the status badge showing saved/unsaved/new state.
   */
  private _renderStatusBadge() {
    if (this._saveSuccess) {
      return html`<sl-badge variant="success" pill>saved</sl-badge>`;
    }
    if (this._isDirty) {
      return html`<sl-badge variant="warning" pill>unsaved</sl-badge>`;
    }
    if (this._originalEntry === null) {
      return html`<sl-badge variant="neutral" pill>new</sl-badge>`;
    }
    return html`<sl-badge variant="success" pill>saved</sl-badge>`;
  }

  /**
   * Render the unsaved changes confirmation dialog.
   */
  private _renderUnsavedDialog() {
    return html`
      <sl-dialog id="unsaved-dialog" label="Unsaved Changes">
        <p>You have unsaved changes. What would you like to do?</p>
        <div slot="footer" class="dialog-footer">
          <sl-button variant="default" @click=${this._onCancelNavigation}>
            Cancel
          </sl-button>
          <sl-button variant="danger" @click=${this._onDiscardChanges}>
            Discard
          </sl-button>
          <sl-button variant="primary" @click=${this._onSaveAndContinue}>
            Save
          </sl-button>
        </div>
      </sl-dialog>
    `;
  }

  render() {
    return html`
      <div class="editor-layout">
        ${this._renderSampleBrowser()}
        <div class="main-area">
          <div class="waveform-section">
            ${this._renderMainArea()}
          </div>
        </div>
        ${this._renderParamsPanel()}
      </div>
      ${this._renderUnsavedDialog()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-editor-view': UvmEditorView;
  }
}
