import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/button-group/button-group.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/badge/badge.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/checkbox/checkbox.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/progress-bar/progress-bar.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';

import './uvm-waveform-canvas.js';
import { api, getDefaultApiUrl } from '../services/api.js';
import { getSharedAudioContext } from '../services/audio-context.js';
import { UvmToastManager } from './uvm-toast-manager.js';
import type { OtoEntry } from '../services/types.js';

/**
 * Filter options for the sample list.
 */
type SampleFilter = 'all' | 'configured' | 'pending' | 'low-confidence';

/**
 * Sort options for the sample list.
 */
type SampleSort = 'name' | 'status' | 'confidence';

/**
 * Sample validation information.
 */
interface SampleValidationInfo {
  filename: string;
  hasOto: boolean;
  entry: OtoEntry | null;
  confidence: number | null;
  selected: boolean;
}

/**
 * Validation view for reviewing and exporting voicebank configurations.
 *
 * Provides a split-view interface with:
 * - Left: Scrollable list of samples with filters
 * - Right: Waveform preview of selected sample with oto markers
 *
 * @fires uvm-validation-view:edit - Fired when user wants to edit a sample
 *
 * @example
 * ```html
 * <uvm-validation-view
 *   voicebankId="my-voicebank"
 *   @uvm-validation-view:edit=${this._onEditSample}
 * ></uvm-validation-view>
 * ```
 */
