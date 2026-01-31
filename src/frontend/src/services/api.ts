/**
 * Typed API client for the UTAU Voicebank Manager backend.
 *
 * Provides type-safe fetch wrappers for all backend endpoints with
 * proper error handling and response parsing.
 */

import type {
  MlStatus,
  OtoEntry,
  OtoEntryCreate,
  OtoEntryUpdate,
  PhonemeSegment,
  Voicebank,
  VoicebankSummary,
} from './types.js';

/**
 * Custom error class for API errors.
 * Includes HTTP status code and server error message.
 */
export class ApiError extends Error {
  /** HTTP status code */
  readonly status: number;
  /** Optional detailed error information */
  readonly detail: unknown;

  constructor(
    status: number,
    message: string,
    detail?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }

  /**
   * Check if this is a "not found" error.
   */
  isNotFound(): boolean {
    return this.status === 404;
  }

  /**
   * Check if this is a conflict error (e.g., duplicate entry).
   */
  isConflict(): boolean {
    return this.status === 409;
  }

  /**
   * Check if this is a validation error.
   */
  isValidationError(): boolean {
    return this.status === 400 || this.status === 422;
  }

  /**
   * Check if this is a server error.
   */
  isServerError(): boolean {
    return this.status >= 500;
  }
}

/**
 * API client for communicating with the UTAU Voicebank Manager backend.
 *
 * @example
 * ```typescript
 * import { api } from './services/api.js';
 *
 * // List all voicebanks
 * const voicebanks = await api.listVoicebanks();
 *
 * // Load a sample as AudioBuffer
 * const audioContext = new AudioContext();
 * const buffer = await api.loadSampleAsAudioBuffer('my-voicebank', 'ka.wav', audioContext);
 * ```
 */
