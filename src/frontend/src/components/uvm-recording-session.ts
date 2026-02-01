import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Router } from '@vaadin/router';

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
import '@shoelace-style/shoelace/dist/components/details/details.js';

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

const STORAGE_KEY_HAS_VOICEBANKS = 'uvm_has_voicebanks';

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
 * Processing step for detailed progress display.
 */
interface ProcessingStep {
  id: string;
  label: string;
  description: string;
  status: 'pending' | 'active' | 'completed' | 'error';
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
 * Navigation is handled via @vaadin/router. On cancel, navigates to
 * /editor (if voicebanks exist) or / (if none). On completion, navigates
 * to /editor/:voicebankName.
 *
 * @fires session-complete - Fired when voicebank generation completes
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

    /* Setup Phase - Simple, focused, inviting */
    .setup-card {
      padding: 2.5rem;
      background: white;
      border-radius: 16px;
      border: none;
      box-shadow: none;
    }

    .setup-card::part(base) {
      border: none;
      box-shadow: none;
    }

    .setup-header {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.5rem;
      margin-bottom: 2rem;
    }

    .setup-header sl-icon {
      display: none; /* The text is sufficient */
    }

    .setup-header h2 {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--sl-color-neutral-900, #0f172a);
      letter-spacing: -0.02em;
    }

