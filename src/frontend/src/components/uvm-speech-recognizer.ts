import { LitElement, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

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

/**
 * Detail emitted with the 'words-updated' event.
 */
export interface WordsUpdatedDetail {
  currentWordIndex: number;
  spokenWords: Set<number>;
}

/**
 * Headless speech recognition component.
 *
 * Wraps the Web Speech API to track which words in a romaji prompt have been
 * spoken. Communicates progress via the 'words-updated' event.
 *
 * @fires words-updated - When spoken word tracking state changes
 * @fires speech-error - When a speech recognition error occurs
 * @fires support-checked - When speech support detection completes
 */
@customElement('uvm-speech-recognizer')
export class UvmSpeechRecognizer extends LitElement {
  /**
   * Language for recognition (BCP-47). Default is Japanese.
   */
  @property({ type: String })
  lang = 'ja-JP';

  /**
   * Whether speech recognition is active.
   */
  @property({ type: Boolean })
  active = false;

  /**
   * The romaji words to match against (space-separated string or array).
   */
  @property({ attribute: false })
  romajiWords: string[] = [];

  /**
   * Whether the Web Speech API is supported in this browser.
   */
  @state()
  private _supported = true;

  /**
   * Whether the browser is Firefox (needs special config).
   */
  @state()
  private _isFirefox = false;

  private _speechRecognition: SpeechRecognitionInstance | null = null;
  private _currentWordIndex = -1;
  private _spokenWords: Set<number> = new Set();

  /**
   * Whether the Web Speech API is supported.
   */
  get supported(): boolean {
    return this._supported;
  }

  /**
   * Whether the browser is Firefox.
   */
  get isFirefox(): boolean {
    return this._isFirefox;
  }

  /**
   * Current spoken word index.
   */
  get currentWordIndex(): number {
    return this._currentWordIndex;
  }

  /**
   * Set of indices of words that have been spoken.
   */
  get spokenWords(): Set<number> {
    return this._spokenWords;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._checkSpeechSupport();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stop();
  }

  updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties);

    if (changedProperties.has('active')) {
      if (this.active) {
        this.start();
      } else {
        this.stop();
      }
    }
  }

  // ---- Public API ----

  /**
   * Start speech recognition.
   */
  start(): void {
    if (!this._supported) return;

    this._initSpeechRecognition();
    this._currentWordIndex = 0;
    this._spokenWords = new Set();

    try {
      this._speechRecognition?.start();
    } catch (error) {
      console.error('Failed to start speech recognition:', error);
    }
  }

  /**
   * Stop speech recognition.
   */
  stop(): void {
    try {
      this._speechRecognition?.stop();
    } catch {
      // Ignore
    }
    this._speechRecognition = null;
  }

  /**
   * Reset tracking state (e.g., for re-recording).
   */
  reset(): void {
    this._currentWordIndex = -1;
    this._spokenWords = new Set();
  }

  // ---- Private helpers ----

  private _checkSpeechSupport(): void {
    this._isFirefox = navigator.userAgent.toLowerCase().includes('firefox');

    const SpeechRecognitionClass =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition;

    this._supported = !!SpeechRecognitionClass;

    if (!this._supported) {
      console.warn('Web Speech API is not supported in this browser');
    }

    this.dispatchEvent(new CustomEvent('support-checked', {
      detail: { supported: this._supported, isFirefox: this._isFirefox },
      bubbles: true,
      composed: true,
    }));
  }

  private _initSpeechRecognition(): void {
    if (!this._supported) return;

    const SpeechRecognitionClass =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition;

    if (!SpeechRecognitionClass) return;

    this._speechRecognition = new SpeechRecognitionClass();
    this._speechRecognition.continuous = true;
    this._speechRecognition.interimResults = true;
    this._speechRecognition.lang = this.lang;
    this._speechRecognition.maxAlternatives = 3;

    this._speechRecognition.onresult = (event) => {
      this._handleSpeechResult(event);
    };

    this._speechRecognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'no-speech') return;
      if (event.error !== 'aborted') {
        this.dispatchEvent(new CustomEvent('speech-error', {
          detail: { error: event.error },
          bubbles: true,
          composed: true,
        }));
      }
    };

    this._speechRecognition.onend = () => {
      // Restart if still active
      if (this.active) {
        try {
          this._speechRecognition?.start();
        } catch {
          // Ignore errors when restarting
        }
      }
    };
  }

  private _handleSpeechResult(event: SpeechRecognitionEvent): void {
    if (this.romajiWords.length === 0) return;

    const words = this.romajiWords.map(w => w.toLowerCase());

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript.toLowerCase().trim();
      this._matchSpokenWords(transcript, words);
    }
  }

  private _matchSpokenWords(transcript: string, romajiWords: string[]): void {
    let changed = false;

    for (let i = 0; i < romajiWords.length; i++) {
      const word = romajiWords[i];
      if (transcript.includes(word) && !this._spokenWords.has(i)) {
        this._spokenWords = new Set([...this._spokenWords, i]);
        changed = true;

        // Update current word index to the next unspoken word
        const nextUnspoken = romajiWords.findIndex(
          (_, idx) => idx > i && !this._spokenWords.has(idx)
        );
        this._currentWordIndex = nextUnspoken >= 0 ? nextUnspoken : romajiWords.length;
      }
    }

    // Partial matching for the current word being spoken
    const currentWord = romajiWords[this._currentWordIndex] || romajiWords[0];
    if (currentWord && transcript.includes(currentWord.substring(0, 2))) {
      if (this._currentWordIndex < 0) {
        this._currentWordIndex = 0;
        changed = true;
      }
    }

    if (changed) {
      this.dispatchEvent(new CustomEvent('words-updated', {
        detail: {
          currentWordIndex: this._currentWordIndex,
          spokenWords: new Set(this._spokenWords),
        } satisfies WordsUpdatedDetail,
        bubbles: true,
        composed: true,
      }));
    }
  }

  /**
   * This is a headless component -- no visible rendering.
   */
  protected render(): unknown {
    return html``;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-speech-recognizer': UvmSpeechRecognizer;
  }
}
