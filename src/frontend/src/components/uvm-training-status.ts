/**
 * Training Status component - ambient waiting UI for voice training jobs.
 *
 * Replaces a typical progress bar with a calm, ambient experience.
 * Design philosophy: make waiting disappear.
 *
 * Features:
 * - Gentle pulse animation (CSS-only, no JS timers for animation)
 * - Rotating ambient status messages (emotional, not technical)
 * - Polls job status via GET /api/jobs/{id} at configurable intervals
 * - UTAU voicebank download available immediately while training runs
 * - Three states: polling -> complete -> error
 *
 * @fires training-complete - Training job finished successfully
 * @fires training-error - Training job failed
 *
 * @example
 * ```html
 * <uvm-training-status
 *   jobId="abc-123"
 *   voicebankId="my-voice"
 *   voicebankName="My Voice"
 *   @training-complete=${this._onComplete}
 * ></uvm-training-status>
 * ```
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// Shoelace components
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';

import type { Job } from '../services/recording-api.js';
import { recordingApi } from '../services/recording-api.js';

/**
 * Ambient status messages rotated while training is in progress.
 * These are emotional and reassuring, never tied to actual training steps.
 */
const AMBIENT_MESSAGES = [
  'Learning your vowels...',
  'Studying your consonants...',
  'Refining expression...',
  'Shaping your tone...',
  'Listening closely...',
  'Tuning the nuances...',
];

/**
 * Interval range for rotating ambient messages (milliseconds).
 * A random interval between MIN and MAX is chosen each rotation.
 */
const MESSAGE_ROTATE_MIN_MS = 30_000;
const MESSAGE_ROTATE_MAX_MS = 60_000;

/** Default polling interval for job status (milliseconds). */
const DEFAULT_POLL_INTERVAL_MS = 10_000;