    .setup-subtitle {
      margin: 0;
      font-size: 0.9375rem;
      color: var(--sl-color-neutral-500, #64748b);
      font-weight: 400;
    }

    .setup-form {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .form-group label {
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--sl-color-neutral-600, #475569);
    }

    .form-group-description {
      font-size: 0.75rem;
      color: var(--sl-color-neutral-400, #94a3b8);
      margin-top: 0.25rem;
      line-height: 1.5;
    }

    sl-details {
      margin-top: 0.5rem;
    }

    sl-details::part(summary) {
      font-size: 0.8125rem;
      color: var(--sl-color-neutral-500, #64748b);
    }

    sl-details .form-group {
      margin-top: 1.25rem;
    }

    sl-details .form-group:first-child {
      margin-top: 0;
    }

    .form-actions {
      display: flex;
      justify-content: flex-start;
      gap: 0.75rem;
      margin-top: 1.5rem;
    }

    /* Recording Phase - Minimal chrome, maximum focus */
    .recording-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      background-color: transparent;
    }

    .recording-info {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .recording-info h3 {
      margin: 0;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--sl-color-neutral-600, #475569);
    }

    .recording-progress {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      margin-top: 0.75rem;
      padding: 0 1rem;
    }

    .progress-info {
      display: flex;
      justify-content: space-between;
      font-size: 0.75rem;
      color: var(--sl-color-neutral-400, #94a3b8);
    }

    .recording-controls {
      display: flex;
      gap: 0.25rem;
    }

    .recording-controls sl-button::part(base) {
      color: var(--sl-color-neutral-500, #64748b);
      font-size: 0.8125rem;
    }

    /* Processing Phase - Calm confidence during the wait */
    .processing-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4rem 2rem;
      background-color: white;
      border-radius: 16px;
      text-align: center;
    }

    .processing-header {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.25rem;
      margin-bottom: 2.5rem;
    }

    .processing-header sl-spinner {
      font-size: 2rem;
      --indicator-color: var(--sl-color-neutral-400, #94a3b8);
      --track-color: var(--sl-color-neutral-200, #e2e8f0);
    }

    .processing-header h3 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 500;
      color: var(--sl-color-neutral-700, #334155);
    }

    .processing-container sl-spinner {
      font-size: 2.5rem;
      --indicator-color: var(--sl-color-neutral-400, #94a3b8);
      --track-color: var(--sl-color-neutral-200, #e2e8f0);
      margin-bottom: 1.25rem;
    }

    .processing-container h3 {
      margin: 0 0 0.5rem;
      font-size: 1.25rem;
      font-weight: 500;
      color: var(--sl-color-neutral-700, #334155);
    }

    .processing-steps {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-bottom: 2rem;
      text-align: left;
      max-width: 320px;
      margin-left: auto;
      margin-right: auto;
      width: 100%;
    }

    .processing-step {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.625rem 0.75rem;
      border-radius: 8px;
      transition: background-color 0.2s ease;
    }

    .processing-step.active {
      background-color: var(--sl-color-neutral-100, #f1f5f9);
    }

    .processing-step.completed {
      opacity: 0.5;
    }

    .step-icon {
      font-size: 1rem;
      flex-shrink: 0;
    }

    .step-icon.success { color: var(--sl-color-neutral-500, #64748b); }
    .step-icon.primary { color: var(--sl-color-neutral-700, #334155); }
    .step-icon.danger { color: var(--sl-color-danger-500, #ef4444); }
    .step-icon.neutral { color: var(--sl-color-neutral-300, #cbd5e1); }

    .step-content {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
    }

    .step-label {
      font-weight: 400;
      font-size: 0.875rem;
      color: var(--sl-color-neutral-700, #334155);
    }

    .step-description {
      font-size: 0.75rem;
      color: var(--sl-color-neutral-400, #94a3b8);
    }

    .processing-progress {
      width: 100%;
      max-width: 320px;
    }

    .processing-progress sl-progress-bar::part(base) {
      height: 4px;
      border-radius: 2px;
    }

    .processing-progress sl-progress-bar::part(indicator) {
      background: var(--sl-color-neutral-400, #94a3b8);
    }

    /* Complete Phase - The emotional payoff deserves elegance */
    .complete-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 4rem 2rem;
      background-color: white;
      border-radius: 16px;
      text-align: center;
    }

    .complete-icon {
      font-size: 3rem;
      color: var(--sl-color-neutral-900, #0f172a);
      margin-bottom: 1.5rem;
    }

    .complete-container h3 {
      margin: 0 0 0.75rem;
      font-size: 1.75rem;
      font-weight: 600;
      color: var(--sl-color-neutral-900, #0f172a);
      letter-spacing: -0.02em;
    }

    .complete-description {
      font-size: 1rem;
      color: var(--sl-color-neutral-500, #64748b);
      margin-bottom: 2rem;
      font-weight: 400;
    }

    .voicebank-stats {
      display: flex;
      gap: 3rem;
      margin-bottom: 2.5rem;
    }

    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.375rem;
    }

    .stat-value {
      font-size: 1.75rem;
      font-weight: 600;
      color: var(--sl-color-neutral-900, #0f172a);
    }

    .stat-label {
      font-size: 0.6875rem;
      color: var(--sl-color-neutral-400, #94a3b8);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .complete-actions {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      justify-content: center;
    }

    .complete-secondary-actions {
      margin-top: 1rem;
    }

    .complete-secondary-actions sl-button::part(base) {
      font-size: 0.875rem;
    }

    /* Next Steps Section - Clear, scannable, helpful */
    .next-steps-section {
      width: 100%;
      max-width: 420px;
      margin: 2rem 0;
      padding: 1.5rem 1.75rem;
      background-color: var(--sl-color-neutral-50, #f8fafc);
      border-radius: 12px;
      text-align: left;
    }

    .next-steps-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1.25rem;
      font-size: 0.6875rem;
      font-weight: 500;
      color: var(--sl-color-neutral-400, #94a3b8);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .next-steps-header sl-icon {
      color: var(--sl-color-neutral-400, #94a3b8);
      font-size: 0.875rem;
    }

    .next-steps-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0.875rem;
    }

    .next-steps-list li {
      display: flex;
      align-items: flex-start;
      gap: 0.875rem;
      font-size: 0.8125rem;
      color: var(--sl-color-neutral-600, #475569);
      line-height: 1.6;
    }

    .step-number {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 1.375rem;
      height: 1.375rem;
      min-width: 1.375rem;
      background-color: var(--sl-color-neutral-200, #e2e8f0);
      color: var(--sl-color-neutral-600, #475569);
      border-radius: 50%;
      font-size: 0.6875rem;
      font-weight: 500;
    }

    .step-content {
      flex: 1;
    }

    .step-content strong {
      color: var(--sl-color-neutral-700, #334155);
      font-weight: 500;
    }

    /* Stats row - refined and subtle */
    .voicebank-stats-compact {
      display: flex;
      flex-wrap: wrap;
      gap: 2rem;
      justify-content: center;
      padding: 1rem 0;
      margin-bottom: 1.5rem;
    }

    .stat-item-compact {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
    }

    .stat-item-compact:last-child {
      border-right: none;
    }

    .stat-item-compact .stat-value {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--sl-color-neutral-800, #1e293b);
    }

    .stat-item-compact .stat-label {
      font-size: 0.6875rem;
      color: var(--sl-color-neutral-400, #94a3b8);
      text-transform: uppercase;
      letter-spacing: 0.05em;
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

      .next-steps-section {
        padding: 1rem;
      }

      .stat-item-compact {
        padding: 0 0.5rem;
      }

      .stat-item-compact .stat-value {
        font-size: 1rem;
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
  private _generatedVoicebank?: GeneratedVoicebank;

  @state()
  private _errorMessage = '';

  @state()
  private _isLoading = false;

  @state()
  private _skippedPrompts: Set<number> = new Set();

  @state()
  private _processingSteps: ProcessingStep[] = [];

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

    // Initialize processing steps
    this._processingSteps = [
      { id: 'save', label: 'Saving recordings', description: 'Storing your audio files securely', status: 'completed' },
      { id: 'analyze', label: 'Analyzing phonemes', description: 'AI is finding where each sound starts and ends', status: 'pending' },
      { id: 'generate', label: 'Generating configuration', description: 'Creating timing parameters for each sample', status: 'pending' },
      { id: 'package', label: 'Packaging voicebank', description: 'Bundling everything into a downloadable file', status: 'pending' },
    ];

    try {
      // Mark session as complete
      await recordingApi.completeSession(this._sessionId);

      this._progress = 20;
      this._updateProcessingSteps(this._progress);

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

      // Mark that we now have voicebanks
      localStorage.setItem(STORAGE_KEY_HAS_VOICEBANKS, 'true');

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
        } else if (status.status === 'completed') {
          this._progress = 100;
        }

        // Update processing steps based on progress
        this._updateProcessingSteps(this._progress);
      } catch (error) {
        console.warn('Failed to poll status:', error);
      }
    }, 2000);
  }

  /**
   * Update processing step statuses based on current progress.
   */
  private _updateProcessingSteps(progress: number): void {
    this._processingSteps = this._processingSteps.map((step) => {
      if (progress < 20) {
        // 0-20%: 'save' completed, 'analyze' active
        if (step.id === 'save') return { ...step, status: 'completed' as const };
        if (step.id === 'analyze') return { ...step, status: 'active' as const };
        return { ...step, status: 'pending' as const };
      } else if (progress < 50) {
        // 20-50%: 'analyze' completed, 'generate' active
        if (step.id === 'save' || step.id === 'analyze') return { ...step, status: 'completed' as const };
        if (step.id === 'generate') return { ...step, status: 'active' as const };
        return { ...step, status: 'pending' as const };
      } else if (progress < 90) {
        // 50-90%: 'generate' completed, 'package' active
        if (step.id === 'save' || step.id === 'analyze' || step.id === 'generate') return { ...step, status: 'completed' as const };
        if (step.id === 'package') return { ...step, status: 'active' as const };
        return { ...step, status: 'pending' as const };
      } else {
        // 90-100%: all completed
        return { ...step, status: 'completed' as const };
      }
    });
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
    UvmToastManager.info('Session cancelled');

    // Navigate based on voicebank state
    const hasVoicebanks = localStorage.getItem(STORAGE_KEY_HAS_VOICEBANKS) === 'true';
    Router.go(hasVoicebanks ? '/editor' : '/');
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
    this._generatedVoicebank = undefined;
    this._errorMessage = '';
    this._skippedPrompts = new Set();
    this._processingSteps = [];
  }

  /**
   * Start a new recording session.
   */
  private _onRecordAnother(): void {
    this._resetSession();
  }

  /**
   * Download the generated voicebank ZIP file.
   */
  private _onDownloadVoicebank(): void {
    if (!this._sessionId) return;

    // Trigger download via the API endpoint
    const downloadUrl = `/api/v1/sessions/${this._sessionId}/download`;

    // Create a hidden anchor element to trigger the download
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `${this._voicebankName || 'voicebank'}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Open the voicebank in the editor for fine-tuning.
   */
  private _onOpenInEditor(): void {
    // Navigate to editor with the new voicebank selected
    if (this._voicebankName) {
      Router.go(`/editor/${encodeURIComponent(this._voicebankName)}`);
    } else {
      Router.go('/editor');
    }
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
          <div>
            <h2>Let's Create Your Voice</h2>
            <p class="setup-subtitle">Record short sounds to build your unique singing voice</p>
          </div>
        </div>

        <div class="setup-form">
          <div class="form-group">
            <label for="voicebank-name">What should we call your voice?</label>
            <sl-input
              id="voicebank-name"
              placeholder="Give your voice a name"
              .value=${this._voicebankName}
              @sl-input=${this._onNameInput}
              required
            ></sl-input>
          </div>

          <sl-details summary="Advanced options">
            <div class="form-group">
              <label for="recording-style">Recording Style</label>
              <sl-select
                id="recording-style"
                .value=${this._recordingStyle}
                @sl-change=${this._onStyleChange}
              >
                <sl-option value="cv">Simple phrases (${JAPANESE_CV_PROMPTS_COUNT} recordings)</sl-option>
                <sl-option value="vcv">Smooth transitions (${JAPANESE_VCV_PROMPTS_COUNT} recordings)</sl-option>
                <sl-option value="cvvc">Combined approach</sl-option>
              </sl-select>
              <p class="form-group-description">
                Simple phrases are quicker to record. Smooth transitions sound more natural but take longer.
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
                <sl-option value="en">English (ARPAsing)</sl-option>
              </sl-select>
            </div>
          </sl-details>

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
          language=${this._language}
          @recording-complete=${this._onRecordingComplete}
        ></uvm-recording-prompter>
      </div>
    `;
  }

  /**
   * Render a single processing step.
   */
  private _renderProcessingStep(step: ProcessingStep) {
    const icon = step.status === 'completed' ? 'check-circle-fill'
      : step.status === 'active' ? 'arrow-right-circle-fill'
      : step.status === 'error' ? 'x-circle-fill'
      : 'circle';

    const variant = step.status === 'completed' ? 'success'
      : step.status === 'active' ? 'primary'
      : step.status === 'error' ? 'danger'
      : 'neutral';

    return html`
      <div class="processing-step ${step.status}">
        <sl-icon name=${icon} class="step-icon ${variant}"></sl-icon>
        <div class="step-content">
          <span class="step-label">${step.label}</span>
          ${step.status === 'active' ? html`<span class="step-description">${step.description}</span>` : null}
        </div>
      </div>
    `;
  }

  /**
   * Render processing phase.
   */
  private _renderProcessing() {
    return html`
      <div class="processing-container">
        <div class="processing-header">
          <sl-spinner></sl-spinner>
          <h3>Creating Your Voicebank</h3>
        </div>

        <div class="processing-steps">
          ${this._processingSteps.map(step => this._renderProcessingStep(step))}
        </div>

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
        <h3>Your Voicebank is Ready!</h3>
        <p class="complete-description">
          "${this._generatedVoicebank.name}" has been created and is ready to download.
        </p>

        <!-- Compact stats row -->
        <div class="voicebank-stats-compact">
          <div class="stat-item-compact">
            <span class="stat-value">${this._generatedVoicebank.sample_count}</span>
            <span class="stat-label">Samples</span>
          </div>
          <div class="stat-item-compact">
            <span class="stat-value">${this._generatedVoicebank.oto_entries}</span>
            <span class="stat-label">Oto Entries</span>
          </div>
          <div class="stat-item-compact">
            <span class="stat-value">${Math.round(this._generatedVoicebank.average_confidence * 100)}%</span>
            <span class="stat-label">Confidence</span>
          </div>
          <div class="stat-item-compact">
            <span class="stat-value">${this._generatedVoicebank.generation_time_seconds.toFixed(1)}s</span>
            <span class="stat-label">Generated</span>
          </div>
        </div>

        ${this._generatedVoicebank.warnings.length > 0
          ? html`
              <sl-alert variant="warning" open style="margin-bottom: 1rem; width: 100%; max-width: 500px;">
                <sl-icon slot="icon" name="exclamation-triangle"></sl-icon>
                ${this._generatedVoicebank.warnings.length} warning(s) during generation.
                ${this._generatedVoicebank.skipped_segments > 0
                  ? ` ${this._generatedVoicebank.skipped_segments} segment(s) were skipped.`
                  : ''}
              </sl-alert>
            `
          : null}

        <!-- Primary action -->
        <div class="complete-actions">
          <sl-button variant="primary" size="large" @click=${this._onDownloadVoicebank}>
            <sl-icon slot="prefix" name="download"></sl-icon>
            Download Voicebank
          </sl-button>
        </div>

        <!-- What's next instructions -->
        <div class="next-steps-section">
          <div class="next-steps-header">
            <sl-icon name="lightbulb"></sl-icon>
            <span>How to use your voicebank in OpenUTAU</span>
          </div>
          <ol class="next-steps-list">
            <li>
              <span class="step-number">1</span>
              <span class="step-content">
                <strong>Download</strong> your voicebank using the button above
              </span>
            </li>
            <li>
              <span class="step-number">2</span>
              <span class="step-content">
                <strong>Open OpenUTAU</strong> on your computer
              </span>
            </li>
            <li>
              <span class="step-number">3</span>
              <span class="step-content">
                Go to <strong>Tools</strong> menu and select <strong>Install Singer</strong>
              </span>
            </li>
            <li>
              <span class="step-number">4</span>
              <span class="step-content">
                <strong>Select the downloaded ZIP file</strong> and click Open
              </span>
            </li>
            <li>
              <span class="step-number">5</span>
              <span class="step-content">
                Your voice is ready to sing! Select it from the singer dropdown.
              </span>
            </li>
          </ol>
        </div>

        <!-- Secondary actions -->
        <div class="complete-actions">
          <sl-button variant="default" @click=${this._onRecordAnother}>
            <sl-icon slot="prefix" name="plus-lg"></sl-icon>
            Create Another
          </sl-button>
          <sl-button variant="text" @click=${this._onOpenInEditor}>
            <sl-icon slot="prefix" name="sliders"></sl-icon>
            Fine-tune in Editor
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
