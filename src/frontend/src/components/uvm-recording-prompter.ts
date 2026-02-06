import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';

// Shoelace components
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/badge/badge.js';
import '@shoelace-style/shoelace/dist/components/progress-bar/progress-bar.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

// Sub-components
import './uvm-record-engine.js';
import './uvm-live-waveform.js';
import './uvm-speech-recognizer.js';
import './uvm-level-meter.js';

import type { UvmRecordEngine } from './uvm-record-engine.js';
import type { RecordingState } from './uvm-record-engine.js';
import type { UvmLiveWaveform } from './uvm-live-waveform.js';
import type { UvmSpeechRecognizer } from './uvm-speech-recognizer.js';
import type { WordsUpdatedDetail } from './uvm-speech-recognizer.js';
import type { RecordingDataDetail } from './uvm-record-engine.js';

import { UvmToastManager } from './uvm-toast-manager.js';
import { getSharedAudioContext } from '../services/audio-context.js';
import { getHintsForPrompt, getEnglishHintsForPrompt, type PronunciationHint } from '../services/pronunciation-hints.js';

/**
 * Phoneme prompt data structure from the backend.
 */
export interface PhonemePrompt {
  id: string;
  text: string;       // Japanese text: "kakikukeko"
  romaji: string;     // Romanized: "ka ki ku ke ko"
  phonemes: string[];
  style: 'cv' | 'vcv' | 'cvvc' | 'vccv' | 'arpasing';
  category: string;
  difficulty: 'basic' | 'intermediate' | 'advanced';
  notes?: string;
}

/**
 * Word structure within a paragraph prompt.
 */
export interface ParagraphWord {
  text: string;         // Word: "akai"
  romaji: string;       // Word romaji: "akai"
  phonemes: string[];   // ["a", "ka", "i"]
  start_char: number;   // Position in sentence
}

/**
 * Paragraph prompt data structure for sentence-based recording.
 */
export interface ParagraphPrompt {
  id: string;
  text: string;           // Full sentence: "akai hana ga saku"
  romaji: string;         // Full romaji: "akai hana ga saku"
  words: ParagraphWord[];
  style: 'cv' | 'vcv' | 'cvvc';
  category: string;
  difficulty: 'basic' | 'intermediate' | 'advanced';
}

/**
 * Recording prompter component for guided voicebank recording sessions.
 *
 * Orchestrates three sub-components:
 * - `uvm-record-engine` -- MediaRecorder lifecycle, mic permission, audio capture
 * - `uvm-live-waveform` -- Canvas waveform visualization (live and recorded)
 * - `uvm-speech-recognizer` -- Web Speech API word tracking
 *
 * @fires recording-complete - Fired when user finishes recording with audio blob
 * @fires recording-cancelled - Fired when user cancels the recording
 * @fires re-record-requested - Fired when user wants to redo the current prompt
 * @fires proceed-to-next - Fired when user accepts the recording and wants to move to the next prompt
 *
 * @example
 * ```html
 * <uvm-recording-prompter
 *   .prompt=${currentPrompt}
 *   .promptIndex=${3}
 *   .totalPrompts=${12}
 *   @recording-complete=${this._onRecordingComplete}
 *   @proceed-to-next=${this._onProceedToNext}
 * ></uvm-recording-prompter>
 * ```
 */
