import { LitElement, html, css } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import type { AfterEnterObserver, RouterLocation } from '@vaadin/router';

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
import '@shoelace-style/shoelace/dist/components/details/details.js';
import type SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

// Import child components
import './uvm-sample-browser.js';
import './uvm-waveform-editor.js';
import './uvm-entry-list.js';
import './uvm-context-bar.js';
import './uvm-value-bar.js';
import './uvm-precision-drawer.js';
import './uvm-shortcut-overlay.js';
import './uvm-batch-review.js';
import './uvm-metadata-editor.js';

import { api, ApiError } from '../services/api.js';
import { getSharedAudioContext } from '../services/audio-context.js';
import type { BatchSampleResult } from './uvm-batch-review.js';
import type { EntryCreateDetail } from './uvm-entry-list.js';
import type { OtoEntry } from '../services/types.js';
import type { PrecisionDrawerChangeDetail } from './uvm-precision-drawer.js';
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
 * Main editor view component with waveform-centric layout.
 *
 * Layout (top to bottom):
 * - Context bar: Breadcrumb navigation + undo/redo/save actions
 * - Entry tabs: For VCV samples with multiple aliases (hidden if 1 entry)
 * - Waveform editor: Main editing area (fills available space)
 * - Value bar: Read-only display of current marker values
 * - Precision drawer: Collapsible numeric input panel
 * - Sample browser: Modal overlay (not inline)
 *
 * @example
 * ```html
 * <uvm-editor-view></uvm-editor-view>
 * ```
 */
@customElement('uvm-editor-view')
export class UvmEditorView extends LitElement implements AfterEnterObserver {
  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    .editor-layout {
      display: flex;
      flex-direction: column;
      height: calc(100vh - 56px);
      background: var(--uvm-background, #ffffff);
    }

    .waveform-area {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      padding: 0 1.5rem;
    }

    .waveform-section {
      flex: 1;
      min-height: 300px;
      display: flex;
      flex-direction: column;
      background-color: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04);
      overflow: hidden;
      margin: 1rem 0;
    }

