/**
 * Phrase preview component for playing demo songs with a voicebank.
 *
 * Allows users to hear their voicebank sing demo songs like "Twinkle Twinkle"
 * or "Furusato". Includes song selection, play/stop controls, progress indication,
 * and compatibility warnings for missing phonemes.
 *
 * @example
 * ```html
 * <uvm-phrase-preview
 *   voicebankId="my-voicebank"
 *   .availableAliases=${new Set(['a', 'ka', 'sa'])}
 * ></uvm-phrase-preview>
 * ```
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/progress-bar/progress-bar.js';
import '@shoelace-style/shoelace/dist/components/badge/badge.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

import { DEMO_SONGS, checkSongCompatibility, type DemoSong } from '../data/demo-songs.js';
import { MelodyPlayer } from '../services/melody-player.js';
import { SampleLoader } from '../services/sample-loader.js';
import { api } from '../services/api.js';
import { getSharedAudioContext } from '../services/audio-context.js';

/**
 * Phrase preview component for voicebank demo playback.
 */
@customElement('uvm-phrase-preview')
export class UvmPhrasePreview extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .preview-container {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .controls-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .song-select {
      flex: 1;
      min-width: 0;
    }

    .song-select::part(combobox) {
      font-size: 0.8125rem;
    }

    .play-button {
      flex-shrink: 0;
    }

    .play-button sl-button::part(base) {
      min-width: 5rem;
    }

    .compatibility-alert {
      margin-top: 0.25rem;
    }

    .compatibility-alert::part(base) {
      font-size: 0.75rem;
      padding: 0.5rem 0.75rem;
    }

    .compatibility-alert::part(message) {
      padding: 0;
    }

    .missing-phonemes {
      margin-top: 0.375rem;
      padding: 0.5rem;
      background-color: #fef3c7;
      border-radius: 4px;
      font-size: 0.6875rem;
      color: #92400e;
    }

    .missing-phonemes-label {
      font-weight: 600;
      margin-bottom: 0.25rem;
    }

