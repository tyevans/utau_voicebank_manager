import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/textarea/textarea.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import type SlInput from '@shoelace-style/shoelace/dist/components/input/input.js';
import type SlTextarea from '@shoelace-style/shoelace/dist/components/textarea/textarea.js';

import { api, ApiError } from '../services/api.js';
import { UvmToastManager } from './uvm-toast-manager.js';

/**
 * Known character.txt keys with their display labels and descriptions.
 */
interface CharacterField {
  key: string;
  label: string;
  placeholder: string;
  type: string;
}

const CHARACTER_FIELDS: CharacterField[] = [
  { key: 'name', label: 'Name', placeholder: 'Voicebank character name', type: 'text' },
  { key: 'author', label: 'Author', placeholder: 'Creator / developer name', type: 'text' },
  { key: 'web', label: 'Website', placeholder: 'https://example.com', type: 'url' },
  { key: 'voice', label: 'Voice Provider', placeholder: 'Name of the voice provider', type: 'text' },
  { key: 'image', label: 'Image File', placeholder: 'icon.bmp', type: 'text' },
  { key: 'sample', label: 'Sample File', placeholder: 'sample.wav', type: 'text' },
];

/**
 * Parsed character.txt data.
 * Stores known fields plus any extra key=value pairs.
 */
interface CharacterData {
  /** Known character.txt fields */
  fields: Record<string, string>;
  /** Unknown key=value pairs to preserve on save */
  extraLines: string[];
}

/**
 * Metadata editor component for UTAU voicebank character.txt and readme.txt files.
 *
 * Provides a structured form for editing character.txt fields (name, author, web,
 * voice, image, sample) and a freeform textarea for readme.txt. Unknown keys in
 * character.txt are preserved when saving.
 *
 * Opens as a dialog triggered from the editor view.
 *
 * @fires uvm-metadata-editor:close - Fired when the dialog is closed
 *
 * @example
 * ```html
 * <uvm-metadata-editor
 *   voicebankId="my-voicebank"
 *   ?open=${this._showMetadata}
 *   @uvm-metadata-editor:close=${() => this._showMetadata = false}
 * ></uvm-metadata-editor>
 * ```
 */