@customElement('uvm-recording-prompter')
export class UvmRecordingPrompter extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
    }

    .prompter-container {
      display: flex;
      flex-direction: column;
      background-color: white;
      border-radius: 16px;
      overflow: hidden;
    }

    /* Progress: Minimal, centered, unobtrusive */
    .progress-section {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.25rem;
    }

    .progress-dots {
      display: none;
    }

    .progress-label {
      font-size: 0.8125rem;
      font-weight: 400;
      color: var(--sl-color-neutral-400, #94a3b8);
      letter-spacing: 0.05em;
    }

    /* The prompt is the hero */
    .prompt-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3.5rem 2rem 2.5rem;
      min-height: 220px;
    }

    .prompt-text-container {
      text-align: center;
    }

    .prompt-japanese {
      font-size: 4rem;
      font-weight: 300;
      color: var(--sl-color-neutral-900, #0f172a);
      letter-spacing: 0.12em;
      margin-bottom: 1rem;
      display: flex;
      justify-content: center;
      gap: 0.08em;
    }

    .prompt-char {
      position: relative;
      display: inline-block;
      transition: color 0.25s ease, transform 0.25s ease;
    }

    .prompt-char.highlighted {
      color: var(--sl-color-neutral-900, #0f172a);
      transform: scale(1.05);
    }

    .prompt-char.highlighted::after {
      content: '';
      position: absolute;
      bottom: -6px;
      left: 15%;
      right: 15%;
      height: 2px;
      background-color: var(--sl-color-neutral-800, #1e293b);
      border-radius: 1px;
    }

    .prompt-char.spoken {
      color: var(--sl-color-neutral-300, #cbd5e1);
    }

    .prompt-romaji {
      font-size: 1.0625rem;
      color: var(--sl-color-neutral-400, #94a3b8);
      letter-spacing: 0.25em;
      display: flex;
      justify-content: center;
      gap: 0.75em;
      font-weight: 300;
    }

    .romaji-word {
      transition: color 0.25s ease;
    }

    .romaji-word.highlighted {
      color: var(--sl-color-neutral-600, #475569);
    }

    .romaji-word.spoken {
      color: var(--sl-color-neutral-300, #cbd5e1);
    }

    .empty-prompt {
      display: flex;
      flex-direction: column;
      align-items: center;
      color: var(--sl-color-neutral-300, #cbd5e1);
    }

    .empty-prompt sl-icon {
      font-size: 2rem;
      margin-bottom: 0.75rem;
    }

    .empty-prompt p {
      font-size: 0.875rem;
    }

    /* State indicator */
    .state-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.625rem;
      padding: 1.25rem;
      font-size: 0.875rem;
      font-weight: 400;
    }

    .state-indicator.idle {
      color: var(--sl-color-neutral-400, #94a3b8);
    }

    .state-indicator.listening {
      color: var(--sl-color-neutral-500, #64748b);
    }

    .state-indicator.recording {
      color: var(--sl-color-neutral-900, #0f172a);
    }

    .state-indicator.processing {
      color: var(--sl-color-neutral-500, #64748b);
    }

    .recording-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: #ef4444;
      animation: recordingPulse 1.2s ease-in-out infinite;
    }

    @keyframes recordingPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.35; }
    }

    .listening-indicator {
      display: flex;
      gap: 3px;
      align-items: center;
      height: 14px;
    }

    .listening-bar {
      width: 2px;
      background-color: var(--sl-color-neutral-400, #94a3b8);
      border-radius: 1px;
      animation: listeningBounce 0.9s ease-in-out infinite;
    }

    .listening-bar:nth-child(1) { height: 4px; animation-delay: 0s; }
    .listening-bar:nth-child(2) { height: 7px; animation-delay: 0.15s; }
    .listening-bar:nth-child(3) { height: 10px; animation-delay: 0.3s; }
    .listening-bar:nth-child(4) { height: 7px; animation-delay: 0.45s; }
    .listening-bar:nth-child(5) { height: 4px; animation-delay: 0.6s; }

    @keyframes listeningBounce {
      0%, 100% { transform: scaleY(1); }
      50% { transform: scaleY(0.35); }
    }

    /* Controls */
    .controls-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
      padding: 1rem 2rem 2rem;
    }

    .control-buttons {
      display: flex;
      justify-content: center;
      gap: 0.75rem;
    }

    .record-btn::part(base) {
      font-weight: 500;
      font-size: 0.9375rem;
      padding: 0.875rem 2.25rem;
      border-radius: 9999px;
      background: var(--sl-color-neutral-900, #0f172a);
      border: none;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }

    .record-btn::part(base):hover {
      transform: scale(1.02);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    }

    .record-btn::part(base):active {
      transform: scale(0.98);
    }

    .record-btn.recording::part(base) {
      background-color: #ef4444;
    }

    .record-btn.recording::part(base):hover {
      background-color: #dc2626;
    }

    /* Metadata is hidden */
    .metadata-row {
      display: none;
    }

    /* Alerts */
    .alert-container {
      padding: 0 1.5rem 1rem;
    }

    .alert-container sl-alert {
      margin: 0;
    }

    .fallback-message {
      padding: 0.625rem 1rem;
      background-color: var(--sl-color-neutral-100, #f1f5f9);
      color: var(--sl-color-neutral-600, #475569);
      font-size: 0.8125rem;
      text-align: center;
    }

    .fallback-message code {
      background-color: var(--sl-color-neutral-200, #e2e8f0);
      padding: 0.125rem 0.375rem;
      border-radius: 4px;
      font-family: ui-monospace, monospace;
      font-size: 0.75rem;
    }

    /* Notes */
    .notes-section {
      display: none;
    }

    /* Pronunciation hints */
    .pronunciation-hints {
      margin-top: 2rem;
      padding: 1rem 1.25rem;
      background: var(--sl-color-neutral-50, #f8fafc);
      border-radius: 10px;
      font-size: 0.8125rem;
      max-width: 380px;
    }

    .hints-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
      font-weight: 500;
      font-size: 0.6875rem;
      color: var(--sl-color-neutral-400, #94a3b8);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .hints-header sl-icon {
      font-size: 0.875rem;
      color: var(--sl-color-neutral-400, #94a3b8);
    }

    .hint-item {
      display: flex;
      align-items: baseline;
      gap: 0.75rem;
      color: var(--sl-color-neutral-600, #475569);
    }

    .hint-item + .hint-item {
      margin-top: 0.375rem;
    }

    .hint-phoneme {
      font-weight: 500;
      color: var(--sl-color-neutral-700, #334155);
      min-width: 1.75rem;
      font-family: inherit;
      font-size: 0.8125rem;
    }

    .hint-description {
      flex: 1;
      color: var(--sl-color-neutral-500, #64748b);
    }

    .hint-examples {
      color: var(--sl-color-neutral-400, #94a3b8);
      margin-left: 0.25rem;
    }

    .hint-examples mark {
      background: var(--sl-color-neutral-200, #e2e8f0);
      color: var(--sl-color-neutral-700, #334155);
      padding: 0.125rem 0.25rem;
      border-radius: 3px;
      font-weight: 500;
    }

    /* Paragraph mode styles */
    .paragraph-sentence {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 1.5rem;
      max-width: 600px;
      margin: 0 auto;
    }

    .paragraph-word {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.375rem;
      padding: 0.5rem 0.75rem;
      border-radius: 8px;
      transition: all 0.25s ease;
    }

    .paragraph-word-text {
      font-size: 2.25rem;
      font-weight: 300;
      color: var(--sl-color-neutral-900, #0f172a);
      letter-spacing: 0.08em;
      transition: color 0.25s ease, transform 0.25s ease;
    }

    .paragraph-word-romaji {
      font-size: 0.875rem;
      color: var(--sl-color-neutral-400, #94a3b8);
      letter-spacing: 0.15em;
      font-weight: 300;
      transition: color 0.25s ease;
    }

    .paragraph-word.active {
      background: var(--sl-color-neutral-100, #f1f5f9);
    }

    .paragraph-word.active .paragraph-word-text {
      color: var(--sl-color-neutral-900, #0f172a);
      transform: scale(1.08);
    }

    .paragraph-word.active .paragraph-word-romaji {
      color: var(--sl-color-neutral-600, #475569);
    }

    .paragraph-word.spoken .paragraph-word-text {
      color: var(--sl-color-neutral-300, #cbd5e1);
    }

    .paragraph-word.spoken .paragraph-word-romaji {
      color: var(--sl-color-neutral-300, #cbd5e1);
    }

    .paragraph-progress {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      margin-top: 1.5rem;
      font-size: 0.8125rem;
      color: var(--sl-color-neutral-400, #94a3b8);
    }

    .paragraph-progress-bar {
      width: 120px;
      height: 4px;
      background: var(--sl-color-neutral-200, #e2e8f0);
      border-radius: 2px;
      overflow: hidden;
    }

    .paragraph-progress-fill {
      height: 100%;
      background: var(--sl-color-neutral-600, #475569);
      border-radius: 2px;
      transition: width 0.3s ease;
    }

    .paragraph-phoneme-coverage {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.75rem;
      color: var(--sl-color-neutral-400, #94a3b8);
      margin-top: 0.5rem;
    }

    .paragraph-phoneme-coverage sl-icon {
      font-size: 0.875rem;
    }

    /* Listen button styles */
    .prompt-header {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      margin-bottom: 0.5rem;
    }

    .listen-button {
      font-size: 1.5rem;
      color: var(--sl-color-neutral-500, #64748b);
      transition: color 0.2s ease, transform 0.2s ease;
    }

    .listen-button:hover {
      color: var(--sl-color-neutral-700, #334155);
      transform: scale(1.1);
    }

    .listen-button.speaking {
      color: var(--sl-color-primary-600, #2563eb);
      animation: speakingPulse 1s ease-in-out infinite;
    }

    .listen-button::part(base) {
      padding: 0.5rem;
    }

    @keyframes speakingPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }

    /* Karaoke highlighting for TTS */
    .prompt-char.tts-active {
      color: var(--sl-color-primary-600, #2563eb);
      transform: scale(1.1);
    }

    .paragraph-word.tts-active {
      background: var(--sl-color-primary-100, #dbeafe);
    }

    .paragraph-word.tts-active .paragraph-word-text {
      color: var(--sl-color-primary-700, #1d4ed8);
      transform: scale(1.08);
    }

    .paragraph-word.tts-active .paragraph-word-romaji {
      color: var(--sl-color-primary-500, #3b82f6);
    }
  `;

  // ---- Public properties (same API as before) ----

  /**
   * The current prompt to display.
   */
  @property({ attribute: false })
  prompt?: PhonemePrompt;

  /**
   * Current prompt index (0-based).
   */
  @property({ type: Number })
  promptIndex = 0;

  /**
   * Total number of prompts in the session.
   */
  @property({ type: Number })
  totalPrompts = 0;

  /**
   * Current recording state.
   */
  @property({ type: String })
  state: RecordingState = 'idle';

  /**
   * Language for pronunciation hints ('ja' for Japanese, 'en' for English).
   */
  @property({ type: String })
  language = 'ja';

  /**
   * Recording mode: 'individual' for single phoneme prompts, 'paragraph' for full sentences.
   */
  @property({ type: String })
  mode: 'individual' | 'paragraph' = 'individual';

  /**
   * The current paragraph prompt to display (only used when mode='paragraph').
   */
  @property({ attribute: false })
  paragraphPrompt?: ParagraphPrompt;

  // ---- Sub-component references ----

  @query('uvm-record-engine')
  private _recordEngine!: UvmRecordEngine;

  @query('uvm-live-waveform')
  private _liveWaveform!: UvmLiveWaveform;

  @query('uvm-speech-recognizer')
  private _speechRecognizer!: UvmSpeechRecognizer;

  // ---- Internal state ----

  @state()
  private _currentWordIndex = -1;

  @state()
  private _spokenWords: Set<number> = new Set();

  @state()
  private _paragraphSpokenWordCount = 0;

  @state()
  private _speechSupported = true;

  @state()
  private _isFirefox = false;

  @state()
  private _errorMessage: string | null = null;

  @state()
  private _recordingDuration = 0;

  @state()
  private _recordedAudioBuffer: AudioBuffer | null = null;

  @state()
  private _isPreviewPlaying = false;

  @state()
  private _isSpeaking = false;

  @state()
  private _speakingCharIndex = -1;

  @state()
  private _analyser: AnalyserNode | null = null;

  @state()
  private _hasRecordedAudio = false;

  private _previewSource: AudioBufferSourceNode | null = null;
  private _previewStartTime = 0;
  private _previewAnimationId: number | null = null;
  private _previewPlayheadPosition = 0;
  private _previewAudioContext: AudioContext | null = null;

  // ---- Lifecycle ----

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._cancelSpeech();
    this._stopPreviewPlayback();
    // Release reference to shared AudioContext (do not close -- it is shared)
    this._previewAudioContext = null;
  }

  updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties);

    // Cancel speech when navigating to a different prompt
    if (changedProperties.has('prompt') || changedProperties.has('paragraphPrompt') || changedProperties.has('promptIndex')) {
      this._cancelSpeech();
    }

    // Redraw recorded waveform when the canvas becomes visible after state change
    if (changedProperties.has('state') || changedProperties.has('_recordedAudioBuffer')) {
      if (this.state === 'idle' && this._recordedAudioBuffer && this._liveWaveform) {
        requestAnimationFrame(() => {
          this._liveWaveform?.redrawRecordedWaveform();
        });
      }
    }
  }

  // ---- Computed properties for sub-components ----

  /**
   * Compute the romaji words array for the speech recognizer.
   */
  private get _romajiWords(): string[] {
    if (this.mode === 'paragraph') {
      return this.paragraphPrompt?.words.map(w => w.romaji.toLowerCase()) ?? [];
    }
    return this.prompt?.romaji.toLowerCase().split(/\s+/) ?? [];
  }

  /**
   * Compute the waveform display mode based on current state.
   */
  private get _waveformMode(): 'live' | 'recorded' | 'empty' | 'processing' {
    if (this.state === 'recording') return 'live';
    if (this.state === 'processing') return 'processing';
    if (this.state === 'idle' && this._recordedAudioBuffer) return 'recorded';
    return 'empty';
  }

  // ---- Sub-component event handlers ----

  private _onEngineStateChanged(e: CustomEvent<{ state: RecordingState; previousState: RecordingState }>): void {
    this.state = e.detail.state;
  }

  private _onEngineError(e: CustomEvent<{ message: string }>): void {
    this._errorMessage = e.detail.message;
    UvmToastManager.error(e.detail.message);
  }

  private _onAnalyserReady(e: CustomEvent<{ analyser: AnalyserNode }>): void {
    this._analyser = e.detail.analyser;
  }

  private _onRecordingDataAvailable(e: CustomEvent<RecordingDataDetail>): void {
    const { audioBlob, audioBuffer, duration } = e.detail;

    this._recordingDuration = duration;
    this._recordedAudioBuffer = audioBuffer;
    this._hasRecordedAudio = true;

    // Initialize preview audio context
    if (!this._previewAudioContext) {
      this._previewAudioContext = getSharedAudioContext();
    }

    // Emit recording complete event (preserving the original public API)
    const promptId = this.mode === 'paragraph' ? this.paragraphPrompt?.id : this.prompt?.id;
    this.dispatchEvent(new CustomEvent('recording-complete', {
      detail: {
        audioBlob,
        duration,
        promptId,
        mode: this.mode,
      },
      bubbles: true,
      composed: true,
    }));

    UvmToastManager.success('Recording saved');
  }

  private _onWordsUpdated(e: CustomEvent<WordsUpdatedDetail>): void {
    this._currentWordIndex = e.detail.currentWordIndex;
    this._spokenWords = e.detail.spokenWords;

    if (this.mode === 'paragraph') {
      this._paragraphSpokenWordCount = this._spokenWords.size;
    }
  }

  private _onSpeechSupportChecked(e: CustomEvent<{ supported: boolean; isFirefox: boolean }>): void {
    this._speechSupported = e.detail.supported;
    this._isFirefox = e.detail.isFirefox;
  }

  private _onSpeechError(e: CustomEvent<{ error: string }>): void {
    UvmToastManager.warning(`Speech recognition error: ${e.detail.error}`);
  }

  // ---- Waveform preview events (from uvm-live-waveform) ----

  private _onWaveformPreviewPlay(): void {
    this._startPreviewPlayback();
  }

  private _onWaveformPreviewStop(): void {
    this._stopPreviewPlayback();
  }

  // ---- Recording actions ----

  private async _startRecording(): Promise<void> {
    this._errorMessage = null;
    this._cancelSpeech();

    // Reset speech recognizer state
    this._currentWordIndex = 0;
    this._spokenWords = new Set();
    this._paragraphSpokenWordCount = 0;

    // Start the record engine (handles mic permission, MediaRecorder)
    await this._recordEngine.startRecording();

    // Start speech recognition
    if (this._speechRecognizer) {
      this._speechRecognizer.reset();
      this._speechRecognizer.active = true;
    }
  }

  private _stopRecording(): void {
    // Stop speech recognition
    if (this._speechRecognizer) {
      this._speechRecognizer.active = false;
    }

    // Stop recording
    this._recordEngine.stopRecording();
  }

  private _cancelRecording(): void {
    // Stop speech recognition
    if (this._speechRecognizer) {
      this._speechRecognizer.active = false;
    }

    // Cancel recording
    this._recordEngine.cancelRecording();
    this._recordEngine.cleanup();

    this._analyser = null;
    this._hasRecordedAudio = false;

    const promptId = this.mode === 'paragraph' ? this.paragraphPrompt?.id : this.prompt?.id;
    this.dispatchEvent(new CustomEvent('recording-cancelled', {
      detail: { promptId, mode: this.mode },
      bubbles: true,
      composed: true,
    }));
  }

  private _reRecord(): void {
    this._stopPreviewPlayback();

    // Stop speech recognition
    if (this._speechRecognizer) {
      this._speechRecognizer.active = false;
      this._speechRecognizer.reset();
    }

    this._recordEngine.cancelRecording();
    this._recordEngine.cleanup();

    this._analyser = null;
    this._currentWordIndex = -1;
    this._spokenWords = new Set();
    this._paragraphSpokenWordCount = 0;
    this._recordedAudioBuffer = null;
    this._hasRecordedAudio = false;

    const promptId = this.mode === 'paragraph' ? this.paragraphPrompt?.id : this.prompt?.id;
    this.dispatchEvent(new CustomEvent('re-record-requested', {
      detail: { promptId, mode: this.mode },
      bubbles: true,
      composed: true,
    }));

    // Auto-start new recording
    this._startRecording();
  }

  private _proceedToNext(): void {
    this._stopPreviewPlayback();

    const promptId = this.mode === 'paragraph' ? this.paragraphPrompt?.id : this.prompt?.id;
    this.dispatchEvent(new CustomEvent('proceed-to-next', {
      detail: { promptId, mode: this.mode },
      bubbles: true,
      composed: true,
    }));

    // Reset internal state for the next prompt
    this._recordedAudioBuffer = null;
    this._hasRecordedAudio = false;
    this._currentWordIndex = -1;
    this._spokenWords = new Set();
    this._paragraphSpokenWordCount = 0;

    if (this._recordEngine) {
      this._recordEngine.resetAudio();
    }
  }

  // ---- Preview playback (stays in parent since it needs AudioBufferSourceNode) ----

  private _startPreviewPlayback(): void {
    if (!this._recordedAudioBuffer) return;

    if (!this._previewAudioContext) {
      this._previewAudioContext = getSharedAudioContext();
    }

    this._stopPreviewPlayback();

    if (this._previewAudioContext.state === 'suspended') {
      this._previewAudioContext.resume();
    }

    this._previewSource = this._previewAudioContext.createBufferSource();
    this._previewSource.buffer = this._recordedAudioBuffer;
    this._previewSource.connect(this._previewAudioContext.destination);

    this._previewStartTime = this._previewAudioContext.currentTime;
    this._previewPlayheadPosition = 0;
    this._isPreviewPlaying = true;

    this._previewSource.start(0);

    this._previewSource.onended = () => {
      this._isPreviewPlaying = false;
      this._previewPlayheadPosition = 0;
      this._stopPreviewAnimation();
    };

    this._startPreviewAnimation();
  }

  private _stopPreviewPlayback(): void {
    if (this._previewSource) {
      try {
        this._previewSource.stop();
      } catch {
        // Ignore errors if already stopped
      }
      this._previewSource.disconnect();
      this._previewSource = null;
    }

    this._isPreviewPlaying = false;
    this._previewPlayheadPosition = 0;
    this._stopPreviewAnimation();
  }

  private _startPreviewAnimation(): void {
    const animate = () => {
      if (!this._isPreviewPlaying || !this._recordedAudioBuffer || !this._previewAudioContext) {
        return;
      }

      const elapsed = this._previewAudioContext.currentTime - this._previewStartTime;
      const duration = this._recordedAudioBuffer.duration;
      this._previewPlayheadPosition = Math.min(elapsed / duration, 1);

      if (this._previewPlayheadPosition < 1) {
        this._previewAnimationId = requestAnimationFrame(animate);
      }
    };

    this._previewAnimationId = requestAnimationFrame(animate);
  }

  private _stopPreviewAnimation(): void {
    if (this._previewAnimationId !== null) {
      cancelAnimationFrame(this._previewAnimationId);
      this._previewAnimationId = null;
    }
  }

  // ---- TTS (speech synthesis) ----

  private _cancelSpeech(): void {
    if (this._isSpeaking) {
      speechSynthesis.cancel();
      this._isSpeaking = false;
      this._speakingCharIndex = -1;
    }
  }

  private _speakPrompt(): void {
    if (this._isSpeaking) {
      this._cancelSpeech();
      return;
    }

    const text = this.mode === 'paragraph'
      ? this.paragraphPrompt?.text
      : this.prompt?.text;

    if (!text) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    utterance.rate = 0.85;

    utterance.onstart = () => {
      this._isSpeaking = true;
      this._speakingCharIndex = 0;
    };

    utterance.onend = () => {
      this._isSpeaking = false;
      this._speakingCharIndex = -1;
    };

    utterance.onerror = () => {
      this._isSpeaking = false;
      this._speakingCharIndex = -1;
    };

    utterance.onboundary = (event: SpeechSynthesisEvent) => {
      if (event.name === 'word' || event.name === 'sentence') {
        this._speakingCharIndex = event.charIndex;
      }
    };

    speechSynthesis.speak(utterance);
  }

  // ---- Formatting helpers ----

  private _formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  private _getStateText(): string {
    switch (this.state) {
      case 'idle': return 'Ready to record';
      case 'listening': return 'Listening...';
      case 'recording': return `Recording... ${this._formatDuration(this._recordingDuration)}`;
      case 'processing': return 'Processing...';
      default: return '';
    }
  }

  // ---- Render helpers ----

  private _renderProgressDots() {
    const dots = [];
    const maxVisible = Math.min(this.totalPrompts, 20);
    const showAll = this.totalPrompts <= maxVisible;

    for (let i = 0; i < (showAll ? this.totalPrompts : maxVisible); i++) {
      const isCompleted = i < this.promptIndex;
      const isCurrent = i === this.promptIndex;

      dots.push(html`
        <div
          class="progress-dot ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}"
        ></div>
      `);
    }

    return dots;
  }

  private _renderJapaneseText() {
    if (!this.prompt) return null;

    const chars = this.prompt.text.split('');
    const romajiWords = this.prompt.romaji.split(/\s+/);

    return chars.map((char, idx) => {
      const wordIdx = Math.floor(idx * romajiWords.length / chars.length);
      const isHighlighted = wordIdx === this._currentWordIndex;
      const isSpoken = this._spokenWords.has(wordIdx);
      const isTtsActive = this._isSpeaking && this._speakingCharIndex >= 0 &&
        idx >= this._speakingCharIndex && idx < this._speakingCharIndex + 2;

      return html`
        <span class="prompt-char ${isHighlighted ? 'highlighted' : ''} ${isSpoken ? 'spoken' : ''} ${isTtsActive ? 'tts-active' : ''}">
          ${char}
        </span>
      `;
    });
  }

  private _renderRomajiText() {
    if (!this.prompt) return null;

    const words = this.prompt.romaji.split(/\s+/);

    return words.map((word, idx) => {
      const isHighlighted = idx === this._currentWordIndex;
      const isSpoken = this._spokenWords.has(idx);

      return html`
        <span class="romaji-word ${isHighlighted ? 'highlighted' : ''} ${isSpoken ? 'spoken' : ''}">
          ${word}
        </span>
      `;
    });
  }

  private _renderParagraphPrompt() {
    if (!this.paragraphPrompt) {
      return html`
        <div class="empty-prompt">
          <sl-icon name="mic-mute"></sl-icon>
          <p>No paragraph prompt loaded</p>
        </div>
      `;
    }

    const totalWords = this.paragraphPrompt.words.length;
    const spokenCount = this._paragraphSpokenWordCount;
    const progressPercent = totalWords > 0 ? (spokenCount / totalWords) * 100 : 0;

    const totalPhonemes = this.paragraphPrompt.words.reduce(
      (sum, w) => sum + w.phonemes.length, 0
    );
    const spokenPhonemes = this.paragraphPrompt.words
      .filter((_, idx) => this._spokenWords.has(idx))
      .reduce((sum, w) => sum + w.phonemes.length, 0);

    const getTtsActiveWordIndex = (): number => {
      if (!this._isSpeaking || this._speakingCharIndex < 0) return -1;
      let charCount = 0;
      for (let i = 0; i < this.paragraphPrompt!.words.length; i++) {
        const word = this.paragraphPrompt!.words[i];
        charCount += word.text.length;
        if (i < this.paragraphPrompt!.words.length - 1) charCount += 1;
        if (this._speakingCharIndex < charCount) return i;
      }
      return this.paragraphPrompt!.words.length - 1;
    };

    const ttsActiveWordIndex = getTtsActiveWordIndex();

    return html`
      <div class="prompt-text-container">
        <div class="prompt-header" style="margin-bottom: 1rem;">
          <sl-tooltip content="Listen to pronunciation">
            <sl-icon-button
              name=${this._isSpeaking ? 'stop-fill' : 'volume-up'}
              label="Listen to pronunciation"
              class="listen-button ${this._isSpeaking ? 'speaking' : ''}"
              @click=${this._speakPrompt}
              ?disabled=${this.state === 'recording'}
            ></sl-icon-button>
          </sl-tooltip>
        </div>

        <div class="paragraph-sentence">
          ${this.paragraphPrompt.words.map((word, idx) => {
            const isActive = idx === this._currentWordIndex;
            const isSpoken = this._spokenWords.has(idx);
            const isTtsActive = idx === ttsActiveWordIndex;

            return html`
              <div class="paragraph-word ${isActive ? 'active' : ''} ${isSpoken ? 'spoken' : ''} ${isTtsActive ? 'tts-active' : ''}">
                <span class="paragraph-word-text">${word.text}</span>
                <span class="paragraph-word-romaji">${word.romaji}</span>
              </div>
            `;
          })}
        </div>

        <div class="paragraph-progress">
          <span>Word ${Math.min(spokenCount + 1, totalWords)} of ${totalWords}</span>
          <div class="paragraph-progress-bar">
            <div class="paragraph-progress-fill" style="width: ${progressPercent}%"></div>
          </div>
        </div>

        <div class="paragraph-phoneme-coverage">
          <sl-icon name="diagram-3"></sl-icon>
          <span>${spokenPhonemes}/${totalPhonemes} phonemes covered</span>
        </div>
      </div>
      ${this._renderStateIndicator()}
    `;
  }

  private _renderIndividualPrompt() {
    if (!this.prompt) {
      return html`
        <div class="empty-prompt">
          <sl-icon name="mic-mute"></sl-icon>
          <p>No prompt loaded</p>
        </div>
      `;
    }

    return html`
      <div class="prompt-text-container">
        <div class="prompt-header">
          <div class="prompt-japanese">
            ${this._renderJapaneseText()}
          </div>
          <sl-tooltip content="Listen to pronunciation">
            <sl-icon-button
              name=${this._isSpeaking ? 'stop-fill' : 'volume-up'}
              label="Listen to pronunciation"
              class="listen-button ${this._isSpeaking ? 'speaking' : ''}"
              @click=${this._speakPrompt}
              ?disabled=${this.state === 'recording'}
            ></sl-icon-button>
          </sl-tooltip>
        </div>
        <div class="prompt-romaji">
          ${this._renderRomajiText()}
        </div>
        ${this._renderPronunciationHints()}
      </div>
      ${this._renderStateIndicator()}
    `;
  }

  private _markdownToMark(text: string): ReturnType<typeof html> {
    const parts = text.split(/\*\*([^*]+)\*\*/);
    return html`${parts.map((part, i) =>
      i % 2 === 1 ? html`<mark>${part}</mark>` : part
    )}`;
  }

  private _renderPronunciationHints() {
    if (!this.prompt) return null;

    const hints = this.language === 'en'
      ? getEnglishHintsForPrompt(this.prompt.romaji)
      : getHintsForPrompt(this.prompt.romaji);

    const displayedHints = hints.slice(0, 4);

    if (displayedHints.length === 0) return null;

    return html`
      <div class="pronunciation-hints">
        <div class="hints-header">
          <sl-icon name="lightbulb"></sl-icon>
          <span>Pronunciation Guide</span>
        </div>
        ${displayedHints.map(hint => this._renderHintItem(hint))}
      </div>
    `;
  }

  private _renderHintItem(hint: PronunciationHint) {
    const examplesText = hint.examples.join(', ');

    return html`
      <div class="hint-item">
        <span class="hint-phoneme">${hint.phoneme}</span>
        <span class="hint-description">${hint.description}</span>
        <span class="hint-examples">${this._markdownToMark(examplesText)}</span>
      </div>
    `;
  }

  private _renderStateIndicator() {
    return html`
      <div class="state-indicator ${this.state}">
        ${this.state === 'recording'
          ? html`<span class="recording-indicator"></span>`
          : this.state === 'listening'
            ? html`
                <span class="listening-indicator">
                  <span class="listening-bar"></span>
                  <span class="listening-bar"></span>
                  <span class="listening-bar"></span>
                  <span class="listening-bar"></span>
                  <span class="listening-bar"></span>
                </span>
              `
            : this.state === 'processing'
              ? html`<sl-spinner></sl-spinner>`
              : html`<sl-icon name="mic"></sl-icon>`
        }
        ${this._getStateText()}
      </div>
    `;
  }

  private _renderMetadataRow() {
    const promptData = this.mode === 'paragraph' ? this.paragraphPrompt : this.prompt;
    if (!promptData) return null;

    return html`
      <div class="metadata-row">
        <div class="metadata-item">
          <sl-icon name="tag"></sl-icon>
          Category: ${promptData.category}
        </div>
        <div class="metadata-item">
          <sl-icon name="speedometer2"></sl-icon>
          Difficulty: ${promptData.difficulty}
        </div>
        <div class="metadata-item">
          <sl-icon name="diagram-3"></sl-icon>
          Style: ${promptData.style.toUpperCase()}
        </div>
      </div>
    `;
  }

  private _renderControls() {
    const isRecording = this.state === 'recording';
    const isProcessing = this.state === 'processing';
    const hasPrompt = this.mode === 'paragraph' ? !!this.paragraphPrompt : !!this.prompt;
    const canRecord = this.state === 'idle' && hasPrompt;

    return html`
      <div class="controls-section">
        <div class="control-buttons">
          ${canRecord
            ? html`
                <sl-button
                  variant="primary"
                  size="large"
                  class="record-btn"
                  @click=${this._startRecording}
                >
                  <sl-icon slot="prefix" name="record-circle"></sl-icon>
                  Record
                </sl-button>
              `
            : isRecording
              ? html`
                  <sl-button
                    variant="danger"
                    size="large"
                    class="record-btn recording"
                    @click=${this._stopRecording}
                  >
                    <sl-icon slot="prefix" name="stop-fill"></sl-icon>
                    Stop
                  </sl-button>
                `
              : null
          }

          ${(isRecording || this.state === 'listening') && html`
            <sl-button
              variant="neutral"
              size="large"
              @click=${this._cancelRecording}
            >
              <sl-icon slot="prefix" name="x-lg"></sl-icon>
              Cancel
            </sl-button>
          `}

          ${this.state === 'idle' && this._hasRecordedAudio && html`
            <sl-button
              variant="primary"
              size="large"
              @click=${this._proceedToNext}
            >
              <sl-icon slot="prefix" name="check-lg"></sl-icon>
              Accept & Next
            </sl-button>
            <sl-tooltip content="Record again">
              <sl-button
                variant="neutral"
                size="large"
                @click=${this._reRecord}
              >
                <sl-icon slot="prefix" name="arrow-counterclockwise"></sl-icon>
                Re-record
              </sl-button>
            </sl-tooltip>
          `}

          ${isProcessing && html`
            <sl-button size="large" disabled loading>
              Processing...
            </sl-button>
          `}
        </div>

        ${this._renderMetadataRow()}
      </div>
    `;
  }

  // ---- Main render ----

  render() {
    return html`
      <!-- Headless sub-components -->
      <uvm-record-engine
        @state-changed=${this._onEngineStateChanged}
        @recording-data-available=${this._onRecordingDataAvailable}
        @error=${this._onEngineError}
        @analyser-ready=${this._onAnalyserReady}
      ></uvm-record-engine>

      <uvm-speech-recognizer
        lang=${this.language === 'en' ? 'en-US' : 'ja-JP'}
        .romajiWords=${this._romajiWords}
        @words-updated=${this._onWordsUpdated}
        @support-checked=${this._onSpeechSupportChecked}
        @speech-error=${this._onSpeechError}
      ></uvm-speech-recognizer>

      <div class="prompter-container">
        ${!this._speechSupported && html`
          <div class="fallback-message">
            <sl-icon name="exclamation-triangle"></sl-icon>
            ${this._isFirefox ? html`
              <span>
                <strong>Firefox detected:</strong> Speech recognition requires experimental flags.
                Go to <code>about:config</code> and enable
                <code>media.webspeech.recognition.enable</code> and
                <code>media.webspeech.recognition.force_enable</code>, then reload.
                Recording still works without it.
              </span>
            ` : html`
              <span>Web Speech API is not supported. Word tracking will not be available, but recording will still work.</span>
            `}
          </div>
        `}

        ${this._errorMessage && html`
          <div class="alert-container">
            <sl-alert variant="danger" open closable @sl-after-hide=${() => this._errorMessage = null}>
              <sl-icon slot="icon" name="exclamation-octagon"></sl-icon>
              ${this._errorMessage}
            </sl-alert>
          </div>
        `}

        <div class="progress-section">
          <div class="progress-dots">
            ${this._renderProgressDots()}
          </div>
          <span class="progress-label">${this.promptIndex + 1} / ${this.totalPrompts}</span>
        </div>

        <div class="prompt-section">
          ${this.mode === 'paragraph'
            ? this._renderParagraphPrompt()
            : this._renderIndividualPrompt()
          }
        </div>

        <uvm-live-waveform
          .analyser=${this._analyser}
          .recording=${this.state === 'recording'}
          .recordedBuffer=${this._recordedAudioBuffer}
          .previewPlaying=${this._isPreviewPlaying}
          .playheadPosition=${this._previewPlayheadPosition}
          mode=${this._waveformMode}
          @preview-play=${this._onWaveformPreviewPlay}
          @preview-stop=${this._onWaveformPreviewStop}
        ></uvm-live-waveform>

        <uvm-level-meter
          .analyser=${this._analyser}
          ?active=${this.state === 'recording' || this.state === 'listening'}
        ></uvm-level-meter>

        ${this._renderControls()}

        ${this.prompt?.notes && html`
          <div class="notes-section">
            <sl-icon name="info-circle"></sl-icon>
            ${this.prompt.notes}
          </div>
        `}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-recording-prompter': UvmRecordingPrompter;
  }
}
