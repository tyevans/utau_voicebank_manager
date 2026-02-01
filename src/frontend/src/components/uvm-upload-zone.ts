import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/progress-bar/progress-bar.js';

/**
 * A reusable drag-drop upload zone component.
 *
 * Supports drag-and-drop file uploads with visual feedback,
 * or clicking to open the native file picker.
 *
 * @fires files-selected - Fired when files are selected via drag-drop or file picker
 *   Detail: { files: FileList }
 *
 * @example
 * ```html
 * <uvm-upload-zone
 *   accept=".zip"
 *   @files-selected=${this._onFilesSelected}
 * ></uvm-upload-zone>
 * ```
 */
@customElement('uvm-upload-zone')
export class UvmUploadZone extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .upload-zone {
      border: 2px dashed var(--sl-color-neutral-300);
      border-radius: var(--sl-border-radius-large);
      padding: 2rem;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s ease;
      background: var(--sl-color-neutral-0);
    }

    .upload-zone:hover:not(.disabled) {
      border-color: var(--sl-color-primary-400);
      background: var(--sl-color-primary-50);
    }

    .upload-zone.drag-over {
      border-color: var(--sl-color-primary-500);
      background: var(--sl-color-primary-100);
      border-style: solid;
    }

    .upload-zone.disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }

    .upload-zone.uploading {
      cursor: default;
    }

    .upload-icon {
      font-size: 3rem;
      color: var(--sl-color-neutral-400);
      margin-bottom: 1rem;
      transition: color 0.2s ease;
    }

    .upload-zone:hover:not(.disabled) .upload-icon,
    .upload-zone.drag-over .upload-icon {
      color: var(--sl-color-primary-500);
    }

    .upload-text {
      font-size: 0.875rem;
      color: var(--sl-color-neutral-600);
      margin-bottom: 0.5rem;
    }

    .upload-hint {
      font-size: 0.75rem;
      color: var(--sl-color-neutral-400);
    }

    .file-input {
      display: none;
    }

    .selected-file {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      margin-top: 1rem;
      padding: 0.75rem;
      background: var(--sl-color-neutral-100);
      border-radius: var(--sl-border-radius-medium);
    }

    .selected-file sl-icon {
      color: var(--sl-color-success-600);
    }

    .file-name {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--sl-color-neutral-800);
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-size {
      font-size: 0.75rem;
      color: var(--sl-color-neutral-500);
    }

    .progress-container {
      margin-top: 1rem;
    }

    .progress-text {
      font-size: 0.75rem;
      color: var(--sl-color-neutral-500);
      margin-top: 0.5rem;
    }
  `;

  /** Whether the upload zone is disabled */
  @property({ type: Boolean, reflect: true })
  disabled = false;

  /** Accepted file types (e.g., '.zip', '.wav,.mp3') */
  @property({ type: String })
  accept = '.zip';

  /** Whether multiple files can be selected */
  @property({ type: Boolean })
  multiple = false;

  /** Whether an upload is in progress */
  @property({ type: Boolean })
  uploading = false;

  /** Upload progress percentage (0-100) */
  @property({ type: Number })
  progress = 0;

  /** Currently dragging over the zone */
  @state()
  private _isDragOver = false;

  /** Selected file info for display */
  @state()
  private _selectedFile: { name: string; size: number } | null = null;

  render() {
    const zoneClasses = [
      'upload-zone',
      this._isDragOver ? 'drag-over' : '',
      this.disabled ? 'disabled' : '',
      this.uploading ? 'uploading' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return html`
      <div
        class=${zoneClasses}
        @click=${this._onClick}
        @dragover=${this._onDragOver}
        @dragleave=${this._onDragLeave}
        @drop=${this._onDrop}
        role="button"
        tabindex=${this.disabled ? -1 : 0}
        aria-label="Upload file drop zone"
        @keydown=${this._onKeyDown}
      >
        <sl-icon class="upload-icon" name="cloud-arrow-up"></sl-icon>
        <div class="upload-text">
          ${this.uploading
            ? 'Uploading...'
            : 'Drag and drop a file here, or click to browse'}
        </div>
        <div class="upload-hint">
          ${this._getAcceptHint()}
        </div>

        ${this._selectedFile && !this.uploading
          ? html`
              <div class="selected-file">
                <sl-icon name="file-earmark-check"></sl-icon>
                <span class="file-name">${this._selectedFile.name}</span>
                <span class="file-size">(${this._formatFileSize(this._selectedFile.size)})</span>
              </div>
            `
          : null}

        ${this.uploading
          ? html`
              <div class="progress-container">
                <sl-progress-bar value=${this.progress}></sl-progress-bar>
                <div class="progress-text">${this.progress}% uploaded</div>
              </div>
            `
          : null}
      </div>

      <input
        type="file"
        class="file-input"
        .accept=${this.accept}
        ?multiple=${this.multiple}
        @change=${this._onFileInputChange}
      />
    `;
  }

  /**
   * Generate a human-readable hint from the accept attribute.
   */
  private _getAcceptHint(): string {
    if (!this.accept) return '';

    const types = this.accept.split(',').map((t) => t.trim().toUpperCase());
    if (types.length === 1) {
      return `Accepts ${types[0]} files`;
    }
    return `Accepts ${types.slice(0, -1).join(', ')} or ${types[types.length - 1]} files`;
  }

  /**
   * Format file size to human-readable string.
   */
  private _formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Handle click to open file picker.
   */
  private _onClick(): void {
    if (this.disabled || this.uploading) return;
    const input = this.shadowRoot?.querySelector('input[type="file"]') as HTMLInputElement;
    input?.click();
  }

  /**
   * Handle keyboard activation.
   */
  private _onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this._onClick();
    }
  }

  /**
   * Handle dragover event.
   */
  private _onDragOver(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (this.disabled || this.uploading) return;
    this._isDragOver = true;
  }

  /**
   * Handle dragleave event.
   */
  private _onDragLeave(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this._isDragOver = false;
  }

  /**
   * Handle drop event.
   */
  private _onDrop(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this._isDragOver = false;

    if (this.disabled || this.uploading) return;

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      this._handleFiles(files);
    }
  }

  /**
   * Handle file input change.
   */
  private _onFileInputChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this._handleFiles(input.files);
    }
    // Reset input so the same file can be selected again
    input.value = '';
  }

  /**
   * Process selected files and emit event.
   */
  private _handleFiles(files: FileList): void {
    // Validate file types if accept is specified
    if (this.accept) {
      const acceptedExtensions = this.accept
        .split(',')
        .map((ext) => ext.trim().toLowerCase());

      const validFiles = Array.from(files).filter((file) =>
        acceptedExtensions.some((ext) => file.name.toLowerCase().endsWith(ext))
      );

      if (validFiles.length === 0) {
        // No valid files selected
        return;
      }
    }

    // Store first file for display
    this._selectedFile = {
      name: files[0].name,
      size: files[0].size,
    };

    // Emit event
    this.dispatchEvent(
      new CustomEvent('files-selected', {
        detail: { files },
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Clear the selected file (useful when upload completes or is cancelled).
   */
  public clearSelection(): void {
    this._selectedFile = null;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-upload-zone': UvmUploadZone;
  }
}
