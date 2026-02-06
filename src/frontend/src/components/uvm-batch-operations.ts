import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';

import './uvm-alignment-settings.js';
import type { AlignmentMethod, AlignmentChangeDetail } from './uvm-alignment-settings.js';
import { api, ApiError } from '../services/api.js';
import type { BatchOtoResult } from '../services/types.js';
import { UvmToastManager } from './uvm-toast-manager.js';

/**
 * Batch operations component for running ML auto-detection on all samples.
 *
 * Renders as a Shoelace dialog that can be opened/closed via the `open` property.
 * Shows alignment settings, a progress indicator, and result summary.
 *
 * @fires batch-complete - Fired when a batch operation completes successfully
 *   Detail: { result: BatchOtoResult }
 * @fires batch-dialog-close - Fired when the dialog is closed
 */
@customElement('uvm-batch-operations')
export class UvmBatchOperations extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }

    .dialog-footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
    }
  `;

  @property({ type: Boolean })
  open = false;

  @property({ type: String })
  voicebankId: string | null = null;

  @property({ type: String })
  voicebankName = '';

  @property({ type: Number })
  sampleCount = 0;

  @state()
  private _isBatchProcessing = false;

  @state()
  private _batchOverwriteExisting = false;

  @state()
  private _batchAlignmentTightness = 0.5;

  @state()
  private _batchAlignmentMethodOverride: 'sofa' | 'fa' | 'blind' | null = null;

  @state()
  private _availableAlignmentMethods: AlignmentMethod[] = [];

  @state()
  private _batchResult: BatchOtoResult | null = null;

  protected updated(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('open') && this.open) {
      this._batchResult = null;
      this._batchOverwriteExisting = false;
      this._loadAlignmentConfig();
    }
  }

  private async _loadAlignmentConfig(): Promise<void> {
    try {
      const [configResult, methodsResult] = await Promise.all([
        api.getAlignmentConfig(),
        api.getAlignmentMethods(),
      ]);

      this._batchAlignmentTightness = configResult.tightness;
      this._batchAlignmentMethodOverride = configResult.method_override as typeof this._batchAlignmentMethodOverride;

      this._availableAlignmentMethods = methodsResult.methods.map(m => ({
        name: m.name as 'sofa' | 'fa' | 'blind',
        available: m.available,
        displayName: m.display_name,
        unavailableReason: m.available ? undefined : (m.description || 'Not available'),
      }));
    } catch (error) {
      console.warn('Failed to load alignment config for batch:', error);
    }
  }

  private _closeDialog(): void {
    if (this._isBatchProcessing) return;
    this.dispatchEvent(
      new CustomEvent('batch-dialog-close', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onDialogClose(e: Event): void {
    if (this._isBatchProcessing) {
      e.preventDefault();
      return;
    }
    this._closeDialog();
  }

  private _onOverwriteChange(e: Event): void {
    const checkbox = e.target as HTMLInputElement;
    this._batchOverwriteExisting = checkbox.checked;
  }

  private _onAlignmentChange(e: CustomEvent<AlignmentChangeDetail>): void {
    this._batchAlignmentTightness = e.detail.tightness;
    this._batchAlignmentMethodOverride = e.detail.methodOverride;
  }

  private async _runBatchAutodetect(): Promise<void> {
    if (!this.voicebankId) return;

    this._isBatchProcessing = true;
    this._batchResult = null;

    try {
      const result = await api.batchGenerateOto(
        this.voicebankId,
        this._batchOverwriteExisting,
        {
          tightness: this._batchAlignmentTightness,
          methodOverride: this._batchAlignmentMethodOverride === 'blind' ? null : this._batchAlignmentMethodOverride,
        }
      );

      this._batchResult = result;

      if (result.processed > 0) {
        UvmToastManager.success(
          `Auto-detected ${result.processed} samples (${Math.round(result.average_confidence * 100)}% avg confidence)`
        );
      } else if (result.skipped === result.total_samples) {
        UvmToastManager.info('All samples already have oto entries');
      }

      this.dispatchEvent(
        new CustomEvent('batch-complete', {
          detail: { result },
          bubbles: true,
          composed: true,
        })
      );
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

  render() {
    return html`
      <sl-dialog
        label="Auto-detect All Samples"
        ?open=${this.open}
        @sl-request-close=${this._onDialogClose}
        style="--width: 28rem;"
      >
        ${this._batchResult
          ? this._renderBatchResult()
          : this._renderBatchConfirmation()}

        <div slot="footer" class="dialog-footer">
          ${this._batchResult
            ? html`
                <sl-button variant="primary" @click=${this._closeDialog}>
                  Done
                </sl-button>
              `
            : html`
                <sl-button
                  @click=${this._closeDialog}
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

  private _renderBatchConfirmation() {
    return html`
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <p style="margin: 0; color: #374151;">
          Run ML-based phoneme detection on all <strong>${this.sampleCount}</strong> samples
          in <strong>${this.voicebankName}</strong> to automatically generate oto.ini entries.
        </p>

        <sl-alert variant="primary" open>
          <sl-icon slot="icon" name="info-circle"></sl-icon>
          This may take a while for large voicebanks. Each sample is processed through the ML pipeline.
        </sl-alert>

        <uvm-alignment-settings
          .tightness=${this._batchAlignmentTightness}
          .methodOverride=${this._batchAlignmentMethodOverride}
          .availableMethods=${this._availableAlignmentMethods}
          @alignment-change=${this._onAlignmentChange}
        ></uvm-alignment-settings>

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
    'uvm-batch-operations': UvmBatchOperations;
  }
}
