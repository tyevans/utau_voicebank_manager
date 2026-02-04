import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/progress-bar/progress-bar.js';
import '@shoelace-style/shoelace/dist/components/badge/badge.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';

import './uvm-waveform-canvas.js';
import { api, ApiError } from '../services/api.js';
import { getSharedAudioContext } from '../services/audio-context.js';
import { UvmToastManager } from './uvm-toast-manager.js';

/**
 * Individual batch result with review status.
 */
export interface BatchSampleResult {
  filename: string;
  alias: string;
  confidence: number;
  offset: number;
  consonant: number;
  cutoff: number;
  preutterance: number;
  overlap: number;
  /** Review status: pending, accepted, adjusted, skipped */
  status: 'pending' | 'accepted' | 'adjusted' | 'skipped';
}

/**
 * Event detail for when a batch review is completed.
 */
export interface BatchReviewCompleteDetail {
  accepted: number;
  adjusted: number;
  skipped: number;
  total: number;
}

/**
 * Batch review modal for reviewing auto-detected oto entries.
 *
 * Displays results sorted by confidence (lowest first) and allows the user
 * to accept, adjust, or skip each entry. Includes a mini waveform preview
 * with suggested markers.
 *
 * @fires uvm-batch-review:complete - Fired when review is finished
 * @fires uvm-batch-review:close - Fired when modal is closed
 * @fires uvm-batch-review:adjust - Fired when user wants to adjust an entry in full editor
 *
 * @example
 * ```html
 * <uvm-batch-review
 *   voicebankId="my-voicebank"
 *   .results=${batchResults}
 *   ?open=${this._showReview}
 *   @uvm-batch-review:complete=${this._onReviewComplete}
 *   @uvm-batch-review:close=${() => this._showReview = false}
 * ></uvm-batch-review>
 * ```
 */