@customElement('uvm-validation-view')
export class UvmValidationView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--uvm-background, #ffffff);
    }

    /* Header */
    .validation-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.5rem;
      background-color: var(--uvm-surface, #fafafa);
      border-bottom: 1px solid var(--uvm-border, #e5e7eb);
      flex-shrink: 0;
    }

    .header-title {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .header-title h1 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--uvm-primary, #1f2937);
    }

    .header-title sl-icon {
      font-size: 1.5rem;
      color: var(--sl-color-primary-600, #2563eb);
    }

    .header-stats {
      display: flex;
      align-items: center;
      gap: 1.5rem;
    }

    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.125rem;
    }

    .stat-value {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--uvm-primary, #1f2937);
    }

    .stat-label {
      font-size: 0.6875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--uvm-secondary, #6b7280);
    }

    .stat-value.configured {
      color: var(--uvm-success, #22c55e);
    }

    .stat-value.pending {
      color: var(--uvm-warning, #f59e0b);
    }

    .header-actions {
      display: flex;
      gap: 0.5rem;
    }

    /* Main content */
    .validation-content {
      flex: 1;
      display: flex;
      min-height: 0;
      overflow: hidden;
    }

    /* Left panel: sample list */
    .sample-list-panel {
      flex: 0 0 380px;
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--uvm-border, #e5e7eb);
      min-height: 0;
    }

    .list-toolbar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      background-color: var(--uvm-surface, #fafafa);
      border-bottom: 1px solid var(--uvm-border, #e5e7eb);
      flex-shrink: 0;
    }

    .list-toolbar sl-input {
      flex: 1;
    }

    .list-toolbar sl-input::part(base) {
      border-radius: 6px;
    }

    .list-toolbar sl-select::part(combobox) {
      min-width: 120px;
    }

    .list-filters {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background-color: var(--uvm-background, #ffffff);
      border-bottom: 1px solid var(--uvm-border, #e5e7eb);
      flex-shrink: 0;
    }

    .filter-btn {
      padding: 0.375rem 0.75rem;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--uvm-secondary, #6b7280);
      background: none;
      border: 1px solid transparent;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .filter-btn:hover {
      background-color: var(--uvm-surface, #f3f4f6);
    }

    .filter-btn.active {
      color: var(--sl-color-primary-600, #2563eb);
      background-color: #eff6ff;
      border-color: var(--sl-color-primary-200, #bfdbfe);
    }

    .filter-count {
      margin-left: 0.25rem;
      font-weight: 400;
      color: var(--uvm-secondary, #9ca3af);
    }

    .list-scroll {
      flex: 1;
      overflow-y: auto;
      min-height: 0;
    }

    .sample-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--uvm-border, #f3f4f6);
      cursor: pointer;
      transition: background-color 0.15s ease;
    }

    .sample-item:hover {
      background-color: var(--uvm-surface, #f9fafb);
    }

    .sample-item.selected {
      background-color: #eff6ff;
      border-left: 3px solid var(--sl-color-primary-600, #3b82f6);
      padding-left: calc(1rem - 3px);
    }

    .sample-checkbox {
      flex-shrink: 0;
    }

    .sample-info {
      flex: 1;
      min-width: 0;
    }

    .sample-name {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--uvm-primary, #1f2937);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .sample-meta {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.25rem;
      font-size: 0.75rem;
      color: var(--uvm-secondary, #9ca3af);
    }

    .sample-status {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .status-dot.configured {
      background-color: var(--uvm-success, #22c55e);
    }

    .status-dot.pending {
      background-color: var(--uvm-secondary, #d1d5db);
    }

    .confidence-badge {
      font-size: 0.6875rem;
      padding: 0.125rem 0.375rem;
      border-radius: 9999px;
    }

    .confidence-badge.high {
      background-color: #dcfce7;
      color: #166534;
    }

    .confidence-badge.medium {
      background-color: #fef3c7;
      color: #92400e;
    }

    .confidence-badge.low {
      background-color: #fee2e2;
      color: #991b1b;
    }

    /* Right panel: preview */
    .preview-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
    }

    .preview-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      background-color: var(--uvm-surface, #fafafa);
      border-bottom: 1px solid var(--uvm-border, #e5e7eb);
      flex-shrink: 0;
    }

    .preview-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--uvm-primary, #374151);
    }

    .preview-alias {
      font-size: 0.75rem;
      color: var(--uvm-secondary, #6b7280);
      margin-left: 0.5rem;
    }

    .preview-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 1rem;
      gap: 1rem;
      min-height: 0;
      overflow: auto;
    }

    .waveform-preview {
      flex-shrink: 0;
      height: 200px;
      background: var(--uvm-surface, #fafafa);
      border: 1px solid var(--uvm-border, #e5e7eb);
      border-radius: 8px;
      overflow: hidden;
      position: relative;
    }

    .waveform-preview uvm-waveform-canvas {
      width: 100%;
      height: 100%;
    }

    /* Marker overlay */
    .marker-overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }

    .marker-line {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      opacity: 0.8;
    }

    .marker-line.offset {
      background-color: var(--uvm-marker-offset, #22c55e);
    }

    .marker-line.consonant {
      background-color: var(--uvm-marker-consonant, #3b82f6);
    }

    .marker-line.cutoff {
      background-color: var(--uvm-marker-cutoff, #ef4444);
    }

    .marker-line.preutterance {
      background-color: var(--uvm-marker-preutterance, #a855f7);
    }

    .marker-line.overlap {
      background-color: var(--uvm-marker-overlap, #f97316);
    }

    /* Parameters table */
    .parameters-section {
      flex-shrink: 0;
    }

    .parameters-title {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--uvm-primary, #374151);
      margin-bottom: 0.75rem;
    }

    .parameters-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 0.75rem;
    }

    .param-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0.75rem;
      background: var(--uvm-surface, #fafafa);
      border: 1px solid var(--uvm-border, #e5e7eb);
      border-radius: 6px;
    }

    .param-label {
      font-size: 0.6875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--uvm-secondary, #6b7280);
      margin-bottom: 0.25rem;
    }

    .param-value {
      font-size: 1rem;
      font-weight: 500;
      font-family: var(--uvm-font-mono, monospace);
      color: var(--uvm-primary, #1f2937);
    }

    /* Empty state */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem;
      text-align: center;
      color: var(--uvm-secondary, #6b7280);
      flex: 1;
    }

    .empty-state sl-icon {
      font-size: 4rem;
      color: var(--uvm-border, #d1d5db);
      margin-bottom: 1rem;
    }

    .empty-state-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--uvm-primary, #374151);
      margin-bottom: 0.5rem;
    }

    .empty-state-text {
      font-size: 0.875rem;
      max-width: 300px;
    }

    /* Loading state */
    .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem;
      gap: 1rem;
      flex: 1;
    }

    .loading-state sl-spinner {
      font-size: 2rem;
      --indicator-color: var(--sl-color-primary-600, #3b82f6);
    }

    .loading-text {
      font-size: 0.875rem;
      color: var(--uvm-secondary, #6b7280);
    }

    /* Bulk actions bar */
    .bulk-actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      background-color: #eff6ff;
      border-top: 1px solid var(--sl-color-primary-200, #bfdbfe);
      flex-shrink: 0;
    }

    .bulk-actions-text {
      font-size: 0.8125rem;
      color: var(--sl-color-primary-700, #1d4ed8);
    }

    .bulk-actions sl-button {
      --sl-button-font-size-small: 0.75rem;
    }

    /* Progress section */
    .progress-section {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem 1rem;
      background-color: var(--uvm-surface, #fafafa);
      border-top: 1px solid var(--uvm-border, #e5e7eb);
      flex-shrink: 0;
    }

    .progress-text {
      font-size: 0.8125rem;
      color: var(--uvm-secondary, #6b7280);
      white-space: nowrap;
    }

    .progress-bar-wrapper {
      flex: 1;
    }

    sl-progress-bar {
      --height: 8px;
      --indicator-color: var(--uvm-success, #22c55e);
    }

    .progress-percentage {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--uvm-primary, #374151);
      min-width: 48px;
      text-align: right;
    }
  `;

  /**
   * Voicebank identifier.
   */
  @property({ type: String })
  voicebankId = '';

  /**
   * Current filter selection.
   */
  @state()
  private _filter: SampleFilter = 'all';

  /**
   * Current sort selection.
   */
  @state()
  private _sort: SampleSort = 'name';

  /**
   * Search query.
   */
  @state()
  private _searchQuery = '';

  /**
   * All samples with validation info.
   */
  @state()
  private _samples: SampleValidationInfo[] = [];

  /**
   * Currently selected sample filename.
   */
  @state()
  private _selectedSample: string | null = null;

  /**
   * Loading state.
   */
  @state()
  private _loading = false;

  /**
   * Audio buffer for preview.
   */
  @state()
  private _audioBuffer: AudioBuffer | null = null;

  /**
   * Audio context for decoding.
   */
  @state()
  private _audioContext: AudioContext | null = null;

  /**
   * Loading audio state.
   */
  @state()
  private _loadingAudio = false;

  /**
   * Audio duration in milliseconds.
   */
  @state()
  private _audioDurationMs = 0;

  connectedCallback(): void {
    super.connectedCallback();
    if (this.voicebankId) {
      this._loadData();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._cleanupAudioContext();
  }

  updated(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('voicebankId') && this.voicebankId) {
      this._loadData();
    }
  }

  private _cleanupAudioContext(): void {
    // Release reference to shared AudioContext (do not close -- it is shared)
    this._audioContext = null;
  }

  /**
   * Load samples and oto entries.
   */
  private async _loadData(): Promise<void> {
    if (!this.voicebankId) return;

    this._loading = true;
    this._samples = [];
    this._selectedSample = null;

    try {
      const [sampleFiles, otoEntries] = await Promise.all([
        api.listSamples(this.voicebankId),
        api.getOtoEntries(this.voicebankId),
      ]);

      // Build map of filename to oto entry
      const otoMap = new Map<string, OtoEntry>();
      for (const entry of otoEntries) {
        // Use first entry per file for now
        if (!otoMap.has(entry.filename)) {
          otoMap.set(entry.filename, entry);
        }
      }

      // Create validation info for each sample
      this._samples = sampleFiles.map(filename => ({
        filename,
        hasOto: otoMap.has(filename),
        entry: otoMap.get(filename) || null,
        confidence: null, // We don't have confidence stored, could be added later
        selected: false,
      }));

      // Select first sample if available
      if (this._samples.length > 0) {
        this._selectedSample = this._samples[0].filename;
        this._loadSampleAudio(this._samples[0].filename);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
      UvmToastManager.error('Failed to load voicebank data');
    } finally {
      this._loading = false;
    }
  }

  /**
   * Load audio for a sample.
   */
  private async _loadSampleAudio(filename: string): Promise<void> {
    if (!this.voicebankId) return;

    this._loadingAudio = true;
    this._audioBuffer = null;

    try {
      if (!this._audioContext) {
        this._audioContext = getSharedAudioContext();
      }

      if (this._audioContext.state === 'suspended') {
        await this._audioContext.resume();
      }

      this._audioBuffer = await api.loadSampleAsAudioBuffer(
        this.voicebankId,
        filename,
        this._audioContext
      );

      this._audioDurationMs = this._audioBuffer.duration * 1000;
    } catch (error) {
      console.error('Failed to load audio:', error);
    } finally {
      this._loadingAudio = false;
    }
  }

  /**
   * Get filtered and sorted samples.
   */
  private _getFilteredSamples(): SampleValidationInfo[] {
    let filtered = [...this._samples];

    // Apply search filter
    if (this._searchQuery.trim()) {
      const query = this._searchQuery.toLowerCase().trim();
      filtered = filtered.filter(s =>
        s.filename.toLowerCase().includes(query) ||
        s.entry?.alias.toLowerCase().includes(query)
      );
    }

    // Apply status filter
    switch (this._filter) {
      case 'configured':
        filtered = filtered.filter(s => s.hasOto);
        break;
      case 'pending':
        filtered = filtered.filter(s => !s.hasOto);
        break;
      case 'low-confidence':
        filtered = filtered.filter(s => s.confidence !== null && s.confidence < 0.5);
        break;
    }

    // Apply sort
    switch (this._sort) {
      case 'name':
        filtered.sort((a, b) => a.filename.localeCompare(b.filename));
        break;
      case 'status':
        filtered.sort((a, b) => {
          if (a.hasOto === b.hasOto) return a.filename.localeCompare(b.filename);
          return a.hasOto ? -1 : 1;
        });
        break;
      case 'confidence':
        filtered.sort((a, b) => {
          const aConf = a.confidence ?? 1;
          const bConf = b.confidence ?? 1;
          if (aConf === bConf) return a.filename.localeCompare(b.filename);
          return aConf - bConf; // Low confidence first
        });
        break;
    }

    return filtered;
  }

  /**
   * Get the currently selected sample info.
   */
  private _getSelectedSampleInfo(): SampleValidationInfo | null {
    if (!this._selectedSample) return null;
    return this._samples.find(s => s.filename === this._selectedSample) || null;
  }

  /**
   * Get filter counts.
   */
  private _getFilterCounts() {
    const all = this._samples.length;
    const configured = this._samples.filter(s => s.hasOto).length;
    const pending = this._samples.filter(s => !s.hasOto).length;
    const lowConfidence = this._samples.filter(s => s.confidence !== null && s.confidence < 0.5).length;

    return { all, configured, pending, lowConfidence };
  }

  /**
   * Get selected samples count.
   */
  private _getSelectedCount(): number {
    return this._samples.filter(s => s.selected).length;
  }

  /**
   * Select a sample.
   */
  private _selectSample(filename: string): void {
    this._selectedSample = filename;
    this._loadSampleAudio(filename);
  }

  /**
   * Toggle sample selection for bulk actions.
   */
  private _toggleSampleSelection(filename: string, e: Event): void {
    e.stopPropagation();
    const sample = this._samples.find(s => s.filename === filename);
    if (sample) {
      sample.selected = !sample.selected;
      this._samples = [...this._samples];
    }
  }

  /**
   * Select all visible samples.
   */
  private _selectAll(): void {
    const filtered = this._getFilteredSamples();
    for (const sample of this._samples) {
      sample.selected = filtered.some(f => f.filename === sample.filename);
    }
    this._samples = [...this._samples];
  }

  /**
   * Deselect all samples.
   */
  private _deselectAll(): void {
    for (const sample of this._samples) {
      sample.selected = false;
    }
    this._samples = [...this._samples];
  }

  /**
   * Edit a sample in the main editor.
   */
  private _editSample(filename: string): void {
    this.dispatchEvent(
      new CustomEvent('uvm-validation-view:edit', {
        detail: {
          voicebankId: this.voicebankId,
          filename,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Export oto.ini file.
   */
  private _exportOto(): void {
    if (!this.voicebankId) return;

    const downloadUrl = `${getDefaultApiUrl()}/voicebanks/${encodeURIComponent(this.voicebankId)}/oto/export`;

    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = 'oto.ini';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    UvmToastManager.success('oto.ini exported');
  }

  /**
   * Calculate marker position as percentage.
   */
  private _getMarkerPosition(value: number, isCutoff = false): string {
    if (this._audioDurationMs <= 0) return '0%';

    let positionMs = value;
    if (isCutoff && value < 0) {
      positionMs = this._audioDurationMs + value;
    }

    const percent = (positionMs / this._audioDurationMs) * 100;
    return `${Math.max(0, Math.min(100, percent))}%`;
  }

  /**
   * Render the header.
   */
  private _renderHeader() {
    const counts = this._getFilterCounts();

    return html`
      <div class="validation-header">
        <div class="header-title">
          <sl-icon name="clipboard-check"></sl-icon>
          <h1>Validation & Export</h1>
        </div>

        <div class="header-stats">
          <div class="stat-item">
            <span class="stat-value configured">${counts.configured}</span>
            <span class="stat-label">Configured</span>
          </div>
          <div class="stat-item">
            <span class="stat-value pending">${counts.pending}</span>
            <span class="stat-label">Pending</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${counts.all}</span>
            <span class="stat-label">Total</span>
          </div>
        </div>

        <div class="header-actions">
          <sl-tooltip content="Export oto.ini">
            <sl-button variant="primary" @click=${this._exportOto}>
              <sl-icon slot="prefix" name="download"></sl-icon>
              Export oto.ini
            </sl-button>
          </sl-tooltip>
        </div>
      </div>
    `;
  }

  /**
   * Render the sample list panel.
   */
  private _renderSampleListPanel() {
    const counts = this._getFilterCounts();
    const filtered = this._getFilteredSamples();
    const selectedCount = this._getSelectedCount();

    return html`
      <div class="sample-list-panel">
        <div class="list-toolbar">
          <sl-input
            placeholder="Search samples..."
            .value=${this._searchQuery}
            @sl-input=${(e: Event) => {
              const input = e.target as HTMLInputElement;
              this._searchQuery = input.value;
            }}
            clearable
          >
            <sl-icon name="search" slot="prefix"></sl-icon>
          </sl-input>
          <sl-select
            size="small"
            .value=${this._sort}
            @sl-change=${(e: Event) => {
              const select = e.target as HTMLSelectElement;
              this._sort = select.value as SampleSort;
            }}
          >
            <sl-option value="name">Name</sl-option>
            <sl-option value="status">Status</sl-option>
            <sl-option value="confidence">Confidence</sl-option>
          </sl-select>
        </div>

        <div class="list-filters">
          <button
            class="filter-btn ${this._filter === 'all' ? 'active' : ''}"
            @click=${() => (this._filter = 'all')}
          >
            All<span class="filter-count">${counts.all}</span>
          </button>
          <button
            class="filter-btn ${this._filter === 'configured' ? 'active' : ''}"
            @click=${() => (this._filter = 'configured')}
          >
            Configured<span class="filter-count">${counts.configured}</span>
          </button>
          <button
            class="filter-btn ${this._filter === 'pending' ? 'active' : ''}"
            @click=${() => (this._filter = 'pending')}
          >
            Pending<span class="filter-count">${counts.pending}</span>
          </button>
        </div>

        <div class="list-scroll">
          ${filtered.length === 0
            ? html`
                <div class="empty-state">
                  <sl-icon name="search"></sl-icon>
                  <div class="empty-state-text">No samples match your filters</div>
                </div>
              `
            : filtered.map(sample => html`
                <div
                  class="sample-item ${this._selectedSample === sample.filename ? 'selected' : ''}"
                  @click=${() => this._selectSample(sample.filename)}
                >
                  <sl-checkbox
                    class="sample-checkbox"
                    ?checked=${sample.selected}
                    @sl-change=${(e: Event) => this._toggleSampleSelection(sample.filename, e)}
                  ></sl-checkbox>
                  <div class="sample-info">
                    <div class="sample-name">${sample.filename.replace(/\.wav$/i, '')}</div>
                    <div class="sample-meta">
                      <div class="sample-status">
                        <span class="status-dot ${sample.hasOto ? 'configured' : 'pending'}"></span>
                        ${sample.hasOto ? 'Configured' : 'Pending'}
                      </div>
                      ${sample.entry?.alias
                        ? html`<span>| ${sample.entry.alias}</span>`
                        : nothing}
                    </div>
                  </div>
                </div>
              `)}
        </div>

        ${selectedCount > 0
          ? html`
              <div class="bulk-actions">
                <span class="bulk-actions-text">${selectedCount} selected</span>
                <sl-button size="small" @click=${this._selectAll}>Select All</sl-button>
                <sl-button size="small" @click=${this._deselectAll}>Deselect All</sl-button>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  /**
   * Render the preview panel.
   */
  private _renderPreviewPanel() {
    const sample = this._getSelectedSampleInfo();

    if (!sample) {
      return html`
        <div class="preview-panel">
          <div class="empty-state">
            <sl-icon name="music-note-beamed"></sl-icon>
            <div class="empty-state-title">No Sample Selected</div>
            <div class="empty-state-text">
              Select a sample from the list to preview its configuration.
            </div>
          </div>
        </div>
      `;
    }

    return html`
      <div class="preview-panel">
        <div class="preview-header">
          <div>
            <span class="preview-title">${sample.filename}</span>
            ${sample.entry?.alias
              ? html`<span class="preview-alias">${sample.entry.alias}</span>`
              : nothing}
          </div>
          <sl-button size="small" variant="primary" @click=${() => this._editSample(sample.filename)}>
            <sl-icon slot="prefix" name="pencil"></sl-icon>
            Edit
          </sl-button>
        </div>

        <div class="preview-content">
          ${this._loadingAudio
            ? html`
                <div class="loading-state">
                  <sl-spinner></sl-spinner>
                  <span class="loading-text">Loading audio...</span>
                </div>
              `
            : html`
                <div class="waveform-preview">
                  <uvm-waveform-canvas
                    .audioBuffer=${this._audioBuffer}
                    height=${200}
                  ></uvm-waveform-canvas>
                  ${sample.entry
                    ? html`
                        <div class="marker-overlay">
                          <div class="marker-line offset" style="left: ${this._getMarkerPosition(sample.entry.offset)}"></div>
                          <div class="marker-line consonant" style="left: ${this._getMarkerPosition(sample.entry.consonant)}"></div>
                          <div class="marker-line preutterance" style="left: ${this._getMarkerPosition(sample.entry.preutterance)}"></div>
                          <div class="marker-line overlap" style="left: ${this._getMarkerPosition(sample.entry.overlap)}"></div>
                          <div class="marker-line cutoff" style="left: ${this._getMarkerPosition(sample.entry.cutoff, true)}"></div>
                        </div>
                      `
                    : nothing}
                </div>

                ${sample.entry
                  ? html`
                      <div class="parameters-section">
                        <div class="parameters-title">Current Parameters</div>
                        <div class="parameters-grid">
                          <div class="param-box">
                            <span class="param-label" style="color: var(--uvm-marker-offset)">Offset</span>
                            <span class="param-value">${Math.round(sample.entry.offset)}</span>
                          </div>
                          <div class="param-box">
                            <span class="param-label" style="color: var(--uvm-marker-consonant)">Consonant</span>
                            <span class="param-value">${Math.round(sample.entry.consonant)}</span>
                          </div>
                          <div class="param-box">
                            <span class="param-label" style="color: var(--uvm-marker-preutterance)">Preutt</span>
                            <span class="param-value">${Math.round(sample.entry.preutterance)}</span>
                          </div>
                          <div class="param-box">
                            <span class="param-label" style="color: var(--uvm-marker-overlap)">Overlap</span>
                            <span class="param-value">${Math.round(sample.entry.overlap)}</span>
                          </div>
                          <div class="param-box">
                            <span class="param-label" style="color: var(--uvm-marker-cutoff)">Cutoff</span>
                            <span class="param-value">${Math.round(sample.entry.cutoff)}</span>
                          </div>
                        </div>
                      </div>
                    `
                  : html`
                      <div class="empty-state">
                        <sl-icon name="exclamation-circle"></sl-icon>
                        <div class="empty-state-title">Not Configured</div>
                        <div class="empty-state-text">
                          This sample doesn't have oto parameters yet.
                          Click Edit to configure it.
                        </div>
                      </div>
                    `}
              `}
        </div>
      </div>
    `;
  }

  /**
   * Render progress section.
   */
  private _renderProgress() {
    const counts = this._getFilterCounts();
    const progress = counts.all > 0 ? (counts.configured / counts.all) * 100 : 0;

    return html`
      <div class="progress-section">
        <span class="progress-text">${counts.configured} of ${counts.all} configured</span>
        <div class="progress-bar-wrapper">
          <sl-progress-bar value=${progress}></sl-progress-bar>
        </div>
        <span class="progress-percentage">${Math.round(progress)}%</span>
      </div>
    `;
  }

  render() {
    if (this._loading) {
      return html`
        <div class="loading-state">
          <sl-spinner></sl-spinner>
          <span class="loading-text">Loading voicebank data...</span>
        </div>
      `;
    }

    return html`
      ${this._renderHeader()}
      <div class="validation-content">
        ${this._renderSampleListPanel()}
        ${this._renderPreviewPanel()}
      </div>
      ${this._renderProgress()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-validation-view': UvmValidationView;
  }
}
