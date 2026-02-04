/**
 * First Sing component - instant voicebank validation through playback.
 *
 * Provides a prominent "Hear Your Voice" button that plays a simple
 * do-re-mi-fa-sol melody using representative samples from the voicebank.
 * Designed for quick validation within 3 seconds of clicking.
 *
 * @example
 * ```html
 * <uvm-first-sing
 *   voicebankId="my-voicebank"
 *   .otoEntries=${entries}
 * ></uvm-first-sing>
 * ```
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

import { MelodyPlayer, type PhraseNote } from '../services/melody-player.js';
import { SampleLoader } from '../services/sample-loader.js';
import { api } from '../services/api.js';
import { getSharedAudioContext } from '../services/audio-context.js';
import type { OtoEntry } from '../services/types.js';

/**
 * Japanese vowels used for representative sample selection.
 * These are the most common and essential phonemes in Japanese voicebanks.
 */
const JAPANESE_VOWELS = ['a', 'i', 'u', 'e', 'o'];

/**
 * Common CV phonemes to try as fallbacks if vowels are not available.
 */
const COMMON_CV_FALLBACKS = ['ka', 'sa', 'ta', 'na', 'ha', 'ma', 'ya', 'ra', 'wa'];

/**
 * Alias prefix patterns used in voicebanks.
 */
const CV_PREFIX = '- ';

/**
 * Do-re-mi-fa-sol melody pattern (ascending C major scale).
 * Pitch values: C4=0, D4=2, E4=4, F4=5, G4=7
 */
const DO_RE_MI_PATTERN: Array<{ pitch: number; duration: number }> = [
  { pitch: 0, duration: 0.4 },   // do (C4)
  { pitch: 2, duration: 0.4 },   // re (D4)
  { pitch: 4, duration: 0.4 },   // mi (E4)
  { pitch: 5, duration: 0.4 },   // fa (F4)
  { pitch: 7, duration: 0.5 },   // sol (G4) - slightly longer ending
];

/**
 * First Sing button component for instant voicebank validation.
 *
 * Selects 5 representative samples (preferring vowels a, i, u, e, o)
 * and plays them with an ascending do-re-mi-fa-sol melody pattern.
 */
