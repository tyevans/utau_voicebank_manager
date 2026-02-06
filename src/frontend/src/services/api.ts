/**
 * Typed API client for the UTAU Voicebank Manager backend.
 *
 * Provides type-safe fetch wrappers for all backend endpoints with
 * proper error handling and response parsing.
 */

/**
 * Detect the API base URL based on the current environment.
 * - In development (Vite dev server on port 5173), use localhost:8000
 * - In production (served from same origin), use relative /api/v1
 */
export function getDefaultApiUrl(): string {
  if (typeof window !== 'undefined') {
    const port = window.location.port;
    // Vite dev server ports
    if (port === '5173' || port === '5174' || port === '5175') {
      return 'http://localhost:8000/api/v1';
    }
    // Production or Docker: same origin
    return '/api/v1';
  }
  return 'http://localhost:8000/api/v1';
}

import type {
  BatchOtoResult,
  MlStatus,
  OtoEntry,
  OtoEntryCreate,
  OtoEntryUpdate,
  OtoSuggestion,
  PaginatedResponse,
  PhonemeSegment,
  Voicebank,
  VoicebankSummary,
} from './types.js';

import type { RetryOptions } from '../utils/fetch-retry.js';
import { fetchWithRetry } from '../utils/fetch-retry.js';
import { dispatchOtoEntriesChanged } from '../events/oto-events.js';

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

  constructor(baseUrl = getDefaultApiUrl()) {
    this.baseUrl = baseUrl;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Make an HTTP request and handle errors.
   *
   * Automatically retries on transient server errors (5xx) and rate limiting (429).
   * Pass `retryOptions: { noRetry: true }` to disable retries for mutations
   * that should not be repeated.
   */
  private async request<T>(
    path: string,
    options: RequestInit = {},
    retryOptions?: RetryOptions,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const response = await fetchWithRetry(url, {
      ...options,
      headers: {
        ...options.headers,
      },
    }, retryOptions);

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
    body: unknown,
    retryOptions?: RetryOptions,
  ): Promise<T> {
    return this.request<T>(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, retryOptions);
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
    const response = await this.request<PaginatedResponse<VoicebankSummary>>('/voicebanks');
    return response.items;
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
    }, { noRetry: true });
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
    }, { noRetry: true });
  }

  /**
   * List all WAV sample filenames in a voicebank.
   *
   * @param voicebankId - Voicebank identifier
   * @returns Array of WAV filenames sorted alphabetically
   * @throws {ApiError} 404 if voicebank not found
   */
  async listSamples(voicebankId: string): Promise<string[]> {
    const response = await this.request<PaginatedResponse<string>>(
      `/voicebanks/${encodeURIComponent(voicebankId)}/samples`
    );
    return response.items;
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
    const response = await fetchWithRetry(url);

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
      const response = await this.request<PaginatedResponse<OtoEntry>>(
        `/voicebanks/${encodeURIComponent(voicebankId)}/oto`
      );
      return response.items;
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
      const response = await this.request<PaginatedResponse<OtoEntry>>(
        `/voicebanks/${encodeURIComponent(voicebankId)}/oto/${encodeURIComponent(filename)}`
      );
      return response.items;
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
    const result = await this.requestJson<OtoEntry>(
      `/voicebanks/${encodeURIComponent(voicebankId)}/oto`,
      'POST',
      entry,
      { noRetry: true },
    );
    dispatchOtoEntriesChanged(voicebankId, 'create');
    return result;
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
    const result = await this.requestJson<OtoEntry>(
      `/voicebanks/${encodeURIComponent(voicebankId)}/oto/${encodeURIComponent(filename)}/${encodeURIComponent(alias)}`,
      'PUT',
      update
    );
    dispatchOtoEntriesChanged(voicebankId, 'update');
    return result;
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
      { method: 'DELETE' },
      { noRetry: true },
    );
    dispatchOtoEntriesChanged(voicebankId, 'delete');
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

  /**
   * Get ML-suggested oto parameters for a sample.
   *
   * Uses phoneme detection to suggest appropriate timing parameters
   * for the given audio file. The confidence score indicates how
   * reliable the suggestions are.
   *
   * @param voicebankId - Voicebank identifier
   * @param filename - WAV filename within the voicebank
   * @param options - Optional settings (alias, preferSofa, sofaLanguage)
   * @returns Suggested oto parameters with confidence score
   * @throws {ApiError} 404 if voicebank or sample not found
   * @throws {ApiError} 503 if ML model is not available
   */
  async suggestOto(
    voicebankId: string,
    filename: string,
    options?: {
      alias?: string;
      /** Use SOFA (singing-optimized) aligner when available. Defaults to true. */
      preferSofa?: boolean;
      /** Language code for SOFA alignment. Defaults to 'ja'. */
      sofaLanguage?: string;
      tightness?: number;
      methodOverride?: string | null;
    }
  ): Promise<OtoSuggestion> {
    const params = new URLSearchParams({
      voicebank_id: voicebankId,
      filename,
    });
    if (options?.alias) {
      params.append('alias', options.alias);
    }
    // Default to preferring SOFA for singing-oriented alignment
    params.append('prefer_sofa', String(options?.preferSofa ?? true));
    if (options?.sofaLanguage) {
      params.append('sofa_language', options.sofaLanguage);
    }
    if (options?.tightness !== undefined) {
      params.append('tightness', String(options.tightness));
    }
    if (options?.methodOverride) {
      params.append('method_override', options.methodOverride);
    }

    return this.request<OtoSuggestion>(`/ml/oto/suggest?${params}`, {
      method: 'POST',
    });
  }

  /**
   * Generate oto entries for all samples in a voicebank.
   *
   * Processes each WAV sample through the ML pipeline to generate
   * suggested oto parameters. This is a potentially long-running
   * operation for large voicebanks.
   *
   * @param voicebankId - Voicebank identifier
   * @param overwriteExisting - If true, replace existing entries. If false, skip files with entries.
   * @returns BatchOtoResult with generated entries and statistics
   * @throws {ApiError} 404 if voicebank not found
   * @throws {ApiError} 503 if ML model is not available
   */
  async batchGenerateOto(
    voicebankId: string,
    overwriteExisting = false,
    options?: { tightness?: number; methodOverride?: string | null }
  ): Promise<BatchOtoResult> {
    const body: Record<string, unknown> = {
      voicebank_id: voicebankId,
      overwrite_existing: overwriteExisting,
    };
    if (options?.tightness !== undefined) {
      body.tightness = options.tightness;
    }
    if (options?.methodOverride) {
      body.method_override = options.methodOverride;
    }
    const result = await this.requestJson<BatchOtoResult>('/ml/oto/batch-generate', 'POST', body);
    dispatchOtoEntriesChanged(voicebankId, 'batch');
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Alignment Config
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get the current alignment configuration.
   */
  async getAlignmentConfig(): Promise<{ tightness: number; method_override: string | null; computed_params: Record<string, number> }> {
    return this.request('/ml/alignment/config');
  }

  /**
   * Update the alignment configuration.
   */
  async updateAlignmentConfig(config: { tightness: number; method_override?: string | null }): Promise<{ tightness: number; method_override: string | null; computed_params: Record<string, number> }> {
    return this.requestJson('/ml/alignment/config', 'POST', config);
  }

  /**
   * Get available alignment methods.
   */
  async getAlignmentMethods(): Promise<{ methods: Array<{ name: string; display_name: string; available: boolean; description: string; languages: string[] }>; recommended: string }> {
    return this.request('/ml/alignment/methods');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Voicebank Icon
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Upload an icon image for a voicebank.
   *
   * Accepts PNG, JPG, or BMP images. The backend auto-converts to 100x100 BMP.
   *
   * @param voicebankId - Voicebank identifier
   * @param file - Image file to upload
   * @throws {ApiError} 400 if file format is invalid
   * @throws {ApiError} 404 if voicebank not found
   */
  async uploadIcon(voicebankId: string, file: File): Promise<void> {
    const formData = new FormData();
    formData.append('file', file);

    await this.request<{ success: boolean }>(
      `/voicebanks/${encodeURIComponent(voicebankId)}/icon`,
      {
        method: 'POST',
        body: formData,
      }
    );
  }

  /**
   * Get the URL for a voicebank's icon image.
   *
   * This is a synchronous method that returns the URL without making
   * a network request. The URL may 404 if no icon has been uploaded.
   *
   * @param voicebankId - Voicebank identifier
   * @returns URL to the icon image
   */
  getIconUrl(voicebankId: string): string {
    return `${this.baseUrl}/voicebanks/${encodeURIComponent(voicebankId)}/icon`;
  }

  /**
   * Delete a voicebank's icon image.
   *
   * @param voicebankId - Voicebank identifier
   * @throws {ApiError} 404 if voicebank not found
   */
  async deleteIcon(voicebankId: string): Promise<void> {
    await this.request<{ success: boolean }>(
      `/voicebanks/${encodeURIComponent(voicebankId)}/icon`,
      { method: 'DELETE' },
      { noRetry: true },
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Metadata Files (character.txt, readme.txt)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get the content of a voicebank metadata file.
   *
   * Retrieves the raw text content of character.txt or readme.txt.
   * Returns an empty string if the file does not exist yet.
   *
   * @param voicebankId - Voicebank identifier
   * @param filename - Metadata filename ('character.txt' or 'readme.txt')
   * @returns File content as a string
   * @throws {ApiError} 404 if voicebank not found
   */
  async getMetadataFile(voicebankId: string, filename: string): Promise<string> {
    try {
      const result = await this.request<{ content: string }>(
        `/voicebanks/${encodeURIComponent(voicebankId)}/metadata/${encodeURIComponent(filename)}`
      );
      return result.content;
    } catch (error) {
      // Return empty string if file doesn't exist yet
      if (error instanceof ApiError && error.isNotFound()) {
        return '';
      }
      throw error;
    }
  }

  /**
   * Save content to a voicebank metadata file.
   *
   * Writes text content to character.txt or readme.txt.
   * Creates the file if it does not exist.
   *
   * @param voicebankId - Voicebank identifier
   * @param filename - Metadata filename ('character.txt' or 'readme.txt')
   * @param content - File content to save
   * @throws {ApiError} 404 if voicebank not found
   */
  async saveMetadataFile(
    voicebankId: string,
    filename: string,
    content: string
  ): Promise<void> {
    await this.requestJson<{ success: boolean }>(
      `/voicebanks/${encodeURIComponent(voicebankId)}/metadata/${encodeURIComponent(filename)}`,
      'PUT',
      { content }
    );
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
