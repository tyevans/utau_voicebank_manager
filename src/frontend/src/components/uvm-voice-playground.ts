/**
 * Voice Playground component - "type to hear yourself" interactive experience.
 *
 * The first thing a user does when their voice is ready is HEAR IT.
 * This component provides:
 * - An audio player for a pre-generated preview sample
 * - A text input that synthesizes speech using the user's voice
 * - Download buttons for OpenUTAU and other formats
 *
 * Synthesis state machine: idle -> generating -> playing -> idle
 *
 * The synthesis API (POST /api/v1/voicebanks/{id}/synthesize) is a placeholder
 * that will be implemented later. The component handles the full lifecycle
 * including error states and loading indicators.
 *
 * @fires download-openutau - User requested OpenUTAU download
 * @fires download-other - User requested download for other apps
 *
 * @example
 * ```html
 * <uvm-voice-playground
 *   voicebankId="my-voice"
 *   voicebankName="My Voice"
 *   sessionId="abc-123"
 *   previewAudioUrl="/api/v1/sessions/abc-123/preview.wav"
 * ></uvm-voice-playground>
 * ```
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// Shoelace components
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

import { fetchWithRetry } from '../utils/fetch-retry.js';
import { getDefaultApiUrl } from '../services/api.js';
import { getSharedAudioContext } from '../services/audio-context.js';

/**
 * Synthesis state machine states.
 *
 * - idle: Ready for input, no activity
 * - generating: API request in flight, waiting for audio blob
 * - playing: Synthesized audio is actively playing back
 */
type SynthesisState = 'idle' | 'generating' | 'playing';