@customElement('uvm-batch-review')
export class UvmBatchReview extends LitElement {
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
      z-index: 1100;
    }

    .backdrop {
      position: absolute;
      inset: 0;
      background-color: rgba(0, 0, 0, 0.6);
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
      width: min(1100px, 95vw);
      max-height: 90vh;
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
      gap: 1rem;
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

    .header-actions {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .modal-body {
      flex: 1;
      display: flex;
      gap: 1rem;
      padding: 1rem;
      min-height: 0;
      overflow: hidden;
    }

    /* Left sidebar: sample list */
    .sample-list-panel {
      flex: 0 0 280px;
      display: flex;
      flex-direction: column;
      background: var(--uvm-background, #ffffff);
      border: 1px solid var(--uvm-border, #e5e7eb);
      border-radius: 8px;
      overflow: hidden;
    }

    .sample-list-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      background-color: var(--uvm-surface, #fafafa);
      border-bottom: 1px solid var(--uvm-border, #e5e7eb);
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--uvm-primary, #374151);
    }

    .sample-list-scroll {
      flex: 1;
      overflow-y: auto;
      min-height: 0;
    }

    .sample-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.625rem 1rem;
      border-bottom: 1px solid var(--uvm-border, #f3f4f6);
      cursor: pointer;
      transition: background-color 0.15s ease;
    }

    .sample-item:hover {
      background-color: var(--uvm-surface, #f9fafb);
    }

    .sample-item.active {
      background-color: #eff6ff;
      border-left: 3px solid var(--sl-color-primary-600, #3b82f6);
      padding-left: calc(1rem - 3px);
    }

    .sample-item.reviewed {
      opacity: 0.6;
    }

    .sample-item.reviewed.accepted .status-icon {
      color: var(--uvm-success, #22c55e);
    }

    .sample-item.reviewed.adjusted .status-icon {
      color: var(--sl-color-primary-600, #2563eb);
    }

    .sample-item.reviewed.skipped .status-icon {
      color: var(--uvm-secondary, #9ca3af);
    }

    .sample-info {
      flex: 1;
      min-width: 0;
    }

    .sample-name {
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--uvm-primary, #1f2937);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .sample-confidence {
      font-size: 0.6875rem;
      color: var(--uvm-secondary, #9ca3af);
      margin-top: 0.125rem;
    }

    .confidence-low {
      color: var(--uvm-warning, #f59e0b);
    }

    .confidence-high {
      color: var(--uvm-success, #22c55e);
    }

    .status-icon {
      font-size: 1rem;
      flex-shrink: 0;
    }

    /* Right panel: preview and actions */
    .preview-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: var(--uvm-background, #ffffff);
      border: 1px solid var(--uvm-border, #e5e7eb);
      border-radius: 8px;
      overflow: hidden;
      min-width: 0;
    }

    .preview-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      background-color: var(--uvm-surface, #fafafa);
      border-bottom: 1px solid var(--uvm-border, #e5e7eb);
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
      min-height: 0;
      padding: 1rem;
      gap: 1rem;
    }

    .waveform-preview {
      flex: 1;
      min-height: 150px;
      max-height: 200px;
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

    /* Marker overlay on waveform */
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

    /* Parameters display */
    .parameters-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 0.75rem;
    }

    .param-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0.625rem;
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
      font-size: 0.875rem;
      font-weight: 500;
      font-family: var(--uvm-font-mono, monospace);
      color: var(--uvm-primary, #1f2937);
    }

    /* Action buttons */
    .action-buttons {
      display: flex;
      gap: 0.75rem;
      padding-top: 0.5rem;
    }

    .action-buttons sl-button {
      flex: 1;
    }

    /* Progress bar */
    .progress-section {
      padding: 0.75rem 1rem;
      background-color: var(--uvm-surface, #fafafa);
      border-top: 1px solid var(--uvm-border, #e5e7eb);
    }

    .progress-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
      font-size: 0.8125rem;
    }

    .progress-text {
      color: var(--uvm-secondary, #6b7280);
    }

    .progress-stats {
      display: flex;
      gap: 1rem;
      font-size: 0.75rem;
    }

    .progress-stat {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .stat-accepted {
      color: var(--uvm-success, #22c55e);
    }

    .stat-adjusted {
      color: var(--sl-color-primary-600, #2563eb);
    }

    .stat-skipped {
      color: var(--uvm-secondary, #9ca3af);
    }

    sl-progress-bar {
      --height: 6px;
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
    }

    .empty-state sl-icon {
      font-size: 3rem;
      color: var(--uvm-border, #d1d5db);
      margin-bottom: 1rem;
    }

    .empty-state-text {
      font-size: 0.875rem;
      max-width: 280px;
    }

    /* Loading state */
    .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem;
      gap: 1rem;
    }

    .loading-state sl-spinner {
      font-size: 2rem;
      --indicator-color: var(--sl-color-primary-600, #3b82f6);
    }

    .loading-text {
      font-size: 0.875rem;
      color: var(--uvm-secondary, #6b7280);
    }

    /* Keyboard hint */
    .keyboard-hint {
      padding: 0.5rem 1rem;
      font-size: 0.6875rem;
      color: var(--uvm-secondary, #9ca3af);
      background-color: var(--uvm-surface, #fafafa);
      border-top: 1px solid var(--uvm-border, #e5e7eb);
      text-align: center;
    }

    .keyboard-hint kbd {
      display: inline-block;
      padding: 0.125rem 0.375rem;
      font-family: var(--uvm-font-mono, monospace);
      font-size: 0.625rem;
      font-weight: 500;
      color: var(--uvm-primary, #374151);
      background-color: var(--uvm-background, #ffffff);
      border: 1px solid var(--uvm-border, #d1d5db);
      border-radius: 4px;
      box-shadow: 0 1px 0 var(--uvm-border, #d1d5db);
      margin: 0 0.125rem;
    }
  `;

  /**
   * Voicebank identifier for loading audio.
   */
  @property({ type: String })
  voicebankId = '';

  /**
   * Batch results to review.
   */
  @property({ attribute: false })
  results: BatchSampleResult[] = [];

  /**
   * Whether the modal is open.
   */
  @property({ type: Boolean, reflect: true })
  open = false;

  /**
   * Currently selected sample index.
   */
  @state()
  private _currentIndex = 0;

  /**
   * Audio buffer for the current sample.
   */
  @state()
  private _audioBuffer: AudioBuffer | null = null;

  /**
   * Audio context for decoding audio.
   */
  @state()
  private _audioContext: AudioContext | null = null;

  /**
   * Loading state for audio.
   */
  @state()
  private _loadingAudio = false;

  /**
   * Duration of current audio in milliseconds.
   */
  @state()
  private _audioDurationMs = 0;

  /**
   * Saving state for current entry.
   */
  @state()
  private _saving = false;

  /**
   * Internal mutable copy of results.
   */
  @state()
  private _internalResults: BatchSampleResult[] = [];

  connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('keydown', this._handleKeyDown);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this._handleKeyDown);
    this._cleanupAudioContext();
  }

  updated(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('results')) {
      // Sort by confidence ascending (lowest first for review)
      this._internalResults = [...this.results].sort(
        (a, b) => a.confidence - b.confidence
      );
      this._currentIndex = 0;
    }

    if (changedProperties.has('open') && this.open && this._internalResults.length > 0) {
      this._loadCurrentSample();
    }
  }

  private _handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.open) return;

    // Don't handle if in input
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        this._close();
        break;
      case 'a':
      case 'Enter':
        e.preventDefault();
        this._acceptCurrent();
        break;
      case 'e':
        e.preventDefault();
        this._adjustCurrent();
        break;
      case 's':
      case 'Tab':
        e.preventDefault();
        this._skipCurrent();
        break;
      case 'ArrowUp':
      case 'k':
        e.preventDefault();
        this._navigatePrevious();
        break;
      case 'ArrowDown':
      case 'j':
        e.preventDefault();
        this._navigateNext();
        break;
    }
  };

  private _cleanupAudioContext(): void {
    // Release reference to shared AudioContext (do not close -- it is shared)
    this._audioContext = null;
  }

  private _close(): void {
    this.dispatchEvent(
      new CustomEvent('uvm-batch-review:close', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onBackdropClick(): void {
    this._close();
  }

  /**
   * Get the current sample being reviewed.
   */
  private _getCurrentSample(): BatchSampleResult | null {
    if (this._currentIndex < 0 || this._currentIndex >= this._internalResults.length) {
      return null;
    }
    return this._internalResults[this._currentIndex];
  }

  /**
   * Load audio for the current sample.
   */
  private async _loadCurrentSample(): Promise<void> {
    const sample = this._getCurrentSample();
    if (!sample || !this.voicebankId) return;

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
        sample.filename,
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
   * Navigate to a specific sample.
   */
  private _selectSample(index: number): void {
    if (index < 0 || index >= this._internalResults.length) return;
    this._currentIndex = index;
    this._loadCurrentSample();
  }

  /**
   * Navigate to previous sample.
   */
  private _navigatePrevious(): void {
    if (this._currentIndex > 0) {
      this._currentIndex--;
      this._loadCurrentSample();
    }
  }

  /**
   * Navigate to next sample.
   */
  private _navigateNext(): void {
    if (this._currentIndex < this._internalResults.length - 1) {
      this._currentIndex++;
      this._loadCurrentSample();
    }
  }

  /**
   * Find the next unreviewed sample.
   */
  private _findNextUnreviewed(): number {
    for (let i = this._currentIndex + 1; i < this._internalResults.length; i++) {
      if (this._internalResults[i].status === 'pending') {
        return i;
      }
    }
    // Wrap around from the beginning
    for (let i = 0; i < this._currentIndex; i++) {
      if (this._internalResults[i].status === 'pending') {
        return i;
      }
    }
    return -1;
  }

  /**
   * Move to the next unreviewed sample or complete the review.
   */
  private _moveToNextOrComplete(): void {
    const nextIndex = this._findNextUnreviewed();
    if (nextIndex >= 0) {
      this._currentIndex = nextIndex;
      this._loadCurrentSample();
    } else {
      // All samples reviewed
      this._completeReview();
    }
  }

  /**
   * Accept the current sample's suggested values.
   */
  private async _acceptCurrent(): Promise<void> {
    const sample = this._getCurrentSample();
    if (!sample || this._saving) return;

    this._saving = true;

    try {
      // Save the entry to the API
      await api.createOtoEntry(this.voicebankId, {
        filename: sample.filename,
        alias: sample.alias,
        offset: sample.offset,
        consonant: sample.consonant,
        cutoff: sample.cutoff,
        preutterance: sample.preutterance,
        overlap: sample.overlap,
      });

      // Mark as accepted
      sample.status = 'accepted';
      this._internalResults = [...this._internalResults];

      this._moveToNextOrComplete();
    } catch (error) {
      if (error instanceof ApiError && error.isConflict()) {
        // Entry already exists, try updating instead
        try {
          await api.updateOtoEntry(
            this.voicebankId,
            sample.filename,
            sample.alias,
            {
              offset: sample.offset,
              consonant: sample.consonant,
              cutoff: sample.cutoff,
              preutterance: sample.preutterance,
              overlap: sample.overlap,
            }
          );
          sample.status = 'accepted';
          this._internalResults = [...this._internalResults];
          this._moveToNextOrComplete();
        } catch (updateError) {
          console.error('Failed to update entry:', updateError);
          UvmToastManager.error('Failed to save entry');
        }
      } else {
        console.error('Failed to save entry:', error);
        UvmToastManager.error('Failed to save entry');
      }
    } finally {
      this._saving = false;
    }
  }

  /**
   * Open the current sample in the full editor for adjustment.
   */
  private _adjustCurrent(): void {
    const sample = this._getCurrentSample();
    if (!sample) return;

    // Mark as adjusted and emit event
    sample.status = 'adjusted';
    this._internalResults = [...this._internalResults];

    this.dispatchEvent(
      new CustomEvent('uvm-batch-review:adjust', {
        detail: {
          voicebankId: this.voicebankId,
          filename: sample.filename,
          suggestion: sample,
        },
        bubbles: true,
        composed: true,
      })
    );

    this._moveToNextOrComplete();
  }

  /**
   * Skip the current sample without saving.
   */
  private _skipCurrent(): void {
    const sample = this._getCurrentSample();
    if (!sample) return;

    sample.status = 'skipped';
    this._internalResults = [...this._internalResults];
    this._moveToNextOrComplete();
  }

  /**
   * Accept all remaining unreviewed samples.
   */
  private async _acceptAllRemaining(): Promise<void> {
    const pending = this._internalResults.filter(r => r.status === 'pending');
    if (pending.length === 0) return;

    this._saving = true;

    let successCount = 0;
    let failCount = 0;

    for (const sample of pending) {
      try {
        await api.createOtoEntry(this.voicebankId, {
          filename: sample.filename,
          alias: sample.alias,
          offset: sample.offset,
          consonant: sample.consonant,
          cutoff: sample.cutoff,
          preutterance: sample.preutterance,
          overlap: sample.overlap,
        });
        sample.status = 'accepted';
        successCount++;
      } catch (error) {
        if (error instanceof ApiError && error.isConflict()) {
          // Try updating instead
          try {
            await api.updateOtoEntry(
              this.voicebankId,
              sample.filename,
              sample.alias,
              {
                offset: sample.offset,
                consonant: sample.consonant,
                cutoff: sample.cutoff,
                preutterance: sample.preutterance,
                overlap: sample.overlap,
              }
            );
            sample.status = 'accepted';
            successCount++;
          } catch {
            failCount++;
          }
        } else {
          failCount++;
        }
      }
    }

    this._internalResults = [...this._internalResults];
    this._saving = false;

    if (failCount > 0) {
      UvmToastManager.warning(`Saved ${successCount} entries, ${failCount} failed`);
    } else {
      UvmToastManager.success(`Saved ${successCount} entries`);
    }

    this._completeReview();
  }

  /**
   * Complete the review and emit completion event.
   */
  private _completeReview(): void {
    const stats = this._getReviewStats();

    this.dispatchEvent(
      new CustomEvent('uvm-batch-review:complete', {
        detail: {
          accepted: stats.accepted,
          adjusted: stats.adjusted,
          skipped: stats.skipped,
          total: stats.total,
        } as BatchReviewCompleteDetail,
        bubbles: true,
        composed: true,
      })
    );

    UvmToastManager.success(
      `Review complete: ${stats.accepted} accepted, ${stats.adjusted} adjusted, ${stats.skipped} skipped`
    );

    this._close();
  }

  /**
   * Get review statistics.
   */
  private _getReviewStats() {
    const accepted = this._internalResults.filter(r => r.status === 'accepted').length;
    const adjusted = this._internalResults.filter(r => r.status === 'adjusted').length;
    const skipped = this._internalResults.filter(r => r.status === 'skipped').length;
    const pending = this._internalResults.filter(r => r.status === 'pending').length;
    const total = this._internalResults.length;
    const reviewed = total - pending;

    return { accepted, adjusted, skipped, pending, total, reviewed };
  }

  /**
   * Get confidence display class.
   */
  private _getConfidenceClass(confidence: number): string {
    if (confidence < 0.5) return 'confidence-low';
    if (confidence >= 0.8) return 'confidence-high';
    return '';
  }

  /**
   * Get status icon for a sample.
   */
  private _getStatusIcon(status: string): string {
    switch (status) {
      case 'accepted':
        return 'check-circle';
      case 'adjusted':
        return 'pencil';
      case 'skipped':
        return 'dash-circle';
      default:
        return '';
    }
  }

  /**
   * Calculate marker position as percentage.
   */
  private _getMarkerPosition(value: number, isCutoff = false): string {
    if (this._audioDurationMs <= 0) return '0%';

    let positionMs = value;
    if (isCutoff && value < 0) {
      // Cutoff is negative (from end)
      positionMs = this._audioDurationMs + value;
    }

    const percent = (positionMs / this._audioDurationMs) * 100;
    return `${Math.max(0, Math.min(100, percent))}%`;
  }

  /**
   * Render the sample list sidebar.
   */
  private _renderSampleList() {
    const stats = this._getReviewStats();

    return html`
      <div class="sample-list-panel">
        <div class="sample-list-header">
          <span>Samples</span>
          <span>${stats.reviewed} / ${stats.total}</span>
        </div>
        <div class="sample-list-scroll">
          ${this._internalResults.map((sample, index) => html`
            <div
              class="sample-item ${index === this._currentIndex ? 'active' : ''} ${sample.status !== 'pending' ? `reviewed ${sample.status}` : ''}"
              @click=${() => this._selectSample(index)}
            >
              <div class="sample-info">
                <div class="sample-name">${sample.filename.replace(/\.wav$/i, '')}</div>
                <div class="sample-confidence ${this._getConfidenceClass(sample.confidence)}">
                  ${Math.round(sample.confidence * 100)}% confidence
                </div>
              </div>
              ${sample.status !== 'pending'
                ? html`<sl-icon class="status-icon" name=${this._getStatusIcon(sample.status)}></sl-icon>`
                : nothing}
            </div>
          `)}
        </div>
      </div>
    `;
  }

  /**
   * Render the preview panel.
   */
  private _renderPreviewPanel() {
    const sample = this._getCurrentSample();

    if (!sample) {
      return html`
        <div class="preview-panel">
          <div class="empty-state">
            <sl-icon name="check-circle"></sl-icon>
            <div class="empty-state-text">
              All samples have been reviewed!
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
            <span class="preview-alias">${sample.alias}</span>
          </div>
          <sl-badge variant=${sample.confidence >= 0.8 ? 'success' : sample.confidence >= 0.5 ? 'primary' : 'warning'}>
            ${Math.round(sample.confidence * 100)}% confidence
          </sl-badge>
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
                    height=${150}
                  ></uvm-waveform-canvas>
                  <div class="marker-overlay">
                    <div class="marker-line offset" style="left: ${this._getMarkerPosition(sample.offset)}"></div>
                    <div class="marker-line consonant" style="left: ${this._getMarkerPosition(sample.consonant)}"></div>
                    <div class="marker-line preutterance" style="left: ${this._getMarkerPosition(sample.preutterance)}"></div>
                    <div class="marker-line overlap" style="left: ${this._getMarkerPosition(sample.overlap)}"></div>
                    <div class="marker-line cutoff" style="left: ${this._getMarkerPosition(sample.cutoff, true)}"></div>
                  </div>
                </div>

                <div class="parameters-grid">
                  <div class="param-box">
                    <span class="param-label" style="color: var(--uvm-marker-offset)">Offset</span>
                    <span class="param-value">${Math.round(sample.offset)}</span>
                  </div>
                  <div class="param-box">
                    <span class="param-label" style="color: var(--uvm-marker-consonant)">Consonant</span>
                    <span class="param-value">${Math.round(sample.consonant)}</span>
                  </div>
                  <div class="param-box">
                    <span class="param-label" style="color: var(--uvm-marker-preutterance)">Preutt</span>
                    <span class="param-value">${Math.round(sample.preutterance)}</span>
                  </div>
                  <div class="param-box">
                    <span class="param-label" style="color: var(--uvm-marker-overlap)">Overlap</span>
                    <span class="param-value">${Math.round(sample.overlap)}</span>
                  </div>
                  <div class="param-box">
                    <span class="param-label" style="color: var(--uvm-marker-cutoff)">Cutoff</span>
                    <span class="param-value">${Math.round(sample.cutoff)}</span>
                  </div>
                </div>

                <div class="action-buttons">
                  <sl-button
                    variant="success"
                    ?loading=${this._saving}
                    @click=${this._acceptCurrent}
                  >
                    <sl-icon slot="prefix" name="check-lg"></sl-icon>
                    Accept
                  </sl-button>
                  <sl-button
                    variant="primary"
                    @click=${this._adjustCurrent}
                  >
                    <sl-icon slot="prefix" name="sliders"></sl-icon>
                    Adjust
                  </sl-button>
                  <sl-button
                    variant="neutral"
                    @click=${this._skipCurrent}
                  >
                    <sl-icon slot="prefix" name="skip-forward"></sl-icon>
                    Skip
                  </sl-button>
                </div>
              `}
        </div>
      </div>
    `;
  }

  /**
   * Render progress section.
   */
  private _renderProgress() {
    const stats = this._getReviewStats();
    const progress = stats.total > 0 ? (stats.reviewed / stats.total) * 100 : 0;

    return html`
      <div class="progress-section">
        <div class="progress-header">
          <span class="progress-text">
            ${stats.reviewed} of ${stats.total} reviewed
          </span>
          <div class="progress-stats">
            <span class="progress-stat stat-accepted">
              <sl-icon name="check-circle"></sl-icon>
              ${stats.accepted}
            </span>
            <span class="progress-stat stat-adjusted">
              <sl-icon name="pencil"></sl-icon>
              ${stats.adjusted}
            </span>
            <span class="progress-stat stat-skipped">
              <sl-icon name="dash-circle"></sl-icon>
              ${stats.skipped}
            </span>
          </div>
        </div>
        <sl-progress-bar value=${progress}></sl-progress-bar>
      </div>
    `;
  }

  render() {
    if (!this.open) {
      return nothing;
    }

    const stats = this._getReviewStats();

    return html`
      <div class="backdrop" @click=${this._onBackdropClick}></div>
      <div class="modal-container" @click=${(e: Event) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>
            <sl-icon name="clipboard-check"></sl-icon>
            Review Auto-Detected Entries
          </h2>
          <div class="header-actions">
            ${stats.pending > 0
              ? html`
                  <sl-tooltip content="Accept all ${stats.pending} remaining entries">
                    <sl-button
                      size="small"
                      variant="success"
                      ?loading=${this._saving}
                      @click=${this._acceptAllRemaining}
                    >
                      <sl-icon slot="prefix" name="check-all"></sl-icon>
                      Accept All Remaining
                    </sl-button>
                  </sl-tooltip>
                `
              : html`
                  <sl-button
                    size="small"
                    variant="primary"
                    @click=${this._completeReview}
                  >
                    <sl-icon slot="prefix" name="check-lg"></sl-icon>
                    Finish Review
                  </sl-button>
                `}
            <sl-icon-button
              name="x-lg"
              label="Close"
              @click=${this._close}
            ></sl-icon-button>
          </div>
        </div>

        <div class="modal-body">
          ${this._renderSampleList()}
          ${this._renderPreviewPanel()}
        </div>

        ${this._renderProgress()}

        <div class="keyboard-hint">
          <kbd>A</kbd> Accept
          <kbd>E</kbd> Adjust
          <kbd>S</kbd> Skip
          <kbd>J</kbd>/<kbd>K</kbd> Navigate
          <kbd>Esc</kbd> Close
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-batch-review': UvmBatchReview;
  }
}
