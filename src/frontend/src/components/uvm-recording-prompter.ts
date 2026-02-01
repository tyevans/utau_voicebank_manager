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

    .prompter-container {
      display: flex;
      flex-direction: column;
      background-color: var(--sl-color-neutral-50, #f8fafc);
      border: 1px solid var(--sl-color-neutral-200, #e2e8f0);
      border-radius: var(--sl-border-radius-large, 0.5rem);
      overflow: hidden;
    }

    /* Progress Section */
    .progress-section {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      background-color: var(--sl-color-neutral-100, #f1f5f9);
      border-bottom: 1px solid var(--sl-color-neutral-200, #e2e8f0);
    }

    .progress-dots {
      display: flex;
      gap: 0.375rem;
      flex-wrap: wrap;
      max-width: 70%;
    }

    .progress-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background-color: var(--sl-color-neutral-300, #cbd5e1);
      transition: background-color 0.2s ease;
    }

    .progress-dot.completed {
      background-color: var(--sl-color-success-500, #22c55e);
    }

    .progress-dot.current {
      background-color: var(--sl-color-primary-500, #3b82f6);
      animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.2); opacity: 0.8; }
    }

    .progress-label {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--sl-color-neutral-600, #475569);
    }

    /* Prompt Display Section */
    .prompt-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2.5rem 1.5rem;
      min-height: 180px;
      position: relative;
    }

    .prompt-text-container {
      text-align: center;
      position: relative;
    }

    .prompt-japanese {
      font-size: 3rem;
      font-weight: 500;
      color: var(--sl-color-neutral-900, #0f172a);
      letter-spacing: 0.25em;
      margin-bottom: 0.5rem;
      display: flex;
      justify-content: center;
      gap: 0.25em;
    }

    .prompt-char {
      position: relative;
      display: inline-block;
      transition: color 0.15s ease;
    }

    .prompt-char.highlighted {
      color: var(--sl-color-primary-600, #2563eb);
    }

    .prompt-char.highlighted::after {
      content: '';
      position: absolute;
      bottom: -4px;
      left: 0;
      right: 0;
      height: 3px;
      background-color: var(--sl-color-primary-500, #3b82f6);
      border-radius: 2px;
      animation: underlineGrow 0.2s ease-out;
    }

    @keyframes underlineGrow {
      from { transform: scaleX(0); }
      to { transform: scaleX(1); }
    }

    .prompt-char.spoken {
      color: var(--sl-color-success-600, #16a34a);
    }

    .prompt-romaji {
      font-size: 1.25rem;
      color: var(--sl-color-neutral-500, #64748b);
      letter-spacing: 0.15em;
      display: flex;
      justify-content: center;
      gap: 0.5em;
    }

    .romaji-word {
      transition: color 0.15s ease, font-weight 0.15s ease;
    }

    .romaji-word.highlighted {
      color: var(--sl-color-primary-600, #2563eb);
      font-weight: 600;
    }

    .romaji-word.spoken {
      color: var(--sl-color-success-600, #16a34a);
    }

    .empty-prompt {
      display: flex;
      flex-direction: column;
      align-items: center;
      color: var(--sl-color-neutral-400, #94a3b8);
    }

    .empty-prompt sl-icon {
      font-size: 3rem;
      margin-bottom: 1rem;
    }

    /* Recording State Indicator */
    .state-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.5rem;
      font-size: 0.875rem;
      font-weight: 500;
    }

    .state-indicator.idle {
      color: var(--sl-color-neutral-500, #64748b);
    }

    .state-indicator.listening {
      color: var(--sl-color-warning-600, #ca8a04);
    }

    .state-indicator.recording {
      color: var(--sl-color-danger-600, #dc2626);
    }

    .state-indicator.processing {
      color: var(--sl-color-primary-600, #2563eb);
    }

    .recording-indicator {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background-color: var(--sl-color-danger-500, #ef4444);
      animation: recordingPulse 1s ease-in-out infinite;
    }

    @keyframes recordingPulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.1); }
    }

    .listening-indicator {
      display: flex;
      gap: 2px;
      align-items: flex-end;
      height: 16px;
    }

    .listening-bar {
      width: 3px;
      background-color: var(--sl-color-warning-500, #eab308);
      border-radius: 1px;
      animation: listeningBounce 0.6s ease-in-out infinite;
    }

    .listening-bar:nth-child(1) { height: 6px; animation-delay: 0s; }
    .listening-bar:nth-child(2) { height: 10px; animation-delay: 0.1s; }
    .listening-bar:nth-child(3) { height: 14px; animation-delay: 0.2s; }
    .listening-bar:nth-child(4) { height: 10px; animation-delay: 0.3s; }
    .listening-bar:nth-child(5) { height: 6px; animation-delay: 0.4s; }

    @keyframes listeningBounce {
      0%, 100% { transform: scaleY(1); }
      50% { transform: scaleY(0.5); }
    }

    /* Waveform Preview Section */
    .waveform-section {
      padding: 1rem;
      background-color: var(--sl-color-neutral-100, #f1f5f9);
      border-top: 1px solid var(--sl-color-neutral-200, #e2e8f0);
      border-bottom: 1px solid var(--sl-color-neutral-200, #e2e8f0);
    }

    .waveform-container {
      position: relative;
      height: 80px;
      background-color: var(--sl-color-neutral-900, #0f172a);
      border-radius: var(--sl-border-radius-medium, 0.375rem);
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
      color: var(--sl-color-neutral-500, #64748b);
      font-size: 0.875rem;
    }

    .waveform-recording {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 0.5rem;
      color: var(--sl-color-danger-400, #f87171);
    }

    /* Controls Section */
    .controls-section {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem 1.5rem;
    }

    .control-buttons {
      display: flex;
      justify-content: center;
      gap: 1rem;
    }

    .record-btn {
      --sl-button-font-size-large: 1rem;
    }

    .record-btn.recording::part(base) {
      background-color: var(--sl-color-danger-600);
      border-color: var(--sl-color-danger-600);
    }

    .record-btn.recording::part(base):hover {
      background-color: var(--sl-color-danger-700);
      border-color: var(--sl-color-danger-700);
    }

    .metadata-row {
      display: flex;
      justify-content: center;
      gap: 1rem;
      font-size: 0.75rem;
      color: var(--sl-color-neutral-500, #64748b);
    }

    .metadata-item {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    /* Error/Warning Alerts */
    .alert-container {
      padding: 0 1rem 1rem;
    }

    .alert-container sl-alert {
      margin: 0;
    }

    /* Speech API not supported fallback */
    .fallback-message {
      padding: 0.75rem 1rem;
      background-color: var(--sl-color-warning-100, #fef9c3);
      color: var(--sl-color-warning-800, #854d0e);
      font-size: 0.875rem;
      text-align: center;
      border-bottom: 1px solid var(--sl-color-warning-200, #fef08a);
    }

    /* Notes section */
    .notes-section {
      padding: 0.75rem 1rem;
      background-color: var(--sl-color-neutral-100, #f1f5f9);
      font-size: 0.875rem;
      color: var(--sl-color-neutral-600, #475569);
      font-style: italic;
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

  @query('.waveform-canvas')
  private _canvas!: HTMLCanvasElement;

  @state()
  private _currentWordIndex = -1;

  @state()
  private _spokenWords: Set<number> = new Set();

  @state()
  private _speechSupported = true;

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

  private _speechRecognition: SpeechRecognitionInstance | null = null;
  private _mediaRecorder: MediaRecorder | null = null;
  private _mediaStream: MediaStream | null = null;
  private _audioContext: AudioContext | null = null;
  private _analyser: AnalyserNode | null = null;
  private _animationFrameId: number | null = null;
  private _recordingStartTime = 0;
  private _durationIntervalId: number | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this._checkSpeechSupport();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._cleanup();
  }

  /**
   * Check if Web Speech API is supported.
   */
  private _checkSpeechSupport(): void {
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
    if (!this.prompt) return;

    const romajiWords = this.prompt.romaji.toLowerCase().split(/\s+/);

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript.toLowerCase().trim();

      // Try to match spoken words with romaji
      this._matchSpokenWords(transcript, romajiWords);
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
  private _processRecording(): void {
    if (this._audioChunks.length === 0) {
      this._errorMessage = 'No audio recorded. Please try again.';
      this._updateState('idle');
      return;
    }

    const audioBlob = new Blob(this._audioChunks, {
      type: this._getSupportedMimeType()
    });

    // Emit recording complete event
    this.dispatchEvent(new CustomEvent('recording-complete', {
      detail: {
        audioBlob,
        duration: this._recordingDuration,
        promptId: this.prompt?.id,
      },
      bubbles: true,
      composed: true,
    }));

    this._updateState('idle');
    UvmToastManager.success('Recording saved');
  }

  /**
   * Cancel the current recording.
   */
  private _cancelRecording(): void {
    this._cleanup();
    this._updateState('idle');

    this.dispatchEvent(new CustomEvent('recording-cancelled', {
      detail: { promptId: this.prompt?.id },
      bubbles: true,
      composed: true,
    }));
  }

  /**
   * Request to re-record the current prompt.
   */
  private _reRecord(): void {
    this._cleanup();
    this._currentWordIndex = -1;
    this._spokenWords = new Set();
    this._audioChunks = [];
    this._liveAudioData = [];

    this.dispatchEvent(new CustomEvent('re-record-requested', {
      detail: { promptId: this.prompt?.id },
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
      this._analyser.getByteTimeDomainData(dataArray);

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
   * Draw the waveform on the canvas.
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

    // Clear canvas
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, displayWidth, displayHeight);

    if (this._liveAudioData.length === 0) return;

    // Draw waveform
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#f87171';
    ctx.beginPath();

    const sliceWidth = displayWidth / this._liveAudioData.length;
    let x = 0;

    for (let i = 0; i < this._liveAudioData.length; i++) {
      const v = this._liveAudioData[i] / 128.0;
      const y = (v * displayHeight) / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    ctx.lineTo(displayWidth, displayHeight / 2);
    ctx.stroke();
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
    return html`
      <div class="waveform-section">
        <div class="waveform-container">
          ${this.state === 'recording'
            ? html`<canvas class="waveform-canvas"></canvas>`
            : this.state === 'idle' && this._audioChunks.length === 0
              ? html`<div class="waveform-empty">Waveform will appear during recording</div>`
              : html`<div class="waveform-empty">Recording preview</div>`
          }
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
    const canRecord = this.state === 'idle' && this.prompt;

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

        ${this.prompt && html`
          <div class="metadata-row">
            <div class="metadata-item">
              <sl-icon name="tag"></sl-icon>
              Category: ${this.prompt.category}
            </div>
            <div class="metadata-item">
              <sl-icon name="speedometer2"></sl-icon>
              Difficulty: ${this.prompt.difficulty}
            </div>
            <div class="metadata-item">
              <sl-icon name="diagram-3"></sl-icon>
              Style: ${this.prompt.style.toUpperCase()}
            </div>
          </div>
        `}
      </div>
    `;
  }

  render() {
    return html`
      <div class="prompter-container">
        ${!this._speechSupported && html`
          <div class="fallback-message">
            <sl-icon name="exclamation-triangle"></sl-icon>
            Web Speech API is not supported. Word tracking will not be available, but recording will still work.
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
          ${this.prompt
            ? html`
                <div class="prompt-text-container">
                  <div class="prompt-japanese">
                    ${this._renderJapaneseText()}
                  </div>
                  <div class="prompt-romaji">
                    ${this._renderRomajiText()}
                  </div>
                </div>
                ${this._renderStateIndicator()}
              `
            : html`
                <div class="empty-prompt">
                  <sl-icon name="mic-mute"></sl-icon>
                  <p>No prompt loaded</p>
                </div>
              `
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