@customElement('uvm-voice-playground')
export class UvmVoicePlayground extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
    }

    .playground {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 3rem 2rem 2.5rem;
      background-color: white;
      border-radius: 16px;
      text-align: center;
      max-width: 560px;
      margin: 0 auto;
    }

    /* -- Heading ------------------------------------------------ */

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

    /* -- Preview player ----------------------------------------- */

    .preview-section {
      width: 100%;
      margin-bottom: 2rem;
    }

    .player-card {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1rem 1.25rem;
      background-color: var(--sl-color-neutral-50, #f8fafc);
      border-radius: 12px;
      width: 100%;
      box-sizing: border-box;
    }

    .play-button {
      flex-shrink: 0;
    }

    .play-button sl-button::part(base) {
      font-size: 1.25rem;
      width: 2.75rem;
      height: 2.75rem;
      padding: 0;
      border-radius: 50%;
    }

    .player-content {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }

    .player-label {
      font-size: 0.8125rem;
      color: var(--sl-color-neutral-500, #64748b);
      text-align: left;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .progress-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .progress-bar-container {
      flex: 1;
      height: 6px;
      background-color: var(--sl-color-neutral-200, #e2e8f0);
      border-radius: 3px;
      overflow: hidden;
      cursor: pointer;
      position: relative;
    }

    .progress-bar-fill {
      height: 100%;
      background-color: var(--sl-color-primary-600, #2563eb);
      border-radius: 3px;
      transition: width 0.1s linear;
      min-width: 0;
    }

    .time-display {
      font-size: 0.6875rem;
      color: var(--sl-color-neutral-400, #94a3b8);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      min-width: 5.5em;
      text-align: right;
    }

    .no-preview {
      font-size: 0.8125rem;
      color: var(--sl-color-neutral-400, #94a3b8);
      padding: 1rem;
      text-align: center;
    }

    /* -- Text-to-speak section ---------------------------------- */

    .tts-section {
      width: 100%;
      margin-bottom: 2rem;
    }

    .tts-label {
      margin: 0 0 0.75rem;
      font-size: 0.9375rem;
      color: var(--sl-color-neutral-600, #475569);
      font-weight: 500;
      text-align: left;
    }

    .tts-input-row {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      width: 100%;
    }

    .tts-input-row sl-input {
      width: 100%;
    }

    .tts-input-row sl-input::part(base) {
      border-radius: 10px;
    }

    .generate-button-wrapper {
      display: flex;
      justify-content: center;
    }

    .generate-button::part(base) {
      font-size: 0.9375rem;
      font-weight: 500;
      padding: 0.625rem 1.5rem;
      border-radius: 9999px;
    }

    /* -- Synthesized playback ----------------------------------- */

    .synth-player {
      width: 100%;
      margin-top: 1rem;
    }

    .synth-player .player-card {
      background-color: var(--sl-color-primary-50, #eff6ff);
      border: 1px solid var(--sl-color-primary-200, #bfdbfe);
    }

    /* -- Error display ------------------------------------------ */

    .error-section {
      width: 100%;
      margin-top: 0.75rem;
    }

    .error-section sl-alert {
      text-align: left;
    }

    /* -- Divider ------------------------------------------------ */

    sl-divider {
      --spacing: 1.5rem;
      width: 100%;
    }

    /* -- Download section --------------------------------------- */

    .download-section {
      width: 100%;
    }

    .download-heading {
      margin: 0 0 1rem;
      font-size: 0.9375rem;
      font-weight: 500;
      color: var(--sl-color-neutral-700, #334155);
      text-align: left;
    }

    .download-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .download-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.875rem 1.25rem;
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
      font-size: 1.125rem;
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

    /* -- Responsive --------------------------------------------- */

    @media (max-width: 640px) {
      .playground {
        padding: 2rem 1.25rem 2rem;
      }

      h2 {
        font-size: 1.25rem;
      }

      .player-card {
        flex-wrap: wrap;
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
    }
  `;

  // -- Public properties ------------------------------------------------------

  /**
   * Voicebank identifier used for synthesis API calls and downloads.
   */
  @property({ type: String })
  voicebankId = '';

  /**
   * Display name for the voicebank shown in the heading.
   */
  @property({ type: String })
  voicebankName = '';

  /**
   * Session identifier used for constructing download URLs.
   */
  @property({ type: String })
  sessionId = '';

  /**
   * Optional URL to a pre-generated audio preview sample.
   * When provided, the preview player section is shown.
   */
  @property({ type: String })
  previewAudioUrl = '';

  // -- Private state ----------------------------------------------------------

  /**
   * Current state of the text-to-speak synthesis flow.
   */
  @state()
  private _synthesisState: SynthesisState = 'idle';

  /**
   * Text the user typed into the synthesis input.
   */
  @state()
  private _inputText = '';

  /**
   * Error message from a failed synthesis or playback attempt.
   */
  @state()
  private _error: string | null = null;

  /**
   * Whether the preview audio player is currently playing.
   */
  @state()
  private _previewPlaying = false;

  /**
   * Preview audio playback progress as a 0-1 fraction.
   */
  @state()
  private _previewProgress = 0;

  /**
   * Current playback time of the preview audio in seconds.
   */
  @state()
  private _previewCurrentTime = 0;

  /**
   * Total duration of the preview audio in seconds.
   */
  @state()
  private _previewDuration = 0;

  /**
   * Whether the synthesized audio player is currently playing.
   */
  @state()
  private _synthPlaying = false;

  /**
   * Synthesized audio playback progress as a 0-1 fraction.
   */
  @state()
  private _synthProgress = 0;

  /**
   * Current playback time of the synthesized audio in seconds.
   */
  @state()
  private _synthCurrentTime = 0;

  /**
   * Total duration of the synthesized audio in seconds.
   */
  @state()
  private _synthDuration = 0;

  // -- Private fields ---------------------------------------------------------

  /**
   * Web Audio context for decoding and playing audio.
   */
  private _audioContext: AudioContext | null = null;

  /**
   * Decoded AudioBuffer for the preview sample.
   */
  private _previewBuffer: AudioBuffer | null = null;

  /**
   * Currently playing AudioBufferSourceNode for the preview.
   */
  private _previewSource: AudioBufferSourceNode | null = null;

  /**
   * Timestamp (AudioContext.currentTime) when preview playback started.
   */
  private _previewStartedAt = 0;

  /**
   * Offset into the preview buffer where playback started (for resume).
   */
  private _previewStartOffset = 0;

  /**
   * Animation frame ID for updating preview progress.
   */
  private _previewAnimFrameId = 0;

  /**
   * Decoded AudioBuffer for the most recent synthesized audio.
   */
  private _synthBuffer: AudioBuffer | null = null;

  /**
   * Currently playing AudioBufferSourceNode for synthesized audio.
   */
  private _synthSource: AudioBufferSourceNode | null = null;

  /**
   * Timestamp (AudioContext.currentTime) when synth playback started.
   */
  private _synthStartedAt = 0;

  /**
   * Offset into the synth buffer where playback started.
   */
  private _synthStartOffset = 0;

  /**
   * Animation frame ID for updating synth progress.
   */
  private _synthAnimFrameId = 0;

  // -- Lifecycle --------------------------------------------------------------

  connectedCallback(): void {
    super.connectedCallback();
    if (this.previewAudioUrl) {
      this._loadPreviewAudio();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._cleanup();
  }

  updated(changedProperties: Map<PropertyKey, unknown>): void {
    if (changedProperties.has('previewAudioUrl') && this.previewAudioUrl) {
      this._loadPreviewAudio();
    }
  }

  // -- AudioContext helpers ---------------------------------------------------

  /**
   * Ensure the shared AudioContext is available and resumed.
   */
  private async _ensureAudioContext(): Promise<AudioContext> {
    if (!this._audioContext) {
      this._audioContext = getSharedAudioContext();
    }
    if (this._audioContext.state === 'suspended') {
      await this._audioContext.resume();
    }
    return this._audioContext;
  }

  // -- Preview audio ----------------------------------------------------------

  /**
   * Fetch and decode the preview audio from the provided URL.
   */
  private async _loadPreviewAudio(): Promise<void> {
    if (!this.previewAudioUrl) return;

    try {
      const ctx = await this._ensureAudioContext();
      const response = await fetchWithRetry(this.previewAudioUrl);

      if (!response.ok) {
        // Preview is optional -- silently ignore load failures
        return;
      }

      const arrayBuffer = await response.arrayBuffer();
      this._previewBuffer = await ctx.decodeAudioData(arrayBuffer);
      this._previewDuration = this._previewBuffer.duration;
    } catch {
      // Preview loading is best-effort; do not surface errors
    }
  }

  /**
   * Toggle play/pause for the preview audio player.
   */
  private _onPreviewToggle(): void {
    if (this._previewPlaying) {
      this._stopPreview();
    } else {
      this._playPreview();
    }
  }

  /**
   * Start or resume preview audio playback.
   */
  private async _playPreview(): Promise<void> {
    if (!this._previewBuffer) return;

    const ctx = await this._ensureAudioContext();

    // Stop any currently playing synth audio to avoid overlap
    this._stopSynth();

    const source = ctx.createBufferSource();
    source.buffer = this._previewBuffer;
    source.connect(ctx.destination);

    source.onended = () => {
      // Only handle if this source is still the active one
      if (this._previewSource === source) {
        this._previewPlaying = false;
        this._previewProgress = 0;
        this._previewCurrentTime = 0;
        this._previewStartOffset = 0;
        cancelAnimationFrame(this._previewAnimFrameId);
      }
    };

    source.start(0, this._previewStartOffset);
    this._previewSource = source;
    this._previewStartedAt = ctx.currentTime;
    this._previewPlaying = true;
    this._updatePreviewProgress();
  }

  /**
   * Stop preview audio playback, preserving the current position for resume.
   */
  private _stopPreview(): void {
    if (this._previewSource) {
      try {
        this._previewSource.onended = null;
        this._previewSource.stop();
      } catch {
        // Ignore errors from already-stopped sources
      }
      this._previewSource = null;
    }

    if (this._audioContext && this._previewPlaying) {
      this._previewStartOffset +=
        this._audioContext.currentTime - this._previewStartedAt;
    }

    this._previewPlaying = false;
    cancelAnimationFrame(this._previewAnimFrameId);
  }

  /**
   * Continuously update the preview progress bar via requestAnimationFrame.
   */
  private _updatePreviewProgress(): void {
    if (!this._previewPlaying || !this._audioContext || !this._previewBuffer) {
      return;
    }

    const elapsed =
      this._previewStartOffset +
      (this._audioContext.currentTime - this._previewStartedAt);
    const duration = this._previewBuffer.duration;

    this._previewCurrentTime = Math.min(elapsed, duration);
    this._previewProgress = duration > 0 ? this._previewCurrentTime / duration : 0;

    this._previewAnimFrameId = requestAnimationFrame(() =>
      this._updatePreviewProgress()
    );
  }

  /**
   * Handle click on the preview progress bar for seeking.
   */
  private _onPreviewSeek(e: MouseEvent): void {
    if (!this._previewBuffer) return;

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seekTime = fraction * this._previewBuffer.duration;

    const wasPlaying = this._previewPlaying;

    // Stop current playback
    if (this._previewSource) {
      try {
        this._previewSource.onended = null;
        this._previewSource.stop();
      } catch {
        // Ignore
      }
      this._previewSource = null;
    }
    this._previewPlaying = false;
    cancelAnimationFrame(this._previewAnimFrameId);

    this._previewStartOffset = seekTime;
    this._previewCurrentTime = seekTime;
    this._previewProgress = fraction;

    if (wasPlaying) {
      this._playPreview();
    }
  }

  // -- Text-to-speak synthesis ------------------------------------------------

  /**
   * Handle changes to the text input field.
   */
  private _onInputChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    this._inputText = input.value;
  }

  /**
   * Handle keydown on the input to submit on Enter.
   */
  private _onInputKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && this._inputText.trim()) {
      this._onGenerate();
    }
  }

  /**
   * Request synthesis of the typed text and play the result.
   */
  private async _onGenerate(): Promise<void> {
    const text = this._inputText.trim();
    if (!text || !this.voicebankId) return;

    this._error = null;
    this._synthesisState = 'generating';

    // Stop any current playback
    this._stopPreview();
    this._stopSynth();

    try {
      const ctx = await this._ensureAudioContext();
      const apiUrl = getDefaultApiUrl();
      const url = `${apiUrl}/voicebanks/${encodeURIComponent(this.voicebankId)}/synthesize`;

      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        let errorMessage = 'Synthesis failed. Please try again.';
        try {
          const errorData = await response.json();
          if (typeof errorData.detail === 'string') {
            errorMessage = errorData.detail;
          }
        } catch {
          // Use default error message
        }
        throw new Error(errorMessage);
      }

      const arrayBuffer = await response.arrayBuffer();
      this._synthBuffer = await ctx.decodeAudioData(arrayBuffer);
      this._synthDuration = this._synthBuffer.duration;
      this._synthStartOffset = 0;
      this._synthProgress = 0;
      this._synthCurrentTime = 0;

      // Automatically start playing the result
      this._synthesisState = 'playing';
      this._playSynth();
    } catch (error) {
      this._synthesisState = 'idle';
      this._error =
        error instanceof Error ? error.message : 'Synthesis failed unexpectedly.';
    }
  }

  // -- Synthesized audio playback ---------------------------------------------

  /**
   * Toggle play/pause for synthesized audio.
   */
  private _onSynthToggle(): void {
    if (this._synthPlaying) {
      this._stopSynth();
    } else {
      this._playSynth();
    }
  }

  /**
   * Start or resume synthesized audio playback.
   */
  private async _playSynth(): Promise<void> {
    if (!this._synthBuffer) return;

    const ctx = await this._ensureAudioContext();

    // Stop preview to avoid overlap
    this._stopPreview();

    const source = ctx.createBufferSource();
    source.buffer = this._synthBuffer;
    source.connect(ctx.destination);

    source.onended = () => {
      if (this._synthSource === source) {
        this._synthPlaying = false;
        this._synthProgress = 0;
        this._synthCurrentTime = 0;
        this._synthStartOffset = 0;
        this._synthesisState = 'idle';
        cancelAnimationFrame(this._synthAnimFrameId);
      }
    };

    source.start(0, this._synthStartOffset);
    this._synthSource = source;
    this._synthStartedAt = ctx.currentTime;
    this._synthPlaying = true;
    this._synthesisState = 'playing';
    this._updateSynthProgress();
  }

  /**
   * Stop synthesized audio playback.
   */
  private _stopSynth(): void {
    if (this._synthSource) {
      try {
        this._synthSource.onended = null;
        this._synthSource.stop();
      } catch {
        // Ignore errors from already-stopped sources
      }
      this._synthSource = null;
    }

    if (this._audioContext && this._synthPlaying) {
      this._synthStartOffset +=
        this._audioContext.currentTime - this._synthStartedAt;
    }

    this._synthPlaying = false;
    this._synthesisState = 'idle';
    cancelAnimationFrame(this._synthAnimFrameId);
  }

  /**
   * Continuously update the synth progress bar via requestAnimationFrame.
   */
  private _updateSynthProgress(): void {
    if (!this._synthPlaying || !this._audioContext || !this._synthBuffer) {
      return;
    }

    const elapsed =
      this._synthStartOffset +
      (this._audioContext.currentTime - this._synthStartedAt);
    const duration = this._synthBuffer.duration;

    this._synthCurrentTime = Math.min(elapsed, duration);
    this._synthProgress = duration > 0 ? this._synthCurrentTime / duration : 0;

    this._synthAnimFrameId = requestAnimationFrame(() =>
      this._updateSynthProgress()
    );
  }

  /**
   * Handle click on the synth progress bar for seeking.
   */
  private _onSynthSeek(e: MouseEvent): void {
    if (!this._synthBuffer) return;

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seekTime = fraction * this._synthBuffer.duration;

    const wasPlaying = this._synthPlaying;

    if (this._synthSource) {
      try {
        this._synthSource.onended = null;
        this._synthSource.stop();
      } catch {
        // Ignore
      }
      this._synthSource = null;
    }
    this._synthPlaying = false;
    cancelAnimationFrame(this._synthAnimFrameId);

    this._synthStartOffset = seekTime;
    this._synthCurrentTime = seekTime;
    this._synthProgress = fraction;

    if (wasPlaying) {
      this._playSynth();
    }
  }

  // -- Downloads --------------------------------------------------------------

  /**
   * Trigger download of the voicebank for OpenUTAU.
   */
  private _onDownloadOpenUtau(): void {
    if (!this.sessionId) return;

    const downloadUrl = `/api/v1/sessions/${this.sessionId}/download`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `${this.voicebankName || 'voicebank'}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    this.dispatchEvent(
      new CustomEvent('download-openutau', {
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Trigger download of the voicebank for other applications.
   * Uses the same download URL with a different filename convention.
   */
  private _onDownloadOther(): void {
    if (!this.sessionId) return;

    const downloadUrl = `/api/v1/sessions/${this.sessionId}/download?format=generic`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `${this.voicebankName || 'voicebank'}-generic.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    this.dispatchEvent(
      new CustomEvent('download-other', {
        bubbles: true,
        composed: true,
      })
    );
  }

  // -- Cleanup ----------------------------------------------------------------

  /**
   * Release all audio resources and cancel animation frames.
   */
  private _cleanup(): void {
    this._stopPreview();
    this._stopSynth();

    this._previewBuffer = null;
    this._synthBuffer = null;

    // Release reference to shared AudioContext (do not close -- it is shared)
    this._audioContext = null;
  }

  // -- Formatting helpers -----------------------------------------------------

  /**
   * Format a time value in seconds to "M:SS" display format.
   */
  private _formatTime(seconds: number): string {
    const totalSeconds = Math.floor(seconds);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // -- Render -----------------------------------------------------------------

  render() {
    const displayName = this.voicebankName || 'Your Voice';

    return html`
      <div class="playground">
        <h2>Your Enhanced Voice</h2>
        <p class="subtitle">"${displayName}" is ready to speak</p>

        <!-- Preview audio player -->
        ${this._renderPreviewPlayer()}

        <!-- Text-to-speak input -->
        ${this._renderTtsSection()}

        <!-- Synthesized audio player (shown after generation) -->
        ${this._renderSynthPlayer()}

        <!-- Error display -->
        ${this._renderError()}

        <sl-divider></sl-divider>

        <!-- Download section -->
        ${this._renderDownloads()}
      </div>
    `;
  }

  /**
   * Render the preview audio player section.
   */
  private _renderPreviewPlayer() {
    if (!this.previewAudioUrl) {
      return nothing;
    }

    const icon = this._previewPlaying ? 'pause-fill' : 'play-fill';
    const label = this._previewPlaying ? 'Pause preview' : 'Play preview';
    const progressPercent = (this._previewProgress * 100).toFixed(1);

    return html`
      <div class="preview-section">
        <div class="player-card">
          <div class="play-button">
            <sl-tooltip content=${label}>
              <sl-button
                variant="primary"
                size="small"
                circle
                ?disabled=${!this._previewBuffer}
                aria-label=${label}
                @click=${this._onPreviewToggle}
              >
                <sl-icon name=${icon}></sl-icon>
              </sl-button>
            </sl-tooltip>
          </div>

          <div class="player-content">
            <span class="player-label">Preview sample</span>
            <div class="progress-row">
              <div
                class="progress-bar-container"
                role="progressbar"
                aria-valuenow=${Math.round(this._previewProgress * 100)}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-label="Preview playback progress"
                @click=${this._onPreviewSeek}
              >
                <div
                  class="progress-bar-fill"
                  style="width: ${progressPercent}%"
                ></div>
              </div>
              <span class="time-display">
                ${this._formatTime(this._previewCurrentTime)} / ${this._formatTime(this._previewDuration)}
              </span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render the text-to-speak input section.
   */
  private _renderTtsSection() {
    const isGenerating = this._synthesisState === 'generating';
    const canGenerate =
      this._inputText.trim().length > 0 &&
      this._synthesisState !== 'generating' &&
      Boolean(this.voicebankId);

    return html`
      <div class="tts-section">
        <p class="tts-label">Try it yourself:</p>
        <div class="tts-input-row">
          <sl-input
            placeholder="Type anything to hear your voice say it..."
            .value=${this._inputText}
            ?disabled=${isGenerating}
            @sl-input=${this._onInputChange}
            @keydown=${this._onInputKeydown}
            aria-label="Text to synthesize"
          ></sl-input>
          <div class="generate-button-wrapper">
            <sl-button
              class="generate-button"
              variant="primary"
              ?disabled=${!canGenerate}
              ?loading=${isGenerating}
              @click=${this._onGenerate}
            >
              ${isGenerating
                ? 'Generating...'
                : 'Generate'}
            </sl-button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render the synthesized audio player (only visible after successful generation).
   */
  private _renderSynthPlayer() {
    if (!this._synthBuffer) {
      return nothing;
    }

    const icon = this._synthPlaying ? 'pause-fill' : 'play-fill';
    const label = this._synthPlaying ? 'Pause' : 'Play synthesized audio';
    const progressPercent = (this._synthProgress * 100).toFixed(1);

    return html`
      <div class="synth-player">
        <div class="player-card">
          <div class="play-button">
            <sl-tooltip content=${label}>
              <sl-button
                variant="primary"
                size="small"
                circle
                aria-label=${label}
                @click=${this._onSynthToggle}
              >
                <sl-icon name=${icon}></sl-icon>
              </sl-button>
            </sl-tooltip>
          </div>

          <div class="player-content">
            <span class="player-label">Your voice saying: "${this._inputText}"</span>
            <div class="progress-row">
              <div
                class="progress-bar-container"
                role="progressbar"
                aria-valuenow=${Math.round(this._synthProgress * 100)}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-label="Synthesized audio playback progress"
                @click=${this._onSynthSeek}
              >
                <div
                  class="progress-bar-fill"
                  style="width: ${progressPercent}%"
                ></div>
              </div>
              <span class="time-display">
                ${this._formatTime(this._synthCurrentTime)} / ${this._formatTime(this._synthDuration)}
              </span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render an error alert if a synthesis error occurred.
   */
  private _renderError() {
    if (!this._error) {
      return nothing;
    }

    return html`
      <div class="error-section">
        <sl-alert variant="danger" open>
          <sl-icon slot="icon" name="exclamation-circle"></sl-icon>
          ${this._error}
        </sl-alert>
      </div>
    `;
  }

  /**
   * Render the download buttons section.
   */
  private _renderDownloads() {
    return html`
      <div class="download-section">
        <p class="download-heading">Download</p>
        <div class="download-list">
          <div class="download-row">
            <div class="download-info">
              <sl-icon name="box-arrow-down"></sl-icon>
              <div class="download-text">
                <span class="download-title">For OpenUTAU</span>
                <span class="download-desc">Ready to use with OpenUTAU</span>
              </div>
            </div>
            <sl-button
              variant="default"
              size="small"
              ?disabled=${!this.sessionId}
              @click=${this._onDownloadOpenUtau}
            >
              <sl-icon slot="prefix" name="download"></sl-icon>
              Download
            </sl-button>
          </div>

          <div class="download-row">
            <div class="download-info">
              <sl-icon name="box-arrow-down"></sl-icon>
              <div class="download-text">
                <span class="download-title">For other apps</span>
                <span class="download-desc">Compatible with other singing tools</span>
              </div>
            </div>
            <sl-button
              variant="default"
              size="small"
              ?disabled=${!this.sessionId}
              @click=${this._onDownloadOther}
            >
              <sl-icon slot="prefix" name="download"></sl-icon>
              Download
            </sl-button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-voice-playground': UvmVoicePlayground;
  }
}