@customElement('uvm-first-sing')
export class UvmFirstSing extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .first-sing-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
    }

    .sing-button {
      --button-padding: 1rem 1.5rem;
    }

    .sing-button sl-button::part(base) {
      font-size: 1rem;
      font-weight: 600;
      padding: 0.875rem 1.5rem;
      border-radius: 0.5rem;
      transition: transform 0.1s ease, box-shadow 0.2s ease;
    }

    .sing-button sl-button::part(base):hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);
    }

    .sing-button sl-button::part(base):active {
      transform: translateY(0);
    }

    /* Playing state with pulsing animation */
    .sing-button.playing sl-button::part(base) {
      animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% {
        box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4);
      }
      50% {
        box-shadow: 0 0 0 10px rgba(239, 68, 68, 0);
      }
    }

    .sing-button sl-button::part(prefix) {
      margin-right: 0.5rem;
    }

    .phoneme-display {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background-color: #f3f4f6;
      border-radius: 0.375rem;
      font-size: 0.875rem;
      color: #4b5563;
      min-height: 2rem;
    }

    .phoneme-display.playing {
      background-color: #eff6ff;
      color: #1d4ed8;
    }

    .current-phoneme {
      font-family: monospace;
      font-weight: 600;
      font-size: 1rem;
      min-width: 3rem;
      text-align: center;
    }

    .phoneme-label {
      font-size: 0.75rem;
      color: #6b7280;
    }

    .warning-message {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.5rem 0.75rem;
      background-color: #fef3c7;
      border-radius: 0.375rem;
      font-size: 0.75rem;
      color: #92400e;
    }

    .warning-message sl-icon {
      flex-shrink: 0;
    }

    .error-message {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.5rem 0.75rem;
      background-color: #fef2f2;
      border-radius: 0.375rem;
      font-size: 0.75rem;
      color: #dc2626;
    }

    .error-message sl-icon {
      flex-shrink: 0;
    }

    .loading-indicator {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #6b7280;
      font-size: 0.75rem;
    }

    .loading-indicator sl-spinner {
      font-size: 1rem;
      --indicator-color: #3b82f6;
    }
  `;

  /**
   * Voicebank identifier for loading samples.
   */
  @property({ type: String })
  voicebankId = '';

  /**
   * Optional: pass existing oto entries to avoid re-fetching.
   * If not provided, entries will be fetched from the API.
   */
  @property({ attribute: false })
  otoEntries?: OtoEntry[];

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
   * Current phoneme being sung (for display).
   */
  @state()
  private _currentPhoneme = '';

  /**
   * Error message if playback fails.
   */
  @state()
  private _error: string | null = null;

  /**
   * Warning message (e.g., some samples missing).
   */
  @state()
  private _warning: string | null = null;


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
   * Interval ID for phoneme display updates.
   */
  private _phonemeIntervalId: number | null = null;

  /**
   * Scheduled phonemes with timing for display.
   */
  private _scheduledPhonemes: Array<{ alias: string; startTime: number }> = [];

  /**
   * Playback start timestamp.
   */
  private _playbackStartTime = 0;

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._cleanup();
  }

  /**
   * Find an alias in the available entries, checking common format variations.
   */
  private _findAlias(target: string, aliasSet: Set<string>): string | null {
    // Check exact match
    if (aliasSet.has(target)) {
      return target;
    }

    // Check CV prefix format (e.g., "- a")
    const cvAlias = CV_PREFIX + target;
    if (aliasSet.has(cvAlias)) {
      return cvAlias;
    }

    // Check VCV format with any vowel prefix
    for (const vowel of JAPANESE_VOWELS) {
      const vcvAlias = `${vowel} ${target}`;
      if (aliasSet.has(vcvAlias)) {
        return vcvAlias;
      }
    }

    return null;
  }

  /**
   * Select representative samples from the voicebank.
   *
   * Priority:
   * 1. Japanese vowels (a, i, u, e, o)
   * 2. Common CV phonemes (ka, sa, ta, etc.)
   * 3. Any available aliases
   */
  private _selectRepresentativeSamples(entries: OtoEntry[]): string[] {
    const availableAliases = new Set(entries.map((e) => e.alias));
    const selected: string[] = [];

    // Try to find the 5 Japanese vowels first
    for (const vowel of JAPANESE_VOWELS) {
      const found = this._findAlias(vowel, availableAliases);
      if (found && selected.length < 5) {
        selected.push(found);
      }
    }

    // If we don't have 5 samples yet, try common CV phonemes
    if (selected.length < 5) {
      for (const cv of COMMON_CV_FALLBACKS) {
        if (selected.length >= 5) break;
        const found = this._findAlias(cv, availableAliases);
        if (found && !selected.includes(found)) {
          selected.push(found);
        }
      }
    }

    // If still not enough, take any available aliases
    if (selected.length < 5) {
      for (const alias of availableAliases) {
        if (selected.length >= 5) break;
        if (!selected.includes(alias)) {
          selected.push(alias);
        }
      }
    }

    return selected;
  }

  /**
   * Create phrase notes from selected aliases and melody pattern.
   */
  private _createPhraseNotes(aliases: string[]): PhraseNote[] {
    const notes: PhraseNote[] = [];
    let startTime = 0;

    // Create notes matching aliases to melody pattern
    const noteCount = Math.min(aliases.length, DO_RE_MI_PATTERN.length);
    for (let i = 0; i < noteCount; i++) {
      const { pitch, duration } = DO_RE_MI_PATTERN[i];
      notes.push({
        alias: aliases[i],
        pitch,
        startTime,
        duration,
      });
      startTime += duration;
    }

    return notes;
  }

  /**
   * Handle button click - toggle play/stop.
   */
  private async _onButtonClick(): Promise<void> {
    if (this._isPlaying) {
      this._stop();
    } else {
      await this._play();
    }
  }

  /**
   * Start playback of the "First Sing" melody.
   */
  private async _play(): Promise<void> {
    if (!this.voicebankId) {
      this._error = 'No voicebank selected';
      return;
    }

    this._error = null;
    this._warning = null;
    this._isLoading = true;
    this._currentPhoneme = '';

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
      }

      // Get oto entries (use provided or fetch from API)
      let entries = this.otoEntries;
      if (!entries || entries.length === 0) {
        entries = await api.getOtoEntries(this.voicebankId);
      }

      if (entries.length === 0) {
        this._error = 'No oto entries found. Please configure oto.ini first.';
        this._isLoading = false;
        return;
      }

      // Select representative samples
      const selectedAliases = this._selectRepresentativeSamples(entries);

      if (selectedAliases.length === 0) {
        this._error = 'No suitable samples found in voicebank.';
        this._isLoading = false;
        return;
      }

      // Create phrase notes
      const notes = this._createPhraseNotes(selectedAliases);

      // Load samples for the phrase
      const result = await this._loader.loadSamplesForPhrase(notes, this.voicebankId);

      if (result.sampleMap.size === 0) {
        this._error = 'Failed to load samples. Check if audio files exist.';
        this._isLoading = false;
        return;
      }

      // Show warning if some samples are missing
      if (result.missingAliases.length > 0 || result.failedAliases.length > 0) {
        const missing = [...result.missingAliases, ...result.failedAliases];
        this._warning = `Playing with ${result.sampleMap.size} of ${notes.length} samples (${missing.length} unavailable)`;
      }

      // Filter notes to only those with loaded samples
      const playableNotes = notes.filter((note) => result.sampleMap.has(note.alias));

      if (playableNotes.length === 0) {
        this._error = 'No playable samples available.';
        this._isLoading = false;
        return;
      }

      // Store scheduled phonemes for display
      this._scheduledPhonemes = playableNotes.map((note) => ({
        alias: note.alias,
        startTime: note.startTime,
      }));

      // Calculate total duration
      const lastNote = playableNotes[playableNotes.length - 1];
      const totalDuration = lastNote.startTime + lastNote.duration;

      // Start playback with quality features enabled
      this._isLoading = false;
      this._isPlaying = true;
      this._playbackStartTime = this._audioContext.currentTime;

      this._player.playPhrase(playableNotes, result.sampleMap, {
        useGranular: true,
        useAdaptiveGrainSize: true,
        useDynamicOverlap: true,
        useLoudnessNormalization: true,
        crossfadeType: 'equal-power',
      });

      // Start phoneme display updates
      this._startPhonemeDisplay();

      // Schedule automatic stop
      const stopDelay = (totalDuration + 0.2) * 1000;
      setTimeout(() => {
        if (this._isPlaying) {
          this._stop();
        }
      }, stopDelay);
    } catch (error) {
      console.error('First Sing playback failed:', error);
      this._error = error instanceof Error ? error.message : 'Playback failed';
      this._isLoading = false;
      this._isPlaying = false;
    }
  }

  /**
   * Stop playback.
   */
  private _stop(): void {
    if (this._player) {
      this._player.stop();
    }

    this._isPlaying = false;
    this._currentPhoneme = '';
    this._stopPhonemeDisplay();
  }

  /**
   * Start updating the current phoneme display.
   */
  private _startPhonemeDisplay(): void {
    if (!this._audioContext) return;

    // Update every 50ms for responsive display
    this._phonemeIntervalId = window.setInterval(() => {
      if (!this._isPlaying || !this._audioContext) {
        this._stopPhonemeDisplay();
        return;
      }

      const elapsed = this._audioContext.currentTime - this._playbackStartTime;

      // Find the current phoneme based on elapsed time
      let current = '';
      for (let i = this._scheduledPhonemes.length - 1; i >= 0; i--) {
        if (elapsed >= this._scheduledPhonemes[i].startTime) {
          current = this._scheduledPhonemes[i].alias;
          break;
        }
      }

      this._currentPhoneme = current;
    }, 50);
  }

  /**
   * Stop phoneme display updates.
   */
  private _stopPhonemeDisplay(): void {
    if (this._phonemeIntervalId !== null) {
      clearInterval(this._phonemeIntervalId);
      this._phonemeIntervalId = null;
    }
  }

  /**
   * Clean up resources.
   */
  private _cleanup(): void {
    this._stop();

    if (this._loader) {
      this._loader.clearCache();
    }

    // Release reference to shared AudioContext (do not close -- it is shared)
    this._audioContext = null;
    this._player = null;
    this._loader = null;
  }

  /**
   * Get a clean display name for an alias.
   * Removes common prefixes like "- " for cleaner display.
   */
  private _getDisplayAlias(alias: string): string {
    if (alias.startsWith(CV_PREFIX)) {
      return alias.slice(CV_PREFIX.length);
    }
    return alias;
  }

  render() {
    const buttonVariant = this._isPlaying ? 'danger' : 'primary';
    const buttonText = this._isPlaying ? 'Stop' : 'Hear Your Voice';
    const buttonIcon = this._isPlaying ? 'stop-fill' : 'mic-fill';

    return html`
      <div class="first-sing-container">
        <sl-tooltip content=${this._isPlaying ? 'Stop playback' : 'Play a quick melody with your voicebank'}>
          <div class="sing-button ${this._isPlaying ? 'playing' : ''}">
            <sl-button
              variant=${buttonVariant}
              size="large"
              ?disabled=${this._isLoading || !this.voicebankId}
              ?loading=${this._isLoading}
              @click=${this._onButtonClick}
            >
              <sl-icon slot="prefix" name=${buttonIcon}></sl-icon>
              ${buttonText}
            </sl-button>
          </div>
        </sl-tooltip>

        ${this._isPlaying && this._currentPhoneme
          ? html`
              <div class="phoneme-display playing">
                <span class="phoneme-label">Singing:</span>
                <span class="current-phoneme">${this._getDisplayAlias(this._currentPhoneme)}</span>
              </div>
            `
          : null}

        ${this._isLoading
          ? html`
              <div class="loading-indicator">
                <sl-spinner></sl-spinner>
                <span>Loading samples...</span>
              </div>
            `
          : null}

        ${this._warning && !this._isPlaying
          ? html`
              <div class="warning-message">
                <sl-icon name="exclamation-triangle"></sl-icon>
                <span>${this._warning}</span>
              </div>
            `
          : null}

        ${this._error
          ? html`
              <div class="error-message">
                <sl-icon name="exclamation-circle"></sl-icon>
                <span>${this._error}</span>
              </div>
            `
          : null}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-first-sing': UvmFirstSing;
  }
}