@customElement('uvm-training-status')
export class UvmTrainingStatus extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
    }

    .training-status {
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

    /* -- Heading ------------------------------------------------ */

    h2 {
      margin: 0 0 1.5rem;
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--sl-color-neutral-900, #0f172a);
      letter-spacing: -0.02em;
    }

    /* -- Pulse dots (CSS-only animation) ----------------------- */

    .pulse-dots {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      margin-bottom: 1.75rem;
    }

    .pulse-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background-color: var(--sl-color-neutral-300, #cbd5e1);
      animation: gentle-pulse 2.4s ease-in-out infinite;
    }

    .pulse-dot:nth-child(2) {
      animation-delay: 0.4s;
    }

    .pulse-dot:nth-child(3) {
      animation-delay: 0.8s;
    }

    @keyframes gentle-pulse {
      0%, 100% {
        opacity: 0.3;
        transform: scale(0.85);
      }
      50% {
        opacity: 1;
        transform: scale(1);
      }
    }

    /* -- Ambient message --------------------------------------- */

    .ambient-message {
      margin: 0 0 0.5rem;
      font-size: 0.9375rem;
      color: var(--sl-color-neutral-500, #64748b);
      font-weight: 400;
      min-height: 1.5em;
      transition: opacity 0.6s ease;
    }

    .ambient-message.fading {
      opacity: 0;
    }

    /* -- Info text --------------------------------------------- */

    .info-text {
      margin: 0 0 0.25rem;
      font-size: 0.875rem;
      color: var(--sl-color-neutral-400, #94a3b8);
      line-height: 1.6;
    }

    /* -- Divider ----------------------------------------------- */

    sl-divider {
      --spacing: 1.75rem;
      width: 100%;
    }

    /* -- Download section ------------------------------------- */

    .download-section {
      width: 100%;
    }

    .download-heading {
      margin: 0 0 1rem;
      font-size: 0.9375rem;
      color: var(--sl-color-neutral-600, #475569);
      font-weight: 400;
      line-height: 1.6;
    }

    .download-heading strong {
      font-weight: 500;
      color: var(--sl-color-neutral-700, #334155);
    }

    .download-button-wrapper {
      margin-bottom: 1.25rem;
    }

    .download-button::part(base) {
      font-size: 0.9375rem;
      font-weight: 500;
    }

    /* -- Close page note --------------------------------------- */

    .close-note {
      margin: 0;
      font-size: 0.8125rem;
      color: var(--sl-color-neutral-400, #94a3b8);
    }

    /* -- Complete state ---------------------------------------- */

    .complete-icon {
      font-size: 2.5rem;
      color: var(--sl-color-success-600, #16a34a);
      margin-bottom: 1rem;
    }

    .complete-subtitle {
      margin: 0 0 2rem;
      font-size: 0.9375rem;
      color: var(--sl-color-neutral-500, #64748b);
      font-weight: 400;
    }

    .review-button::part(base) {
      font-size: 1rem;
      font-weight: 500;
      padding: 0.875rem 2rem;
      border-radius: 9999px;
    }

    /* -- Error state ------------------------------------------- */

    .error-section {
      width: 100%;
    }

    .error-section sl-alert {
      text-align: left;
      margin-bottom: 1.5rem;
    }

    .error-message {
      font-size: 0.875rem;
      line-height: 1.5;
    }

    .retry-button::part(base) {
      font-size: 0.9375rem;
    }

    /* -- Responsive -------------------------------------------- */

    @media (max-width: 640px) {
      .training-status {
        padding: 2rem 1.25rem 2rem;
      }

      h2 {
        font-size: 1.25rem;
      }
    }
  `;

  // ─── Public properties ──────────────────────────────────────────────────────

  /**
   * The job ID to poll for training status.
   */
  @property({ type: String })
  jobId = '';

  /**
   * Voicebank identifier for the download link.
   */
  @property({ type: String })
  voicebankId = '';

  /**
   * Display name for the voicebank.
   */
  @property({ type: String })
  voicebankName = '';

  /**
   * Session ID for constructing the UTAU download URL.
   */
  @property({ type: String })
  sessionId = '';

  /**
   * Polling interval in milliseconds. Defaults to 10 seconds.
   */
  @property({ type: Number })
  pollInterval = DEFAULT_POLL_INTERVAL_MS;

  // ─── Private state ──────────────────────────────────────────────────────────

  /**
   * Current job phase: polling, complete, or error.
   */
  @state()
  private _phase: 'polling' | 'complete' | 'error' = 'polling';

  /**
   * Current ambient status message index.
   */
  @state()
  private _messageIndex = 0;

  /**
   * Whether the ambient message is mid-fade (for crossfade transition).
   */
  @state()
  private _messageFading = false;

  /**
   * Error message to display when training fails.
   */
  @state()
  private _errorMessage = '';

  /**
   * The last job object received from the API.
   */
  @state()
  private _lastJob: Job | null = null;

  /**
   * Timer ID for the polling interval.
   */
  private _pollTimerId: ReturnType<typeof setTimeout> | null = null;

  /**
   * Timer ID for the ambient message rotation.
   */
  private _messageTimerId: ReturnType<typeof setTimeout> | null = null;

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  connectedCallback(): void {
    super.connectedCallback();
    this._startPolling();
    this._startMessageRotation();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopPolling();
    this._stopMessageRotation();
  }

  updated(changedProperties: Map<PropertyKey, unknown>): void {
    // Restart polling if jobId changes
    if (changedProperties.has('jobId') && this.jobId) {
      this._phase = 'polling';
      this._stopPolling();
      this._startPolling();
    }
  }

  // ─── Polling logic ──────────────────────────────────────────────────────────

  private _startPolling(): void {
    if (!this.jobId) return;

    // Poll immediately, then on interval
    this._pollJob();
  }

  private _stopPolling(): void {
    if (this._pollTimerId !== null) {
      clearTimeout(this._pollTimerId);
      this._pollTimerId = null;
    }
  }

  private async _pollJob(): Promise<void> {
    if (!this.jobId || this._phase !== 'polling') return;

    try {
      const job = await recordingApi.getJobStatus(this.jobId);
      this._lastJob = job;

      if (job.status === 'completed') {
        this._phase = 'complete';
        this._stopPolling();
        this._stopMessageRotation();
        this.dispatchEvent(
          new CustomEvent('training-complete', {
            detail: { job },
            bubbles: true,
            composed: true,
          })
        );
        return;
      }

      if (job.status === 'failed') {
        this._phase = 'error';
        this._errorMessage =
          job.result?.error ?? 'Training encountered an unexpected issue.';
        this._stopPolling();
        this._stopMessageRotation();
        this.dispatchEvent(
          new CustomEvent('training-error', {
            detail: { job, error: this._errorMessage },
            bubbles: true,
            composed: true,
          })
        );
        return;
      }

      // Still queued or running -- schedule next poll
      this._pollTimerId = setTimeout(() => this._pollJob(), this.pollInterval);
    } catch {
      // Network or API error -- schedule retry with same interval
      this._pollTimerId = setTimeout(() => this._pollJob(), this.pollInterval);
    }
  }

  // ─── Ambient message rotation ───────────────────────────────────────────────

  private _startMessageRotation(): void {
    this._scheduleNextMessage();
  }

  private _stopMessageRotation(): void {
    if (this._messageTimerId !== null) {
      clearTimeout(this._messageTimerId);
      this._messageTimerId = null;
    }
  }

  private _scheduleNextMessage(): void {
    const delay =
      MESSAGE_ROTATE_MIN_MS +
      Math.random() * (MESSAGE_ROTATE_MAX_MS - MESSAGE_ROTATE_MIN_MS);

    this._messageTimerId = setTimeout(() => {
      // Start fade out
      this._messageFading = true;

      // After the CSS transition (600ms), swap text and fade in
      setTimeout(() => {
        this._messageIndex =
          (this._messageIndex + 1) % AMBIENT_MESSAGES.length;
        this._messageFading = false;
        // Schedule the next rotation
        this._scheduleNextMessage();
      }, 600);
    }, delay);
  }

  // ─── Actions ────────────────────────────────────────────────────────────────

  /**
   * Trigger download of the UTAU voicebank ZIP.
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
   * Retry the training by restarting the poll cycle.
   * The parent component should handle actual job re-submission;
   * this just re-enters the polling phase for the same jobId.
   */
  private _onRetry(): void {
    this._phase = 'polling';
    this._errorMessage = '';
    this._startPolling();
    this._startMessageRotation();
  }

  /**
   * Dispatch event so the parent can navigate to the result review.
   */
  private _onReviewResult(): void {
    this.dispatchEvent(
      new CustomEvent('review-result', {
        detail: { job: this._lastJob },
        bubbles: true,
        composed: true,
      })
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  render() {
    switch (this._phase) {
      case 'polling':
        return this._renderPolling();
      case 'complete':
        return this._renderComplete();
      case 'error':
        return this._renderError();
    }
  }

  private _renderPolling() {
    const currentMessage = AMBIENT_MESSAGES[this._messageIndex];

    return html`
      <div class="training-status">
        <h2>Your voice is training</h2>

        <!-- Gentle pulse animation (CSS-only) -->
        <div class="pulse-dots" aria-hidden="true">
          <div class="pulse-dot"></div>
          <div class="pulse-dot"></div>
          <div class="pulse-dot"></div>
        </div>

        <!-- Rotating ambient message -->
        <p
          class="ambient-message ${this._messageFading ? 'fading' : ''}"
          aria-live="polite"
        >
          ${currentMessage}
        </p>

        <!-- Reassurance text -->
        <p class="info-text">We'll notify you when it's ready.</p>
        <p class="info-text">This usually takes about 15 minutes.</p>

        <sl-divider></sl-divider>

        <!-- Download UTAU voicebank while waiting -->
        <div class="download-section">
          <p class="download-heading">
            While you wait, your <strong>UTAU voicebank</strong> is ready to use
            now:
          </p>
          <div class="download-button-wrapper">
            <sl-button
              class="download-button"
              variant="default"
              size="medium"
              @click=${this._onDownload}
              ?disabled=${!this.sessionId}
            >
              <sl-icon slot="prefix" name="download"></sl-icon>
              Download UTAU Voicebank
            </sl-button>
          </div>
          <p class="close-note">You can close this page anytime.</p>
        </div>
      </div>
    `;
  }

  private _renderComplete() {
    const displayName = this.voicebankName || 'Your voice';

    return html`
      <div class="training-status">
        <sl-icon name="check-circle-fill" class="complete-icon"></sl-icon>
        <h2>Training complete</h2>
        <p class="complete-subtitle">
          "${displayName}" has finished training and is ready to review.
        </p>

        <sl-button
          class="review-button"
          variant="primary"
          size="large"
          @click=${this._onReviewResult}
        >
          <sl-icon slot="prefix" name="play-circle"></sl-icon>
          Review Your Voice
        </sl-button>

        <sl-divider></sl-divider>

        <!-- Download section still available -->
        <div class="download-section">
          <div class="download-button-wrapper">
            <sl-button
              class="download-button"
              variant="default"
              size="medium"
              @click=${this._onDownload}
              ?disabled=${!this.sessionId}
            >
              <sl-icon slot="prefix" name="download"></sl-icon>
              Download UTAU Voicebank
            </sl-button>
          </div>
        </div>
      </div>
    `;
  }

  private _renderError() {
    return html`
      <div class="training-status">
        <h2>Training paused</h2>

        <div class="error-section">
          <sl-alert variant="warning" open>
            <sl-icon slot="icon" name="exclamation-triangle"></sl-icon>
            <p class="error-message">
              ${this._errorMessage ||
              'Something went wrong during training. This can sometimes happen with complex audio.'}
            </p>
          </sl-alert>

          <sl-button
            class="retry-button"
            variant="default"
            size="medium"
            @click=${this._onRetry}
          >
            <sl-icon slot="prefix" name="arrow-clockwise"></sl-icon>
            Try Again
          </sl-button>
        </div>

        <sl-divider></sl-divider>

        <!-- Download section still available -->
        <div class="download-section">
          <p class="download-heading">
            Your <strong>UTAU voicebank</strong> is still available:
          </p>
          <div class="download-button-wrapper">
            <sl-button
              class="download-button"
              variant="default"
              size="medium"
              @click=${this._onDownload}
              ?disabled=${!this.sessionId}
            >
              <sl-icon slot="prefix" name="download"></sl-icon>
              Download UTAU Voicebank
            </sl-button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-training-status': UvmTrainingStatus;
  }
}
