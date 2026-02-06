/**
 * Quick Phrase Mode component - phoneme text input to singing.
 *
 * Allows users to type phonemes (e.g., "a ka sa ta na") and hear them
 * sung as a melody. Validates that the voicebank works with real phoneme
 * sequences.
 *
 * @example
 * ```html
 * <uvm-quick-phrase
 *   voicebankId="my-voicebank"
 *   .otoEntries=${entries}
 * ></uvm-quick-phrase>
 * ```
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/badge/badge.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

import { MelodyPlayer, type PhraseNote } from '../services/melody-player.js';
import { SampleLoader } from '../services/sample-loader.js';
import { api } from '../services/api.js';
import { getSharedAudioContext } from '../services/audio-context.js';
import type { OtoEntry } from '../services/types.js';
import { findMatchingAlias, CV_PREFIX, parseVCVAlias } from '../utils/alias-matching.js';

/**
 * Melody pattern types.
 */
type MelodyPattern = 'ascending' | 'descending' | 'monotone' | 'custom';

/**
 * Parsed phoneme with availability info.
 */
interface ParsedPhoneme {
  /** The original phoneme as typed */
  original: string;
  /** The actual alias found in the voicebank (or null if not found) */
  alias: string | null;
  /** Whether this phoneme is available in the voicebank */
  available: boolean;
}

/**
 * Melody pattern definitions.
 * Pitch values are semitones relative to C4 (0 = C4, 2 = D4, etc.)
 */
const MELODY_PATTERNS: Record<MelodyPattern, number[]> = {
  ascending: [0, 2, 4, 5, 7, 9, 11, 12], // C4-D4-E4-F4-G4-A4-B4-C5
  descending: [7, 5, 4, 2, 0, -2, -3, -5], // G4-F4-E4-D4-C4-B3-A3-G3
  monotone: [0, 0, 0, 0, 0, 0, 0, 0], // All C4
  custom: [0, 2, 4, 5, 7, 5, 4, 2], // C4-D4-E4-F4-G4-F4-E4-D4 (up and down)
};

/**
 * Note duration in seconds.
 */
const NOTE_DURATION = 0.35;

/**
 * Quick Phrase Mode component for text-to-singing playback.
 *
 * Parses user-typed phonemes and plays them as a melody using the
 * voicebank's samples. Provides visual feedback for phoneme availability.
 */