export class ApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl = 'http://localhost:8000/api/v1') {
    this.baseUrl = baseUrl;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Make an HTTP request and handle errors.
   */
  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
      },
    });

    if (!response.ok) {
      let message = `HTTP ${response.status}: ${response.statusText}`;
      let detail: unknown = undefined;

      try {
        const errorData = await response.json();
        if (typeof errorData.detail === 'string') {
          message = errorData.detail;
        } else if (errorData.detail) {
          detail = errorData.detail;
          message = JSON.stringify(errorData.detail);
        }
      } catch {
        // Response body is not JSON, use default message
      }

      throw new ApiError(response.status, message, detail);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  /**
   * Make a JSON POST/PUT request.
   */
  private async requestJson<T>(
    path: string,
    method: 'POST' | 'PUT' | 'PATCH',
    body: unknown
  ): Promise<T> {
    return this.request<T>(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Voicebanks
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * List all voicebanks.
   *
   * @returns Array of voicebank summaries sorted by name
   */
  async listVoicebanks(): Promise<VoicebankSummary[]> {
    return this.request<VoicebankSummary[]>('/voicebanks');
  }

  /**
   * Get detailed information about a voicebank.
   *
   * @param id - Voicebank identifier
   * @returns Full voicebank details
   * @throws {ApiError} 404 if voicebank not found
   */
  async getVoicebank(id: string): Promise<Voicebank> {
    return this.request<Voicebank>(`/voicebanks/${encodeURIComponent(id)}`);
  }

  /**
   * Create a new voicebank by uploading files.
   *
   * Accepts either individual WAV files or a ZIP archive containing
   * the voicebank contents.
   *
   * @param name - Display name for the voicebank
   * @param files - Array of File objects to upload
   * @returns Created voicebank details
   * @throws {ApiError} 400 if validation fails
   * @throws {ApiError} 409 if voicebank with same name exists
   * @throws {ApiError} 413 if files exceed size limits
   */
  async createVoicebank(
    name: string,
    files: FileList | File[]
  ): Promise<Voicebank> {
    const formData = new FormData();
    formData.append('name', name);

    const fileArray = Array.from(files);

    // Check if it's a single ZIP file
    if (fileArray.length === 1 && fileArray[0].name.toLowerCase().endsWith('.zip')) {
      formData.append('zip_file', fileArray[0]);
    } else {
      // Upload individual files
      for (const file of fileArray) {
        formData.append('files', file);
      }
    }

    return this.request<Voicebank>('/voicebanks', {
      method: 'POST',
      body: formData,
    });
  }

  /**
   * Delete a voicebank and all its contents.
   *
   * This permanently removes the voicebank directory and all files within.
   *
   * @param id - Voicebank identifier
   * @throws {ApiError} 404 if voicebank not found
   */
  async deleteVoicebank(id: string): Promise<void> {
    await this.request<void>(`/voicebanks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  /**
   * List all WAV sample filenames in a voicebank.
   *
   * @param voicebankId - Voicebank identifier
   * @returns Array of WAV filenames sorted alphabetically
   * @throws {ApiError} 404 if voicebank not found
   */
  async listSamples(voicebankId: string): Promise<string[]> {
    return this.request<string[]>(
      `/voicebanks/${encodeURIComponent(voicebankId)}/samples`
    );
  }

  /**
   * Get the URL for a sample audio file.
   *
   * This is a synchronous method that returns the URL without making
   * a network request. Use this URL for audio playback or download.
   *
   * @param voicebankId - Voicebank identifier
   * @param filename - WAV filename
   * @returns URL to the audio file
   */
  getSampleUrl(voicebankId: string, filename: string): string {
    return `${this.baseUrl}/voicebanks/${encodeURIComponent(voicebankId)}/samples/${encodeURIComponent(filename)}`;
  }

  /**
   * Load a sample as an AudioBuffer for Web Audio API playback.
   *
   * Fetches the audio file, decodes it, and returns an AudioBuffer
   * ready for use with Web Audio API.
   *
   * @param voicebankId - Voicebank identifier
   * @param filename - WAV filename
   * @param audioContext - Web Audio API AudioContext for decoding
   * @returns Decoded AudioBuffer
   * @throws {ApiError} 404 if voicebank or sample not found
   * @throws {Error} if audio decoding fails
   */
  async loadSampleAsAudioBuffer(
    voicebankId: string,
    filename: string,
    audioContext: AudioContext
  ): Promise<AudioBuffer> {
    const url = this.getSampleUrl(voicebankId, filename);
    const response = await fetch(url);

    if (!response.ok) {
      throw new ApiError(
        response.status,
        `Failed to fetch sample: ${response.statusText}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return audioContext.decodeAudioData(arrayBuffer);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Oto Entries
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get all oto entries for a voicebank.
   *
   * Returns all entries defined in the voicebank's oto.ini file.
   * Returns empty array if oto.ini doesn't exist yet.
   *
   * @param voicebankId - Voicebank identifier
   * @returns Array of oto entries
   * @throws {ApiError} 404 if voicebank not found
   */
  async getOtoEntries(voicebankId: string): Promise<OtoEntry[]> {
    try {
      return await this.request<OtoEntry[]>(
        `/voicebanks/${encodeURIComponent(voicebankId)}/oto`
      );
    } catch (error) {
      // Return empty array if oto.ini doesn't exist
      if (error instanceof ApiError && error.isNotFound()) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get all oto entries for a specific WAV file.
   *
   * A single WAV file can have multiple oto entries with different aliases
   * (e.g., for VCV voicebanks where one file contains multiple phonemes).
   *
   * @param voicebankId - Voicebank identifier
   * @param filename - WAV filename
   * @returns Array of oto entries for the file
   * @throws {ApiError} 404 if voicebank not found
   */
  async getOtoEntriesForFile(
    voicebankId: string,
    filename: string
  ): Promise<OtoEntry[]> {
    try {
      return await this.request<OtoEntry[]>(
        `/voicebanks/${encodeURIComponent(voicebankId)}/oto/${encodeURIComponent(filename)}`
      );
    } catch (error) {
      // Return empty array if no entries exist for this file
      if (error instanceof ApiError && error.isNotFound()) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Create a new oto entry.
   *
   * Validates that the referenced WAV file exists and that no duplicate
   * entry exists for the same filename+alias combination.
   *
   * If oto.ini doesn't exist, it will be created.
   *
   * @param voicebankId - Voicebank identifier
   * @param entry - Oto entry data
   * @returns Created oto entry with all fields populated
   * @throws {ApiError} 400 if WAV file doesn't exist
   * @throws {ApiError} 404 if voicebank not found
   * @throws {ApiError} 409 if entry with same filename+alias already exists
   */
  async createOtoEntry(
    voicebankId: string,
    entry: OtoEntryCreate
  ): Promise<OtoEntry> {
    return this.requestJson<OtoEntry>(
      `/voicebanks/${encodeURIComponent(voicebankId)}/oto`,
      'POST',
      entry
    );
  }

  /**
   * Update an existing oto entry.
   *
   * Only provided fields will be updated; omitted fields retain their
   * existing values.
   *
   * @param voicebankId - Voicebank identifier
   * @param filename - WAV filename
   * @param alias - Entry alias
   * @param update - Fields to update
   * @returns Updated oto entry with all fields
   * @throws {ApiError} 404 if voicebank or entry not found
   */
  async updateOtoEntry(
    voicebankId: string,
    filename: string,
    alias: string,
    update: OtoEntryUpdate
  ): Promise<OtoEntry> {
    return this.requestJson<OtoEntry>(
      `/voicebanks/${encodeURIComponent(voicebankId)}/oto/${encodeURIComponent(filename)}/${encodeURIComponent(alias)}`,
      'PUT',
      update
    );
  }

  /**
   * Delete an oto entry.
   *
   * Removes the specified entry from the voicebank's oto.ini file.
   *
   * @param voicebankId - Voicebank identifier
   * @param filename - WAV filename
   * @param alias - Entry alias
   * @throws {ApiError} 404 if voicebank or entry not found
   */
  async deleteOtoEntry(
    voicebankId: string,
    filename: string,
    alias: string
  ): Promise<void> {
    await this.request<void>(
      `/voicebanks/${encodeURIComponent(voicebankId)}/oto/${encodeURIComponent(filename)}/${encodeURIComponent(alias)}`,
      { method: 'DELETE' }
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ML (Machine Learning)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Detect phonemes with timestamps from an audio file.
   *
   * Uploads an audio file and returns detected phonemes with their
   * start/end times and confidence scores.
   *
   * @param file - Audio file (WAV, MP3, FLAC, OGG, or M4A)
   * @returns Array of detected phoneme segments
   * @throws {ApiError} 400 if file format is invalid
   * @throws {ApiError} 413 if file is too large
   * @throws {ApiError} 422 if audio processing fails
   * @throws {ApiError} 503 if ML model is not available
   */
  async detectPhonemes(file: File): Promise<PhonemeSegment[]> {
    const formData = new FormData();
    formData.append('file', file);

    return this.request<PhonemeSegment[]>('/ml/phonemes/detect', {
      method: 'POST',
      body: formData,
    });
  }

  /**
   * Check ML service status and model availability.
   *
   * @returns ML service status information
   */
  async getMlStatus(): Promise<MlStatus> {
    return this.request<MlStatus>('/ml/status');
  }
}

/**
 * Default API client instance configured for local development.
 *
 * @example
 * ```typescript
 * import { api } from './services/api.js';
 *
 * const voicebanks = await api.listVoicebanks();
 * ```
 */
export const api = new ApiClient();
