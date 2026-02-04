/**
 * Voice Complete component - the "Your Voice is Ready" completion flow.
 *
 * Replaces the inline _renderComplete() in uvm-recording-session.ts with
 * a standalone component that follows an emotional arc:
 *   Recording complete -> "It worked! That's me!" -> "Wait, there's more I can do?" -> "Yes, I want that"
 *
 * Design principles:
 * - UTAU download is instant, always available (the safe familiar path)
 * - "Preview Your Voice" is the primary CTA (uses uvm-first-sing)
 * - "Enhanced Voice" is presented as a bonus, not a fork (progressive disclosure)
 * - No technical jargon visible (no "DiffSinger", "GPT-SoVITS", "neural")
 * - Compact stats row shown subtly
 *
 * @fires create-another - User wants to start a new recording session
 * @fires open-editor - User wants to fine-tune in the editor
 *
 * @example
 * ```html
 * <uvm-voice-complete
 *   voicebankName="My Voice"
 *   voicebankId="my-voice"
 *   sessionId="abc-123"
 *   .generatedVoicebank=${result}
 *   @create-another=${this._onCreateAnother}
 *   @open-editor=${this._onOpenEditor}
 * ></uvm-voice-complete>
 * ```
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

// Shoelace components
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';
import '@shoelace-style/shoelace/dist/components/badge/badge.js';

// Child components
import './uvm-first-sing.js';

import type { GeneratedVoicebank } from '../services/recording-api.js';

@customElement('uvm-voice-complete')
export class UvmVoiceComplete extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
    }

    .voice-complete {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 3rem 2rem 2.5rem;
      background-color: white;
      border-radius: 16px;
      text-align: center;
      max-width: 520px;
      margin: 0 auto;
    }

    /* ── Success heading ───────────────────────────────── */

    .success-icon {
      font-size: 2.5rem;
      color: var(--sl-color-neutral-900, #0f172a);
      margin-bottom: 1rem;
    }

    h2 {
      margin: 0 0 0.375rem;
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--sl-color-neutral-900, #0f172a);
      letter-spacing: -0.02em;
    }

    .subtitle {
      margin: 0 0 2rem;
      font-size: 0.9375rem;
      color: var(--sl-color-neutral-500, #64748b);
      font-weight: 400;
    }

    /* ── Preview section ───────────────────────────────── */

    .preview-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1.75rem;
      width: 100%;
    }

    .preview-hint {
      margin: 0;
      font-size: 0.8125rem;
      color: var(--sl-color-neutral-400, #94a3b8);
    }

    /* ── Stats row ─────────────────────────────────────── */

    .stats-row {
      display: flex;
      flex-wrap: wrap;
      gap: 2rem;
      justify-content: center;
      padding: 1rem 0;
      margin-bottom: 1.5rem;
    }

    .stat {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
    }

    .stat-value {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--sl-color-neutral-800, #1e293b);
    }

    .stat-label {
      font-size: 0.6875rem;
      color: var(--sl-color-neutral-400, #94a3b8);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    /* ── Warnings ──────────────────────────────────────── */

    .warnings-section {
      width: 100%;
      margin-bottom: 1rem;
    }

    .warnings-section sl-alert {
      text-align: left;
    }

    /* ── Generation time ───────────────────────────────── */

    .generation-time {
      font-size: 0.75rem;
      color: var(--sl-color-neutral-400, #94a3b8);
      margin-bottom: 1.5rem;
    }

    /* ── Download section ──────────────────────────────── */

    .download-section {
      width: 100%;
      margin-bottom: 0.5rem;
    }

    .download-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 1rem 1.25rem;
      background-color: var(--sl-color-neutral-50, #f8fafc);
      border-radius: 12px;
    }

    .download-info {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      text-align: left;
    }

    .download-info > sl-icon {
      font-size: 1.25rem;
      color: var(--sl-color-neutral-500, #64748b);
      flex-shrink: 0;
    }

    .download-text {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
    }

    .download-title {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--sl-color-neutral-700, #334155);
    }

    .download-desc {
      font-size: 0.75rem;
      color: var(--sl-color-neutral-400, #94a3b8);
    }

    /* ── Divider ───────────────────────────────────────── */

    sl-divider {
      --spacing: 1.5rem;
      width: 100%;
    }

    /* ── Enhanced Voice teaser ─────────────────────────── */

    .enhanced-section {
      width: 100%;
    }

    .enhanced-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 1.25rem;
      background-color: var(--sl-color-neutral-50, #f8fafc);
      border-radius: 12px;
      border: 1px dashed var(--sl-color-neutral-200, #e2e8f0);
      opacity: 0.7;
      cursor: default;
      transition: opacity 0.2s ease;
    }

    .enhanced-card:hover {
      opacity: 0.85;
    }

    .enhanced-content {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.375rem;
      text-align: left;
    }

    .enhanced-content sl-badge {
      margin-bottom: 0.125rem;
    }

    .enhanced-title {
      font-size: 0.9375rem;
      font-weight: 500;
      color: var(--sl-color-neutral-700, #334155);
    }

    .enhanced-desc {
      font-size: 0.8125rem;
      color: var(--sl-color-neutral-400, #94a3b8);
      line-height: 1.5;
    }

    .enhanced-arrow {
      font-size: 1.25rem;
      color: var(--sl-color-neutral-300, #cbd5e1);
      flex-shrink: 0;
    }

    /* ── Secondary actions ─────────────────────────────── */

    .secondary-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 1.5rem;
      flex-wrap: wrap;
      justify-content: center;
    }

    .secondary-actions sl-button::part(base) {
      font-size: 0.875rem;
    }

    /* ── Responsive ────────────────────────────────────── */

    @media (max-width: 640px) {
      .voice-complete {
        padding: 2rem 1.25rem 2rem;
      }

      h2 {
        font-size: 1.25rem;
      }

      .stats-row {
        gap: 1.25rem;
      }

      .stat-value {
        font-size: 1rem;
      }

      .download-row {
        flex-direction: column;
        align-items: stretch;
        gap: 0.75rem;
        text-align: center;
      }

      .download-info {
        justify-content: center;
      }

      .secondary-actions {
        flex-direction: column;
        width: 100%;
      }

      .secondary-actions sl-button {
        width: 100%;
      }
    }
  `;

  /**
   * Display name for the voicebank.
   */
  @property({ type: String })
  voicebankName = '';

  /**
   * Voicebank identifier used by uvm-first-sing for sample loading.
   */
  @property({ type: String })
  voicebankId = '';

  /**
   * Session identifier for constructing the download URL.
   */
  @property({ type: String })
  sessionId = '';

  /**
   * Generated voicebank result containing stats and warnings.
   */
  @property({ attribute: false })
  generatedVoicebank?: GeneratedVoicebank;

  /**
   * Trigger download of the voicebank ZIP via a hidden anchor click.
   */
  private _onDownload(): void {
    if (!this.sessionId) return;

    const downloadUrl = `/api/v1/sessions/${this.sessionId}/download`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `${this.voicebankName || 'voicebank'}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Dispatch event to open the editor for fine-tuning.
   */
  private _onOpenEditor(): void {
    this.dispatchEvent(
      new CustomEvent('open-editor', {
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Dispatch event to start a new recording session.
   */
  private _onCreateAnother(): void {
    this.dispatchEvent(
      new CustomEvent('create-another', {
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Render the compact stats row (samples, oto entries, confidence).
   */
  private _renderStats() {
    if (!this.generatedVoicebank) return nothing;

    const { sample_count, oto_entries, average_confidence } = this.generatedVoicebank;
    const confidence = Math.round(average_confidence * 100);

    return html`
      <div class="stats-row">
        <div class="stat">
          <span class="stat-value">${sample_count}</span>
          <span class="stat-label">Samples</span>
        </div>
        <div class="stat">
          <span class="stat-value">${oto_entries}</span>
          <span class="stat-label">Configured</span>
        </div>
        <div class="stat">
          <span class="stat-value">${confidence}%</span>
          <span class="stat-label">Confidence</span>
        </div>
      </div>
    `;
  }

  /**
   * Render warnings alert if any warnings exist.
   */
  private _renderWarnings() {
    if (
      !this.generatedVoicebank ||
      this.generatedVoicebank.warnings.length === 0
    ) {
      return nothing;
    }

    const { warnings, skipped_segments } = this.generatedVoicebank;

    return html`
      <div class="warnings-section">
        <sl-alert variant="warning" open>
          <sl-icon slot="icon" name="exclamation-triangle"></sl-icon>
          ${warnings.length} warning${warnings.length !== 1 ? 's' : ''} during
          generation.${skipped_segments > 0
            ? ` ${skipped_segments} segment${skipped_segments !== 1 ? 's were' : ' was'} skipped.`
            : ''}
        </sl-alert>
      </div>
    `;
  }

  /**
   * Render generation time if it is notable (>= 1 second).
   */
  private _renderGenerationTime() {
    if (
      !this.generatedVoicebank ||
      this.generatedVoicebank.generation_time_seconds < 1
    ) {
      return nothing;
    }

    return html`
      <p class="generation-time">
        Generated in ${this.generatedVoicebank.generation_time_seconds.toFixed(1)}s
      </p>
    `;
  }

  render() {
    const displayName = this.voicebankName || 'Your voicebank';

    return html`
      <div class="voice-complete">
        <!-- Success icon + heading -->
        <sl-icon name="check-circle-fill" class="success-icon"></sl-icon>
        <h2>Your voice is ready</h2>
        <p class="subtitle">"${displayName}" is ready to sing</p>

        <!-- Primary CTA: Preview -->
        <div class="preview-section">
          <uvm-first-sing .voicebankId=${this.voicebankId}></uvm-first-sing>
          <p class="preview-hint">Hear a sample of how you'll sound</p>
        </div>

        <!-- Compact stats -->
        ${this._renderStats()}

        <!-- Warnings if any -->
        ${this._renderWarnings()}

        <!-- Generation time -->
        ${this._renderGenerationTime()}

        <!-- Download action -->
        <div class="download-section">
          <div class="download-row">
            <div class="download-info">
              <sl-icon name="box-arrow-down"></sl-icon>
              <div class="download-text">
                <span class="download-title">Download for UTAU / OpenUTAU</span>
                <span class="download-desc">Ready to use with any UTAU engine</span>
              </div>
            </div>
            <sl-button variant="default" @click=${this._onDownload}>
              <sl-icon slot="prefix" name="download"></sl-icon>
              Download
            </sl-button>
          </div>
        </div>

        <sl-divider></sl-divider>

        <!-- Enhanced Voice teaser -->
        <div class="enhanced-section">
          <div class="enhanced-card" aria-disabled="true">
            <div class="enhanced-content">
              <sl-badge variant="neutral" pill>Coming soon</sl-badge>
              <span class="enhanced-title">Enhanced Voice</span>
              <span class="enhanced-desc">
                Train a voice that speaks and sings naturally. Ready in about 15
                minutes.
              </span>
            </div>
            <sl-icon name="chevron-right" class="enhanced-arrow"></sl-icon>
          </div>
        </div>

        <!-- Secondary actions -->
        <div class="secondary-actions">
          <sl-button variant="text" @click=${this._onOpenEditor}>
            <sl-icon slot="prefix" name="sliders"></sl-icon>
            Fine-tune in Editor
          </sl-button>
          <sl-button variant="text" @click=${this._onCreateAnother}>
            <sl-icon slot="prefix" name="plus-lg"></sl-icon>
            Create Another
          </sl-button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-voice-complete': UvmVoiceComplete;
  }
}