@customElement('uvm-quick-phrase')
export class UvmQuickPhrase extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .quick-phrase-container {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 1rem;
      background-color: #f8fafc;
      border-radius: 0.5rem;
      border: 1px solid #e2e8f0;
    }

    .input-row {
      display: flex;
      gap: 0.5rem;
      align-items: flex-end;
    }

    .phrase-input {
      flex: 1;
    }

    .phrase-input::part(base) {
      font-family: monospace;
      font-size: 1.1rem;
    }

    .controls-row {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      flex-wrap: wrap;
    }

    .melody-select {
      min-width: 140px;
    }

    .play-button::part(base) {
      font-weight: 600;
    }

    .play-button.playing::part(base) {
      animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% {
        box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4);
      }
      50% {
        box-shadow: 0 0 0 8px rgba(239, 68, 68, 0);
      }
    }

    .phoneme-preview {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      min-height: 2.5rem;
      padding: 0.75rem;
      background-color: white;
      border-radius: 0.375rem;
      border: 1px solid #e2e8f0;
    }

    .phoneme-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      font-family: monospace;
      font-size: 0.875rem;
      transition: transform 0.1s ease, box-shadow 0.1s ease;
    }

    .phoneme-badge.available {
      background-color: #dcfce7;
      color: #166534;
      border: 1px solid #86efac;
    }

    .phoneme-badge.missing {
      background-color: #fef2f2;
      color: #dc2626;
      border: 1px solid #fecaca;
    }

    .phoneme-badge.playing {
      transform: scale(1.1);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.4);
      background-color: #dbeafe;
      color: #1d4ed8;
      border-color: #93c5fd;
    }

    .phoneme-badge sl-icon {
      font-size: 0.75rem;
    }

    .status-message {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.5rem 0.75rem;
      border-radius: 0.375rem;
      font-size: 0.875rem;
    }

    .status-message.warning {
      background-color: #fef3c7;
      color: #92400e;
    }

    .status-message.error {
      background-color: #fef2f2;
      color: #dc2626;
    }

    .status-message.info {
      background-color: #eff6ff;
      color: #1d4ed8;
    }

    .status-message sl-icon {
      flex-shrink: 0;
    }

    .loading-indicator {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #6b7280;
      font-size: 0.875rem;
    }

    .loading-indicator sl-spinner {
      font-size: 1rem;
      --indicator-color: #3b82f6;
    }

    .suggestions-container {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
      padding-top: 0.5rem;
    }

    .suggestion-chip {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      background-color: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-radius: 0.25rem;
      font-family: monospace;
      font-size: 0.75rem;
      color: #475569;
      cursor: pointer;
      transition: background-color 0.15s ease;
    }

    .suggestion-chip:hover {
      background-color: #e2e8f0;
    }

    .section-label {
      font-size: 0.75rem;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.25rem;
    }

    .keyboard-hint {
      font-size: 0.75rem;
      color: #94a3b8;
    }

    .keyboard-hint kbd {
      display: inline-block;
      padding: 0.125rem 0.375rem;
      background-color: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 0.25rem;
      font-family: inherit;
      font-size: 0.6875rem;
    }
  `;

  /**
   * Voicebank identifier for loading samples.
   */
  @property({ type: String })
  voicebankId = '';

  /**
   * Optional: pass existing oto entries to avoid re-fetching.
   */
  @property({ attribute: false })
  otoEntries?: OtoEntry[];

  /**
   * Optional: pre-fill phrase input.
   */
  @property({ type: String })
  initialPhrase?: string;

  /**
   * Current phrase text input.
   */
  @state()
  private _phraseText = '';

  /**
   * Selected melody pattern.
   */
  @state()
  private _melodyPattern: MelodyPattern = 'ascending';

  /**
   * Parsed phonemes with availability info.
   */
  @state()
  private _parsedPhonemes: ParsedPhoneme[] = [];

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
   * Current phoneme index being played.
   */
  @state()
  private _currentPhonemeIndex = -1;

  /**
   * Error message.
   */
  @state()
  private _error: string | null = null;

  /**
   * Warning message.
   */
  @state()
  private _warning: string | null = null;

  /**
   * Cached oto entries map for quick lookup.
   */
  private _otoMap: Map<string, OtoEntry> = new Map();

  /**
   * Available aliases for suggestions.
   */
  @state()
  private _availableAliases: string[] = [];

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
   * Interval ID for phoneme highlight updates.
   */
  private _phonemeIntervalId: number | null = null;

  /**
   * Playback start timestamp.
   */
  private _playbackStartTime = 0;

  /**
   * Scheduled phoneme timings for display.
   */
  private _scheduledPhonemes: Array<{ index: number; startTime: number }> = [];

  connectedCallback(): void {
    super.connectedCallback();
    if (this.initialPhrase) {
      this._phraseText = this.initialPhrase;
    }
    this._updateOtoMap();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._cleanup();
  }

  updated(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('otoEntries') || changedProperties.has('voicebankId')) {
      this._updateOtoMap();
    }
    if (changedProperties.has('_phraseText') || changedProperties.has('otoEntries')) {
      this._parsePhonemes();
    }
  }

  /**
   * Update the oto entries map from the entries array.
   */
  private _updateOtoMap(): void {
    this._otoMap.clear();
    if (this.otoEntries) {
      for (const entry of this.otoEntries) {
        this._otoMap.set(entry.alias, entry);
      }
      // Extract simplified aliases for suggestions
      this._availableAliases = this._extractSimplifiedAliases();
    }
  }

  /**
   * Extract simplified aliases for auto-suggestions.
   * Removes common prefixes like "- " for cleaner display.
   */
  private _extractSimplifiedAliases(): string[] {
    const simplified = new Set<string>();
    for (const alias of this._otoMap.keys()) {
      // Remove CV prefix if present
      if (alias.startsWith(CV_PREFIX)) {
        simplified.add(alias.slice(CV_PREFIX.length));
      } else {
        // For VCV aliases like "a ka", extract just the CV part
        const vcvParts = parseVCVAlias(alias);
        if (vcvParts) {
          simplified.add(vcvParts.cv);
        } else {
          simplified.add(alias);
        }
      }
    }
    return Array.from(simplified).slice(0, 20).sort();
  }

  /**
   * Parse the phrase text into individual phonemes.
   */
  private _parsePhonemes(): void {
    const text = this._phraseText.trim();
    if (!text) {
      this._parsedPhonemes = [];
      return;
    }

    // Handle different input formats
    let phonemes: string[];

    // VCV bracket format: "[a ka] [a sa]"
    const bracketMatch = text.match(/\[([^\]]+)\]/g);
    if (bracketMatch) {
      phonemes = bracketMatch.map(m => m.slice(1, -1).trim());
    }
    // Hyphen-separated: "a-ka-sa-ta-na"
    else if (text.includes('-') && !text.includes(' ')) {
      phonemes = text.split('-').map(p => p.trim()).filter(p => p);
    }
    // Space-separated (default): "a ka sa ta na"
    else {
      phonemes = text.split(/\s+/).filter(p => p);
    }

    // Match each phoneme to available aliases
    this._parsedPhonemes = phonemes.map(phoneme => {
      const alias = this._findAlias(phoneme);
      return {
        original: phoneme,
        alias,
        available: alias !== null,
      };
    });
  }

  /**
   * Find an alias in the oto map, checking common format variations.
   * Delegates to the shared alias matching utility.
   */
  private _findAlias(phoneme: string): string | null {
    return findMatchingAlias(phoneme, new Set(this._otoMap.keys()));
  }

  /**
   * Handle input change.
   */
  private _onInputChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    this._phraseText = input.value;
    this._error = null;
    this._warning = null;
  }

  /**
   * Handle melody pattern change.
   */
  private _onPatternChange(e: Event): void {
    const select = e.target as HTMLSelectElement;
    this._melodyPattern = select.value as MelodyPattern;
  }

  /**
   * Handle keyboard events on the input.
   */
  private _onInputKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!this._isPlaying) {
        this._play();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this._stop();
    }
  }

  /**
   * Handle suggestion chip click.
   */
  private _onSuggestionClick(alias: string): void {
    const currentText = this._phraseText.trim();
    this._phraseText = currentText ? `${currentText} ${alias}` : alias;
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
   * Start playback.
   */
  private async _play(): Promise<void> {
    if (!this.voicebankId) {
      this._error = 'No voicebank selected';
      return;
    }

    // Filter to only available phonemes
    const playablePhonemes = this._parsedPhonemes.filter(p => p.available);
    if (playablePhonemes.length === 0) {
      this._error = 'No playable phonemes. Check that the phonemes exist in your voicebank.';
      return;
    }

    // Show warning if some phonemes are missing
    const missingCount = this._parsedPhonemes.length - playablePhonemes.length;
    if (missingCount > 0) {
      this._warning = `${missingCount} phoneme${missingCount > 1 ? 's' : ''} not found and will be skipped`;
    } else {
      this._warning = null;
    }

    this._error = null;
    this._isLoading = true;
    this._currentPhonemeIndex = -1;

    try {
      // Get shared AudioContext on user interaction
      if (!this._audioContext) {
        this._audioContext = getSharedAudioContext();
      }

      if (this._audioContext.state === 'suspended') {
        await this._audioContext.resume();
      }

      // Create player and loader
      if (!this._player) {
        this._player = new MelodyPlayer(this._audioContext);
      }

      if (!this._loader) {
        this._loader = new SampleLoader(this._audioContext, api);
        this._loader.enableAutoInvalidation();
      }

      // Get oto entries if not provided
      let entries = this.otoEntries;
      if (!entries || entries.length === 0) {
        entries = await api.getOtoEntries(this.voicebankId);
      }

      // Build phrase notes with melody pattern
      const melodyPitches = MELODY_PATTERNS[this._melodyPattern];
      const notes: PhraseNote[] = [];
      let startTime = 0;

      // Store mapping from original index to playable note for highlighting
      this._scheduledPhonemes = [];

      for (let i = 0; i < playablePhonemes.length; i++) {
        const phoneme = playablePhonemes[i];
        const pitch = melodyPitches[i % melodyPitches.length];

        notes.push({
          alias: phoneme.alias!,
          pitch,
          startTime,
          duration: NOTE_DURATION,
        });

        // Find original index for this phoneme
        const originalIndex = this._parsedPhonemes.findIndex(
          p => p === phoneme
        );
        this._scheduledPhonemes.push({
          index: originalIndex,
          startTime,
        });

        startTime += NOTE_DURATION;
      }

      // Load samples
      const result = await this._loader.loadSamplesForPhrase(notes, this.voicebankId);

      if (result.sampleMap.size === 0) {
        this._error = 'Failed to load samples. Check if audio files exist.';
        this._isLoading = false;
        return;
      }

      // Filter notes to only those with loaded samples
      const playableNotes = notes.filter(note => result.sampleMap.has(note.alias));

      if (playableNotes.length === 0) {
        this._error = 'No playable samples available.';
        this._isLoading = false;
        return;
      }

      // Calculate total duration
      const lastNote = playableNotes[playableNotes.length - 1];
      const totalDuration = lastNote.startTime + lastNote.duration;

      // Start playback
      this._isLoading = false;
      this._isPlaying = true;
      this._playbackStartTime = this._audioContext.currentTime;

      this._player.playPhrase(playableNotes, result.sampleMap, {
        useDynamicOverlap: true,
        useLoudnessNormalization: true,
        crossfadeType: 'equal-power',
      });

      // Start phoneme highlight updates
      this._startPhonemeHighlight();

      // Schedule automatic stop
      const stopDelay = (totalDuration + 0.3) * 1000;
      setTimeout(() => {
        if (this._isPlaying) {
          this._stop();
        }
      }, stopDelay);

    } catch (error) {
      console.error('Quick Phrase playback failed:', error);
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
    this._currentPhonemeIndex = -1;
    this._stopPhonemeHighlight();
  }

  /**
   * Start updating the current phoneme highlight.
   */
  private _startPhonemeHighlight(): void {
    if (!this._audioContext) return;

    this._phonemeIntervalId = window.setInterval(() => {
      if (!this._isPlaying || !this._audioContext) {
        this._stopPhonemeHighlight();
        return;
      }

      const elapsed = this._audioContext.currentTime - this._playbackStartTime;

      // Find the current phoneme based on elapsed time
      let currentIndex = -1;
      for (let i = this._scheduledPhonemes.length - 1; i >= 0; i--) {
        if (elapsed >= this._scheduledPhonemes[i].startTime) {
          currentIndex = this._scheduledPhonemes[i].index;
          break;
        }
      }

      this._currentPhonemeIndex = currentIndex;
    }, 50);
  }

  /**
   * Stop phoneme highlight updates.
   */
  private _stopPhonemeHighlight(): void {
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
   * Get display name for a phoneme (removes prefixes).
   */
  private _getDisplayName(phoneme: ParsedPhoneme): string {
    if (!phoneme.alias) {
      return phoneme.original;
    }
    // Remove CV prefix for cleaner display
    if (phoneme.alias.startsWith(CV_PREFIX)) {
      return phoneme.alias.slice(CV_PREFIX.length);
    }
    return phoneme.alias;
  }

  render() {
    const hasPhonemes = this._parsedPhonemes.length > 0;
    const availableCount = this._parsedPhonemes.filter(p => p.available).length;
    const missingCount = this._parsedPhonemes.length - availableCount;

    const buttonVariant = this._isPlaying ? 'danger' : 'primary';
    const buttonText = this._isPlaying ? 'Stop' : 'Play';
    const buttonIcon = this._isPlaying ? 'stop-fill' : 'play-fill';

    return html`
      <div class="quick-phrase-container">
        <div class="section-label">Quick Phrase Mode</div>

        <div class="input-row">
          <sl-input
            class="phrase-input"
            placeholder="Type phonemes to sing (e.g., a ka sa ta na)"
            .value=${this._phraseText}
            @sl-input=${this._onInputChange}
            @keydown=${this._onInputKeyDown}
            ?disabled=${this._isPlaying}
          >
            <sl-icon slot="prefix" name="music-note-beamed"></sl-icon>
          </sl-input>
        </div>

        <div class="controls-row">
          <sl-select
            class="melody-select"
            value=${this._melodyPattern}
            @sl-change=${this._onPatternChange}
            ?disabled=${this._isPlaying}
            size="small"
          >
            <sl-option value="ascending">Ascending</sl-option>
            <sl-option value="descending">Descending</sl-option>
            <sl-option value="monotone">Monotone</sl-option>
            <sl-option value="custom">Up & Down</sl-option>
          </sl-select>

          <sl-tooltip content=${this._isPlaying ? 'Stop playback (Esc)' : 'Play phrase (Enter)'}>
            <sl-button
              class="play-button ${this._isPlaying ? 'playing' : ''}"
              variant=${buttonVariant}
              size="small"
              ?disabled=${this._isLoading || !hasPhonemes || !this.voicebankId || (availableCount === 0)}
              ?loading=${this._isLoading}
              @click=${this._onPlayClick}
            >
              <sl-icon slot="prefix" name=${buttonIcon}></sl-icon>
              ${buttonText}
            </sl-button>
          </sl-tooltip>

          <span class="keyboard-hint">
            <kbd>Enter</kbd> to play, <kbd>Esc</kbd> to stop
          </span>
        </div>

        ${hasPhonemes
          ? html`
              <div class="phoneme-preview">
                ${this._parsedPhonemes.map(
                  (phoneme, index) => html`
                    <span
                      class="phoneme-badge ${phoneme.available ? 'available' : 'missing'} ${
                        index === this._currentPhonemeIndex ? 'playing' : ''
                      }"
                    >
                      <sl-icon
                        name=${phoneme.available ? 'check-lg' : 'x-lg'}
                      ></sl-icon>
                      ${this._getDisplayName(phoneme)}
                    </span>
                  `
                )}
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
              <div class="status-message warning">
                <sl-icon name="exclamation-triangle"></sl-icon>
                <span>${this._warning}</span>
              </div>
            `
          : null}

        ${this._error
          ? html`
              <div class="status-message error">
                <sl-icon name="exclamation-circle"></sl-icon>
                <span>${this._error}</span>
              </div>
            `
          : null}

        ${hasPhonemes && missingCount > 0 && !this._isPlaying
          ? html`
              <div class="status-message info">
                <sl-icon name="info-circle"></sl-icon>
                <span>${availableCount} of ${this._parsedPhonemes.length} phonemes available</span>
              </div>
            `
          : null}

        ${!hasPhonemes && this._availableAliases.length > 0
          ? html`
              <div>
                <div class="section-label">Quick Add</div>
                <div class="suggestions-container">
                  ${this._availableAliases.slice(0, 15).map(
                    alias => html`
                      <span
                        class="suggestion-chip"
                        @click=${() => this._onSuggestionClick(alias)}
                      >
                        ${alias}
                      </span>
                    `
                  )}
                </div>
              </div>
            `
          : null}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-quick-phrase': UvmQuickPhrase;
  }
}