@customElement('uvm-metadata-editor')
export class UvmMetadataEditor extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    sl-dialog::part(panel) {
      max-width: 600px;
      width: 90vw;
    }

    sl-dialog::part(body) {
      padding: 1rem 1.5rem;
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    .section-header sl-icon {
      font-size: 1.125rem;
      color: var(--sl-color-neutral-500, #64748b);
    }

    .section-title {
      font-size: 0.9375rem;
      font-weight: 600;
      color: var(--sl-color-neutral-800, #1e293b);
      margin: 0;
    }

    .section-description {
      font-size: 0.8125rem;
      color: var(--sl-color-neutral-500, #64748b);
      margin: 0 0 1rem;
    }

    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
    }

    .form-grid .full-width {
      grid-column: 1 / -1;
    }

    sl-divider {
      --spacing: 1.5rem;
    }

    .readme-section {
      margin-top: 0;
    }

    sl-textarea::part(textarea) {
      min-height: 120px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
      font-size: 0.8125rem;
    }

    .dialog-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }

    .dialog-footer-right {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .save-status {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.8125rem;
      color: var(--sl-color-neutral-500, #64748b);
    }

    .save-status sl-spinner {
      font-size: 0.875rem;
    }

    .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem 1rem;
      gap: 0.75rem;
    }

    .loading-state sl-spinner {
      font-size: 1.5rem;
      --indicator-color: var(--sl-color-primary-600);
    }

    .loading-state span {
      font-size: 0.875rem;
      color: var(--sl-color-neutral-500, #64748b);
    }

    .error-state {
      margin: 1rem 0;
    }

    .extra-fields-note {
      font-size: 0.75rem;
      color: var(--sl-color-neutral-400, #94a3b8);
      font-style: italic;
      margin-top: 0.5rem;
    }

    .icon-section {
      display: flex;
      align-items: flex-start;
      gap: 1rem;
    }

    .icon-preview {
      flex-shrink: 0;
      width: 100px;
      height: 100px;
      border-radius: 0.5rem;
      border: 2px dashed var(--sl-color-neutral-300, #cbd5e1);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: var(--sl-color-neutral-50, #f8fafc);
    }

    .icon-preview.has-icon {
      border-style: solid;
      border-color: var(--sl-color-neutral-200, #e2e8f0);
    }

    .icon-preview img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .icon-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
      color: var(--sl-color-neutral-400, #94a3b8);
    }

    .icon-placeholder sl-icon {
      font-size: 1.5rem;
    }

    .icon-placeholder span {
      font-size: 0.6875rem;
    }

    .icon-controls {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      justify-content: center;
      min-height: 100px;
    }

    .icon-controls p {
      margin: 0;
      font-size: 0.75rem;
      color: var(--sl-color-neutral-500, #64748b);
    }

    .icon-buttons {
      display: flex;
      gap: 0.5rem;
    }

    .icon-file-input {
      display: none;
    }
  `;

  /**
   * ID of the voicebank to edit metadata for.
   */
  @property({ type: String })
  voicebankId = '';

  /**
   * Whether the dialog is open.
   */
  @property({ type: Boolean, reflect: true })
  open = false;

  /**
   * Parsed character.txt data.
   */
  @state()
  private _characterData: CharacterData = { fields: {}, extraLines: [] };

  /**
   * Raw readme.txt content.
   */
  @state()
  private _readmeContent = '';

  /**
   * Whether data is currently being loaded.
   */
  @state()
  private _loading = false;

  /**
   * Whether a save operation is in progress.
   */
  @state()
  private _saving = false;

  /**
   * Error message to display, if any.
   */
  @state()
  private _error: string | null = null;

  /**
   * Whether data has been modified since last load/save.
   */
  @state()
  private _isDirty = false;

  /**
   * Whether the voicebank has an icon uploaded.
   */
  @state()
  private _hasIcon = false;

  /**
   * Cache-busting key appended to the icon URL to force reload after upload.
   */
  @state()
  private _iconCacheBuster = 0;

  /**
   * Whether an icon upload is in progress.
   */
  @state()
  private _uploadingIcon = false;

  /**
   * Whether data has been loaded for the current voicebankId.
   */
  private _loadedForVoicebankId: string | null = null;

  updated(changedProperties: Map<string, unknown>): void {
    // Load data when dialog is opened or voicebankId changes while open
    if (changedProperties.has('open') || changedProperties.has('voicebankId')) {
      if (this.open && this.voicebankId && this._loadedForVoicebankId !== this.voicebankId) {
        this._loadData();
      }
    }
  }

  /**
   * Load both character.txt and readme.txt content from the API.
   */
  private async _loadData(): Promise<void> {
    if (!this.voicebankId) return;

    this._loading = true;
    this._error = null;
    this._isDirty = false;

    try {
      const [characterContent, readmeContent] = await Promise.all([
        api.getMetadataFile(this.voicebankId, 'character.txt'),
        api.getMetadataFile(this.voicebankId, 'readme.txt'),
      ]);

      this._characterData = this._parseCharacterTxt(characterContent);
      this._readmeContent = readmeContent;
      this._loadedForVoicebankId = this.voicebankId;

      // Check if icon exists by attempting a HEAD request
      this._checkIconExists();
    } catch (error) {
      console.error('Failed to load metadata:', error);
      if (error instanceof ApiError) {
        this._error = error.message;
      } else {
        this._error = error instanceof Error ? error.message : 'Failed to load metadata';
      }
    } finally {
      this._loading = false;
    }
  }

  /**
   * Parse character.txt content into structured data.
   *
   * Known keys (name, author, web, voice, image, sample) are stored in
   * the fields map. Unknown lines are stored in extraLines to be preserved.
   */
  private _parseCharacterTxt(content: string): CharacterData {
    const knownKeys = new Set(CHARACTER_FIELDS.map((f) => f.key));
    const fields: Record<string, string> = {};
    const extraLines: string[] = [];

    if (!content.trim()) {
      return { fields, extraLines };
    }

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const equalsIndex = trimmed.indexOf('=');
      if (equalsIndex === -1) {
        // Line without = sign, preserve as-is
        extraLines.push(trimmed);
        continue;
      }

      const key = trimmed.substring(0, equalsIndex).trim().toLowerCase();
      const value = trimmed.substring(equalsIndex + 1).trim();

      if (knownKeys.has(key)) {
        fields[key] = value;
      } else {
        // Unknown key=value pair, preserve as-is
        extraLines.push(trimmed);
      }
    }

    return { fields, extraLines };
  }

  /**
   * Serialize character data back to character.txt format.
   *
   * Known fields are written first in a standard order, followed by
   * any extra lines that were preserved from the original file.
   */
  private _serializeCharacterTxt(): string {
    const lines: string[] = [];

    // Write known fields in defined order
    for (const field of CHARACTER_FIELDS) {
      const value = this._characterData.fields[field.key];
      if (value !== undefined && value !== '') {
        lines.push(`${field.key}=${value}`);
      }
    }

    // Append preserved extra lines
    for (const line of this._characterData.extraLines) {
      lines.push(line);
    }

    return lines.join('\n');
  }

  /**
   * Handle input change for a character.txt field.
   */
  private _onCharacterFieldChange(key: string, e: Event): void {
    const input = e.target as SlInput;
    this._characterData = {
      ...this._characterData,
      fields: {
        ...this._characterData.fields,
        [key]: input.value,
      },
    };
    this._isDirty = true;
  }

  /**
   * Handle readme.txt textarea change.
   */
  private _onReadmeChange(e: Event): void {
    const textarea = e.target as SlTextarea;
    this._readmeContent = textarea.value;
    this._isDirty = true;
  }

  /**
   * Check whether the voicebank has an icon by making a HEAD request.
   */
  private async _checkIconExists(): Promise<void> {
    if (!this.voicebankId) return;

    try {
      const iconUrl = api.getIconUrl(this.voicebankId);
      const response = await fetch(iconUrl, { method: 'HEAD' });
      this._hasIcon = response.ok;
    } catch {
      this._hasIcon = false;
    }
  }

  /**
   * Get the icon image URL with a cache-busting parameter.
   */
  private _getIconSrc(): string {
    return `${api.getIconUrl(this.voicebankId)}?t=${this._iconCacheBuster}`;
  }

  /**
   * Trigger the hidden file input for icon upload.
   */
  private _triggerIconUpload(): void {
    const input = this.renderRoot.querySelector('.icon-file-input') as HTMLInputElement;
    if (input) {
      input.value = '';
      input.click();
    }
  }

  /**
   * Handle icon file selection and upload immediately.
   */
  private async _onIconFileSelected(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.voicebankId) return;

    this._uploadingIcon = true;

    try {
      await api.uploadIcon(this.voicebankId, file);
      this._hasIcon = true;
      this._iconCacheBuster = Date.now();
      UvmToastManager.success('Icon uploaded');
    } catch (error) {
      console.error('Failed to upload icon:', error);
      if (error instanceof ApiError) {
        UvmToastManager.error(`Failed to upload icon: ${error.message}`);
      } else {
        UvmToastManager.error('Failed to upload icon');
      }
    } finally {
      this._uploadingIcon = false;
    }
  }

  /**
   * Delete the voicebank icon.
   */
  private async _deleteIcon(): Promise<void> {
    if (!this.voicebankId) return;

    try {
      await api.deleteIcon(this.voicebankId);
      this._hasIcon = false;
      UvmToastManager.success('Icon removed');
    } catch (error) {
      console.error('Failed to delete icon:', error);
      if (error instanceof ApiError) {
        UvmToastManager.error(`Failed to remove icon: ${error.message}`);
      } else {
        UvmToastManager.error('Failed to remove icon');
      }
    }
  }

  /**
   * Handle icon image load error (e.g., 404).
   */
  private _onIconError(): void {
    this._hasIcon = false;
  }

  /**
   * Save both character.txt and readme.txt to the API.
   */
  private async _save(): Promise<void> {
    if (!this.voicebankId || this._saving) return;

    this._saving = true;
    this._error = null;

    try {
      const characterContent = this._serializeCharacterTxt();

      await Promise.all([
        api.saveMetadataFile(this.voicebankId, 'character.txt', characterContent),
        api.saveMetadataFile(this.voicebankId, 'readme.txt', this._readmeContent),
      ]);

      this._isDirty = false;
      UvmToastManager.success('Voicebank metadata saved');
    } catch (error) {
      console.error('Failed to save metadata:', error);
      if (error instanceof ApiError) {
        this._error = error.message;
        UvmToastManager.error(`Failed to save metadata: ${error.message}`);
      } else {
        const message = error instanceof Error ? error.message : 'Failed to save metadata';
        this._error = message;
        UvmToastManager.error(message);
      }
    } finally {
      this._saving = false;
    }
  }

  /**
   * Handle dialog close (via X button or Escape).
   */
  private _onDialogClose(): void {
    this.open = false;
    this.dispatchEvent(
      new CustomEvent('uvm-metadata-editor:close', {
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Handle dialog request-close event to confirm unsaved changes.
   */
  private _onRequestClose(): void {
    this._onDialogClose();
  }

  /**
   * Public method to show the dialog programmatically.
   */
  public show(): void {
    this.open = true;
  }

  /**
   * Public method to hide the dialog programmatically.
   */
  public hide(): void {
    this._onDialogClose();
  }

  /**
   * Render the loading state.
   */
  private _renderLoading() {
    return html`
      <div class="loading-state">
        <sl-spinner></sl-spinner>
        <span>Loading metadata...</span>
      </div>
    `;
  }

  /**
   * Render the icon upload section.
   */
  private _renderIconSection() {
    return html`
      <div class="section-header">
        <sl-icon name="image"></sl-icon>
        <h3 class="section-title">Voicebank Icon</h3>
      </div>
      <p class="section-description">
        100x100 icon displayed in UTAU/OpenUTAU. Uploaded images are automatically resized.
      </p>

      <div class="icon-section">
        <div class="icon-preview ${this._hasIcon ? 'has-icon' : ''}">
          ${this._hasIcon
            ? html`<img
                src=${this._getIconSrc()}
                alt="Voicebank icon"
                @error=${this._onIconError}
              />`
            : html`
                <div class="icon-placeholder">
                  <sl-icon name="person-square"></sl-icon>
                  <span>No icon</span>
                </div>
              `}
        </div>

        <div class="icon-controls">
          <div class="icon-buttons">
            <sl-button
              size="small"
              variant="default"
              ?loading=${this._uploadingIcon}
              ?disabled=${this._uploadingIcon}
              @click=${this._triggerIconUpload}
            >
              <sl-icon slot="prefix" name="upload"></sl-icon>
              ${this._hasIcon ? 'Change' : 'Upload'}
            </sl-button>
            ${this._hasIcon
              ? html`
                  <sl-button
                    size="small"
                    variant="danger"
                    outline
                    @click=${this._deleteIcon}
                  >
                    <sl-icon slot="prefix" name="trash"></sl-icon>
                    Remove
                  </sl-button>
                `
              : null}
          </div>
          <p>PNG, JPG, or BMP. Will be converted to 100x100 BMP.</p>
        </div>

        <input
          type="file"
          class="icon-file-input"
          accept="image/png,image/jpeg,image/bmp"
          @change=${this._onIconFileSelected}
        />
      </div>
    `;
  }

  /**
   * Render the character.txt form fields.
   */
  private _renderCharacterForm() {
    return html`
      <div class="section-header">
        <sl-icon name="person-badge"></sl-icon>
        <h3 class="section-title">Character Info</h3>
      </div>
      <p class="section-description">
        Information stored in character.txt. Used by UTAU/OpenUTAU to display voicebank details.
      </p>

      <div class="form-grid">
        ${CHARACTER_FIELDS.map((field) => {
          // Name and author get full width
          const isFullWidth = field.key === 'name' || field.key === 'web';
          return html`
            <sl-input
              class="${isFullWidth ? 'full-width' : ''}"
              label=${field.label}
              placeholder=${field.placeholder}
              .value=${this._characterData.fields[field.key] ?? ''}
              @sl-input=${(e: Event) => this._onCharacterFieldChange(field.key, e)}
            ></sl-input>
          `;
        })}
      </div>

      ${this._characterData.extraLines.length > 0
        ? html`
            <p class="extra-fields-note">
              ${this._characterData.extraLines.length} additional field${this._characterData.extraLines.length > 1 ? 's' : ''} will be preserved on save.
            </p>
          `
        : null}
    `;
  }

  /**
   * Render the readme.txt textarea.
   */
  private _renderReadmeSection() {
    return html`
      <div class="readme-section">
        <div class="section-header">
          <sl-icon name="file-text"></sl-icon>
          <h3 class="section-title">Readme</h3>
        </div>
        <p class="section-description">
          Free-form text stored in readme.txt. Usage terms, credits, and notes.
        </p>

        <sl-textarea
          placeholder="Enter voicebank readme content..."
          rows="6"
          resize="vertical"
          .value=${this._readmeContent}
          @sl-input=${this._onReadmeChange}
        ></sl-textarea>
      </div>
    `;
  }

  /**
   * Render the dialog footer with save button and status.
   */
  private _renderFooter() {
    return html`
      <div slot="footer" class="dialog-footer">
        <div class="save-status">
          ${this._isDirty
            ? html`<sl-icon name="circle-fill" style="color: var(--sl-color-warning-500); font-size: 0.5rem;"></sl-icon> Unsaved changes`
            : null}
        </div>
        <div class="dialog-footer-right">
          <sl-button variant="default" @click=${this._onDialogClose}>
            Cancel
          </sl-button>
          <sl-button
            variant="primary"
            ?loading=${this._saving}
            ?disabled=${!this._isDirty || this._saving}
            @click=${this._save}
          >
            <sl-icon slot="prefix" name="check-lg"></sl-icon>
            Save
          </sl-button>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <sl-dialog
        label="Voicebank Metadata"
        ?open=${this.open}
        @sl-request-close=${this._onRequestClose}
      >
        ${this._loading
          ? this._renderLoading()
          : html`
              ${this._error
                ? html`
                    <sl-alert variant="danger" open class="error-state">
                      <sl-icon slot="icon" name="exclamation-octagon"></sl-icon>
                      ${this._error}
                    </sl-alert>
                  `
                : null}

              ${this._renderIconSection()}
              <sl-divider></sl-divider>
              ${this._renderCharacterForm()}
              <sl-divider></sl-divider>
              ${this._renderReadmeSection()}
            `}

        ${this._renderFooter()}
      </sl-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-metadata-editor': UvmMetadataEditor;
  }
}
