import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/progress-bar/progress-bar.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/badge/badge.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';

// Import child components
import './uvm-recording-prompter.js';

import { UvmToastManager } from './uvm-toast-manager.js';
import type { PhonemePrompt } from './uvm-recording-prompter.js';
import {
  recordingApi,
  type GeneratedVoicebank,
  type SessionProgress,
} from '../services/recording-api.js';
import { ApiError } from '../services/api.js';

/**
 * Recording session phase.
 */
type SessionPhase = 'setup' | 'recording' | 'processing' | 'complete' | 'error';

/**
 * Recording complete event detail from the prompter.
 */
interface RecordingCompleteDetail {
  audioBlob: Blob;
  duration: number;
  promptId?: string;
}

/**
 * Guided recording session component for creating voicebanks.
 *
 * This component manages the full user journey:
 * 1. Setup - Configure voicebank name, style, and language
 * 2. Recording - Record prompts one-by-one with the prompter
 * 3. Processing - Generate the voicebank with ML alignment
 * 4. Complete - Download the finished voicebank
 *
 * @fires session-complete - Fired when voicebank generation completes
 * @fires session-cancelled - Fired when user cancels the session
 *
 * @example
 * ```html
 * <uvm-recording-session
 *   @session-complete=${this._onSessionComplete}
 * ></uvm-recording-session>
 * ```
 */
