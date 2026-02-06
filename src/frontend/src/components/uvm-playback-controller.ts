/**
 * uvm-playback-controller.ts
 *
 * Manages all audio playback concerns for the waveform editor:
 * - Transport controls (play/stop from offset to cutoff)
 * - Click-to-seek playback (play from arbitrary position to cutoff)
 * - Marker preview (short snippet around a marker after drag)
 * - Melody preview (play a melody pattern using the current oto entry)
 * - Playhead animation (separate animation frame lifecycle)
 *
 * This component is headless (renders transport UI only) and communicates
 * playback state to the parent via properties and events.
 *
 * @fires playback-state - Emits { playing, position } on every state change
 * @fires playback-ended - Emits when any playback finishes naturally
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';

import { MelodyPlayer, MELODY_PATTERNS, getMelodyPattern } from '../services/index.js';
import { getSharedAudioContext } from '../services/audio-context.js';
import type { OtoEntry } from '../services/index.js';

@customElement('uvm-playback-controller')
export class UvmPlaybackController extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }

    .playback-controls {
      display: flex;
      align-items: center;
      gap: 0.375rem;
    }

    .playback-controls sl-icon-button {
      font-size: 1.125rem;
    }

    .playback-controls sl-icon-button::part(base) {
      color: var(--sl-color-neutral-500, #64748b);
      padding: 0.25rem;
    }

    .playback-controls sl-icon-button::part(base):hover {
      color: var(--sl-color-primary-500, #3b82f6);
    }

    :host([theme='dark']) .playback-controls sl-icon-button::part(base) {
      color: var(--sl-color-neutral-300, #cbd5e1);
    }

    :host([theme='dark']) .playback-controls sl-icon-button::part(base):hover {
      color: var(--sl-color-primary-400, #818cf8);
    }

    .playback-time {
      font-family: monospace;
      font-size: 0.75rem;
      color: var(--sl-color-neutral-500, #64748b);
      min-width: 4.5rem;
    }

    :host([theme='dark']) .playback-time {
      color: var(--sl-color-neutral-400, #94a3b8);
    }

    .preview-controls {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .preview-controls sl-select {
      min-width: 120px;
    }

    .preview-controls sl-select::part(combobox) {
      font-size: 0.75rem;
      min-height: 1.75rem;
    }

    .preview-btn {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.25rem 0.5rem;
      border: 1px solid var(--sl-color-neutral-200, #e2e8f0);
      background-color: var(--sl-color-neutral-50, #f8fafc);
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.75rem;
      line-height: 1;
      color: var(--sl-color-neutral-600, #475569);
      transition: all 0.15s ease;
    }

    .preview-btn:hover {
      background-color: var(--sl-color-neutral-100, #f1f5f9);
      color: var(--sl-color-neutral-700, #334155);
      border-color: var(--sl-color-neutral-300, #cbd5e1);
    }

    .preview-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .preview-btn.playing {
      background-color: var(--sl-color-primary-50, #eff6ff);
      border-color: var(--sl-color-primary-300, #93c5fd);
      color: var(--sl-color-primary-600, #2563eb);
    }

    .preview-btn.playing:hover {
      background-color: var(--sl-color-primary-100, #dbeafe);
    }

    :host([theme='dark']) .preview-btn {
      background-color: var(--sl-color-neutral-700, #334155);
      border-color: var(--sl-color-neutral-600, #475569);
      color: var(--sl-color-neutral-200, #e2e8f0);
    }

    :host([theme='dark']) .preview-btn:hover {
      background-color: var(--sl-color-neutral-600, #475569);
      color: white;
    }

    :host([theme='dark']) .preview-btn.playing {
      background-color: var(--sl-color-primary-900, #1e3a8a);
      border-color: var(--sl-color-primary-700, #1d4ed8);
      color: var(--sl-color-primary-200, #bfdbfe);
    }

    .preview-btn sl-icon {
      font-size: 0.875rem;
    }
  `;

  // ==================== Public Properties ====================

  /** The audio buffer for playback. */
  @property({ attribute: false })
  audioBuffer: AudioBuffer | null = null;

  /** Offset marker position in ms (playback start). */
  @property({ type: Number })
  offset = 0;

  /** Consonant marker position in ms. */
  @property({ type: Number })
  consonant = 0;

  /** Cutoff position in ms (negative = from end). */
  @property({ type: Number })
  cutoff = 0;

  /** Preutterance position in ms. */
  @property({ type: Number })
  preutterance = 0;

  /** Overlap position in ms. */
  @property({ type: Number })
  overlap = 0;

  /** Theme for dark mode styling. */
  @property({ type: String, reflect: true })
  theme: 'light' | 'dark' = 'light';

  // ==================== Public Read-Only State ====================

  /** Whether transport playback is active. */
  get isPlaying(): boolean {
    return this._isPlaying;
  }

  /** Whether melody preview is active. */
  get isPreviewPlaying(): boolean {
    return this._isPreviewPlaying;
  }

  /** Current playback position in ms from start of audio. */
  get playbackPosition(): number {
    return this._playbackPosition;
  }

  // ==================== Private State ====================

  @state()
  private _isPlaying = false;

  @state()
  private _playbackPosition = 0;

  @state()
  private _isPreviewPlaying = false;

  @state()
  private _selectedPatternId = 'scale';

  private _audioContext: AudioContext | null = null;
  private _sourceNode: AudioBufferSourceNode | null = null;
  private _previewSourceNode: AudioBufferSourceNode | null = null;
  private _melodyPlayer: MelodyPlayer | null = null;
  private _playbackStartTime = 0;
  private _playbackStartPosition = 0;

  /**
   * Dedicated animation frame ID for the playhead.
   * Separate from any other animation frames to prevent conflicts.
   */
  private _playheadFrameId: number | null = null;

  // ==================== Lifecycle ====================

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopAll();
    this._cleanupAudioContext();
  }

  // ==================== Public Methods ====================

  /** Toggle transport playback on/off. */
  togglePlayback(): void {
    if (this._isPlaying) {
      this.stopPlayback();
    } else {
      this._startPlayback();
    }
  }

  /** Stop transport playback. */
  stopPlayback(): void {
    this._stopSourceNode();
    this._stopPlayheadAnimation();
    this._isPlaying = false;
    this._playbackPosition = this.offset;
    this._emitPlaybackState();
  }

  /** Play from a specific position (ms) to the cutoff point. */
  async playFromPosition(positionMs: number): Promise<void> {
    if (!this.audioBuffer) return;

    this.stopPlayback();
    this.stopMarkerPreview();

    if (!this._audioContext) {
      this._audioContext = getSharedAudioContext();
    }

    if (this._audioContext.state === 'suspended') {
      await this._audioContext.resume();
    }

    const startTime = positionMs / 1000;
    const endTime = this._getPlaybackEndTime();
    const duration = Math.max(0, endTime - startTime);

    if (duration <= 0) return;

    this._sourceNode = this._audioContext.createBufferSource();
    this._sourceNode.buffer = this.audioBuffer;
    this._sourceNode.connect(this._audioContext.destination);

    this._playbackStartTime = this._audioContext.currentTime;
    this._playbackStartPosition = startTime;
    this._playbackPosition = positionMs;

    this._sourceNode.start(0, startTime, duration);
    this._isPlaying = true;

    this._sourceNode.onended = () => {
      this._onPlaybackEnded();
    };

    this._startPlayheadAnimation();
    this._emitPlaybackState();
  }

  /** Play a short audio preview around a marker position. */
  async playMarkerPreview(markerName: string, markerValue: number): Promise<void> {
    if (!this.audioBuffer) return;

    this.stopMarkerPreview();

    if (!this._audioContext) {
      this._audioContext = getSharedAudioContext();
    }

    if (this._audioContext.state === 'suspended') {
      await this._audioContext.resume();
    }

    const duration = this.audioBuffer.duration * 1000;
    const previewDuration = 500;
    const halfPreview = previewDuration / 2;

    let startMs: number;
    let endMs: number;

    switch (markerName) {
      case 'offset':
      case 'preutterance':
        startMs = Math.max(0, markerValue);
        endMs = Math.min(duration, startMs + previewDuration);
        break;

      case 'consonant':
        startMs = Math.max(0, this.offset);
        endMs = Math.min(duration, Math.max(markerValue, this.offset + previewDuration));
        break;

      case 'cutoff': {
        const cutoffPosition = duration + markerValue;
        endMs = Math.max(0, Math.min(duration, cutoffPosition));
        startMs = Math.max(0, endMs - previewDuration);
        break;
      }

      case 'overlap':
        startMs = Math.max(0, markerValue - halfPreview);
        endMs = Math.min(duration, markerValue + halfPreview);
        break;

      default:
        return;
    }

    const playDuration = (endMs - startMs) / 1000;
    if (playDuration <= 0) return;

    this._previewSourceNode = this._audioContext.createBufferSource();
    this._previewSourceNode.buffer = this.audioBuffer;
    this._previewSourceNode.connect(this._audioContext.destination);

    this._previewSourceNode.start(0, startMs / 1000, playDuration);

    this._previewSourceNode.onended = () => {
      this._previewSourceNode = null;
    };
  }

  /** Stop any active marker preview playback. */
  stopMarkerPreview(): void {
    if (this._previewSourceNode) {
      try {
        this._previewSourceNode.stop();
      } catch {
        // Ignore errors if already stopped
      }
      this._previewSourceNode.disconnect();
      this._previewSourceNode = null;
    }
  }

  /** Toggle melody preview on/off. */
  togglePreview(): void {
    if (this._isPreviewPlaying) {
      this.stopPreview();
    } else {
      this._startPreview();
    }
  }

  /** Stop melody preview. */
  stopPreview(): void {
    this._melodyPlayer?.stop();
    this._isPreviewPlaying = false;
  }

  /** Stop all playback (transport, marker preview, melody preview). */
  stopAll(): void {
    this.stopPlayback();
    this.stopPreview();
    this.stopMarkerPreview();
  }

  // ==================== Private: Transport Playback ====================

  private async _startPlayback(): Promise<void> {
    if (!this.audioBuffer) return;

    if (!this._audioContext) {
      this._audioContext = getSharedAudioContext();
    }

    if (this._audioContext.state === 'suspended') {
      await this._audioContext.resume();
    }

    const startTime = this.offset / 1000;
    const endTime = this._getPlaybackEndTime();
    const duration = Math.max(0, endTime - startTime);

    if (duration <= 0) {
      console.warn('Invalid playback region: offset >= cutoff');
      return;
    }

    this._stopSourceNode();

    this._sourceNode = this._audioContext.createBufferSource();
    this._sourceNode.buffer = this.audioBuffer;
    this._sourceNode.connect(this._audioContext.destination);

    this._playbackStartTime = this._audioContext.currentTime;
    this._playbackStartPosition = startTime;
    this._playbackPosition = this.offset;

    this._sourceNode.start(0, startTime, duration);
    this._isPlaying = true;

    this._sourceNode.onended = () => {
      this._onPlaybackEnded();
    };

    this._startPlayheadAnimation();
    this._emitPlaybackState();
  }

  private _getPlaybackEndTime(): number {
    if (!this.audioBuffer) return 0;

    if (this.cutoff < 0) {
      return this.audioBuffer.duration + this.cutoff / 1000;
    } else if (this.cutoff > 0) {
      return this.cutoff / 1000;
    } else {
      return this.audioBuffer.duration;
    }
  }

  private _stopSourceNode(): void {
    if (this._sourceNode) {
      try {
        this._sourceNode.stop();
      } catch {
        // Ignore errors if already stopped
      }
      this._sourceNode.disconnect();
      this._sourceNode = null;
    }
  }

  private _onPlaybackEnded(): void {
    this._stopPlayheadAnimation();
    this._isPlaying = false;
    this._sourceNode = null;
    this._playbackPosition = this.offset;
    this._emitPlaybackState();

    this.dispatchEvent(
      new CustomEvent('playback-ended', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private _cleanupAudioContext(): void {
    this._stopSourceNode();
    this.stopMarkerPreview();
    this._melodyPlayer?.dispose();
    this._melodyPlayer = null;
    this._audioContext = null;
  }

  // ==================== Private: Playhead Animation ====================

  private _startPlayheadAnimation(): void {
    const animate = (): void => {
      if (!this._isPlaying || !this._audioContext) {
        return;
      }

      const elapsed = this._audioContext.currentTime - this._playbackStartTime;
      const currentPositionSec = this._playbackStartPosition + elapsed;
      this._playbackPosition = currentPositionSec * 1000;

      const endTime = this._getPlaybackEndTime();
      if (currentPositionSec >= endTime) {
        this._playbackPosition = endTime * 1000;
        return;
      }

      this._playheadFrameId = requestAnimationFrame(animate);
      this._emitPlaybackState();
    };

    this._playheadFrameId = requestAnimationFrame(animate);
  }

  private _stopPlayheadAnimation(): void {
    if (this._playheadFrameId !== null) {
      cancelAnimationFrame(this._playheadFrameId);
      this._playheadFrameId = null;
    }
  }

  // ==================== Private: Melody Preview ====================

  private _startPreview(): void {
    if (!this.audioBuffer) return;

    if (this._isPlaying) {
      this.stopPlayback();
    }

    if (!this._audioContext) {
      this._audioContext = getSharedAudioContext();
    }

    if (!this._melodyPlayer) {
      this._melodyPlayer = new MelodyPlayer(this._audioContext);
    }

    const pattern = getMelodyPattern(this._selectedPatternId);
    if (!pattern) return;

    const otoEntry = this._buildCurrentOtoEntry();

    this._melodyPlayer.playSequence(pattern.notes, {
      otoEntry,
      audioBuffer: this.audioBuffer,
    });
    this._isPreviewPlaying = true;

    const totalDuration = pattern.notes.reduce((max, note) => {
      return Math.max(max, note.startTime + note.duration);
    }, 0);

    const checkInterval = setInterval(() => {
      if (!this._melodyPlayer?.isPlaying) {
        this._isPreviewPlaying = false;
        clearInterval(checkInterval);
      }
    }, 100);

    setTimeout(() => {
      clearInterval(checkInterval);
      if (this._isPreviewPlaying && !this._melodyPlayer?.isPlaying) {
        this._isPreviewPlaying = false;
      }
    }, (totalDuration + 0.5) * 1000);
  }

  private _onPatternChange(e: Event): void {
    const select = e.target as HTMLSelectElement;
    this._selectedPatternId = select.value;
  }

  private _buildCurrentOtoEntry(): OtoEntry {
    return {
      filename: 'sample.wav',
      alias: 'sample',
      offset: this.offset,
      consonant: this.consonant,
      cutoff: this.cutoff,
      preutterance: this.preutterance,
      overlap: this.overlap,
    };
  }

  // ==================== Private: Event Emitters ====================

  private _emitPlaybackState(): void {
    this.dispatchEvent(
      new CustomEvent('playback-state', {
        detail: {
          playing: this._isPlaying,
          position: this._playbackPosition,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  // ==================== Private: Formatting ====================

  private _formatTime(ms: number): string {
    const absMs = Math.abs(ms);
    const seconds = Math.floor(absMs / 1000);
    const milliseconds = Math.round(absMs % 1000);
    const sign = ms < 0 ? '-' : '';
    return `${sign}${seconds}.${milliseconds.toString().padStart(3, '0')}s`;
  }

  // ==================== Render ====================

  render() {
    return html`
      <div class="playback-controls">
        <sl-icon-button
          name=${this._isPlaying ? 'stop-fill' : 'play-fill'}
          label=${this._isPlaying ? 'Stop' : 'Play'}
          @click=${() => this.togglePlayback()}
          ?disabled=${!this.audioBuffer}
        ></sl-icon-button>
        <span class="playback-time">${this._formatTime(this._playbackPosition)}</span>
      </div>
      <div class="preview-controls">
        <sl-select
          size="small"
          value=${this._selectedPatternId}
          @sl-change=${this._onPatternChange}
          ?disabled=${!this.audioBuffer}
        >
          ${MELODY_PATTERNS.map(
            (p) => html`<sl-option value=${p.id}>${p.name}</sl-option>`
          )}
        </sl-select>
        <button
          class="preview-btn ${this._isPreviewPlaying ? 'playing' : ''}"
          @click=${() => this.togglePreview()}
          ?disabled=${!this.audioBuffer}
          title="Preview with melody pattern (P)"
        >
          <sl-icon name=${this._isPreviewPlaying ? 'stop-fill' : 'music-note-beamed'}></sl-icon>
          ${this._isPreviewPlaying ? 'Stop' : 'Preview'}
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'uvm-playback-controller': UvmPlaybackController;
  }
}
