import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';

// Web Speech API type definitions (not included in TypeScript by default)
interface SpeechRecognitionResultItem {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  item(index: number): SpeechRecognitionResultItem;
  [index: number]: SpeechRecognitionResultItem;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new(): SpeechRecognitionInstance;
}

// Import Shoelace components
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/badge/badge.js';
import '@shoelace-style/shoelace/dist/components/progress-bar/progress-bar.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

import { UvmToastManager } from './uvm-toast-manager.js';
import { getHintsForPrompt, getEnglishHintsForPrompt, type PronunciationHint } from '../services/pronunciation-hints.js';

/**
 * Phoneme prompt data structure from the backend.
 */
export interface PhonemePrompt {
  id: string;
  text: string;       // Japanese text: "kakikukeko"
  romaji: string;     // Romanized: "ka ki ku ke ko"
  phonemes: string[];
  style: 'cv' | 'vcv' | 'cvvc';
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
 * Recording state type.
 */
type RecordingState = 'idle' | 'listening' | 'recording' | 'processing';

/**
 * Recording prompter component for guided voicebank recording sessions.
 *
 * Displays prompts with Japanese text and romaji, provides real-time word
 * tracking using Web Speech API, and captures audio recordings.
 *
 * @fires recording-complete - Fired when user finishes recording with audio blob
 * @fires recording-cancelled - Fired when user cancels the recording
 * @fires re-record-requested - Fired when user wants to redo the current prompt
 *
 * @example
 * ```html
 * <uvm-recording-prompter
 *   .prompt=${currentPrompt}
 *   .promptIndex=${3}
 *   .totalPrompts=${12}
 *   @recording-complete=${this._onRecordingComplete}
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

    /* We've stripped away the unnecessary visual complexity.
       The interface now steps aside to let the content breathe. */
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
      display: none; /* The dots created visual noise. The number is sufficient. */
    }

    .progress-label {
      font-size: 0.8125rem;
      font-weight: 400;
      color: var(--sl-color-neutral-400, #94a3b8);
      letter-spacing: 0.05em;
    }

    /* The prompt is the hero. Everything else defers. */
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

    /* State indicator: Quiet confidence */
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

    /* Waveform: Dark canvas, focused, purposeful */
    .waveform-section {
      padding: 0 1.5rem 1.5rem;
    }

    .waveform-container {
      position: relative;
      height: 56px;
      background-color: var(--sl-color-neutral-900, #0f172a);
      border-radius: 10px;
      overflow: hidden;
    }

    .waveform-canvas {
      width: 100%;
      height: 100%;
    }

    .waveform-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--sl-color-neutral-600, #475569);
      font-size: 0.8125rem;
      font-weight: 300;
    }

    .waveform-recording {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 0.5rem;
      color: var(--sl-color-neutral-400, #94a3b8);
    }

    .waveform-preview-container {
      position: relative;
      height: 100%;
      width: 100%;
    }

    .waveform-playback-controls {
      position: absolute;
      bottom: 6px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 0.5rem;
      z-index: 10;
    }

    .waveform-playback-controls sl-button::part(base) {
      background-color: rgba(15, 23, 42, 0.85);
      border: none;
      font-size: 0.75rem;
    }

    /* Controls: One clear action per state */
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

    /* Metadata is hidden - it distracts from the single task */
    .metadata-row {
      display: none;
    }

    /* Alerts: Unobtrusive */
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

    /* Notes: Removed during recording to reduce cognitive load */
    .notes-section {
      display: none;
    }

    /* Pronunciation hints: Refined, subtle, helpful */
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
  `;

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

  @query('.waveform-canvas')
  private _canvas!: HTMLCanvasElement;

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
  private _micPermissionGranted = false;

  @state()
  private _errorMessage: string | null = null;

  @state()
  private _audioChunks: Blob[] = [];

  @state()
  private _recordingDuration = 0;

  @state()
  private _liveAudioData: number[] = [];

  @state()
  private _recordedAudioBuffer: AudioBuffer | null = null;

  @state()
  private _isPreviewPlaying = false;

  private _speechRecognition: SpeechRecognitionInstance | null = null;
  private _mediaRecorder: MediaRecorder | null = null;
  private _mediaStream: MediaStream | null = null;
  private _audioContext: AudioContext | null = null;
  private _analyser: AnalyserNode | null = null;
  private _animationFrameId: number | null = null;
  private _recordingStartTime = 0;
  private _durationIntervalId: number | null = null;
  private _previewSource: AudioBufferSourceNode | null = null;
  private _previewStartTime = 0;
  private _previewAnimationId: number | null = null;
  private _previewPlayheadPosition = 0;
  private _previewAudioContext: AudioContext | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this._checkSpeechSupport();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._cleanup();
  }

  updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties);

    // Redraw recorded waveform when the canvas becomes visible after state change
    if (changedProperties.has('state') || changedProperties.has('_recordedAudioBuffer')) {
      if (this.state === 'idle' && this._recordedAudioBuffer && this._canvas) {
        // Use requestAnimationFrame to ensure canvas is ready
        requestAnimationFrame(() => {
          this._drawRecordedWaveform();
        });
      }
    }
  }

  /**
   * Check if Web Speech API is supported and detect Firefox.
   */
  private _checkSpeechSupport(): void {
    // Detect Firefox browser
    this._isFirefox = navigator.userAgent.toLowerCase().includes('firefox');

    const SpeechRecognitionClass =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition;

    this._speechSupported = !!SpeechRecognitionClass;

    if (!this._speechSupported) {
      console.warn('Web Speech API is not supported in this browser');
    }
  }

  /**
   * Initialize speech recognition.
   */
  private _initSpeechRecognition(): void {
    if (!this._speechSupported) return;

    const SpeechRecognitionClass =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition;

    if (!SpeechRecognitionClass) return;

    this._speechRecognition = new SpeechRecognitionClass();
    this._speechRecognition.continuous = true;
    this._speechRecognition.interimResults = true;
    this._speechRecognition.lang = 'ja-JP'; // Japanese language
    this._speechRecognition.maxAlternatives = 3;

    this._speechRecognition.onresult = (event) => {
      this._handleSpeechResult(event);
    };

    this._speechRecognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'no-speech') {
        // This is not critical, just no speech detected
        return;
      }
      if (event.error !== 'aborted') {
        UvmToastManager.warning(`Speech recognition error: ${event.error}`);
      }
    };

    this._speechRecognition.onend = () => {
      // Restart if still in listening/recording state
      if (this.state === 'listening' || this.state === 'recording') {
        try {
          this._speechRecognition?.start();
        } catch {
          // Ignore errors when restarting
        }
      }
    };
  }

  /**
   * Handle speech recognition results.
   */
  private _handleSpeechResult(event: SpeechRecognitionEvent): void {
    // Event type comes from our interface definition
    if (this.mode === 'paragraph') {
      if (!this.paragraphPrompt) return;

      const romajiWords = this.paragraphPrompt.words.map(w => w.romaji.toLowerCase());

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript.toLowerCase().trim();

        this._matchSpokenWords(transcript, romajiWords);
      }
    } else {
      if (!this.prompt) return;

      const romajiWords = this.prompt.romaji.toLowerCase().split(/\s+/);

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript.toLowerCase().trim();

        // Try to match spoken words with romaji
        this._matchSpokenWords(transcript, romajiWords);
      }
    }
  }

  /**
   * Match spoken transcript against romaji words.
   */
  private _matchSpokenWords(transcript: string, romajiWords: string[]): void {
    // Simple matching: check if any romaji word is contained in the transcript
    for (let i = 0; i < romajiWords.length; i++) {
      const word = romajiWords[i];
      if (transcript.includes(word) && !this._spokenWords.has(i)) {
        this._spokenWords = new Set([...this._spokenWords, i]);

        // Update paragraph spoken word count
        if (this.mode === 'paragraph') {
          this._paragraphSpokenWordCount = this._spokenWords.size;
        }

        // Update current word index to the next unspoken word
        const nextUnspoken = romajiWords.findIndex(
          (_, idx) => idx > i && !this._spokenWords.has(idx)
        );
        this._currentWordIndex = nextUnspoken >= 0 ? nextUnspoken : romajiWords.length;
      }
    }

    // Also try partial matching for the current word being spoken
    const currentWord = romajiWords[this._currentWordIndex] || romajiWords[0];
    if (currentWord && transcript.includes(currentWord.substring(0, 2))) {
      if (this._currentWordIndex < 0) {
        this._currentWordIndex = 0;
      }
    }
  }

  /**
   * Request microphone permission and initialize recording.
   */
  private async _requestMicPermission(): Promise<boolean> {
    try {
      this._mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 44100,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
      this._micPermissionGranted = true;
      this._setupAudioAnalyser();
      return true;
    } catch (error) {
      console.error('Microphone permission denied:', error);
      this._errorMessage = 'Microphone access denied. Please allow microphone access to record.';
      UvmToastManager.error('Microphone permission denied');
      return false;
    }
  }

  /**
   * Set up audio analyser for waveform visualization.
   */
  private _setupAudioAnalyser(): void {
    if (!this._mediaStream) return;

    this._audioContext = new AudioContext();
    const source = this._audioContext.createMediaStreamSource(this._mediaStream);
    this._analyser = this._audioContext.createAnalyser();
    this._analyser.fftSize = 256;
    source.connect(this._analyser);
  }

  /**
   * Start recording session.
   */
  private async _startRecording(): Promise<void> {
    this._errorMessage = null;

    // Request mic permission if not already granted
    if (!this._micPermissionGranted) {
      const granted = await this._requestMicPermission();
      if (!granted) return;
    }

    // Initialize speech recognition
    this._initSpeechRecognition();

    // Reset state
    this._currentWordIndex = 0;
    this._spokenWords = new Set();
    this._paragraphSpokenWordCount = 0;
    this._audioChunks = [];
    this._recordingDuration = 0;
    this._liveAudioData = [];

    // Update state to listening first
    this._updateState('listening');

    // Start speech recognition
    try {
      this._speechRecognition?.start();
    } catch (error) {
      console.error('Failed to start speech recognition:', error);
    }

    // Short delay before starting actual recording
    await new Promise(resolve => setTimeout(resolve, 500));

    // Start media recorder
    if (this._mediaStream) {
      this._mediaRecorder = new MediaRecorder(this._mediaStream, {
        mimeType: this._getSupportedMimeType(),
      });

      this._mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this._audioChunks.push(event.data);
        }
      };

      this._mediaRecorder.onstop = () => {
        this._processRecording();
      };

      this._mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
        this._errorMessage = 'Recording failed. Please try again.';
        this._updateState('idle');
        UvmToastManager.error('Recording failed');
      };

      this._mediaRecorder.start(100); // Collect data every 100ms
      this._recordingStartTime = Date.now();
      this._updateState('recording');

      // Start duration timer
      this._durationIntervalId = window.setInterval(() => {
        this._recordingDuration = Math.floor((Date.now() - this._recordingStartTime) / 1000);
      }, 1000);

      // Start waveform animation
      this._startWaveformAnimation();
    }
  }

  /**
   * Get a supported MIME type for MediaRecorder.
   */
  private _getSupportedMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return 'audio/webm'; // Default fallback
  }

  /**
   * Stop recording.
   */
  private _stopRecording(): void {
    // Stop speech recognition
    try {
      this._speechRecognition?.stop();
    } catch {
      // Ignore
    }

    // Stop media recorder
    if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
      this._mediaRecorder.stop();
    }

    // Clear duration timer
    if (this._durationIntervalId !== null) {
      clearInterval(this._durationIntervalId);
      this._durationIntervalId = null;
    }

    // Stop waveform animation
    this._stopWaveformAnimation();

    this._updateState('processing');
  }

  /**
   * Process the completed recording.
   */
  private async _processRecording(): Promise<void> {
    if (this._audioChunks.length === 0) {
      this._errorMessage = 'No audio recorded. Please try again.';
      this._updateState('idle');
      return;
    }

    const audioBlob = new Blob(this._audioChunks, {
      type: this._getSupportedMimeType()
    });

    // Decode the audio blob to AudioBuffer for preview
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      // Create a separate audio context for preview playback
      if (!this._previewAudioContext) {
        this._previewAudioContext = new AudioContext();
      }
      this._recordedAudioBuffer = await this._previewAudioContext.decodeAudioData(arrayBuffer);

      // Draw the recorded waveform
      this._updateState('idle');
      await this.updateComplete;
      this._drawRecordedWaveform();
    } catch (error) {
      console.error('Failed to decode audio for preview:', error);
      // Still proceed even if preview fails
      this._updateState('idle');
    }

    // Emit recording complete event
    const promptId = this.mode === 'paragraph' ? this.paragraphPrompt?.id : this.prompt?.id;
    this.dispatchEvent(new CustomEvent('recording-complete', {
      detail: {
        audioBlob,
        duration: this._recordingDuration,
        promptId,
        mode: this.mode,
      },
      bubbles: true,
      composed: true,
    }));

    UvmToastManager.success('Recording saved');
  }

  /**
   * Cancel the current recording.
   */
  private _cancelRecording(): void {
    this._cleanup();
    this._updateState('idle');

    const promptId = this.mode === 'paragraph' ? this.paragraphPrompt?.id : this.prompt?.id;
    this.dispatchEvent(new CustomEvent('recording-cancelled', {
      detail: { promptId, mode: this.mode },
      bubbles: true,
      composed: true,
    }));
  }

  /**
   * Request to re-record the current prompt.
   */
  private _reRecord(): void {
    // Stop any preview playback first
    this._stopPreviewPlayback();

    this._cleanup();
    this._currentWordIndex = -1;
    this._spokenWords = new Set();
    this._paragraphSpokenWordCount = 0;
    this._audioChunks = [];
    this._liveAudioData = [];
    this._recordedAudioBuffer = null;

    const promptId = this.mode === 'paragraph' ? this.paragraphPrompt?.id : this.prompt?.id;
    this.dispatchEvent(new CustomEvent('re-record-requested', {
      detail: { promptId, mode: this.mode },
      bubbles: true,
      composed: true,
    }));

    // Auto-start new recording
    this._startRecording();
  }

  /**
   * Update the component state.
   */
  private _updateState(newState: RecordingState): void {
    this.state = newState;
  }

  /**
   * Start waveform visualization animation.
   */
  private _startWaveformAnimation(): void {
    const animate = () => {
      if (this.state !== 'recording' || !this._analyser) {
        return;
      }

      const dataArray = new Uint8Array(this._analyser.frequencyBinCount);
      // Use frequency data for histogram visualization
      this._analyser.getByteFrequencyData(dataArray);

      // Store live data for visualization
      this._liveAudioData = Array.from(dataArray);
      this._drawWaveform();

      this._animationFrameId = requestAnimationFrame(animate);
    };

    this._animationFrameId = requestAnimationFrame(animate);
  }

  /**
   * Stop waveform animation.
   */
  private _stopWaveformAnimation(): void {
    if (this._animationFrameId !== null) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }
  }

  /**
   * Draw frequency histogram (VU meter style) on the canvas.
   */
  private _drawWaveform(): void {
    if (!this._canvas) return;

    const ctx = this._canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    // Set canvas size with device pixel ratio
    const displayWidth = this._canvas.clientWidth;
    const displayHeight = this._canvas.clientHeight;
    this._canvas.width = displayWidth * dpr;
    this._canvas.height = displayHeight * dpr;
    ctx.scale(dpr, dpr);

    // Clear canvas with dark background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, displayWidth, displayHeight);

    if (this._liveAudioData.length === 0) return;

    // Number of bars to display (32-64 range)
    const numBars = 48;
    const barWidth = (displayWidth / numBars) - 2;
    const barGap = 2;
    const maxBarHeight = displayHeight - 10;

    // Sample the frequency data evenly
    const step = Math.floor(this._liveAudioData.length / numBars);

    for (let i = 0; i < numBars; i++) {
      // Get average of nearby frequency bins for smoother visualization
      let sum = 0;
      const startIdx = i * step;
      const endIdx = Math.min(startIdx + step, this._liveAudioData.length);
      for (let j = startIdx; j < endIdx; j++) {
        sum += this._liveAudioData[j];
      }
      const value = sum / (endIdx - startIdx);

      // Normalize value (0-255) to bar height
      const normalizedValue = value / 255;
      const barHeight = Math.max(4, normalizedValue * maxBarHeight);

      // Calculate bar position
      const x = i * (barWidth + barGap) + barGap;
      const y = displayHeight - barHeight;

      // Create gradient based on amplitude: green -> yellow -> red
      const gradient = ctx.createLinearGradient(x, displayHeight, x, y);
      if (normalizedValue < 0.4) {
        // Low amplitude: green
        gradient.addColorStop(0, '#22c55e');
        gradient.addColorStop(1, '#16a34a');
      } else if (normalizedValue < 0.7) {
        // Medium amplitude: green to yellow
        gradient.addColorStop(0, '#22c55e');
        gradient.addColorStop(0.5, '#eab308');
        gradient.addColorStop(1, '#facc15');
      } else {
        // High amplitude: green to yellow to red
        gradient.addColorStop(0, '#22c55e');
        gradient.addColorStop(0.4, '#eab308');
        gradient.addColorStop(0.7, '#f97316');
        gradient.addColorStop(1, '#ef4444');
      }

      // Add glow effect
      ctx.shadowColor = normalizedValue > 0.5 ? '#f87171' : '#22c55e';
      ctx.shadowBlur = normalizedValue * 15;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // Draw bar with rounded top
      ctx.fillStyle = gradient;
      ctx.beginPath();
      const radius = Math.min(barWidth / 2, 3);
      ctx.roundRect(x, y, barWidth, barHeight, [radius, radius, 0, 0]);
      ctx.fill();

      // Reset shadow for next iteration
      ctx.shadowBlur = 0;
    }

    // Add a subtle reflection effect at the bottom
    ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
    ctx.fillRect(0, displayHeight - 2, displayWidth, 2);
  }

  /**
   * Draw the recorded waveform on the canvas.
   */
  private _drawRecordedWaveform(): void {
    if (!this._canvas || !this._recordedAudioBuffer) return;

    const ctx = this._canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    // Set canvas size with device pixel ratio
    const displayWidth = this._canvas.clientWidth;
    const displayHeight = this._canvas.clientHeight;
    this._canvas.width = displayWidth * dpr;
    this._canvas.height = displayHeight * dpr;
    ctx.scale(dpr, dpr);

    // Clear canvas with dark background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, displayWidth, displayHeight);

    // Get audio data from buffer
    const channelData = this._recordedAudioBuffer.getChannelData(0);
    const samplesPerPixel = Math.floor(channelData.length / displayWidth);
    const centerY = displayHeight / 2;

    // Create gradient for waveform fill
    const gradient = ctx.createLinearGradient(0, 0, 0, displayHeight);
    gradient.addColorStop(0, 'rgba(248, 113, 113, 0.6)');
    gradient.addColorStop(0.5, 'rgba(248, 113, 113, 0.3)');
    gradient.addColorStop(1, 'rgba(248, 113, 113, 0.6)');

    // Draw filled waveform
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, centerY);

    // Draw top half of waveform
    for (let x = 0; x < displayWidth; x++) {
      const startSample = x * samplesPerPixel;
      const endSample = Math.min(startSample + samplesPerPixel, channelData.length);

      let max = 0;
      for (let i = startSample; i < endSample; i++) {
        const sample = Math.abs(channelData[i]);
        if (sample > max) max = sample;
      }

      const y = centerY - (max * centerY * 0.9);
      ctx.lineTo(x, y);
    }

    // Draw bottom half of waveform (mirror)
    for (let x = displayWidth - 1; x >= 0; x--) {
      const startSample = x * samplesPerPixel;
      const endSample = Math.min(startSample + samplesPerPixel, channelData.length);

      let max = 0;
      for (let i = startSample; i < endSample; i++) {
        const sample = Math.abs(channelData[i]);
        if (sample > max) max = sample;
      }

      const y = centerY + (max * centerY * 0.9);
      ctx.lineTo(x, y);
    }

    ctx.closePath();
    ctx.fill();

    // Draw center line for the waveform
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);

    for (let x = 0; x < displayWidth; x++) {
      const startSample = x * samplesPerPixel;
      const endSample = Math.min(startSample + samplesPerPixel, channelData.length);

      let max = 0;
      let maxSign = 1;
      for (let i = startSample; i < endSample; i++) {
        const sample = channelData[i];
        if (Math.abs(sample) > max) {
          max = Math.abs(sample);
          maxSign = sample >= 0 ? 1 : -1;
        }
      }

      const y = centerY - (max * maxSign * centerY * 0.9);
      ctx.lineTo(x, y);
    }

    ctx.stroke();

    // Draw playhead if playing
    if (this._isPreviewPlaying && this._recordedAudioBuffer) {
      const playheadX = this._previewPlayheadPosition * displayWidth;

      // Draw playhead line with glow
      ctx.shadowColor = '#f87171';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, displayHeight);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Draw playhead handle
      ctx.fillStyle = '#f87171';
      ctx.beginPath();
      ctx.arc(playheadX, 8, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw a subtle border
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, displayWidth, displayHeight);
  }

  /**
   * Start preview playback of the recorded audio.
   */
  private _startPreviewPlayback(): void {
    if (!this._recordedAudioBuffer || !this._previewAudioContext) return;

    // Stop any existing playback
    this._stopPreviewPlayback();

    // Resume audio context if suspended
    if (this._previewAudioContext.state === 'suspended') {
      this._previewAudioContext.resume();
    }

    // Create a new source node
    this._previewSource = this._previewAudioContext.createBufferSource();
    this._previewSource.buffer = this._recordedAudioBuffer;
    this._previewSource.connect(this._previewAudioContext.destination);

    // Set up playback tracking
    this._previewStartTime = this._previewAudioContext.currentTime;
    this._previewPlayheadPosition = 0;
    this._isPreviewPlaying = true;

    // Start playback
    this._previewSource.start(0);

    // Set up onended callback
    this._previewSource.onended = () => {
      this._isPreviewPlaying = false;
      this._previewPlayheadPosition = 0;
      this._stopPreviewAnimation();
      this._drawRecordedWaveform();
    };

    // Start playhead animation
    this._startPreviewAnimation();
  }

  /**
   * Stop preview playback.
   */
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

    // Redraw waveform without playhead
    if (this._recordedAudioBuffer) {
      this._drawRecordedWaveform();
    }
  }

  /**
   * Start the playhead animation.
   */
  private _startPreviewAnimation(): void {
    const animate = () => {
      if (!this._isPreviewPlaying || !this._recordedAudioBuffer || !this._previewAudioContext) {
        return;
      }

      const elapsed = this._previewAudioContext.currentTime - this._previewStartTime;
      const duration = this._recordedAudioBuffer.duration;
      this._previewPlayheadPosition = Math.min(elapsed / duration, 1);

      this._drawRecordedWaveform();

      if (this._previewPlayheadPosition < 1) {
        this._previewAnimationId = requestAnimationFrame(animate);
      }
    };

    this._previewAnimationId = requestAnimationFrame(animate);
  }

  /**
   * Stop the playhead animation.
   */
  private _stopPreviewAnimation(): void {
    if (this._previewAnimationId !== null) {
      cancelAnimationFrame(this._previewAnimationId);
      this._previewAnimationId = null;
    }
  }

  /**
   * Clean up resources.
   */
  private _cleanup(): void {
    // Stop speech recognition
    try {
      this._speechRecognition?.stop();
    } catch {
      // Ignore
    }
    this._speechRecognition = null;

    // Stop media recorder
    if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
      try {
        this._mediaRecorder.stop();
      } catch {
        // Ignore
      }
    }
    this._mediaRecorder = null;

    // Stop media stream tracks
    if (this._mediaStream) {
      this._mediaStream.getTracks().forEach(track => track.stop());
      this._mediaStream = null;
    }

    // Close audio context
    if (this._audioContext) {
      this._audioContext.close();
      this._audioContext = null;
    }

    // Stop preview playback and clean up preview resources
    this._stopPreviewPlayback();
    if (this._previewAudioContext) {
      this._previewAudioContext.close();
      this._previewAudioContext = null;
    }
    this._recordedAudioBuffer = null;

    // Clear timers
    if (this._durationIntervalId !== null) {
      clearInterval(this._durationIntervalId);
      this._durationIntervalId = null;
    }

    this._stopWaveformAnimation();
    this._micPermissionGranted = false;
  }

  /**
   * Format duration as MM:SS.
   */
  private _formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Get state indicator text.
   */
  private _getStateText(): string {
    switch (this.state) {
      case 'idle': return 'Ready to record';
      case 'listening': return 'Listening...';
      case 'recording': return `Recording... ${this._formatDuration(this._recordingDuration)}`;
      case 'processing': return 'Processing...';
      default: return '';
    }
  }

  /**
   * Render progress dots.
   */
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

  /**
   * Render Japanese text with highlighting.
   */
  private _renderJapaneseText() {
    if (!this.prompt) return null;

    // Split Japanese text into individual characters for highlighting
    const chars = this.prompt.text.split('');
    const romajiWords = this.prompt.romaji.split(/\s+/);

    // Map characters to romaji words (approximate)
    return chars.map((char, idx) => {
      // Approximate which word this character belongs to
      const wordIdx = Math.floor(idx * romajiWords.length / chars.length);
      const isHighlighted = wordIdx === this._currentWordIndex;
      const isSpoken = this._spokenWords.has(wordIdx);

      return html`
        <span class="prompt-char ${isHighlighted ? 'highlighted' : ''} ${isSpoken ? 'spoken' : ''}">
          ${char}
        </span>
      `;
    });
  }

  /**
   * Render romaji text with highlighting.
   */
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

  /**
   * Render paragraph prompt content.
   */
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

    // Calculate total phonemes for coverage display
    const totalPhonemes = this.paragraphPrompt.words.reduce(
      (sum, w) => sum + w.phonemes.length, 0
    );
    const spokenPhonemes = this.paragraphPrompt.words
      .filter((_, idx) => this._spokenWords.has(idx))
      .reduce((sum, w) => sum + w.phonemes.length, 0);

    return html`
      <div class="prompt-text-container">
        <div class="paragraph-sentence">
          ${this.paragraphPrompt.words.map((word, idx) => {
            const isActive = idx === this._currentWordIndex;
            const isSpoken = this._spokenWords.has(idx);

            return html`
              <div class="paragraph-word ${isActive ? 'active' : ''} ${isSpoken ? 'spoken' : ''}">
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

  /**
   * Render individual prompt content (existing behavior refactored).
   */
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
        <div class="prompt-japanese">
          ${this._renderJapaneseText()}
        </div>
        <div class="prompt-romaji">
          ${this._renderRomajiText()}
        </div>
        ${this._renderPronunciationHints()}
      </div>
      ${this._renderStateIndicator()}
    `;
  }

  /**
   * Convert markdown bold (**text**) to HTML mark tags.
   */
  private _markdownToMark(text: string): ReturnType<typeof html> {
    // Split by **...** pattern and render with mark tags
    const parts = text.split(/\*\*([^*]+)\*\*/);
    return html`${parts.map((part, i) =>
      i % 2 === 1 ? html`<mark>${part}</mark>` : part
    )}`;
  }

  /**
   * Render pronunciation hints for the current prompt.
   */
  private _renderPronunciationHints() {
    if (!this.prompt) return null;

    const hints = this.language === 'en'
      ? getEnglishHintsForPrompt(this.prompt.romaji)
      : getHintsForPrompt(this.prompt.romaji);

    // Limit to 4 hints to keep it concise
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

  /**
   * Render a single pronunciation hint item.
   */
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

  /**
   * Render state indicator.
   */
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

  /**
   * Render waveform section.
   */
  private _renderWaveformSection() {
    const hasRecordedAudio = this._recordedAudioBuffer !== null;
    const showHistogram = this.state === 'recording';
    const showRecordedWaveform = this.state === 'idle' && hasRecordedAudio;
    const showEmpty = this.state === 'idle' && !hasRecordedAudio;

    return html`
      <div class="waveform-section">
        <div class="waveform-container">
          ${showHistogram
            ? html`<canvas class="waveform-canvas"></canvas>`
            : showRecordedWaveform
              ? html`
                  <div class="waveform-preview-container">
                    <canvas class="waveform-canvas"></canvas>
                    <div class="waveform-playback-controls">
                      ${this._isPreviewPlaying
                        ? html`
                            <sl-button
                              variant="text"
                              size="small"
                              @click=${this._stopPreviewPlayback}
                            >
                              <sl-icon name="stop-fill"></sl-icon>
                              Stop
                            </sl-button>
                          `
                        : html`
                            <sl-button
                              variant="text"
                              size="small"
                              @click=${this._startPreviewPlayback}
                            >
                              <sl-icon name="play-fill"></sl-icon>
                              Preview
                            </sl-button>
                          `
                      }
                    </div>
                  </div>
                `
              : showEmpty
                ? html`<div class="waveform-empty">Waveform will appear during recording</div>`
                : html`<div class="waveform-empty">Processing...</div>`
          }
        </div>
      </div>
    `;
  }

  /**
   * Render metadata row showing prompt details.
   */
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

  /**
   * Render control buttons.
   */
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

          ${this.state === 'idle' && this._audioChunks.length > 0 && html`
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

  render() {
    return html`
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

        ${this._renderWaveformSection()}

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
