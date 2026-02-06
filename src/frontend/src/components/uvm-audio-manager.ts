import { LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { api, ApiError } from '../services/api.js';
import { getSharedAudioContext } from '../services/audio-context.js';
import { UvmToastManager } from './uvm-toast-manager.js';

/**
 * Event detail emitted when audio loading completes or fails.
 */
export interface AudioLoadedDetail {
  /** The decoded audio buffer, or null if loading failed. */
  audioBuffer: AudioBuffer | null;
  /** Error message if loading failed, null on success. */
  error: string | null;
}

/**
 * Headless component that manages audio loading and AudioContext lifecycle.
 *
 * This component has no visual output. It encapsulates:
 * - Shared AudioContext acquisition and resume handling
 * - Audio file fetching and decoding via the API
 * - Loading state tracking
 * - Error handling with toast notifications
 *
 * The parent component passes `voicebankId` and `filename` as properties.
 * When both are set, audio loading begins automatically. The loaded buffer
 * and loading/error states are exposed as read-only properties and via
 * custom events.
 *
 * @fires audio-loaded - Fired when audio loading completes (success or failure).
 *   Detail: { audioBuffer: AudioBuffer | null, error: string | null }
 *
 * @example
 * ```html
 * <uvm-audio-manager
 *   .voicebankId=${this._voicebankId}
 *   .filename=${this._filename}
 *   @audio-loaded=${this._onAudioLoaded}
 * ></uvm-audio-manager>
 * ```
 */
@customElement('uvm-audio-manager')
export class UvmAudioManager extends LitElement {
  // ==================== Public Properties ====================

  /**
   * Voicebank ID to load audio from.
   * Setting this (along with filename) triggers a load.
   */
  @property({ type: String })
  voicebankId: string | null = null;

  /**
   * WAV filename within the voicebank to load.
   * Setting this (along with voicebankId) triggers a load.
   */
  @property({ type: String })
  filename: string | null = null;

  // ==================== Read-Only State ====================

  /**
   * The decoded audio buffer for the current sample. Null when no
   * sample is loaded or loading failed.
   */
  @state()
  audioBuffer: AudioBuffer | null = null;

  /**
   * Whether audio is currently being loaded.
   */
  @state()
  loading = false;

  /**
   * Error message from the last load attempt, or null if no error.
   */
  @state()
  error: string | null = null;

  // ==================== Private State ====================

  /** Shared AudioContext instance. */
  private _audioContext: AudioContext | null = null;

  /** Track the last requested load to avoid stale responses. */
  private _loadId = 0;

  // ==================== Lifecycle ====================

  disconnectedCallback(): void {
    super.disconnectedCallback();
    // Release reference to shared AudioContext (do not close -- it is shared)
    this._audioContext = null;
  }

  /**
   * React to property changes. When voicebankId or filename change,
   * trigger a new audio load if both are present.
   */
  updated(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('voicebankId') || changedProperties.has('filename')) {
      if (this.voicebankId && this.filename) {
        this._loadAudio(this.voicebankId, this.filename);
      } else {
        // Clear state when inputs are removed
        this.audioBuffer = null;
        this.error = null;
        this.loading = false;
      }
    }
  }

  // ==================== Public Methods ====================

  /**
   * Force a reload of the current sample audio.
   * Useful after external changes to the audio file.
   */
  reload(): void {
    if (this.voicebankId && this.filename) {
      this._loadAudio(this.voicebankId, this.filename);
    }
  }

  // ==================== Private Methods ====================

  /**
   * Load audio file as AudioBuffer from the API.
   */
  private async _loadAudio(voicebankId: string, filename: string): Promise<void> {
    const loadId = ++this._loadId;

    this.loading = true;
    this.audioBuffer = null;
    this.error = null;

    try {
      // Get shared AudioContext on first use
      if (!this._audioContext) {
        this._audioContext = getSharedAudioContext();
      }

      // Request resume without blocking -- decodeAudioData works on suspended
      // contexts, and awaiting resume() blocks until a user gesture on deep links.
      if (this._audioContext.state === 'suspended') {
        this._audioContext.resume();
      }

      const buffer = await api.loadSampleAsAudioBuffer(
        voicebankId,
        filename,
        this._audioContext
      );

      // Guard against stale responses (user navigated to a different sample)
      if (loadId !== this._loadId) return;

      this.audioBuffer = buffer;
      this.error = null;
      this._emitLoaded(buffer, null);
    } catch (err) {
      // Guard against stale responses
      if (loadId !== this._loadId) return;

      console.error('Failed to load audio:', err);
      let errorMessage: string;

      if (err instanceof ApiError) {
        if (err.isNotFound()) {
          errorMessage = 'Sample not found';
          UvmToastManager.error('Sample not found');
        } else {
          errorMessage = err.message;
          UvmToastManager.error(`Failed to load audio: ${err.message}`);
        }
      } else {
        errorMessage = err instanceof Error ? err.message : 'Failed to load audio';
        UvmToastManager.error('Failed to load audio');
      }

      this.error = errorMessage;
      this._emitLoaded(null, errorMessage);
    } finally {
      if (loadId === this._loadId) {
        this.loading = false;
      }
    }
  }

  /**
   * Emit the audio-loaded event.
   */
  private _emitLoaded(audioBuffer: AudioBuffer | null, error: string | null): void {
    this.dispatchEvent(
      new CustomEvent<AudioLoadedDetail>('audio-loaded', {
        detail: { audioBuffer, error },
        bubbles: true,
        composed: true,
      })
    );
  }

  // ==================== Render ====================

  /**
   * Headless component -- no visual output.
   */
  protected createRenderRoot(): this {
    return this;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-audio-manager': UvmAudioManager;
  }
}
