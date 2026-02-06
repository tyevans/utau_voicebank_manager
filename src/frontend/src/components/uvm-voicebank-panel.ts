import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/badge/badge.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';

import './uvm-upload-zone.js';
import type { UvmUploadZone } from './uvm-upload-zone.js';
import { api, ApiError, getDefaultApiUrl } from '../services/api.js';
import type { VoicebankSummary } from '../services/types.js';
import { UvmToastManager } from './uvm-toast-manager.js';

/**
 * Voicebank panel component for selecting and managing voicebanks.
 *
 * Displays a list of voicebanks with selection, upload, download,
 * and delete capabilities.
 *
 * @fires voicebank-select - Fired when a voicebank is selected
 *   Detail: { voicebankId: string }
 * @fires voicebanks-changed - Fired when the voicebank list changes (upload/delete)
 */
@customElement('uvm-voicebank-panel')
export class UvmVoicebankPanel extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      background-color: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04);
      overflow: hidden;
      min-height: 0;
      flex: 0 0 180px;
      min-width: 160px;
      max-width: 200px;
    }

    @media (max-width: 768px) {
      :host {
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
  `;

  @property({ type: Array })
  voicebanks: VoicebankSummary[] = [];

  @property({ type: String })
  selectedVoicebankId: string | null = null;

  @property({ type: Boolean })
  loadingVoicebanks = false;

  @property({ type: String })
  voicebanksError: string | null = null;

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
  private _isDownloading = false;

  @query('uvm-upload-zone')
  private _uploadZone!: UvmUploadZone;

  /**
   * Emit a retry event so the parent component can re-fetch voicebanks.
   */
  private _onRetryLoad(): void {
    this.dispatchEvent(
      new CustomEvent('voicebanks-retry', {
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Get the name of the selected voicebank.
   */
  private _getSelectedVoicebankName(): string {
    const vb = this.voicebanks.find((v) => v.id === this.selectedVoicebankId);
    return vb?.name ?? '';
  }

  /**
   * Handle voicebank selection.
   */
  private _onVoicebankClick(voicebankId: string): void {
    if (this.selectedVoicebankId === voicebankId) return;
    this.dispatchEvent(
      new CustomEvent('voicebank-select', {
        detail: { voicebankId },
        bubbles: true,
        composed: true,
      })
    );
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
    if (this.voicebanks.length === 0) return;

    const currentIndex = this.selectedVoicebankId
      ? this.voicebanks.findIndex((v) => v.id === this.selectedVoicebankId)
      : -1;

    const newIndex = Math.max(
      0,
      Math.min(this.voicebanks.length - 1, currentIndex + direction)
    );

    const newVoicebank = this.voicebanks[newIndex];
    if (newVoicebank) {
      this._onVoicebankClick(newVoicebank.id);
      this._focusVoicebankItem(newVoicebank.id);
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
   * Download the selected voicebank as a ZIP file.
   */
  private async _downloadVoicebank(): Promise<void> {
    if (!this.selectedVoicebankId || this._isDownloading) return;

    this._isDownloading = true;

    try {
      const voicebankId = this.selectedVoicebankId;
      const voicebankName = this._getSelectedVoicebankName();
      const downloadUrl = `${getDefaultApiUrl()}/voicebanks/${encodeURIComponent(voicebankId)}/download`;

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
      setTimeout(() => {
        this._isDownloading = false;
      }, 1000);
    }
  }

  // --- Upload dialog ---

  private _openUploadDialog(): void {
    this._showUploadDialog = true;
    this._uploadName = '';
    this._uploadFiles = [];
    this._uploadError = null;
  }

  private _closeUploadDialog(): void {
    if (this._isUploading) return;
    this._showUploadDialog = false;
    this._uploadName = '';
    this._uploadFiles = [];
    this._uploadError = null;
    this._uploadZone?.clearSelection();
  }

  private _onUploadDialogClose(e: Event): void {
    if (this._isUploading) {
      e.preventDefault();
      return;
    }
    this._closeUploadDialog();
  }

  private _onUploadNameChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    this._uploadName = input.value;
  }

  private _onFilesSelected(e: CustomEvent<{ files: FileList }>): void {
    this._uploadFiles = Array.from(e.detail.files);
    this._uploadError = null;
  }

  private get _canUpload(): boolean {
    return (
      this._uploadName.trim().length > 0 &&
      this._uploadFiles.length > 0 &&
      !this._isUploading
    );
  }

  private async _uploadVoicebank(): Promise<void> {
    if (!this._canUpload) return;

    this._isUploading = true;
    this._uploadError = null;

    try {
      const voicebank = await api.createVoicebank(this._uploadName.trim(), this._uploadFiles);

      this._showUploadDialog = false;
      this._uploadName = '';
      this._uploadFiles = [];
      this._uploadZone?.clearSelection();

      UvmToastManager.success(`Voicebank "${voicebank.name}" uploaded successfully`);

      this.dispatchEvent(
        new CustomEvent('voicebanks-changed', {
          bubbles: true,
          composed: true,
        })
      );
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

  // --- Delete dialog ---

  private _openDeleteDialog(vb: VoicebankSummary, e: Event): void {
    e.stopPropagation();
    this._voicebankToDelete = vb;
    this._showDeleteDialog = true;
  }

  private _closeDeleteDialog(): void {
    if (this._isDeleting) return;
    this._showDeleteDialog = false;
    this._voicebankToDelete = null;
  }

  private _onDeleteDialogClose(e: Event): void {
    if (this._isDeleting) {
      e.preventDefault();
      return;
    }
    this._closeDeleteDialog();
  }

  private async _deleteVoicebank(): Promise<void> {
    if (!this._voicebankToDelete) return;

    this._isDeleting = true;

    try {
      await api.deleteVoicebank(this._voicebankToDelete.id);
      const deletedName = this._voicebankToDelete.name;
      const deletedId = this._voicebankToDelete.id;

      this._showDeleteDialog = false;
      this._voicebankToDelete = null;

      UvmToastManager.success(`Voicebank "${deletedName}" deleted`);

      this.dispatchEvent(
        new CustomEvent('voicebanks-changed', {
          detail: { deletedVoicebankId: deletedId },
          bubbles: true,
          composed: true,
        })
      );
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

  // --- Rendering ---

  render() {
    return html`
      <div class="panel-header">
        <sl-icon name="folder2"></sl-icon>
        Voicebanks
        <div class="panel-header-actions">
          ${this.selectedVoicebankId
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
        ${this.loadingVoicebanks
          ? this._renderLoadingState()
          : this.voicebanksError
            ? this._renderErrorState(this.voicebanksError)
            : this.voicebanks.length === 0
              ? this._renderEmptyState()
              : this._renderVoicebankList()}
      </div>
      ${this._renderUploadDialog()}
      ${this._renderDeleteDialog()}
    `;
  }

  private _renderVoicebankList() {
    return html`
      <ul class="voicebank-list" role="listbox" aria-label="Voicebanks">
        ${this.voicebanks.map(
          (vb) => html`
            <li
              class="voicebank-item ${this.selectedVoicebankId === vb.id
                ? 'selected'
                : ''}"
              role="option"
              aria-selected=${this.selectedVoicebankId === vb.id}
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

  private _renderLoadingState() {
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

  private _renderErrorState(message: string) {
    return html`
      <div class="error-state">
        <sl-icon name="exclamation-triangle"></sl-icon>
        <div class="error-state-text">${message}</div>
        <sl-button
          size="small"
          variant="default"
          style="margin-top: 0.75rem;"
          @click=${this._onRetryLoad}
        >
          <sl-icon slot="prefix" name="arrow-counterclockwise"></sl-icon>
          Retry
        </sl-button>
      </div>
    `;
  }

  private _renderEmptyState() {
    return html`
      <div class="empty-state">
        <sl-icon name="folder-plus"></sl-icon>
        <div class="empty-state-text">
          No voicebanks yet. Upload one to get started.
        </div>
      </div>
    `;
  }

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
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-voicebank-panel': UvmVoicebankPanel;
  }
}