    .phoneme-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
    }

    .phoneme-chip {
      display: inline-block;
      padding: 0.125rem 0.375rem;
      background-color: #fde68a;
      border-radius: 3px;
      font-family: monospace;
      font-size: 0.6875rem;
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .progress-section {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .progress-bar {
      flex: 1;
    }

    .progress-bar::part(base) {
      height: 6px;
    }

    .progress-bar::part(indicator) {
      background-color: #3b82f6;
      transition: width 0.1s linear;
    }

    .progress-time {
      font-size: 0.6875rem;
      color: #6b7280;
      min-width: 4rem;
      text-align: right;
      font-family: monospace;
    }

    .loading-state {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem;
      color: #6b7280;
      font-size: 0.75rem;
    }

    .loading-state sl-spinner {
      font-size: 1rem;
      --indicator-color: #3b82f6;
    }

    .song-info {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.25rem;
    }

    .song-info sl-badge::part(base) {
      font-size: 0.625rem;
      padding: 0.125rem 0.375rem;
    }

    .song-description {
      font-size: 0.6875rem;
      color: #9ca3af;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      text-align: center;
      color: #9ca3af;
      font-size: 0.75rem;
    }

    .empty-state sl-icon {
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
      color: #d1d5db;
    }

    .error-message {
      font-size: 0.75rem;
      color: #dc2626;
      padding: 0.5rem;
      background-color: #fef2f2;
      border-radius: 4px;
    }
  `;

  /**
   * Voicebank identifier for loading samples.
   */
  @property({ type: String })
  voicebankId = '';

  /**
   * Set of available phoneme aliases in the voicebank.
   * Used to check song compatibility.
   */
  @property({ attribute: false })
  availableAliases: Set<string> = new Set();

  /**
   * Currently selected demo song ID.
   */
  @state()
  private _selectedSongId: string = DEMO_SONGS[0]?.id ?? '';

  /**
   * Whether playback is in progress.
   */
  @state()
  private _isPlaying = false;

  /**
   * Whether samples are being loaded.
   */
  @state()
  private _isLoading = false;

  /**
   * Current playback progress (0-1).
   */
  @state()
  private _progress = 0;

  /**
   * Current playback time in seconds.
   */
  @state()
  private _currentTime = 0;

  /**
   * Total duration of the current song in seconds.
   */
  @state()
  private _totalDuration = 0;

  /**
   * Error message if playback fails.
   */
  @state()
  private _error: string | null = null;

  /**
   * Web Audio context for playback.
   */
  private _audioContext: AudioContext | null = null;

  /**
   * Melody player instance.
   */
  private _player: MelodyPlayer | null = null;

  /**
   * Sample loader instance.
   */
  private _loader: SampleLoader | null = null;

  /**
   * Animation frame ID for progress updates.
   */
  private _animationFrameId: number | null = null;

  /**
   * Playback start timestamp.
   */
  private _playbackStartTime = 0;

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._cleanup();
  }

  /**
   * Get the currently selected demo song.
   */
  private get _selectedSong(): DemoSong | undefined {
    return DEMO_SONGS.find((song) => song.id === this._selectedSongId);
  }

  /**
   * Get compatibility info for the selected song.
   */
  private get _compatibility() {
    const song = this._selectedSong;
    if (!song) return null;
    return checkSongCompatibility(song, this.availableAliases);
  }

  /**
   * Handle song selection change.
   */
  private _onSongChange(e: Event): void {
    const select = e.target as HTMLSelectElement;
    this._selectedSongId = select.value;
    this._error = null;

    // Stop current playback if changing songs
    if (this._isPlaying) {
      this._stop();
    }
  }

  /**
   * Handle play/stop button click.
   */
  private async _onPlayClick(): Promise<void> {
    if (this._isPlaying) {
      this._stop();
    } else {
      await this._play();
    }
  }

  /**
   * Start playback of the selected song.
   */
  private async _play(): Promise<void> {
    const song = this._selectedSong;
    if (!song || !this.voicebankId) return;

    this._error = null;
    this._isLoading = true;

    try {
      // Get shared AudioContext on user interaction (required by browser policy)
      if (!this._audioContext) {
        this._audioContext = getSharedAudioContext();
      }

      // Resume if suspended
      if (this._audioContext.state === 'suspended') {
        await this._audioContext.resume();
      }

      // Create player and loader if needed
      if (!this._player) {
        this._player = new MelodyPlayer(this._audioContext);
      }

      if (!this._loader) {
        this._loader = new SampleLoader(this._audioContext, api);
        this._loader.enableAutoInvalidation();
      }

      // Calculate total duration from notes
      const lastNote = song.notes[song.notes.length - 1];
      this._totalDuration = lastNote ? lastNote.startTime + lastNote.duration : 0;

      // Load samples for the phrase
      const result = await this._loader.loadSamplesForPhrase(song.notes, this.voicebankId);

      if (result.missingAliases.length > 0) {
        console.warn('Missing aliases for playback:', result.missingAliases);
      }

      if (result.sampleMap.size === 0) {
        this._error = 'No samples could be loaded. Check if voicebank has the required phonemes.';
        this._isLoading = false;
        return;
      }

      // Start playback
      this._isLoading = false;
      this._isPlaying = true;
      this._progress = 0;
      this._currentTime = 0;
      this._playbackStartTime = this._audioContext.currentTime;

      this._player.playPhrase(song.notes, result.sampleMap, {
        useDynamicOverlap: true,
        useLoudnessNormalization: true,
        crossfadeType: 'equal-power',
      });

      // Start progress animation
      this._updateProgress();
    } catch (error) {
      console.error('Failed to play demo song:', error);
      this._error = error instanceof Error ? error.message : 'Failed to play demo song';
      this._isLoading = false;
      this._isPlaying = false;
    }
  }

  /**
   * Stop current playback.
   */
  private _stop(): void {
    if (this._player) {
      this._player.stop();
    }

    this._isPlaying = false;
    this._progress = 0;
    this._currentTime = 0;

    if (this._animationFrameId !== null) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }
  }

  /**
   * Update playback progress.
   */
  private _updateProgress(): void {
    if (!this._isPlaying || !this._audioContext) {
      return;
    }

    const elapsed = this._audioContext.currentTime - this._playbackStartTime;
    this._currentTime = Math.min(elapsed, this._totalDuration);
    this._progress = this._totalDuration > 0 ? (this._currentTime / this._totalDuration) * 100 : 0;

    // Check if playback is complete
    if (elapsed >= this._totalDuration) {
      // Add a small buffer for audio to finish
      setTimeout(() => {
        this._isPlaying = false;
        this._progress = 100;
      }, 200);
      return;
    }

    // Continue updating
    this._animationFrameId = requestAnimationFrame(() => this._updateProgress());
  }

  /**
   * Clean up resources.
   */
  private _cleanup(): void {
    this._stop();

    if (this._loader) {
      this._loader.disableAutoInvalidation();
      this._loader.clearCache();
    }

    // Dispose the melody player to release audio nodes and caches
    this._player?.dispose();

    // Release reference to shared AudioContext (do not close -- it is shared)
    this._audioContext = null;
    this._player = null;
    this._loader = null;
  }

  /**
   * Format time in seconds to MM:SS format.
   */
  private _formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Get badge variant based on recording style.
   */
  private _getStyleVariant(style: string): 'primary' | 'success' | 'warning' | 'danger' | 'neutral' {
    switch (style) {
      case 'cv':
        return 'primary';
      case 'vcv':
        return 'success';
      case 'cvvc':
        return 'danger';
      case 'arpasing':
        return 'warning';
      default:
        return 'neutral';
    }
  }

  /**
   * Render the component.
   */
  render() {
    if (!this.voicebankId) {
      return html`
        <div class="preview-container">
          <div class="empty-state">
            <sl-icon name="music-note-beamed"></sl-icon>
            <span>Select a voicebank to preview demo songs</span>
          </div>
        </div>
      `;
    }

    const song = this._selectedSong;
    const compatibility = this._compatibility;

    return html`
      <div class="preview-container">
        <div class="controls-row">
          <sl-select
            class="song-select"
            value=${this._selectedSongId}
            size="small"
            ?disabled=${this._isLoading}
            @sl-change=${this._onSongChange}
          >
            ${DEMO_SONGS.map(
              (s) => html`
                <sl-option value=${s.id}>
                  ${s.title}
                </sl-option>
              `
            )}
          </sl-select>

          <div class="play-button">
            <sl-button
              size="small"
              variant=${this._isPlaying ? 'danger' : 'primary'}
              ?disabled=${this._isLoading}
              ?loading=${this._isLoading}
              @click=${this._onPlayClick}
            >
              <sl-icon
                slot="prefix"
                name=${this._isPlaying ? 'stop-fill' : 'play-fill'}
              ></sl-icon>
              ${this._isPlaying ? 'Stop' : 'Play'}
            </sl-button>
          </div>
        </div>

        ${song
          ? html`
              <div class="song-info">
                <sl-badge variant=${this._getStyleVariant(song.recordingStyle)}>
                  ${song.recordingStyle.toUpperCase()}
                </sl-badge>
                <sl-badge variant="neutral">
                  ${song.language === 'japanese' ? 'Japanese' : 'English'}
                </sl-badge>
                ${song.description
                  ? html`<span class="song-description">${song.description}</span>`
                  : null}
              </div>
            `
          : null}

        ${this._isPlaying || this._progress > 0
          ? html`
              <div class="progress-section">
                <sl-progress-bar
                  class="progress-bar"
                  value=${this._progress}
                ></sl-progress-bar>
                <span class="progress-time">
                  ${this._formatTime(this._currentTime)} / ${this._formatTime(this._totalDuration)}
                </span>
              </div>
            `
          : null}

        ${this._isLoading
          ? html`
              <div class="loading-state">
                <sl-spinner></sl-spinner>
                <span>Loading samples...</span>
              </div>
            `
          : null}

        ${this._error
          ? html`
              <div class="error-message">
                <sl-icon name="exclamation-triangle"></sl-icon>
                ${this._error}
              </div>
            `
          : null}

        ${compatibility && !compatibility.compatible && !this._isPlaying && !this._isLoading
          ? html`
              <sl-alert variant="warning" open class="compatibility-alert">
                <sl-icon slot="icon" name="exclamation-triangle"></sl-icon>
                Missing ${compatibility.missingPhonemes.length} of ${compatibility.totalRequired} required phonemes.
                Playback may be incomplete.
              </sl-alert>
              <div class="missing-phonemes">
                <div class="missing-phonemes-label">Missing phonemes:</div>
                <div class="phoneme-list" aria-label="Missing phonemes: ${compatibility.missingPhonemes.join(', ')}">
                  ${compatibility.missingPhonemes.map(
                    (p, i) => html`<span class="phoneme-chip">${p}</span>${i < compatibility.missingPhonemes.length - 1 ? html`<span class="visually-hidden">, </span>` : ''}`
                  )}
                </div>
              </div>
            `
          : null}

        ${compatibility && compatibility.compatible && !this._isPlaying && !this._isLoading
          ? html`
              <sl-tooltip content="All required phonemes are available">
                <sl-badge variant="success" style="width: fit-content;">
                  <sl-icon name="check-circle" style="margin-right: 0.25rem;"></sl-icon>
                  Compatible
                </sl-badge>
              </sl-tooltip>
            `
          : null}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-phrase-preview': UvmPhrasePreview;
  }
}
