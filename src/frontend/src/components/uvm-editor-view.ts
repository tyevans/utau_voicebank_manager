import { LitElement, html, css } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import type { AfterEnterObserver, RouterLocation } from '@vaadin/router';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import type SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

// Import child components
import './uvm-audio-manager.js';
import './uvm-oto-manager.js';
import './uvm-editor-toolbar.js';
import './uvm-sample-browser.js';
import './uvm-waveform-editor.js';
import './uvm-entry-list.js';
import './uvm-context-bar.js';
import './uvm-value-bar.js';
import './uvm-precision-drawer.js';
import './uvm-shortcut-overlay.js';
import './uvm-batch-review.js';
import './uvm-metadata-editor.js';
import './uvm-validation-warnings.js';

import { api } from '../services/api.js';
import type { UvmOtoManager, OtoValidationWarning } from './uvm-oto-manager.js';
import type { BatchSampleResult } from './uvm-batch-review.js';
import type { OtoEntry } from '../services/types.js';
import type { PrecisionDrawerChangeDetail } from './uvm-precision-drawer.js';
import { UvmToastManager } from './uvm-toast-manager.js';

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
 * This component acts as an orchestrator, composing focused sub-components:
 * - uvm-audio-manager: Audio loading, AudioContext lifecycle (headless)
 * - uvm-oto-manager: OtoEntry CRUD, undo/redo, auto-detection (headless)
 * - uvm-editor-toolbar: Keyboard shortcuts and status indicator
 * - uvm-context-bar: Breadcrumb navigation + action buttons
 * - uvm-waveform-editor: Main waveform editing area
 * - uvm-value-bar: Read-only marker values
 * - uvm-precision-drawer: Numeric input panel
 * - uvm-sample-browser: Modal sample selection
 *
 * Layout (top to bottom):
 * - Context bar: Breadcrumb navigation + undo/redo/save actions
 * - Entry tabs: For VCV samples with multiple aliases (hidden if 1 entry)
 * - Waveform editor: Main editing area (fills available space)
 * - Status indicator: Detection/save/loading state
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
  `;

  // ==================== URL Parameter State ====================

  @state()
  private _urlVoicebankId: string | null = null;

  @state()
  private _urlSampleId: string | null = null;

  // ==================== Current Selection ====================

  @state()
  private _currentVoicebankId: string | null = null;

  @state()
  private _currentFilename: string | null = null;

  // ==================== State Mirrored from Sub-Components ====================

  /** Audio buffer from uvm-audio-manager. */
  @state()
  private _audioBuffer: AudioBuffer | null = null;

  @state()
  private _loadingAudio = false;

  /** Current entry from uvm-oto-manager. */
  @state()
  private _currentEntry: OtoEntry | null = null;

  @state()
  private _otoEntries: OtoEntry[] = [];

  @state()
  private _selectedEntryIndex = 0;

  @state()
  private _isDirty = false;

  @state()
  private _isSaving = false;

  @state()
  private _saveSuccess = false;

  @state()
  private _isDetecting = false;

  @state()
  private _lastConfidence: number | null = null;

  @state()
  private _loadingEntries = false;

  @state()
  private _error: string | null = null;

  @state()
  private _validationWarnings: OtoValidationWarning[] = [];

  // ==================== Zoom ====================

  @state()
  private _zoom = 1;

  // ==================== UI Toggle State ====================

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

  // ==================== Navigation ====================

  @state()
  private _samplesList: string[] = [];

  /** Pending sample selection (used when prompting to save). */
  private _pendingSampleSelect: SampleSelectDetail | null = null;

  // ==================== Queries ====================

  @query('#unsaved-dialog')
  private _unsavedDialog!: SlDialog;

  @query('uvm-oto-manager')
  private _otoManager!: UvmOtoManager;

  // ==================== Lifecycle ====================

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
    } else if (this._urlVoicebankId) {
      // Voicebank only -- open browser so user can pick a sample
      this._showBrowser = true;
    }
  }

  // ==================== Sample Loading ====================

  /**
   * Load a sample (triggers audio + oto loading via sub-components).
   */
  private async _loadSample(voicebankId: string, filename: string): Promise<void> {
    // Clear samples list cache if voicebank changed
    if (this._currentVoicebankId !== voicebankId) {
      this._samplesList = [];
    }

    this._currentVoicebankId = voicebankId;
    this._currentFilename = filename;
    this._error = null;

    // Update URL to reflect current selection
    const newPath = `/editor/${encodeURIComponent(voicebankId)}/sample/${encodeURIComponent(filename)}`;
    window.history.replaceState(null, '', newPath);

    // The sub-components (uvm-audio-manager and uvm-oto-manager) will
    // react to the property changes and load their respective data.
    // We also explicitly call loadEntries on the oto manager to handle
    // the auto-detect-on-load logic that depends on audioBuffer.
    await this.updateComplete;

    // The audio manager loads automatically via property change.
    // The oto manager needs explicit invocation for auto-detect coordination.
    if (this._otoManager) {
      this._otoManager.loadEntries(voicebankId, filename);
    }
  }

  // ==================== Audio Manager Events ====================

  /**
   * Handle audio-loaded event from the audio manager.
   */
  private _onAudioLoaded(e: CustomEvent<{ audioBuffer: AudioBuffer | null; error: string | null }>): void {
    this._audioBuffer = e.detail.audioBuffer;
    this._loadingAudio = false;

    if (e.detail.error) {
      this._error = e.detail.error;
    }
  }

  // ==================== Oto Manager Events ====================

  /**
   * Handle oto-entries-loaded from the oto manager.
   */
  private _onEntriesLoaded(e: CustomEvent<{ entries: OtoEntry[]; currentEntry: OtoEntry | null; isNew: boolean }>): void {
    this._otoEntries = e.detail.entries;
    this._currentEntry = e.detail.currentEntry;
    this._selectedEntryIndex = 0;
    this._isDirty = false;
    this._loadingEntries = false;
    if (this._otoManager) {
      this._validationWarnings = this._otoManager.validationWarnings;
    }
  }

  /**
   * Handle oto-entry-changed from the oto manager.
   */
  private _onEntryChanged(e: CustomEvent<{ entry: OtoEntry; isDirty: boolean }>): void {
    this._currentEntry = e.detail.entry;
    this._isDirty = e.detail.isDirty;
    this._saveSuccess = false;
    // Sync validation warnings from the oto manager
    if (this._otoManager) {
      this._validationWarnings = this._otoManager.validationWarnings;
    }
  }

  /**
   * Handle oto-entry-saved from the oto manager.
   */
  private _onEntrySaved(): void {
    this._syncFromOtoManager();

    // Auto-advance to next sample if enabled
    if (this._autoAdvance) {
      setTimeout(() => {
        this._navigateToNextSample();
      }, 300);
    }
  }

  /**
   * Handle oto-detected from the oto manager.
   */
  private _onOtoDetected(): void {
    this._syncFromOtoManager();
  }

  /**
   * Handle oto-error from the oto manager.
   */
  private _onOtoError(e: CustomEvent<{ message: string }>): void {
    this._error = e.detail.message;
  }

  /**
   * Sync state from the oto manager after operations that modify multiple properties.
   */
  private _syncFromOtoManager(): void {
    if (!this._otoManager) return;
    this._currentEntry = this._otoManager.currentEntry;
    this._otoEntries = this._otoManager.entries;
    this._selectedEntryIndex = this._otoManager.selectedEntryIndex;
    this._isDirty = this._otoManager.isDirty;
    this._isSaving = this._otoManager.isSaving;
    this._saveSuccess = this._otoManager.saveSuccess;
    this._isDetecting = this._otoManager.isDetecting;
    this._lastConfidence = this._otoManager.lastConfidence;
    this._loadingEntries = this._otoManager.loadingEntries;
    this._validationWarnings = this._otoManager.validationWarnings;
  }

  // ==================== Waveform Events ====================

  /**
   * Handle marker changes from the waveform editor.
   * Delegates to the oto manager.
   */
  private _onMarkerChange(e: CustomEvent<MarkerChangeDetail>): void {
    const { name, value } = e.detail;
    this._otoManager?.updateMarker(name, value);
    this._syncFromOtoManager();
  }

  /**
   * Handle zoom changes from the waveform editor.
   */
  private _onZoomChange(e: CustomEvent<{ zoom: number }>): void {
    this._zoom = e.detail.zoom;
  }

  // ==================== Context Bar Events ====================

  private _onContextBarUndo(): void {
    this._otoManager?.undo();
    this._syncFromOtoManager();
  }

  private _onContextBarRedo(): void {
    this._otoManager?.redo();
    this._syncFromOtoManager();
  }

  private _onContextBarSave(): void {
    this._otoManager?.saveEntry();
    // Sync handled via oto-entry-saved event
  }

  private _onContextBarDetect(): void {
    this._otoManager?.autoDetect();
    // Sync handled via oto-detected event
  }

  private _onAutoAdvanceToggle(): void {
    this._autoAdvance = !this._autoAdvance;
    const status = this._autoAdvance ? 'enabled' : 'disabled';
    UvmToastManager.info(`Auto-advance ${status}`);
  }

  private _onAlignmentChange(e: CustomEvent<{ tightness: number; methodOverride: 'sofa' | 'fa' | 'blind' | null }>): void {
    const { tightness, methodOverride } = e.detail;
    this._otoManager?.updateAlignmentSettings(tightness, methodOverride);
  }

  // ==================== Editor Toolbar Events ====================

  private _onToolbarPreviousSample(): void {
    this._navigateToPreviousSample();
  }

  private _onToolbarNextSample(): void {
    this._navigateToNextSample();
  }

  private _onToolbarTogglePrecision(): void {
    this._showPrecision = !this._showPrecision;
  }

  private _onToolbarDetect(): void {
    this._otoManager?.autoDetect();
  }

  private _onToolbarShowShortcuts(): void {
    this._showShortcuts = true;
  }

  private _onToolbarSave(): void {
    this._otoManager?.saveEntry();
  }

  // ==================== Sample Navigation ====================

  /**
   * Navigate to the previous sample in the current voicebank.
   */
  private async _navigateToPreviousSample(): Promise<void> {
    if (!this._currentVoicebankId || !this._currentFilename) return;

    if (this._samplesList.length === 0) {
      await this._fetchSamplesList();
    }

    const currentIndex = this._samplesList.indexOf(this._currentFilename);
    if (currentIndex <= 0) return;

    const previousSample = this._samplesList[currentIndex - 1];

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

    if (this._samplesList.length === 0) {
      await this._fetchSamplesList();
    }

    const currentIndex = this._samplesList.indexOf(this._currentFilename);
    if (currentIndex < 0 || currentIndex >= this._samplesList.length - 1) return;

    const nextSample = this._samplesList[currentIndex + 1];

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

  // ==================== Sample Browser Events ====================

  /**
   * Handle sample selection from the sample browser.
   */
  private async _onSampleSelect(e: CustomEvent<SampleSelectDetail>): Promise<void> {
    const { voicebankId, filename } = e.detail;

    if (this._currentVoicebankId === voicebankId && this._currentFilename === filename) {
      return;
    }

    if (this._isDirty) {
      this._pendingSampleSelect = { voicebankId, filename };
      this._unsavedDialog.show();
      return;
    }

    await this._loadSample(voicebankId, filename);
  }

  /**
   * Handle voicebank selection from the sample browser.
   */
  private _onVoicebankSelect(e: CustomEvent<{ voicebankId: string }>): void {
    const { voicebankId } = e.detail;
    const newPath = `/editor/${encodeURIComponent(voicebankId)}`;
    window.history.replaceState(null, '', newPath);
  }

  // ==================== Unsaved Changes Dialog ====================

  private _onDiscardChanges(): void {
    this._unsavedDialog.hide();
    this._isDirty = false;

    if (this._pendingSampleSelect) {
      const { voicebankId, filename } = this._pendingSampleSelect;
      this._pendingSampleSelect = null;
      this._loadSample(voicebankId, filename);
    }
  }

  private async _onSaveAndContinue(): Promise<void> {
    await this._otoManager?.saveEntry();
    this._syncFromOtoManager();
    this._unsavedDialog.hide();

    if (this._pendingSampleSelect && !this._isDirty) {
      const { voicebankId, filename } = this._pendingSampleSelect;
      this._pendingSampleSelect = null;
      this._loadSample(voicebankId, filename);
    }
  }

  private _onCancelNavigation(): void {
    this._unsavedDialog.hide();
    this._pendingSampleSelect = null;
  }

  // ==================== Entry Tabs ====================

  /**
   * Handle entry selection from the entry tabs.
   */
  private _selectEntry(index: number): void {
    this._otoManager?.selectEntry(index);
    this._syncFromOtoManager();
  }

  /**
   * Add a new entry (for VCV samples with multiple aliases).
   */
  private _addEntry(): void {
    this._otoManager?.addEntry();
  }

  // ==================== Precision Drawer ====================

  /**
   * Handle precision drawer value changes.
   * Delegates to the oto manager.
   */
  private _onPrecisionChange(e: CustomEvent<PrecisionDrawerChangeDetail>): void {
    const { name, value } = e.detail;
    this._otoManager?.updateMarker(name, value);
    this._syncFromOtoManager();
  }

  // ==================== Batch Review ====================

  private _onBatchReviewComplete(e: CustomEvent<{ accepted: BatchSampleResult[]; skipped: BatchSampleResult[] }>): void {
    const { accepted } = e.detail;
    this._showBatchReview = false;
    this._batchResults = [];

    if (accepted.length > 0) {
      UvmToastManager.success(`Accepted ${accepted.length} samples`);
    }
  }

  private _onBatchReviewAdjust(e: CustomEvent<{ sample: BatchSampleResult }>): void {
    const { sample } = e.detail;
    this._showBatchReview = false;

    if (this._currentVoicebankId) {
      this._loadSample(this._currentVoicebankId, sample.filename);
    }
  }

  // ==================== Helpers ====================

  /**
   * Compute a Set of parameter names that have validation warnings,
   * for passing to the precision drawer's warningParameters property.
   */
  private get _warningParameterSet(): Set<string> {
    return new Set(this._validationWarnings.map((w) => w.parameter));
  }

  private _getVoicebankName(): string {
    return this._currentVoicebankId || '';
  }

  private _openBrowser(): void {
    this._showBrowser = true;
  }

  private _openMetadata(): void {
    this._showMetadata = true;
  }

  private _getProgressCounts(): { configured: number; total: number } {
    const total = this._samplesList.length;
    const configured = this._otoEntries.length > 0 ? 1 : 0;
    return { configured, total };
  }

  // ==================== Render Helpers ====================

  /**
   * Render entry tabs for VCV samples with multiple aliases.
   */
  private _renderEntryTabs() {
    if (!this._otoEntries || this._otoEntries.length <= 1) {
      return null;
    }

    return html`
      <div class="entry-tabs" role="tablist" aria-label="Oto aliases">
        ${this._otoEntries.map(
          (entry, index) => html`
            <button
              class="entry-tab ${index === this._selectedEntryIndex ? 'active' : ''}"
              role="tab"
              aria-selected=${index === this._selectedEntryIndex}
              aria-label="${entry.alias || `Entry ${index + 1}`}"
              @click=${() => this._selectEntry(index)}
            >
              ${entry.alias || `Entry ${index + 1}`}
            </button>
          `
        )}
        <button class="entry-tab add-tab" aria-label="Add new alias" @click=${this._addEntry}>
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

  // ==================== Main Render ====================

  render() {
    const progress = this._getProgressCounts();

    return html`
      <div class="editor-layout" role="main" aria-label="Oto parameter editor">
        <!-- Headless sub-components for audio and oto management -->
        <uvm-audio-manager
          .voicebankId=${this._currentVoicebankId}
          .filename=${this._currentFilename}
          @audio-loaded=${this._onAudioLoaded}
        ></uvm-audio-manager>

        <uvm-oto-manager
          .voicebankId=${this._currentVoicebankId}
          .filename=${this._currentFilename}
          .audioBuffer=${this._audioBuffer}
          @oto-entries-loaded=${this._onEntriesLoaded}
          @oto-entry-changed=${this._onEntryChanged}
          @oto-entry-saved=${this._onEntrySaved}
          @oto-detected=${this._onOtoDetected}
          @oto-error=${this._onOtoError}
        ></uvm-oto-manager>

        <!-- Keyboard shortcut handler and status indicator -->
        <uvm-editor-toolbar
          .hasSample=${!!this._currentFilename}
          .isDetecting=${this._isDetecting}
          .isDirty=${this._isDirty}
          .isSaving=${this._isSaving}
          .saveSuccess=${this._saveSuccess}
          .loadingEntries=${this._loadingEntries}
          .lastConfidence=${this._lastConfidence}
          @editor-toolbar:previous-sample=${this._onToolbarPreviousSample}
          @editor-toolbar:next-sample=${this._onToolbarNextSample}
          @editor-toolbar:toggle-precision=${this._onToolbarTogglePrecision}
          @editor-toolbar:detect=${this._onToolbarDetect}
          @editor-toolbar:show-shortcuts=${this._onToolbarShowShortcuts}
          @editor-toolbar:save=${this._onToolbarSave}
        ></uvm-editor-toolbar>

        <uvm-context-bar
          .voicebankName=${this._getVoicebankName()}
          .sampleName=${this._currentFilename || ''}
          .canUndo=${this._otoManager?.canUndo ?? false}
          .canRedo=${this._otoManager?.canRedo ?? false}
          .hasUnsavedChanges=${this._isDirty}
          .saving=${this._isSaving}
          .autoAdvance=${this._autoAdvance}
          .progressConfigured=${progress.configured}
          .progressTotal=${progress.total}
          .detecting=${this._isDetecting}
          .detectDisabled=${!this._currentFilename}
          .alignmentTightness=${this._otoManager?.alignmentTightness ?? 0.5}
          .alignmentMethodOverride=${this._otoManager?.alignmentMethodOverride ?? null}
          .availableAlignmentMethods=${this._otoManager?.availableAlignmentMethods ?? []}
          @uvm-context-bar:browse=${this._openBrowser}
          @uvm-context-bar:undo=${this._onContextBarUndo}
          @uvm-context-bar:redo=${this._onContextBarRedo}
          @uvm-context-bar:save=${this._onContextBarSave}
          @uvm-context-bar:auto-advance-toggle=${this._onAutoAdvanceToggle}
          @uvm-context-bar:metadata=${this._openMetadata}
          @uvm-context-bar:detect=${this._onContextBarDetect}
          @uvm-context-bar:alignment-change=${this._onAlignmentChange}
        ></uvm-context-bar>

        ${this._renderEntryTabs()}

        ${this._currentFilename
          ? html`
              <div class="waveform-area">
                <div class="waveform-section">
                  ${this._renderWaveform()}
                </div>

                <uvm-value-bar
                  .offset=${this._currentEntry?.offset ?? 0}
                  .consonant=${this._currentEntry?.consonant ?? 0}
                  .cutoff=${this._currentEntry?.cutoff ?? 0}
                  .preutterance=${this._currentEntry?.preutterance ?? 0}
                  .overlap=${this._currentEntry?.overlap ?? 0}
                ></uvm-value-bar>

                <uvm-validation-warnings
                  .warnings=${this._validationWarnings}
                ></uvm-validation-warnings>

                <uvm-precision-drawer
                  ?open=${this._showPrecision}
                  .offset=${this._currentEntry?.offset ?? 0}
                  .consonant=${this._currentEntry?.consonant ?? 0}
                  .cutoff=${this._currentEntry?.cutoff ?? 0}
                  .preutterance=${this._currentEntry?.preutterance ?? 0}
                  .overlap=${this._currentEntry?.overlap ?? 0}
                  .warningParameters=${this._warningParameterSet}
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
