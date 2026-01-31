import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/badge/badge.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';

import { api } from '../services/api.js';
import type { VoicebankSummary } from '../services/types.js';

/**
 * Sample browser component for selecting voicebank samples.
 *
 * Displays a two-panel layout with voicebanks on the left and
 * samples in the selected voicebank on the right.
 *
 * @fires sample-select - Fired when a sample is selected (double-click or Enter)
 *
 * @example
 * ```html
 * <uvm-sample-browser
 *   @sample-select=${this._onSampleSelect}
 * ></uvm-sample-browser>
 * ```
 */
@customElement('uvm-sample-browser')
export class UvmSampleBrowser extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
    }

    .browser-container {
      display: flex;
      gap: 1rem;
      min-height: 400px;
    }

    /* Responsive: stack on mobile */
    @media (max-width: 768px) {
      .browser-container {
        flex-direction: column;
      }
    }

    .panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      background-color: var(--sl-color-neutral-50, #f8fafc);
      border: 1px solid var(--sl-color-neutral-200, #e2e8f0);
      border-radius: var(--sl-border-radius-medium, 0.375rem);
      overflow: hidden;
    }

    .panel-header {
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

    .panel-header sl-icon {
      font-size: 1rem;
    }

    .panel-content {
      flex: 1;
      overflow-y: auto;
      max-height: 350px;
    }

    .list {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .list-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.625rem 1rem;
      cursor: pointer;
      border-bottom: 1px solid var(--sl-color-neutral-100, #f1f5f9);
      transition: background-color 0.15s ease;
    }

    .list-item:last-child {
      border-bottom: none;
    }

    .list-item:hover {
      background-color: var(--sl-color-neutral-100, #f1f5f9);
    }

    .list-item.selected {
      background-color: var(--sl-color-primary-100, #dbeafe);
    }

    .list-item:focus {
      outline: 2px solid var(--sl-color-primary-500, #3b82f6);
      outline-offset: -2px;
    }

    .item-icon {
      flex-shrink: 0;
      font-size: 1.25rem;
      color: var(--sl-color-neutral-500, #64748b);
    }

    .list-item.selected .item-icon {
      color: var(--sl-color-primary-600, #2563eb);
    }

    .item-content {
      flex: 1;
      min-width: 0;
    }

    .item-name {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--sl-color-neutral-800, #1e293b);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .item-meta {
      font-size: 0.75rem;
      color: var(--sl-color-neutral-500, #64748b);
      margin-top: 0.125rem;
    }

    .item-badges {
      display: flex;
      gap: 0.375rem;
      flex-shrink: 0;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem 1rem;
      text-align: center;
      height: 100%;
      min-height: 200px;
    }

    .empty-state sl-icon {
      font-size: 2.5rem;
      color: var(--sl-color-neutral-300, #cbd5e1);
      margin-bottom: 0.75rem;
    }

    .empty-state-text {
      font-size: 0.875rem;
      color: var(--sl-color-neutral-500, #64748b);
      max-width: 200px;
      line-height: 1.5;
    }

    .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      height: 100%;
      min-height: 200px;
    }

    .loading-state sl-spinner {
      font-size: 2rem;
      --indicator-color: var(--sl-color-primary-500, #3b82f6);
    }

    .loading-state-text {
      margin-top: 0.75rem;
      font-size: 0.875rem;
      color: var(--sl-color-neutral-500, #64748b);
    }

    .error-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem 1rem;
      text-align: center;
      height: 100%;
      min-height: 200px;
    }

    .error-state sl-icon {
      font-size: 2.5rem;
      color: var(--sl-color-danger-500, #ef4444);
      margin-bottom: 0.75rem;
    }

    .error-state-text {
      font-size: 0.875rem;
      color: var(--sl-color-danger-600, #dc2626);
      max-width: 200px;
      line-height: 1.5;
    }

    .voicebank-panel {
      max-width: 300px;
      min-width: 200px;
    }

    @media (max-width: 768px) {
      .voicebank-panel {
        max-width: 100%;
      }
    }

    .samples-panel {
      flex: 2;
    }

    .keyboard-hint {
      padding: 0.5rem 1rem;
      font-size: 0.75rem;
      color: var(--sl-color-neutral-400, #94a3b8);
      background-color: var(--sl-color-neutral-50, #f8fafc);
      border-top: 1px solid var(--sl-color-neutral-200, #e2e8f0);
    }
  `;

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

  connectedCallback(): void {
    super.connectedCallback();
    this._fetchVoicebanks();
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
      this._voicebanksError =
        error instanceof Error ? error.message : 'Failed to load voicebanks';
    } finally {
      this._loadingVoicebanks = false;
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
    } catch (error) {
      this._samplesError =
        error instanceof Error ? error.message : 'Failed to load samples';
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
    this._fetchSamples(voicebankId);
  }

  /**
   * Handle sample click (single click for selection).
   */
  private _onSampleClick(filename: string): void {
    this._selectedSample = filename;
  }

  /**
   * Handle sample double-click (selection and emit event).
   */
  private _onSampleDblClick(filename: string): void {
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
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._navigateSample(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._navigateSample(-1);
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
    if (this._samples.length === 0) return;

    const currentIndex = this._selectedSample
      ? this._samples.indexOf(this._selectedSample)
      : -1;

    const newIndex = Math.max(
      0,
      Math.min(this._samples.length - 1, currentIndex + direction)
    );

    const newSample = this._samples[newIndex];
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
   * Focus a sample list item by filename.
   */
  private _focusSampleItem(filename: string): void {
    const item = this.shadowRoot?.querySelector(
      `[data-sample-filename="${filename}"]`
    ) as HTMLElement | null;
    item?.focus();
  }

  /**
   * Emit the sample-select event.
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
  }

  /**
   * Strip .wav extension from filename for display.
   */
  private _displayName(filename: string): string {
    return filename.replace(/\.wav$/i, '');
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
        </div>
        <div class="panel-content">
          ${this._loadingVoicebanks
            ? this._renderLoadingState('Loading voicebanks...')
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
      <ul class="list" role="listbox" aria-label="Voicebanks">
        ${this._voicebanks.map(
          (vb) => html`
            <li
              class="list-item ${this._selectedVoicebank === vb.id
                ? 'selected'
                : ''}"
              role="option"
              aria-selected=${this._selectedVoicebank === vb.id}
              tabindex="0"
              data-voicebank-id=${vb.id}
              @click=${() => this._onVoicebankClick(vb.id)}
              @keydown=${(e: KeyboardEvent) => this._onVoicebankKeyDown(e, vb.id)}
            >
              <sl-icon class="item-icon" name="folder-fill"></sl-icon>
              <div class="item-content">
                <div class="item-name">${vb.name}</div>
                <div class="item-meta">${vb.sample_count} samples</div>
              </div>
              ${vb.has_oto
                ? html`
                    <div class="item-badges">
                      <sl-badge variant="success" pill>oto</sl-badge>
                    </div>
                  `
                : null}
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
    return html`
      <div class="panel samples-panel">
        <div class="panel-header">
          <sl-icon name="music-note-list"></sl-icon>
          Samples
          ${this._selectedVoicebank
            ? html`<span style="font-weight: normal; color: var(--sl-color-neutral-500);">
                - ${this._getSelectedVoicebankName()}
              </span>`
            : null}
        </div>
        <div class="panel-content">
          ${!this._selectedVoicebank
            ? this._renderSelectVoicebankPrompt()
            : this._loadingSamples
              ? this._renderLoadingState('Loading samples...')
              : this._samplesError
                ? this._renderErrorState(this._samplesError)
                : this._samples.length === 0
                  ? this._renderEmptySamples()
                  : this._renderSampleList()}
        </div>
        ${this._samples.length > 0
          ? html`<div class="keyboard-hint">
              Double-click or press Enter to load sample
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
   * Render the sample list items.
   */
  private _renderSampleList() {
    return html`
      <ul class="list" role="listbox" aria-label="Samples">
        ${this._samples.map(
          (filename) => html`
            <li
              class="list-item ${this._selectedSample === filename
                ? 'selected'
                : ''}"
              role="option"
              aria-selected=${this._selectedSample === filename}
              tabindex="0"
              data-sample-filename=${filename}
              @click=${() => this._onSampleClick(filename)}
              @dblclick=${() => this._onSampleDblClick(filename)}
              @keydown=${(e: KeyboardEvent) => this._onSampleKeyDown(e, filename)}
            >
              <sl-icon class="item-icon" name="file-earmark-music"></sl-icon>
              <div class="item-content">
                <div class="item-name">${this._displayName(filename)}</div>
              </div>
              ${this._sampleOtoMap.get(filename)
                ? html`
                    <div class="item-badges">
                      <sl-badge variant="primary" pill>oto</sl-badge>
                    </div>
                  `
                : null}
            </li>
          `
        )}
      </ul>
    `;
  }

  /**
   * Render loading state.
   */
  private _renderLoadingState(message: string) {
    return html`
      <div class="loading-state">
        <sl-spinner></sl-spinner>
        <div class="loading-state-text">${message}</div>
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
    return html`
      <div class="browser-container">
        ${this._renderVoicebanksPanel()} ${this._renderSamplesPanel()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-sample-browser': UvmSampleBrowser;
  }
}