@customElement('uvm-recording-session')
export class UvmRecordingSession extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
      max-width: 900px;
      margin: 0 auto;
    }

    .session-container {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    /* Setup Phase */
    .setup-card {
      padding: 2rem;
    }

    .setup-card::part(base) {
      border-radius: var(--sl-border-radius-large, 0.5rem);
    }

    .setup-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1.5rem;
    }

    .setup-header sl-icon {
      font-size: 1.5rem;
      color: var(--sl-color-primary-600, #2563eb);
    }

    .setup-header h2 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--sl-color-neutral-900, #0f172a);
    }

    .setup-form {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .form-group label {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--sl-color-neutral-700, #334155);
    }

    .form-group-description {
      font-size: 0.75rem;
      color: var(--sl-color-neutral-500, #64748b);
      margin-top: 0.25rem;
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      margin-top: 1rem;
    }

    /* Recording Phase */
    .recording-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.5rem;
      background-color: var(--sl-color-neutral-50, #f8fafc);
      border: 1px solid var(--sl-color-neutral-200, #e2e8f0);
      border-radius: var(--sl-border-radius-medium, 0.375rem);
    }

    .recording-info {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .recording-info h3 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      color: var(--sl-color-neutral-800, #1e293b);
    }

    .recording-progress {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 1rem;
    }

    .progress-info {
      display: flex;
      justify-content: space-between;
      font-size: 0.875rem;
      color: var(--sl-color-neutral-600, #475569);
    }

    .recording-controls {
      display: flex;
      gap: 0.5rem;
    }

    /* Processing Phase */
    .processing-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4rem 2rem;
      background-color: var(--sl-color-neutral-50, #f8fafc);
      border: 1px solid var(--sl-color-neutral-200, #e2e8f0);
      border-radius: var(--sl-border-radius-large, 0.5rem);
      text-align: center;
    }

    .processing-container sl-spinner {
      font-size: 3rem;
      --indicator-color: var(--sl-color-primary-500, #3b82f6);
      margin-bottom: 1.5rem;
    }

    .processing-container h3 {
      margin: 0 0 0.5rem;
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--sl-color-neutral-800, #1e293b);
    }

    .processing-status {
      font-size: 0.875rem;
      color: var(--sl-color-neutral-600, #475569);
      margin-bottom: 1.5rem;
    }

    .processing-progress {
      width: 100%;
      max-width: 400px;
    }

    /* Complete Phase */
    .complete-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 3rem 2rem;
      background-color: var(--sl-color-success-50, #f0fdf4);
      border: 1px solid var(--sl-color-success-200, #bbf7d0);
      border-radius: var(--sl-border-radius-large, 0.5rem);
      text-align: center;
    }

    .complete-icon {
      font-size: 4rem;
      color: var(--sl-color-success-500, #22c55e);
      margin-bottom: 1.5rem;
    }

    .complete-container h3 {
      margin: 0 0 0.5rem;
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--sl-color-neutral-900, #0f172a);
    }

    .complete-description {
      font-size: 1rem;
      color: var(--sl-color-neutral-600, #475569);
      margin-bottom: 1.5rem;
    }

    .voicebank-stats {
      display: flex;
      gap: 2rem;
      margin-bottom: 2rem;
    }

    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
    }

    .stat-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--sl-color-neutral-800, #1e293b);
    }

    .stat-label {
      font-size: 0.75rem;
      color: var(--sl-color-neutral-500, #64748b);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .complete-actions {
      display: flex;
      gap: 0.75rem;
    }

    /* Error Phase */
    .error-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 3rem 2rem;
      background-color: var(--sl-color-danger-50, #fef2f2);
      border: 1px solid var(--sl-color-danger-200, #fecaca);
      border-radius: var(--sl-border-radius-large, 0.5rem);
      text-align: center;
    }

    .error-icon {
      font-size: 4rem;
      color: var(--sl-color-danger-500, #ef4444);
      margin-bottom: 1.5rem;
    }

    .error-container h3 {
      margin: 0 0 0.5rem;
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--sl-color-neutral-900, #0f172a);
    }

    .error-message {
      font-size: 0.875rem;
      color: var(--sl-color-neutral-600, #475569);
      margin-bottom: 1.5rem;
      max-width: 400px;
    }

    .error-actions {
      display: flex;
      gap: 0.75rem;
    }

    /* Responsive */
    @media (max-width: 640px) {
      .setup-card {
        padding: 1.5rem;
      }

      .voicebank-stats {
        gap: 1rem;
      }

      .stat-value {
        font-size: 1.25rem;
      }

      .complete-actions,
      .error-actions {
        flex-direction: column;
        width: 100%;
      }

      .complete-actions sl-button,
      .error-actions sl-button {
        width: 100%;
      }
    }
  `;

  @state()
  private _phase: SessionPhase = 'setup';

  @state()
  private _sessionId?: string;

  @state()
  private _voicebankName = '';

  @state()
  private _recordingStyle: 'cv' | 'vcv' | 'cvvc' = 'cv';

  @state()
  private _language = 'ja';

  @state()
  private _prompts: PhonemePrompt[] = [];

  @state()
  private _currentPromptIndex = 0;

  @state()
  private _progress = 0;

  @state()
  private _processingStatus = 'Initializing...';

  @state()
  private _generatedVoicebank?: GeneratedVoicebank;

  @state()
  private _errorMessage = '';

  @state()
  private _isLoading = false;

  @state()
  private _skippedPrompts: Set<number> = new Set();

  private _pollIntervalId?: number;

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopPolling();
  }

  /**
   * Handle setup form submission.
   */
  private async _onStartRecording(): Promise<void> {
    if (!this._voicebankName.trim()) {
      UvmToastManager.warning('Please enter a voicebank name');
      return;
    }

    this._isLoading = true;
    this._errorMessage = '';

    try {
      // Get prompts for the selected style
      const prompts = recordingApi.getPrompts(this._recordingStyle, this._language);
      this._prompts = prompts;

      // Create session on backend
      const result = await recordingApi.createSession({
        voicebankName: this._voicebankName.trim(),
        style: this._recordingStyle,
        language: this._language,
      });

      this._sessionId = result.sessionId;

      // Start the recording session
      await recordingApi.startSession(this._sessionId);

      this._currentPromptIndex = 0;
      this._skippedPrompts = new Set();
      this._phase = 'recording';

      UvmToastManager.success('Recording session started');
    } catch (error) {
      console.error('Failed to start recording session:', error);
      if (error instanceof ApiError) {
        this._errorMessage = error.message;
        UvmToastManager.error(error.message);
      } else {
        this._errorMessage = 'Failed to start recording session';
        UvmToastManager.error('Failed to start recording session');
      }
    } finally {
      this._isLoading = false;
    }
  }

  /**
   * Handle recording complete from the prompter.
   */
  private async _onRecordingComplete(
    e: CustomEvent<RecordingCompleteDetail>
  ): Promise<void> {
    if (!this._sessionId) return;

    const { audioBlob, duration } = e.detail;
    const currentPrompt = this._prompts[this._currentPromptIndex];

    try {
      // Upload the segment to the backend
      await recordingApi.uploadSegment(
        this._sessionId,
        this._currentPromptIndex,
        currentPrompt.romaji,
        audioBlob,
        duration * 1000 // Convert to ms
      );

      // Move to next prompt
      this._advanceToNextPrompt();
    } catch (error) {
      console.error('Failed to upload segment:', error);
      if (error instanceof ApiError) {
        UvmToastManager.error(`Upload failed: ${error.message}`);
      } else {
        UvmToastManager.error('Failed to upload recording');
      }
    }
  }

  /**
   * Skip the current prompt.
   */
  private _onSkipPrompt(): void {
    this._skippedPrompts.add(this._currentPromptIndex);
    this._advanceToNextPrompt();
    UvmToastManager.info('Prompt skipped');
  }

  /**
   * Advance to the next prompt or finish recording.
   */
  private _advanceToNextPrompt(): void {
    const nextIndex = this._currentPromptIndex + 1;

    if (nextIndex >= this._prompts.length) {
      // All prompts completed
      this._finishRecording();
    } else {
      this._currentPromptIndex = nextIndex;
    }
  }

  /**
   * Finish recording and start processing.
   */
  private async _finishRecording(): Promise<void> {
    if (!this._sessionId) return;

    this._phase = 'processing';
    this._progress = 0;
    this._processingStatus = 'Completing session...';

    try {
      // Mark session as complete
      await recordingApi.completeSession(this._sessionId);

      this._processingStatus = 'Generating voicebank...';
      this._progress = 20;

      // Start polling for status
      this._startPolling();

      // Generate the voicebank
      const result = await recordingApi.generateVoicebank(
        this._sessionId,
        this._voicebankName
      );

      this._stopPolling();
      this._generatedVoicebank = result;
      this._phase = 'complete';

      UvmToastManager.success('Voicebank generated successfully!');

      // Emit completion event
      this.dispatchEvent(
        new CustomEvent('session-complete', {
          detail: { voicebank: result },
          bubbles: true,
          composed: true,
        })
      );
    } catch (error) {
      this._stopPolling();
      console.error('Failed to generate voicebank:', error);

      this._phase = 'error';
      if (error instanceof ApiError) {
        this._errorMessage = error.message;
      } else {
        this._errorMessage = 'Failed to generate voicebank. Please try again.';
      }
    }
  }

  /**
   * Start polling for session status during processing.
   */
  private _startPolling(): void {
    this._pollIntervalId = window.setInterval(async () => {
      if (!this._sessionId) return;

      try {
        const status: SessionProgress = await recordingApi.getSessionStatus(
          this._sessionId
        );

        // Update progress based on status
        if (status.status === 'processing') {
          this._progress = Math.min(90, this._progress + 5);
          this._processingStatus = 'Processing audio files...';
        } else if (status.status === 'completed') {
          this._progress = 100;
          this._processingStatus = 'Finalizing...';
        }
      } catch (error) {
        console.warn('Failed to poll status:', error);
      }
    }, 2000);
  }

  /**
   * Stop polling for status.
   */
  private _stopPolling(): void {
    if (this._pollIntervalId) {
      clearInterval(this._pollIntervalId);
      this._pollIntervalId = undefined;
    }
  }

  /**
   * Cancel the current session.
   */
  private async _onCancelSession(): Promise<void> {
    if (this._sessionId) {
      try {
        await recordingApi.cancelSession(this._sessionId);
      } catch (error) {
        console.warn('Failed to cancel session:', error);
      }
    }

    this._resetSession();

    this.dispatchEvent(
      new CustomEvent('session-cancelled', {
        bubbles: true,
        composed: true,
      })
    );

    UvmToastManager.info('Session cancelled');
  }

  /**
   * Reset the session state.
   */
  private _resetSession(): void {
    this._stopPolling();
    this._phase = 'setup';
    this._sessionId = undefined;
    this._voicebankName = '';
    this._recordingStyle = 'cv';
    this._language = 'ja';
    this._prompts = [];
    this._currentPromptIndex = 0;
    this._progress = 0;
    this._processingStatus = '';
    this._generatedVoicebank = undefined;
    this._errorMessage = '';
    this._skippedPrompts = new Set();
  }

  /**
   * Start a new recording session.
   */
  private _onRecordAnother(): void {
    this._resetSession();
  }

  /**
   * Retry after error.
   */
  private _onRetry(): void {
    if (this._phase === 'error') {
      // Go back to recording to try again
      this._phase = 'recording';
      this._errorMessage = '';
    }
  }

  /**
   * Handle voicebank name input.
   */
  private _onNameInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    this._voicebankName = input.value;
  }

  /**
   * Handle style selection.
   */
  private _onStyleChange(e: Event): void {
    const select = e.target as HTMLSelectElement;
    this._recordingStyle = select.value as 'cv' | 'vcv' | 'cvvc';
  }

  /**
   * Handle language selection.
   */
  private _onLanguageChange(e: Event): void {
    const select = e.target as HTMLSelectElement;
    this._language = select.value;
  }

  /**
   * Get recording progress percentage.
   */
  private get _recordingProgress(): number {
    if (this._prompts.length === 0) return 0;
    return Math.round(
      ((this._currentPromptIndex) / this._prompts.length) * 100
    );
  }

  /**
   * Render setup phase.
   */
  private _renderSetup() {
    return html`
      <sl-card class="setup-card">
        <div class="setup-header">
          <sl-icon name="mic-fill"></sl-icon>
          <h2>Create New Voicebank</h2>
        </div>

        <div class="setup-form">
          <div class="form-group">
            <label for="voicebank-name">Voicebank Name</label>
            <sl-input
              id="voicebank-name"
              placeholder="Enter a name for your voicebank"
              .value=${this._voicebankName}
              @sl-input=${this._onNameInput}
              required
            ></sl-input>
            <p class="form-group-description">
              This name will be used for the voicebank folder and metadata.
            </p>
          </div>

          <div class="form-group">
            <label for="recording-style">Recording Style</label>
            <sl-select
              id="recording-style"
              .value=${this._recordingStyle}
              @sl-change=${this._onStyleChange}
            >
              <sl-option value="cv">CV (Consonant-Vowel)</sl-option>
              <sl-option value="vcv">VCV (Vowel-Consonant-Vowel)</sl-option>
              <sl-option value="cvvc">CVVC (Combined)</sl-option>
            </sl-select>
            <p class="form-group-description">
              CV is simpler with ${JAPANESE_CV_PROMPTS_COUNT} prompts. VCV produces smoother transitions with ${JAPANESE_VCV_PROMPTS_COUNT} prompts.
            </p>
          </div>

          <div class="form-group">
            <label for="language">Language</label>
            <sl-select
              id="language"
              .value=${this._language}
              @sl-change=${this._onLanguageChange}
            >
              <sl-option value="ja">Japanese</sl-option>
              <sl-option value="en" disabled>English (Coming Soon)</sl-option>
            </sl-select>
          </div>

          <sl-divider></sl-divider>

          <div class="form-actions">
            <sl-button
              variant="primary"
              size="large"
              ?loading=${this._isLoading}
              @click=${this._onStartRecording}
            >
              <sl-icon slot="prefix" name="play-fill"></sl-icon>
              Start Recording
            </sl-button>
          </div>
        </div>
      </sl-card>
    `;
  }

  /**
   * Render recording phase.
   */
  private _renderRecording() {
    const currentPrompt = this._prompts[this._currentPromptIndex];
    const recordedCount = this._currentPromptIndex - this._skippedPrompts.size;

    return html`
      <div class="session-container">
        <div class="recording-header">
          <div class="recording-info">
            <h3>${this._voicebankName}</h3>
            <sl-badge variant="primary">${this._recordingStyle.toUpperCase()}</sl-badge>
          </div>
          <div class="recording-controls">
            <sl-button variant="text" @click=${this._onSkipPrompt}>
              <sl-icon slot="prefix" name="skip-forward-fill"></sl-icon>
              Skip
            </sl-button>
            <sl-button variant="text" @click=${this._onCancelSession}>
              <sl-icon slot="prefix" name="x-lg"></sl-icon>
              Cancel
            </sl-button>
          </div>
        </div>

        <div class="recording-progress">
          <div class="progress-info">
            <span>${recordedCount} recorded, ${this._skippedPrompts.size} skipped</span>
            <span>${this._currentPromptIndex + 1} / ${this._prompts.length}</span>
          </div>
          <sl-progress-bar value=${this._recordingProgress}></sl-progress-bar>
        </div>

        <uvm-recording-prompter
          .prompt=${currentPrompt}
          .promptIndex=${this._currentPromptIndex}
          .totalPrompts=${this._prompts.length}
          @recording-complete=${this._onRecordingComplete}
        ></uvm-recording-prompter>
      </div>
    `;
  }

  /**
   * Render processing phase.
   */
  private _renderProcessing() {
    return html`
      <div class="processing-container">
        <sl-spinner></sl-spinner>
        <h3>Generating Voicebank</h3>
        <p class="processing-status">${this._processingStatus}</p>
        <div class="processing-progress">
          <sl-progress-bar value=${this._progress}></sl-progress-bar>
        </div>
      </div>
    `;
  }

  /**
   * Render complete phase.
   */
  private _renderComplete() {
    if (!this._generatedVoicebank) return null;

    return html`
      <div class="complete-container">
        <sl-icon class="complete-icon" name="check-circle-fill"></sl-icon>
        <h3>Voicebank Created!</h3>
        <p class="complete-description">
          Your voicebank "${this._generatedVoicebank.name}" has been generated successfully.
        </p>

        <div class="voicebank-stats">
          <div class="stat-item">
            <span class="stat-value">${this._generatedVoicebank.sample_count}</span>
            <span class="stat-label">Samples</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${this._generatedVoicebank.oto_entries}</span>
            <span class="stat-label">Oto Entries</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${Math.round(this._generatedVoicebank.average_confidence * 100)}%</span>
            <span class="stat-label">Confidence</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${this._generatedVoicebank.generation_time_seconds.toFixed(1)}s</span>
            <span class="stat-label">Gen Time</span>
          </div>
        </div>

        ${this._generatedVoicebank.warnings.length > 0
          ? html`
              <sl-alert variant="warning" open>
                <sl-icon slot="icon" name="exclamation-triangle"></sl-icon>
                ${this._generatedVoicebank.warnings.length} warning(s) during generation.
                ${this._generatedVoicebank.skipped_segments > 0
                  ? `${this._generatedVoicebank.skipped_segments} segment(s) were skipped.`
                  : ''}
              </sl-alert>
            `
          : null}

        <div class="complete-actions">
          <sl-button variant="primary" size="large">
            <sl-icon slot="prefix" name="download"></sl-icon>
            Download Voicebank
          </sl-button>
          <sl-button variant="default" size="large" @click=${this._onRecordAnother}>
            <sl-icon slot="prefix" name="plus-lg"></sl-icon>
            Record Another
          </sl-button>
        </div>
      </div>
    `;
  }

  /**
   * Render error phase.
   */
  private _renderError() {
    return html`
      <div class="error-container">
        <sl-icon class="error-icon" name="exclamation-circle-fill"></sl-icon>
        <h3>Something Went Wrong</h3>
        <p class="error-message">${this._errorMessage}</p>
        <div class="error-actions">
          <sl-button variant="primary" @click=${this._onRetry}>
            <sl-icon slot="prefix" name="arrow-counterclockwise"></sl-icon>
            Try Again
          </sl-button>
          <sl-button variant="default" @click=${this._onRecordAnother}>
            <sl-icon slot="prefix" name="arrow-left"></sl-icon>
            Start Over
          </sl-button>
        </div>
      </div>
    `;
  }

  render() {
    switch (this._phase) {
      case 'setup':
        return this._renderSetup();
      case 'recording':
        return this._renderRecording();
      case 'processing':
        return this._renderProcessing();
      case 'complete':
        return this._renderComplete();
      case 'error':
        return this._renderError();
      default:
        return this._renderSetup();
    }
  }
}

// Constants for prompt counts (used in UI text)
const JAPANESE_CV_PROMPTS_COUNT = 71;
const JAPANESE_VCV_PROMPTS_COUNT = 43;

declare global {
  interface HTMLElementTagNameMap {
    'uvm-recording-session': UvmRecordingSession;
  }
}
