import { LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { api, ApiError } from '../services/api.js';
import type { OtoEntry } from '../services/types.js';
import type { AlignmentMethod } from './uvm-alignment-settings.js';
import { UvmToastManager } from './uvm-toast-manager.js';

/**
 * Default oto parameter values for new entries.
 */
export const DEFAULT_OTO_VALUES = {
  offset: 0,
  consonant: 100,
  cutoff: -50,
  preutterance: 50,
  overlap: 20,
} as const;

/**
 * Event detail emitted when oto entries finish loading.
 */
export interface OtoEntriesLoadedDetail {
  entries: OtoEntry[];
  currentEntry: OtoEntry | null;
  isNew: boolean;
}

/**
 * Event detail emitted when the current entry changes (edit, undo, redo, detect).
 */
export interface OtoEntryChangedDetail {
  entry: OtoEntry;
  isDirty: boolean;
}

/**
 * Event detail emitted after a successful save.
 */
export interface OtoEntrySavedDetail {
  entry: OtoEntry;
  wasNew: boolean;
}

/**
 * Event detail emitted after a successful auto-detect.
 */
export interface OtoDetectedDetail {
  entry: OtoEntry;
  confidence: number;
}

/**
 * A single validation warning for an oto parameter.
 */
export interface OtoValidationWarning {
  /** Which parameter triggered the warning. */
  parameter: 'offset' | 'consonant' | 'cutoff' | 'preutterance' | 'overlap';
  /** Human-readable warning message. */
  message: string;
}

/**
 * Validate oto parameters against WAV file duration.
 *
 * Returns an array of warnings (not blocking errors). An empty array
 * means all parameters are within the valid range for the given duration.
 *
 * @param entry - The oto entry to validate.
 * @param durationMs - WAV file duration in milliseconds.
 */
export function validateOtoParameters(entry: OtoEntry, durationMs: number): OtoValidationWarning[] {
  const warnings: OtoValidationWarning[] = [];

  if (durationMs <= 0) return warnings;

  // offset > duration
  if (entry.offset > durationMs) {
    warnings.push({
      parameter: 'offset',
      message: `Offset (${Math.round(entry.offset)}ms) exceeds audio duration (${Math.round(durationMs)}ms)`,
    });
  }

  // |cutoff| > duration (cutoff is negative = from end)
  if (Math.abs(entry.cutoff) > durationMs) {
    warnings.push({
      parameter: 'cutoff',
      message: `Cutoff (${Math.round(entry.cutoff)}ms) exceeds audio duration (${Math.round(durationMs)}ms)`,
    });
  }

  const availableAfterOffset = durationMs - entry.offset;

  // consonant > duration - offset
  if (entry.offset <= durationMs && entry.consonant > availableAfterOffset) {
    warnings.push({
      parameter: 'consonant',
      message: `Consonant (${Math.round(entry.consonant)}ms) exceeds available region after offset (${Math.round(availableAfterOffset)}ms)`,
    });
  }

  // preutterance > duration - offset
  if (entry.offset <= durationMs && entry.preutterance > availableAfterOffset) {
    warnings.push({
      parameter: 'preutterance',
      message: `Preutterance (${Math.round(entry.preutterance)}ms) exceeds available region after offset (${Math.round(availableAfterOffset)}ms)`,
    });
  }

  // overlap > preutterance
  if (entry.overlap > entry.preutterance) {
    warnings.push({
      parameter: 'overlap',
      message: `Overlap (${Math.round(entry.overlap)}ms) exceeds preutterance (${Math.round(entry.preutterance)}ms)`,
    });
  }

  return warnings;
}

/**
 * Headless component managing OtoEntry CRUD, undo/redo, and auto-detection.
 *
 * Encapsulates:
 * - Loading oto entries for a given voicebank + filename
 * - Creating, updating, and deleting entries via the API
 * - Undo/redo history for entry edits
 * - ML auto-detection with alignment settings
 * - Dirty state tracking
 *
 * The parent passes voicebankId and filename as properties. When both are
 * set, entries are loaded automatically. The current entry, dirty state,
 * and undo/redo availability are exposed as read-only properties and events.
 *
 * @fires oto-entries-loaded - Fired when entries finish loading.
 * @fires oto-entry-changed - Fired when the current entry is modified (including undo/redo).
 * @fires oto-entry-saved - Fired after a successful save.
 * @fires oto-detected - Fired after a successful auto-detect.
 * @fires oto-error - Fired when an error occurs. Detail: { message: string }
 *
 * @example
 * ```html
 * <uvm-oto-manager
 *   .voicebankId=${this._voicebankId}
 *   .filename=${this._filename}
 *   .audioBuffer=${this._audioBuffer}
 *   @oto-entries-loaded=${this._onEntriesLoaded}
 *   @oto-entry-changed=${this._onEntryChanged}
 *   @oto-entry-saved=${this._onEntrySaved}
 * ></uvm-oto-manager>
 * ```
 */
@customElement('uvm-oto-manager')
export class UvmOtoManager extends LitElement {
  // ==================== Public Properties ====================

  /**
   * Voicebank ID for API calls.
   */
  @property({ type: String })
  voicebankId: string | null = null;

  /**
   * WAV filename for loading entries.
   */
  @property({ type: String })
  filename: string | null = null;

  /**
   * Audio buffer for the current sample.
   * Used to determine whether auto-detect should run on load.
   */
  @property({ attribute: false })
  audioBuffer: AudioBuffer | null = null;

  /**
   * Alignment tightness setting for auto-detect (0.0 to 1.0).
   */
  @property({ type: Number })
  alignmentTightness = 0.5;

  /**
   * Alignment method override for auto-detect. Null = automatic.
   */
  @property({ attribute: false })
  alignmentMethodOverride: 'sofa' | 'fa' | 'blind' | null = null;

  // ==================== Read-Only State ====================

  /** All oto entries for the current file. */
  @state()
  entries: OtoEntry[] = [];

  /** Index of the currently selected entry. */
  @state()
  selectedEntryIndex = 0;

  /** The current entry being edited (local copy). */
  @state()
  currentEntry: OtoEntry | null = null;

  /** Whether entries are currently loading. */
  @state()
  loadingEntries = false;

  /** Whether the current entry has unsaved changes. */
  @state()
  isDirty = false;

  /** Whether a save operation is in progress. */
  @state()
  isSaving = false;

  /** Whether save completed successfully (transient). */
  @state()
  saveSuccess = false;

  /** Whether auto-detection is in progress. */
  @state()
  isDetecting = false;

  /** Confidence score from the last auto-detection, or null. */
  @state()
  lastConfidence: number | null = null;

  /** Whether undo is available. */
  get canUndo(): boolean {
    return this._undoStack.length > 0;
  }

  /** Whether redo is available. */
  get canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  /** Available alignment methods from the backend. */
  @state()
  availableAlignmentMethods: AlignmentMethod[] = [];

  /** Validation warnings for the current entry against WAV duration. */
  @state()
  validationWarnings: OtoValidationWarning[] = [];

  // ==================== Private State ====================

  /** Original entry before edits, used to decide create vs update. */
  private _originalEntry: OtoEntry | null = null;

  /** Undo stack of previous entry states. */
  @state()
  private _undoStack: OtoEntry[] = [];

  /** Redo stack for undone changes. */
  @state()
  private _redoStack: OtoEntry[] = [];

  /** Auto-detect timeout ID for delayed detection on load. */
  private _autoDetectTimer: number | null = null;

  // ==================== Lifecycle ====================

  connectedCallback(): void {
    super.connectedCallback();
    this._loadAlignmentConfig();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._autoDetectTimer !== null) {
      clearTimeout(this._autoDetectTimer);
      this._autoDetectTimer = null;
    }
  }

  protected updated(changedProperties: Map<string, unknown>): void {
    // Revalidate when audioBuffer changes (it loads asynchronously after entries)
    if (changedProperties.has('audioBuffer')) {
      this._recomputeValidationWarnings();
    }
  }

  // ==================== Public Methods ====================

  /**
   * Load oto entries for the given voicebank and filename.
   * Called by the parent when switching samples.
   */
  async loadEntries(voicebankId: string, filename: string): Promise<void> {
    this.voicebankId = voicebankId;
    this.filename = filename;
    this.selectedEntryIndex = 0;
    this.isDirty = false;
    this._originalEntry = null;
    this.lastConfidence = null;
    this._undoStack = [];
    this._redoStack = [];
    this.saveSuccess = false;

    await this._fetchEntries(voicebankId, filename);

    // Auto-detect if this is a new entry OR has only default values
    if (
      (this._originalEntry === null || this._hasOnlyDefaultValues(this._originalEntry)) &&
      this.audioBuffer !== null
    ) {
      // Small delay to let UI update before starting detection
      if (this._autoDetectTimer !== null) {
        clearTimeout(this._autoDetectTimer);
      }
      this._autoDetectTimer = window.setTimeout(() => {
        this._autoDetectTimer = null;
        this.autoDetect();
      }, 100);
    }
  }

  /**
   * Update a marker value on the current entry (from waveform drag or precision input).
   */
  updateMarker(name: string, value: number): void {
    if (!this.currentEntry) return;

    this._pushUndo();

    this.currentEntry = {
      ...this.currentEntry,
      [name]: value,
    };

    this.isDirty = true;
    this.saveSuccess = false;
    this._emitEntryChanged();
  }

  /**
   * Select an entry by index from the entries list.
   */
  selectEntry(index: number): void {
    if (index < 0 || index >= this.entries.length) return;
    if (index === this.selectedEntryIndex) return;

    this.selectedEntryIndex = index;
    this.currentEntry = { ...this.entries[index] };
    this._originalEntry = { ...this.entries[index] };
    this.isDirty = false;
    this.saveSuccess = false;
    this.lastConfidence = null;
    this._undoStack = [];
    this._redoStack = [];
    this._emitEntryChanged();
  }

  /**
   * Save the current entry to the backend.
   */
  async saveEntry(): Promise<void> {
    if (!this.currentEntry || !this.voicebankId) return;

    this.isSaving = true;
    this.saveSuccess = false;

    try {
      const isNew = this._originalEntry === null;

      if (isNew) {
        const created = await api.createOtoEntry(this.voicebankId, {
          filename: this.currentEntry.filename,
          alias: this.currentEntry.alias,
          offset: this.currentEntry.offset,
          consonant: this.currentEntry.consonant,
          cutoff: this.currentEntry.cutoff,
          preutterance: this.currentEntry.preutterance,
          overlap: this.currentEntry.overlap,
        });

        this.currentEntry = { ...created };
        this._originalEntry = { ...created };
        this.entries = [...this.entries, created];
      } else {
        const updated = await api.updateOtoEntry(
          this.voicebankId,
          this.currentEntry.filename,
          this._originalEntry!.alias,
          {
            offset: this.currentEntry.offset,
            consonant: this.currentEntry.consonant,
            cutoff: this.currentEntry.cutoff,
            preutterance: this.currentEntry.preutterance,
            overlap: this.currentEntry.overlap,
          }
        );

        this.currentEntry = { ...updated };
        this._originalEntry = { ...updated };
        this.entries = this.entries.map((entry, i) =>
          i === this.selectedEntryIndex ? updated : entry
        );
      }

      this.isDirty = false;
      this.saveSuccess = true;

      UvmToastManager.success('Entry saved');

      this.dispatchEvent(
        new CustomEvent<OtoEntrySavedDetail>('oto-entry-saved', {
          detail: { entry: this.currentEntry, wasNew: isNew },
          bubbles: true,
          composed: true,
        })
      );

      // Clear success indicator after 2 seconds
      setTimeout(() => {
        this.saveSuccess = false;
      }, 2000);
    } catch (error) {
      console.error('Failed to save oto entry:', error);
      if (error instanceof ApiError) {
        if (error.isNotFound()) {
          UvmToastManager.error('Sample not found');
        } else if (error.isConflict()) {
          UvmToastManager.error('An entry with this alias already exists');
        } else {
          UvmToastManager.error(error.message);
        }
      } else {
        UvmToastManager.error('Failed to save entry');
      }
      this._emitError(error instanceof Error ? error.message : 'Failed to save entry');
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Create a new entry with a given alias for the current file.
   */
  async createEntry(alias: string): Promise<void> {
    if (!this.voicebankId || !this.filename) return;

    const newEntry = {
      filename: this.filename,
      alias,
      ...DEFAULT_OTO_VALUES,
    };

    try {
      const created = await api.createOtoEntry(this.voicebankId, newEntry);
      UvmToastManager.success(`Created alias "${alias}"`);

      this.entries = [...this.entries, created];
      this.selectedEntryIndex = this.entries.length - 1;
      this.currentEntry = { ...created };
      this._originalEntry = { ...created };
      this.isDirty = false;
      this.saveSuccess = false;
      this.lastConfidence = null;
      this._undoStack = [];
      this._redoStack = [];
      this._emitEntryChanged();
    } catch (error) {
      console.error('Failed to create oto entry:', error);
      if (error instanceof ApiError) {
        if (error.isConflict()) {
          UvmToastManager.error(`An entry with alias "${alias}" already exists`);
        } else {
          UvmToastManager.error(error.message);
        }
      } else {
        UvmToastManager.error('Failed to create entry');
      }
    }
  }

  /**
   * Add a new entry with an auto-generated unique alias.
   */
  addEntry(): void {
    if (!this.filename) return;

    const baseName = this.filename.replace(/\.wav$/i, '').replace(/^_/, '');
    let alias = `- ${baseName}`;
    let suffix = 2;

    while (this.entries.some((e) => e.alias === alias)) {
      alias = `- ${baseName} ${suffix}`;
      suffix++;
    }

    this.createEntry(alias);
  }

  /**
   * Undo the last change to the current entry.
   */
  undo(): void {
    if (this._undoStack.length === 0) return;

    const current = this._getCurrentEntryCopy();
    if (current) {
      this._redoStack = [...this._redoStack, current];
    }

    const previous = this._undoStack[this._undoStack.length - 1];
    this._undoStack = this._undoStack.slice(0, -1);
    this._applyEntry(previous);
  }

  /**
   * Redo a previously undone change.
   */
  redo(): void {
    if (this._redoStack.length === 0) return;

    const current = this._getCurrentEntryCopy();
    if (current) {
      this._undoStack = [...this._undoStack, current];
    }

    const next = this._redoStack[this._redoStack.length - 1];
    this._redoStack = this._redoStack.slice(0, -1);
    this._applyEntry(next);
  }

  /**
   * Run ML auto-detection for the current sample.
   */
  async autoDetect(): Promise<void> {
    if (!this.voicebankId || !this.filename) return;

    this.isDetecting = true;

    try {
      const suggestion = await api.suggestOto(
        this.voicebankId,
        this.filename,
        {
          alias: this.currentEntry?.alias,
          tightness: this.alignmentTightness,
          methodOverride: this.alignmentMethodOverride === 'blind' ? null : this.alignmentMethodOverride,
        }
      );

      this._pushUndo();

      this.currentEntry = {
        filename: suggestion.filename,
        alias: suggestion.alias,
        offset: suggestion.offset,
        consonant: suggestion.consonant,
        cutoff: suggestion.cutoff,
        preutterance: suggestion.preutterance,
        overlap: suggestion.overlap,
      };

      this.lastConfidence = suggestion.confidence;
      this.isDirty = true;
      this.saveSuccess = false;

      const confidencePercent = Math.round(suggestion.confidence * 100);
      UvmToastManager.success(`Parameters detected (${confidencePercent}% confidence)`);

      this.dispatchEvent(
        new CustomEvent<OtoDetectedDetail>('oto-detected', {
          detail: { entry: this.currentEntry, confidence: suggestion.confidence },
          bubbles: true,
          composed: true,
        })
      );

      this._emitEntryChanged();
    } catch (error) {
      console.error('Failed to auto-detect oto parameters:', error);
      if (error instanceof ApiError) {
        if (error.isNotFound()) {
          UvmToastManager.error('Sample not found');
        } else if (error.status === 503) {
          UvmToastManager.error('ML service is not available');
        } else {
          UvmToastManager.error(error.message);
        }
      } else {
        UvmToastManager.error('Failed to auto-detect parameters');
      }
      this.lastConfidence = null;
      this._emitError(error instanceof Error ? error.message : 'Failed to auto-detect parameters');
    } finally {
      this.isDetecting = false;
    }
  }

  /**
   * Update alignment settings and persist to backend.
   */
  async updateAlignmentSettings(tightness: number, methodOverride: 'sofa' | 'fa' | 'blind' | null): Promise<void> {
    this.alignmentTightness = tightness;
    this.alignmentMethodOverride = methodOverride;

    try {
      await api.updateAlignmentConfig({
        tightness,
        method_override: methodOverride === 'blind' ? null : methodOverride,
      });
    } catch (error) {
      console.warn('Failed to persist alignment config:', error);
    }
  }

  // ==================== Private Methods ====================

  /**
   * Fetch oto entries from the API.
   */
  private async _fetchEntries(voicebankId: string, filename: string): Promise<void> {
    this.loadingEntries = true;
    this.entries = [];

    try {
      this.entries = await api.getOtoEntriesForFile(voicebankId, filename);

      if (this.entries.length > 0) {
        this.currentEntry = { ...this.entries[0] };
        this._originalEntry = { ...this.entries[0] };
      } else {
        this.currentEntry = this._createDefaultEntry(filename);
        this._originalEntry = null;
      }
    } catch (_error) {
      this.currentEntry = this._createDefaultEntry(filename);
      this._originalEntry = null;
      console.warn('No oto entries found, using defaults:', _error);
    } finally {
      this.loadingEntries = false;
    }

    const isNew = this._originalEntry === null;
    this._recomputeValidationWarnings();
    this.dispatchEvent(
      new CustomEvent<OtoEntriesLoadedDetail>('oto-entries-loaded', {
        detail: { entries: this.entries, currentEntry: this.currentEntry, isNew },
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Create a default oto entry for a new file.
   */
  private _createDefaultEntry(filename: string): OtoEntry {
    const baseName = filename.replace(/\.wav$/i, '').replace(/^_/, '');
    const alias = `- ${baseName}`;

    return {
      filename,
      alias,
      ...DEFAULT_OTO_VALUES,
    };
  }

  /**
   * Check if entry has only default values (hasn't been configured).
   */
  private _hasOnlyDefaultValues(entry: OtoEntry | null): boolean {
    if (!entry) return true;

    return (
      entry.offset === DEFAULT_OTO_VALUES.offset &&
      entry.consonant === DEFAULT_OTO_VALUES.consonant &&
      entry.cutoff === DEFAULT_OTO_VALUES.cutoff &&
      entry.preutterance === DEFAULT_OTO_VALUES.preutterance &&
      entry.overlap === DEFAULT_OTO_VALUES.overlap
    );
  }

  /**
   * Push current state to undo stack.
   */
  private _pushUndo(): void {
    const current = this._getCurrentEntryCopy();
    if (current) {
      this._undoStack = [...this._undoStack, current];
      this._redoStack = [];
    }
  }

  /**
   * Get a copy of the current entry.
   */
  private _getCurrentEntryCopy(): OtoEntry | null {
    if (!this.filename || !this.currentEntry) return null;
    return { ...this.currentEntry };
  }

  /**
   * Apply an entry state (used for undo/redo).
   */
  private _applyEntry(entry: OtoEntry): void {
    this.currentEntry = { ...entry };
    this.isDirty = true;
    this.saveSuccess = false;
    this._emitEntryChanged();
  }

  /**
   * Load alignment configuration and available methods from the backend.
   */
  private async _loadAlignmentConfig(): Promise<void> {
    try {
      const [configResult, methodsResult] = await Promise.all([
        api.getAlignmentConfig(),
        api.getAlignmentMethods(),
      ]);

      this.alignmentTightness = configResult.tightness;
      this.alignmentMethodOverride = configResult.method_override as typeof this.alignmentMethodOverride;

      this.availableAlignmentMethods = methodsResult.methods.map(m => ({
        name: m.name as 'sofa' | 'fa' | 'blind',
        available: m.available,
        displayName: m.display_name,
        unavailableReason: m.available ? undefined : (m.description || 'Not available'),
      }));
    } catch (error) {
      console.warn('Failed to load alignment config:', error);
    }
  }

  /**
   * Recompute validation warnings based on current entry and audio buffer.
   * Called whenever the entry or audio buffer changes.
   */
  private _recomputeValidationWarnings(): void {
    if (!this.currentEntry || !this.audioBuffer) {
      this.validationWarnings = [];
      return;
    }

    const durationMs = this.audioBuffer.duration * 1000;
    this.validationWarnings = validateOtoParameters(this.currentEntry, durationMs);
  }

  /**
   * Emit entry-changed event.
   */
  private _emitEntryChanged(): void {
    if (!this.currentEntry) return;
    this._recomputeValidationWarnings();
    this.dispatchEvent(
      new CustomEvent<OtoEntryChangedDetail>('oto-entry-changed', {
        detail: { entry: this.currentEntry, isDirty: this.isDirty },
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Emit error event.
   */
  private _emitError(message: string): void {
    this.dispatchEvent(
      new CustomEvent('oto-error', {
        detail: { message },
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
    'uvm-oto-manager': UvmOtoManager;
  }
}