    /* Entry tabs for VCV samples with multiple aliases */
    .entry-tabs {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0 1.5rem;
      background-color: var(--uvm-surface, #fafafa);
      border-bottom: 1px solid var(--uvm-border, #e5e7eb);
      overflow-x: auto;
    }

    .entry-tab {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.625rem 1rem;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      font-family: inherit;
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--uvm-secondary, #6b7280);
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }

    .entry-tab:hover {
      color: var(--uvm-primary, #1f2937);
      background-color: rgba(0, 0, 0, 0.03);
    }

    .entry-tab.active {
      color: var(--sl-color-primary-600, #2563eb);
      border-bottom-color: var(--sl-color-primary-600, #2563eb);
    }

    .entry-tab.add-tab {
      padding: 0.625rem 0.75rem;
      color: var(--uvm-secondary, #9ca3af);
    }

    .entry-tab.add-tab:hover {
      color: var(--sl-color-primary-600, #2563eb);
    }

    .entry-tab.add-tab sl-icon {
      font-size: 1rem;
    }

    /* Empty state when no sample is loaded */
    .waveform-empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem 2rem;
      text-align: center;
      flex: 1;
      min-height: 300px;
      background-color: #fafbfc;
      background-image:
        radial-gradient(circle at 1px 1px, #e5e7eb 1px, transparent 0);
      background-size: 24px 24px;
      border: 2px dashed #d1d5db;
      border-radius: 12px;
      margin: 1rem 1.5rem;
    }

    .waveform-empty-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.5rem;
      max-width: 320px;
    }

    .waveform-empty-icon-row {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .waveform-empty-waveform-icon {
      font-size: 3.5rem;
      color: #d1d5db;
    }

    .waveform-empty-title {
      font-size: 1.125rem;
      font-weight: 600;
      color: #374151;
      margin: 0;
    }

    .waveform-empty-description {
      font-size: 0.875rem;
      color: #6b7280;
      line-height: 1.6;
      margin: 0;
    }

    .waveform-empty-hints {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.875rem 1rem;
      background-color: rgba(255, 255, 255, 0.8);
      border-radius: 8px;
      border: 1px solid #e5e7eb;
    }

    .waveform-empty-hint {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      font-size: 0.8125rem;
      color: #6b7280;
    }

    .waveform-empty-hint sl-icon {
      font-size: 1rem;
      color: #9ca3af;
      flex-shrink: 0;
    }

    .waveform-empty-hint kbd {
      display: inline-block;
      padding: 0.125rem 0.375rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
      font-size: 0.75rem;
      font-weight: 500;
      color: #374151;
      background-color: #f3f4f6;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      box-shadow: 0 1px 0 #d1d5db;
    }

    .error-message {
      margin: 1rem 1.5rem;
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
      color: #374151;
    }

    /* Loading state */
    .loading-overlay {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      text-align: center;
      color: #6b7280;
    }

    .loading-overlay sl-spinner {
      font-size: 1.75rem;
      --indicator-color: #3b82f6;
      margin-bottom: 0.625rem;
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

  // URL parameter state (from router)
  @state()
  private _urlVoicebankId: string | null = null;

  @state()
  private _urlSampleId: string | null = null;

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

  // New layout state
  @state()
  private _showBrowser = false;

  @state()
  private _showPrecision = false;

  @state()
  private _showShortcuts = false;

  @state()
  private _autoAdvance = false;

  @state()
  private _showMetadata = false;

  @state()
  private _showBatchReview = false;

  @state()
  private _batchResults: BatchSampleResult[] = [];

  @state()
  private _undoStack: OtoEntry[] = [];

  @state()
  private _redoStack: OtoEntry[] = [];

  // Original entry to detect changes and determine create vs update
  private _originalEntry: OtoEntry | null = null;

  // Pending sample selection (used when prompting to save)
  private _pendingSampleSelect: SampleSelectDetail | null = null;

  // Reference to unsaved changes dialog
  @query('#unsaved-dialog')
  private _unsavedDialog!: SlDialog;

  connectedCallback(): void {
    super.connectedCallback();
    // Add keyboard listener for shortcuts
    this._boundKeyHandler = this._onKeyDown.bind(this);
    document.addEventListener('keydown', this._boundKeyHandler);

    // Parse URL for deep linking (fallback if onAfterEnter isn't called)
    this._parseUrlAndLoad();
  }

  /**
   * Parse the current URL for deep linking parameters.
   * This serves as a fallback when Vaadin Router lifecycle hooks aren't called.
   */
  private _parseUrlAndLoad(): void {
    const path = window.location.pathname;
    // Match /editor/:voicebankId/sample/:sampleId
    const sampleMatch = path.match(/^\/editor\/([^/]+)\/sample\/([^/]+)$/);
    if (sampleMatch) {
      const voicebankId = decodeURIComponent(sampleMatch[1]);
      const sampleId = decodeURIComponent(sampleMatch[2]);
      this._loadSample(voicebankId, sampleId);
      return;
    }
    // Match /editor/:voicebankId (voicebank only, no sample)
    const voicebankMatch = path.match(/^\/editor\/([^/]+)$/);
    if (voicebankMatch) {
      this._urlVoicebankId = decodeURIComponent(voicebankMatch[1]);
      // Open browser to let user select a sample
      this._showBrowser = true;
    }
  }

  /**
   * Vaadin Router lifecycle hook - called when navigating to this view.
   * Reads URL parameters and loads the sample if specified.
   */
  onAfterEnter(location: RouterLocation): void {
    const voicebankId = location.params.voicebankId as string | undefined;
    const sampleId = location.params.sampleId as string | undefined;

    if (voicebankId) {
      this._urlVoicebankId = decodeURIComponent(voicebankId);
    } else {
      this._urlVoicebankId = null;
    }

    if (sampleId) {
      this._urlSampleId = decodeURIComponent(sampleId);
    } else {
      this._urlSampleId = null;
    }

    // Load the sample if both IDs are present
    if (this._urlVoicebankId && this._urlSampleId) {
      this._loadSample(this._urlVoicebankId, this._urlSampleId);
    }
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
   * Handle keyboard events for shortcuts.
   */
  private _onKeyDown(e: KeyboardEvent): void {
    // Ctrl+S or Cmd+S to save (handled by context-bar, but keep for fallback)
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (this._isDirty && !this._isSaving) {
        this._saveEntry();
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
      this._navigateToPreviousSample();
      return;
    }

    if (e.key === ']') {
      e.preventDefault();
      this._navigateToNextSample();
      return;
    }

    // Toggle precision drawer with = or + key
    if (e.key === '=' || e.key === '+') {
      e.preventDefault();
      this._showPrecision = !this._showPrecision;
      return;
    }

    // D key for auto-detect
    if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      if (!this._isDetecting && this._currentFilename) {
        this._autoDetect();
      }
      return;
    }

    // ? key for shortcut overlay
    if (e.key === '?') {
      e.preventDefault();
      this._showShortcuts = true;
      return;
    }
  }

  // Sample list cache for navigation
  @state()
  private _samplesList: string[] = [];

  /**
   * Navigate to the previous sample in the current voicebank.
   */
  private async _navigateToPreviousSample(): Promise<void> {
    if (!this._currentVoicebankId || !this._currentFilename) return;

    // Fetch samples list if not cached or voicebank changed
    if (this._samplesList.length === 0) {
      await this._fetchSamplesList();
    }

    const currentIndex = this._samplesList.indexOf(this._currentFilename);
    if (currentIndex <= 0) return; // Already at first sample

    const previousSample = this._samplesList[currentIndex - 1];

    // Check for unsaved changes before navigating
    if (this._isDirty) {
      this._pendingSampleSelect = {
        voicebankId: this._currentVoicebankId,
        filename: previousSample,
      };
      this._unsavedDialog.show();
      return;
    }

    await this._loadSample(this._currentVoicebankId, previousSample);
  }

  /**
   * Navigate to the next sample in the current voicebank.
   */
  private async _navigateToNextSample(): Promise<void> {
    if (!this._currentVoicebankId || !this._currentFilename) return;

    // Fetch samples list if not cached or voicebank changed
    if (this._samplesList.length === 0) {
      await this._fetchSamplesList();
    }

    const currentIndex = this._samplesList.indexOf(this._currentFilename);
    if (currentIndex < 0 || currentIndex >= this._samplesList.length - 1) return; // Already at last sample

    const nextSample = this._samplesList[currentIndex + 1];

    // Check for unsaved changes before navigating
    if (this._isDirty) {
      this._pendingSampleSelect = {
        voicebankId: this._currentVoicebankId,
        filename: nextSample,
      };
      this._unsavedDialog.show();
      return;
    }

    await this._loadSample(this._currentVoicebankId, nextSample);
  }

  /**
   * Fetch the samples list for the current voicebank.
   */
  private async _fetchSamplesList(): Promise<void> {
    if (!this._currentVoicebankId) return;

    try {
      this._samplesList = await api.listSamples(this._currentVoicebankId);
    } catch (error) {
      console.warn('Failed to fetch samples list:', error);
      this._samplesList = [];
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
    // Clear samples list cache if voicebank changed
    if (this._currentVoicebankId !== voicebankId) {
      this._samplesList = [];
    }

    this._currentVoicebankId = voicebankId;
    this._currentFilename = filename;
    this._error = null;
    this._selectedEntryIndex = 0;
    this._isDirty = false;
    this._originalEntry = null;
    this._lastConfidence = null;
    this._undoStack = [];
    this._redoStack = [];

    // Load audio and oto entries in parallel
    await Promise.all([
      this._loadAudio(voicebankId, filename),
      this._loadOtoEntries(voicebankId, filename),
    ]);

    // Auto-detect if this is a new entry OR has only default values
    if (
      (this._originalEntry === null || this._hasOnlyDefaultValues(this._originalEntry)) &&
      this._audioBuffer !== null
    ) {
      // Small delay to let UI update before starting detection
      setTimeout(() => this._autoDetect(), 100);
    }

    // Update URL to reflect current selection
    const newPath = `/editor/${encodeURIComponent(voicebankId)}/sample/${encodeURIComponent(filename)}`;
    window.history.replaceState(null, '', newPath);
  }

  /**
   * Check if entry has only default values (hasn't been configured).
   */
  private _hasOnlyDefaultValues(entry: OtoEntry | null): boolean {
    if (!entry) return true;

    return (
      entry.offset === DEFAULT_OTO_VALUES.offset &&
      entry.consonant === DEFAULT_OTO_VALUES.consonant &&
      entry.cutoff === DEFAULT_OTO_VALUES.cutoff &&
      entry.preutterance === DEFAULT_OTO_VALUES.preutterance &&
      entry.overlap === DEFAULT_OTO_VALUES.overlap
    );
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
      // Get shared AudioContext on first use (must be after user gesture)
      if (!this._audioContext) {
        this._audioContext = getSharedAudioContext();
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

    // Push current state to undo stack before making changes
    this._pushUndo();

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

      // Auto-advance to next sample if enabled
      if (this._autoAdvance) {
        // Small delay to let user see save confirmation
        setTimeout(() => {
          this._navigateToNextSample();
        }, 300);
      }
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
   * Handle entry selection from the entry list/tabs.
   */
  private _selectEntry(index: number): void {
    if (index < 0 || index >= this._otoEntries.length) return;
    if (index === this._selectedEntryIndex) return;

    this._selectedEntryIndex = index;
    this._currentEntry = { ...this._otoEntries[index] };
    this._originalEntry = { ...this._otoEntries[index] };
    this._isDirty = false;
    this._saveSuccess = false;
    this._lastConfidence = null;
    this._undoStack = [];
    this._redoStack = [];
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
      this._undoStack = [];
      this._redoStack = [];
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
   * Add a new entry (for VCV samples with multiple aliases).
   */
  private _addEntry(): void {
    if (!this._currentFilename) return;

    // Generate a unique alias
    const baseName = this._currentFilename.replace(/\.wav$/i, '').replace(/^_/, '');
    let alias = `- ${baseName}`;
    let suffix = 2;

    while (this._otoEntries.some((e) => e.alias === alias)) {
      alias = `- ${baseName} ${suffix}`;
      suffix++;
    }

    // Trigger entry creation
    this._onEntryCreate(new CustomEvent('entry-create', { detail: { alias } }));
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
        { alias: this._currentEntry?.alias }
      );

      // Push current state to undo stack before applying detection
      this._pushUndo();

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
   * Clean up audio context when component is disconnected.
   */
  private _cleanupAudioContext(): void {
    // Release reference to shared AudioContext (do not close -- it is shared)
    this._audioContext = null;
  }

  /**
   * Get the voicebank name for display.
   */
  private _getVoicebankName(): string {
    return this._currentVoicebankId || '';
  }

  /**
   * Open the sample browser modal.
   */
  private _openBrowser(): void {
    this._showBrowser = true;
  }

  /**
   * Get current entry as OtoEntry object.
   */
  private _getCurrentEntry(): OtoEntry | null {
    if (!this._currentFilename || !this._currentEntry) return null;
    return { ...this._currentEntry };
  }

  /**
   * Push current state to undo stack.
   */
  private _pushUndo(): void {
    const current = this._getCurrentEntry();
    if (current) {
      this._undoStack = [...this._undoStack, current];
      this._redoStack = []; // Clear redo on new action
    }
  }

  /**
   * Apply an entry state (used for undo/redo).
   */
  private _applyEntry(entry: OtoEntry): void {
    this._currentEntry = { ...entry };
    this._isDirty = true;
    this._saveSuccess = false;
  }

  /**
   * Undo the last change.
   */
  private _undo(): void {
    if (this._undoStack.length === 0) return;

    const current = this._getCurrentEntry();
    if (current) {
      this._redoStack = [...this._redoStack, current];
    }

    const previous = this._undoStack[this._undoStack.length - 1];
    this._undoStack = this._undoStack.slice(0, -1);
    this._applyEntry(previous);
  }

  /**
   * Redo a previously undone change.
   */
  private _redo(): void {
    if (this._redoStack.length === 0) return;

    const current = this._getCurrentEntry();
    if (current) {
      this._undoStack = [...this._undoStack, current];
    }

    const next = this._redoStack[this._redoStack.length - 1];
    this._redoStack = this._redoStack.slice(0, -1);
    this._applyEntry(next);
  }

  /**
   * Handle precision drawer value changes.
   */
  private _onPrecisionChange(e: CustomEvent<PrecisionDrawerChangeDetail>): void {
    if (!this._currentEntry) return;

    const { name, value } = e.detail;

    // Push current state to undo stack before making changes
    this._pushUndo();

    // Update the entry
    this._currentEntry = {
      ...this._currentEntry,
      [name]: value,
    };

    this._isDirty = true;
    this._saveSuccess = false;
  }

  /**
   * Handle voicebank selection from the sample browser.
   * Updates the URL to reflect the selected voicebank.
   */
  private _onVoicebankSelect(e: CustomEvent<{ voicebankId: string }>): void {
    const { voicebankId } = e.detail;
    // Update URL to show voicebank selection (without triggering navigation)
    const newPath = `/editor/${encodeURIComponent(voicebankId)}`;
    window.history.replaceState(null, '', newPath);
  }

  /**
   * Open the metadata editor dialog.
   */
  private _openMetadata(): void {
    this._showMetadata = true;
  }

  /**
   * Handle auto-advance toggle from context bar.
   */
  private _onAutoAdvanceToggle(): void {
    this._autoAdvance = !this._autoAdvance;
    const status = this._autoAdvance ? 'enabled' : 'disabled';
    UvmToastManager.info(`Auto-advance ${status}`);
  }

  /**
   * Handle batch review completion.
   */
  private _onBatchReviewComplete(e: CustomEvent<{ accepted: BatchSampleResult[]; skipped: BatchSampleResult[] }>): void {
    const { accepted } = e.detail;
    this._showBatchReview = false;
    this._batchResults = [];

    if (accepted.length > 0) {
      UvmToastManager.success(`Accepted ${accepted.length} samples`);
    }
  }

  /**
   * Handle request to adjust a sample from batch review.
   */
  private _onBatchReviewAdjust(e: CustomEvent<{ sample: BatchSampleResult }>): void {
    const { sample } = e.detail;
    this._showBatchReview = false;

    // Navigate to the sample for manual adjustment
    if (this._currentVoicebankId) {
      this._loadSample(this._currentVoicebankId, sample.filename);
    }
  }

  /**
   * Get progress counts for the current voicebank.
   */
  private _getProgressCounts(): { configured: number; total: number } {
    // For now, use samples list length as total
    // In a real implementation, we'd track which samples have oto entries
    const total = this._samplesList.length;
    // This is a placeholder - in production we'd track actual configured count
    const configured = this._otoEntries.length > 0 ? 1 : 0;
    return { configured, total };
  }

  /**
   * Render entry tabs for VCV samples with multiple aliases.
   */
  private _renderEntryTabs() {
    if (!this._otoEntries || this._otoEntries.length <= 1) {
      return null; // No tabs for single entry
    }

    return html`
      <div class="entry-tabs">
        ${this._otoEntries.map(
          (entry, index) => html`
            <button
              class="entry-tab ${index === this._selectedEntryIndex ? 'active' : ''}"
              @click=${() => this._selectEntry(index)}
            >
              ${entry.alias || `Entry ${index + 1}`}
            </button>
          `
        )}
        <button class="entry-tab add-tab" @click=${this._addEntry}>
          <sl-icon name="plus"></sl-icon>
        </button>
      </div>
    `;
  }

  /**
   * Render the main waveform editing area.
   */
  private _renderWaveform() {
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
   * Render empty state when no sample is loaded.
   */
  private _renderEmptyState() {
    return html`
      <div class="waveform-empty-state">
        <div class="waveform-empty-content">
          <div class="waveform-empty-icon-row">
            <sl-icon name="soundwave" class="waveform-empty-waveform-icon"></sl-icon>
          </div>
          <h3 class="waveform-empty-title">No sample loaded</h3>
          <p class="waveform-empty-description">
            Click the breadcrumb above or press <kbd>/</kbd> to open the sample browser.
          </p>
          <div class="waveform-empty-hints">
            <div class="waveform-empty-hint">
              <sl-icon name="mouse"></sl-icon>
              <span>Click the voicebank name to browse samples</span>
            </div>
            <div class="waveform-empty-hint">
              <sl-icon name="keyboard"></sl-icon>
              <span>Press <kbd>/</kbd> to quick-open browser</span>
            </div>
            <div class="waveform-empty-hint">
              <sl-icon name="arrow-left-right"></sl-icon>
              <span>Use <kbd>[</kbd> and <kbd>]</kbd> to navigate samples</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render status indicator showing detection/save/loading state.
   */
  private _renderStatusIndicator() {
    // Show detecting state
    if (this._isDetecting) {
      return html`
        <div class="status-indicator detecting">
          <sl-spinner></sl-spinner>
          <span>Detecting parameters...</span>
        </div>
      `;
    }

    // Show loading entries state
    if (this._loadingEntries) {
      return html`
        <div class="status-indicator loading">
          <sl-spinner></sl-spinner>
          <span>Loading entries...</span>
        </div>
      `;
    }

    // Show save success with confidence
    if (this._saveSuccess) {
      return html`
        <div class="status-indicator success">
          <sl-icon name="check-circle"></sl-icon>
          <span>Saved</span>
          ${this._lastConfidence !== null
            ? html`
                <span class="confidence-badge">
                  <sl-icon name="cpu"></sl-icon>
                  ${Math.round(this._lastConfidence * 100)}% confidence
                </span>
              `
            : null}
        </div>
      `;
    }

    // Show confidence from last detection (if available)
    if (this._lastConfidence !== null) {
      return html`
        <div class="status-indicator">
          <span class="confidence-badge">
            <sl-icon name="cpu"></sl-icon>
            ${Math.round(this._lastConfidence * 100)}% confidence
          </span>
        </div>
      `;
    }

    // No status to show
    return null;
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
    const progress = this._getProgressCounts();

    return html`
      <div class="editor-layout">
        <uvm-context-bar
          .voicebankName=${this._getVoicebankName()}
          .sampleName=${this._currentFilename || ''}
          .canUndo=${this._undoStack.length > 0}
          .canRedo=${this._redoStack.length > 0}
          .hasUnsavedChanges=${this._isDirty}
          .saving=${this._isSaving}
          .autoAdvance=${this._autoAdvance}
          .progressConfigured=${progress.configured}
          .progressTotal=${progress.total}
          @uvm-context-bar:browse=${this._openBrowser}
          @uvm-context-bar:undo=${this._undo}
          @uvm-context-bar:redo=${this._redo}
          @uvm-context-bar:save=${this._saveEntry}
          @uvm-context-bar:auto-advance-toggle=${this._onAutoAdvanceToggle}
          @uvm-context-bar:metadata=${this._openMetadata}
        ></uvm-context-bar>

        ${this._renderEntryTabs()}

        ${this._currentFilename
          ? html`
              <div class="waveform-area">
                <div class="waveform-section">
                  ${this._renderWaveform()}
                  ${this._renderStatusIndicator()}
                </div>

                <uvm-value-bar
                  .offset=${this._currentEntry?.offset ?? 0}
                  .consonant=${this._currentEntry?.consonant ?? 0}
                  .cutoff=${this._currentEntry?.cutoff ?? 0}
                  .preutterance=${this._currentEntry?.preutterance ?? 0}
                  .overlap=${this._currentEntry?.overlap ?? 0}
                ></uvm-value-bar>

                <uvm-precision-drawer
                  ?open=${this._showPrecision}
                  .offset=${this._currentEntry?.offset ?? 0}
                  .consonant=${this._currentEntry?.consonant ?? 0}
                  .cutoff=${this._currentEntry?.cutoff ?? 0}
                  .preutterance=${this._currentEntry?.preutterance ?? 0}
                  .overlap=${this._currentEntry?.overlap ?? 0}
                  @uvm-precision-drawer:change=${this._onPrecisionChange}
                  @uvm-precision-drawer:close=${() => (this._showPrecision = false)}
                ></uvm-precision-drawer>
              </div>
            `
          : this._renderEmptyState()}

        <uvm-sample-browser
          ?open=${this._showBrowser}
          @sample-select=${this._onSampleSelect}
          @voicebank-select=${this._onVoicebankSelect}
          @uvm-sample-browser:close=${() => (this._showBrowser = false)}
        ></uvm-sample-browser>

        <uvm-shortcut-overlay
          ?open=${this._showShortcuts}
          @uvm-shortcut-overlay:close=${() => (this._showShortcuts = false)}
        ></uvm-shortcut-overlay>

        <uvm-batch-review
          ?open=${this._showBatchReview}
          .samples=${this._batchResults}
          voicebankId=${this._currentVoicebankId || ''}
          @uvm-batch-review:complete=${this._onBatchReviewComplete}
          @uvm-batch-review:adjust=${this._onBatchReviewAdjust}
          @uvm-batch-review:close=${() => (this._showBatchReview = false)}
        ></uvm-batch-review>

        <uvm-metadata-editor
          ?open=${this._showMetadata}
          voicebankId=${this._currentVoicebankId || ''}
          @uvm-metadata-editor:close=${() => (this._showMetadata = false)}
        ></uvm-metadata-editor>

        ${this._renderUnsavedDialog()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-editor-view': UvmEditorView;
  }
}
