import { LitElement, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { getSharedAudioContext } from '../services/audio-context.js';

/**
 * Recording state type.
 */
export type RecordingState = 'idle' | 'listening' | 'recording' | 'processing';

/**
 * Detail emitted with the 'recording-data-available' event.
 */
export interface RecordingDataDetail {
  audioBlob: Blob;
  audioBuffer: AudioBuffer;
  duration: number;
}

/**
 * Headless recording engine component.
 *
 * Manages MediaRecorder lifecycle, microphone permissions, and audio analysis.
 * This component renders nothing visible -- it is a service element that
 * communicates state via properties and custom events.
 *
 * @fires state-changed - When the recording state changes
 * @fires recording-data-available - When a completed recording has been processed into a blob and AudioBuffer
 * @fires error - When a recording error occurs
 * @fires analyser-ready - When the AnalyserNode is connected and ready for visualization
 */
@customElement('uvm-record-engine')
export class UvmRecordEngine extends LitElement {
  /**
   * Current recording state. Read by parent to coordinate UI.
   */
  @property({ type: String, reflect: true })
  state: RecordingState = 'idle';

  /**
   * Elapsed recording duration in seconds.
   */
  @state()
  private _duration = 0;

  /**
   * Whether microphone permission has been granted this session.
   */
  private _micPermissionGranted = false;

  private _mediaRecorder: MediaRecorder | null = null;
  private _mediaStream: MediaStream | null = null;
  private _audioContext: AudioContext | null = null;
  private _analyser: AnalyserNode | null = null;
  private _audioChunks: Blob[] = [];
  private _recordingStartTime = 0;
  private _durationIntervalId: number | null = null;

  /**
   * The AnalyserNode connected to the microphone input.
   * Exposed so that sibling components (e.g. uvm-live-waveform) can read audio data.
   */
  get analyser(): AnalyserNode | null {
    return this._analyser;
  }

  /**
   * Elapsed recording duration in whole seconds.
   */
  get duration(): number {
    return this._duration;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.cleanup();
  }

  // ---- Public API (called by parent) ----

  /**
   * Begin a recording session. Requests mic permission on first call,
   * transitions through listening -> recording states, and begins capturing audio.
   */
  async startRecording(): Promise<void> {
    // Request mic permission if not already granted
    if (!this._micPermissionGranted) {
      const granted = await this._requestMicPermission();
      if (!granted) return;
    }

    // Reset state
    this._audioChunks = [];
    this._duration = 0;

    this._updateState('listening');

    // Short delay before actual recording (matches original behavior)
    await new Promise(resolve => setTimeout(resolve, 500));

    // Start MediaRecorder
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
        this._updateState('idle');
        this.dispatchEvent(new CustomEvent('error', {
          detail: { message: 'Recording failed. Please try again.' },
          bubbles: true,
          composed: true,
        }));
      };

      this._mediaRecorder.start(100); // Collect data every 100ms
      this._recordingStartTime = Date.now();
      this._updateState('recording');

      // Start duration timer
      this._durationIntervalId = window.setInterval(() => {
        this._duration = Math.floor((Date.now() - this._recordingStartTime) / 1000);
      }, 1000);
    }
  }

  /**
   * Stop the current recording. Triggers processing of captured audio.
   */
  stopRecording(): void {
    if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
      this._mediaRecorder.stop();
    }

    this._clearDurationTimer();
    this._updateState('processing');
  }

  /**
   * Cancel the current recording without producing output.
   */
  cancelRecording(): void {
    this._stopMediaRecorder();
    this._clearDurationTimer();
    this._audioChunks = [];
    this._duration = 0;
    this._updateState('idle');
  }

  /**
   * Full cleanup -- release mic stream, analyser, and all resources.
   * Called when the parent is done with this engine instance.
   */
  cleanup(): void {
    this._stopMediaRecorder();
    this._clearDurationTimer();

    // Stop media stream tracks
    if (this._mediaStream) {
      this._mediaStream.getTracks().forEach(track => track.stop());
      this._mediaStream = null;
    }

    // Release reference to shared AudioContext (do not close -- it is shared)
    this._audioContext = null;
    this._analyser = null;
    this._micPermissionGranted = false;
    this._audioChunks = [];
    this._duration = 0;
  }

  /**
   * Whether audio chunks have been captured (i.e., a recording was completed).
   */
  get hasRecordedAudio(): boolean {
    return this._audioChunks.length > 0;
  }

  /**
   * Reset captured audio chunks (e.g., when moving to next prompt).
   */
  resetAudio(): void {
    this._audioChunks = [];
    this._duration = 0;
  }

  // ---- Private helpers ----

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
      this.dispatchEvent(new CustomEvent('error', {
        detail: { message: 'Microphone access denied. Please allow microphone access to record.' },
        bubbles: true,
        composed: true,
      }));
      return false;
    }
  }

  private _setupAudioAnalyser(): void {
    if (!this._mediaStream) return;

    this._audioContext = getSharedAudioContext();
    const source = this._audioContext.createMediaStreamSource(this._mediaStream);
    this._analyser = this._audioContext.createAnalyser();
    this._analyser.fftSize = 256;
    source.connect(this._analyser);

    this.dispatchEvent(new CustomEvent('analyser-ready', {
      detail: { analyser: this._analyser },
      bubbles: true,
      composed: true,
    }));
  }

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

    return 'audio/webm';
  }

  private async _processRecording(): Promise<void> {
    if (this._audioChunks.length === 0) {
      this._updateState('idle');
      this.dispatchEvent(new CustomEvent('error', {
        detail: { message: 'No audio recorded. Please try again.' },
        bubbles: true,
        composed: true,
      }));
      return;
    }

    const audioBlob = new Blob(this._audioChunks, {
      type: this._getSupportedMimeType(),
    });

    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioContext = getSharedAudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      this._updateState('idle');

      this.dispatchEvent(new CustomEvent('recording-data-available', {
        detail: {
          audioBlob,
          audioBuffer,
          duration: this._duration,
        } satisfies RecordingDataDetail,
        bubbles: true,
        composed: true,
      }));
    } catch (error) {
      console.error('Failed to decode audio:', error);
      this._updateState('idle');

      // Still emit the blob even if AudioBuffer decode fails
      this.dispatchEvent(new CustomEvent('recording-data-available', {
        detail: {
          audioBlob,
          audioBuffer: null,
          duration: this._duration,
        },
        bubbles: true,
        composed: true,
      }));
    }
  }

  private _stopMediaRecorder(): void {
    if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
      try {
        this._mediaRecorder.stop();
      } catch {
        // Ignore errors if already stopped
      }
    }
    this._mediaRecorder = null;
  }

  private _clearDurationTimer(): void {
    if (this._durationIntervalId !== null) {
      clearInterval(this._durationIntervalId);
      this._durationIntervalId = null;
    }
  }

  private _updateState(newState: RecordingState): void {
    const oldState = this.state;
    this.state = newState;
    if (oldState !== newState) {
      this.dispatchEvent(new CustomEvent('state-changed', {
        detail: { state: newState, previousState: oldState },
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
    'uvm-record-engine': UvmRecordEngine;
  }
}
