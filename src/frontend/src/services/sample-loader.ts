/**
 * SampleLoader - Preloads audio samples for phrase playback.
 *
 * Handles fetching oto.ini entries and audio buffers, building the
 * alias-to-SampleData map required by MelodyPlayer.playPhrase().
 *
 * Includes caching to avoid redundant fetches when samples are reused
 * across phrases.
 *
 * @example
 * ```typescript
 * const loader = new SampleLoader(audioContext, api);
 *
 * const phrase: PhraseNote[] = [
 *   { alias: 'ka', pitch: 0, startTime: 0, duration: 0.3 },
 *   { alias: 'a', pitch: 0, startTime: 0.3, duration: 0.2 },
 * ];
 *
 * const sampleMap = await loader.loadSamplesForPhrase(phrase, 'my-voicebank');
 * player.playPhrase(phrase, sampleMap);
 * ```
 */

import type { ApiClient } from "./api.js";
import type { OtoEntry } from "./types.js";
import type { PhraseNote, SampleData } from "./melody-player.js";
import {
  analyzeLoudness,
  calculateNormalizationGain,
  type NormalizationOptions,
} from "../utils/loudness-analysis.js";
import { findOtoEntry } from "../utils/alias-matching.js";
import {
  onOtoEntriesChanged,
  offOtoEntriesChanged,
  type OtoEntriesChangedDetail,
} from "../events/oto-events.js";

/**
 * Calculate the sample end time from oto cutoff parameter.
 *
 * Cutoff can be:
 * - Negative: measured from end of audio (e.g., -100 = 100ms before end)
 * - Positive: absolute position from start
 * - Zero: play to end
 *
 * @param otoEntry - The oto entry with cutoff parameter
 * @param audioDuration - Duration of the audio buffer in seconds
 * @returns Sample end time in seconds
 */
function calculateSampleEnd(otoEntry: OtoEntry, audioDuration: number): number {
  if (otoEntry.cutoff < 0) {
    // Negative cutoff: measured from end
    return audioDuration + (otoEntry.cutoff / 1000);
  } else if (otoEntry.cutoff > 0) {
    // Positive cutoff: absolute position
    return otoEntry.cutoff / 1000;
  } else {
    // Zero: play to end
    return audioDuration;
  }
}

/**
 * Result of loading samples for a phrase.
 *
 * Contains the sample map for playback along with information about
 * any aliases that could not be loaded.
 */
export interface LoadSamplesResult {
  /** Map from alias to sample data (audio + oto entry) */
  sampleMap: Map<string, SampleData>;
  /** Aliases that were requested but not found in oto.ini */
  missingAliases: string[];
  /** Aliases that failed to load (file fetch or decode error) */
  failedAliases: string[];
  /**
   * Pre-computed normalization gains for each alias (optional).
   * Only populated when loadSamplesForPhrase is called with
   * precomputeNormalization: true.
   * Maps alias to gain factor (multiply sample amplitude by this value).
   */
  normalizationGains?: Map<string, number>;
}

/**
 * Cached audio buffer entry.
 */
interface CachedAudioBuffer {
  buffer: AudioBuffer;
}

/** Default maximum number of AudioBuffer entries held in the LRU cache. */
const DEFAULT_MAX_CACHE_SIZE = 100;

/**
 * LRU (Least Recently Used) cache for AudioBuffers.
 *
 * Exploits the fact that JavaScript Maps iterate in insertion order.
 * On every access (get or set), the entry is deleted and re-inserted,
 * moving it to the "most recently used" end.  When the cache exceeds
 * maxSize, the *first* entry (least recently used) is evicted.
 */
class LruAudioBufferCache {
  private readonly _map = new Map<string, CachedAudioBuffer>();
  private readonly _maxSize: number;

  constructor(maxSize: number) {
    this._maxSize = maxSize;
  }

  /** Number of entries currently in the cache. */
  get size(): number {
    return this._map.size;
  }

  /** Maximum number of entries before eviction begins. */
  get maxSize(): number {
    return this._maxSize;
  }

  /**
   * Retrieve a cached buffer, promoting it to most-recently-used.
   * Returns undefined on cache miss.
   */
  get(key: string): CachedAudioBuffer | undefined {
    const entry = this._map.get(key);
    if (!entry) {
      return undefined;
    }
    // Move to most-recently-used position
    this._map.delete(key);
    this._map.set(key, entry);
    return entry;
  }

  /**
   * Insert or update a cache entry.
   * If the cache exceeds maxSize after insertion, the least-recently-used
   * entry is evicted.
   */
  set(key: string, entry: CachedAudioBuffer): void {
    // If the key already exists, delete first so re-insert moves it to the end
    if (this._map.has(key)) {
      this._map.delete(key);
    }
    this._map.set(key, entry);
    this._evictIfNeeded();
  }

  /** Check whether a key exists without promoting it. */
  has(key: string): boolean {
    return this._map.has(key);
  }

  /** Delete a specific entry. Returns true if the entry existed. */
  delete(key: string): boolean {
    return this._map.delete(key);
  }

  /** Iterate over all keys (in LRU order, least-recent first). */
  keys(): IterableIterator<string> {
    return this._map.keys();
  }

  /** Remove all entries. */
  clear(): void {
    this._map.clear();
  }

  /** Evict least-recently-used entries until size <= maxSize. */
  private _evictIfNeeded(): void {
    while (this._map.size > this._maxSize) {
      // Map.keys().next() gives the first (oldest) key
      const oldest = this._map.keys().next();
      if (oldest.done) break;
      this._map.delete(oldest.value);
    }
  }
}

/**
 * SampleLoader preloads audio samples required for phrase playback.
 *
 * Features:
 * - Extracts unique aliases from phrase notes
 * - Looks up OtoEntry for each alias
 * - Fetches and decodes AudioBuffers for each unique sample file
 * - Caches decoded AudioBuffers to avoid redundant network requests
 * - Reports missing or failed samples for error handling
 *
 * The loader maintains two caches:
 * 1. OtoEntry cache - keyed by voicebank ID, stores all oto entries
 * 2. AudioBuffer cache - keyed by voicebank ID + filename, stores decoded audio
 */
export class SampleLoader {
  private readonly _audioContext: AudioContext;
  private readonly _api: ApiClient;

  /**
   * Cache of oto entries by voicebank ID.
   * Maps voicebankId -> Map<alias, OtoEntry>
   */
  private readonly _otoCache: Map<string, Map<string, OtoEntry>> = new Map();

  /**
   * LRU cache of decoded AudioBuffers.
   * Maps "voicebankId:filename" -> CachedAudioBuffer.
   * Evicts least-recently-used entries when the cache exceeds maxSize.
   */
  private readonly _audioBufferCache: LruAudioBufferCache;

  /**
   * Event listener for automatic cache invalidation.
   * Set when {@link enableAutoInvalidation} is called, null when not active.
   */
  private _invalidationListener: EventListener | null = null;

  /**
   * Create a new SampleLoader.
   *
   * @param audioContext - Web Audio AudioContext for decoding audio
   * @param api - ApiClient instance for fetching data from backend
   * @param maxCacheSize - Maximum number of AudioBuffers to keep cached
   *   before evicting least-recently-used entries. Defaults to 100.
   */
  constructor(
    audioContext: AudioContext,
    api: ApiClient,
    maxCacheSize: number = DEFAULT_MAX_CACHE_SIZE,
  ) {
    this._audioContext = audioContext;
    this._api = api;
    this._audioBufferCache = new LruAudioBufferCache(maxCacheSize);
  }

  /**
   * Load all samples required for playing a phrase.
   *
   * Extracts unique aliases from the phrase notes, looks up their
   * OtoEntry records, fetches the audio files, and builds the
   * SampleData map required by MelodyPlayer.playPhrase().
   *
   * @param notes - Array of phrase notes to load samples for
   * @param voicebankId - Voicebank identifier
   * @param options - Optional loading options
   * @returns LoadSamplesResult with the sample map and any errors
   *
   * @example
   * ```typescript
   * const result = await loader.loadSamplesForPhrase(phrase, 'my-voicebank');
   *
   * if (result.missingAliases.length > 0) {
   *   console.warn('Missing aliases:', result.missingAliases);
   * }
   *
   * player.playPhrase(phrase, result.sampleMap);
   *
   * // With pre-computed normalization gains
   * const result = await loader.loadSamplesForPhrase(phrase, 'my-voicebank', {
   *   precomputeNormalization: true,
   * });
   * // result.normalizationGains is now populated
   * ```
   */
  async loadSamplesForPhrase(
    notes: PhraseNote[],
    voicebankId: string,
    options?: {
      /**
       * Pre-compute loudness normalization gains for all samples.
       * The gains are returned in result.normalizationGains.
       */
      precomputeNormalization?: boolean;
      /**
       * Options for normalization gain calculation.
       * Only used when precomputeNormalization is true.
       */
      normalizationOptions?: NormalizationOptions;
    }
  ): Promise<LoadSamplesResult> {
    // Extract unique aliases from the phrase
    const uniqueAliases = new Set<string>();
    for (const note of notes) {
      uniqueAliases.add(note.alias);
    }

    // Load oto entries for this voicebank (cached after first load)
    const otoMap = await this._loadOtoEntries(voicebankId);

    // Find which aliases exist and which are missing
    // Uses fallback matching for common voicebank formats (CV prefix, VCV)
    const missingAliases: string[] = [];
    const aliasesToLoad: Map<string, OtoEntry> = new Map();

    for (const alias of uniqueAliases) {
      const result = findOtoEntry(alias, otoMap);
      if (result) {
        // Store under the original alias for consistent lookup during playback
        aliasesToLoad.set(alias, result.entry);
      } else {
        missingAliases.push(alias);
      }
    }

    // Determine which unique filenames we need to load
    const filenamesToLoad = new Set<string>();
    for (const otoEntry of aliasesToLoad.values()) {
      filenamesToLoad.add(otoEntry.filename);
    }

    // Load audio buffers for all required filenames
    const audioBuffers = await this._loadAudioBuffers(
      voicebankId,
      Array.from(filenamesToLoad),
    );

    // Build the sample map
    const sampleMap = new Map<string, SampleData>();
    const failedAliases: string[] = [];

    for (const [alias, otoEntry] of aliasesToLoad) {
      const audioBuffer = audioBuffers.get(otoEntry.filename);
      if (audioBuffer) {
        sampleMap.set(alias, {
          audioBuffer,
          otoEntry,
        });
      } else {
        // Audio file failed to load
        failedAliases.push(alias);
      }
    }

    // Pre-compute normalization gains if requested
    // IMPORTANT: Analyze only the oto-defined playback region (offset to cutoff),
    // not the entire audio buffer for accurate normalization.
    let normalizationGains: Map<string, number> | undefined;
    if (options?.precomputeNormalization) {
      normalizationGains = new Map<string, number>();
      for (const [alias, sampleData] of sampleMap) {
        const { audioBuffer, otoEntry } = sampleData;

        // Calculate the playable region from oto.ini parameters
        const sampleStart = otoEntry.offset / 1000;
        const sampleEnd = calculateSampleEnd(otoEntry, audioBuffer.duration);

        const analysis = analyzeLoudness(audioBuffer, {
          startTime: sampleStart,
          endTime: sampleEnd,
        });
        const gain = calculateNormalizationGain(analysis, options.normalizationOptions);
        normalizationGains.set(alias, gain);
      }
    }

    return {
      sampleMap,
      missingAliases,
      failedAliases,
      normalizationGains,
    };
  }

  /**
   * Preload all oto entries for a voicebank.
   *
   * Use this to warm the cache before playing phrases. This avoids
   * a network request on the first playPhrase call.
   *
   * @param voicebankId - Voicebank identifier
   */
  async preloadOtoEntries(voicebankId: string): Promise<void> {
    await this._loadOtoEntries(voicebankId);
  }

  /**
   * Preload specific audio files into the cache.
   *
   * Use this to warm the cache for samples you know will be needed.
   *
   * @param voicebankId - Voicebank identifier
   * @param filenames - Array of filenames to preload
   * @returns Map of filename to success/failure
   */
  async preloadAudioFiles(
    voicebankId: string,
    filenames: string[],
  ): Promise<Map<string, boolean>> {
    const buffers = await this._loadAudioBuffers(voicebankId, filenames);
    const results = new Map<string, boolean>();
    for (const filename of filenames) {
      results.set(filename, buffers.has(filename));
    }
    return results;
  }

  /**
   * Clear all caches.
   *
   * Call this when switching voicebanks or when memory is a concern.
   */
  clearCache(): void {
    this._otoCache.clear();
    this._audioBufferCache.clear();
  }

  /**
   * Clear cache for a specific voicebank.
   *
   * @param voicebankId - Voicebank identifier
   */
  clearVoicebankCache(voicebankId: string): void {
    // Clear oto cache
    this._otoCache.delete(voicebankId);

    // Clear audio buffer cache entries for this voicebank.
    // Collect keys first to avoid mutating the map during iteration.
    const prefix = `${voicebankId}:`;
    const keysToDelete: string[] = [];
    for (const key of this._audioBufferCache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this._audioBufferCache.delete(key);
    }
  }

  /**
   * Get cache statistics for debugging.
   */
  getCacheStats(): {
    otoEntriesCached: number;
    audioBuffersCached: number;
    audioBufferCacheMaxSize: number;
    voicebanksCached: string[];
  } {
    return {
      otoEntriesCached: Array.from(this._otoCache.values()).reduce(
        (sum, map) => sum + map.size,
        0,
      ),
      audioBuffersCached: this._audioBufferCache.size,
      audioBufferCacheMaxSize: this._audioBufferCache.maxSize,
      voicebanksCached: Array.from(this._otoCache.keys()),
    };
  }

  /**
   * Enable automatic cache invalidation when oto entries change.
   *
   * Subscribes to the global `oto-entries-changed` event dispatched by
   * ApiClient after any oto mutation. When an event fires, the oto entry
   * cache for the affected voicebank is cleared so that the next
   * `loadSamplesForPhrase` call fetches fresh data.
   *
   * Audio buffer cache entries are intentionally preserved because oto
   * edits change timing parameters, not the underlying WAV audio data.
   *
   * Call {@link disableAutoInvalidation} to unsubscribe (e.g., during
   * component teardown).
   */
  enableAutoInvalidation(): void {
    if (this._invalidationListener) {
      // Already listening
      return;
    }

    this._invalidationListener = onOtoEntriesChanged(
      (voicebankId: string, _action: OtoEntriesChangedDetail['action']) => {
        // Only clear the oto entry cache; AudioBuffers remain valid since
        // the WAV files themselves have not changed -- only timing params.
        this._otoCache.delete(voicebankId);
      },
    );
  }

  /**
   * Disable automatic cache invalidation.
   *
   * Removes the event listener registered by {@link enableAutoInvalidation}.
   * Safe to call even if auto-invalidation was never enabled.
   */
  disableAutoInvalidation(): void {
    if (this._invalidationListener) {
      offOtoEntriesChanged(this._invalidationListener);
      this._invalidationListener = null;
    }
  }

  /**
   * Load and cache oto entries for a voicebank.
   *
   * Returns a map from alias to OtoEntry for fast lookup.
   */
  private async _loadOtoEntries(
    voicebankId: string,
  ): Promise<Map<string, OtoEntry>> {
    // Check cache first
    const cached = this._otoCache.get(voicebankId);
    if (cached) {
      return cached;
    }

    // Fetch from API
    const entries = await this._api.getOtoEntries(voicebankId);

    // Build alias -> OtoEntry map
    const otoMap = new Map<string, OtoEntry>();
    for (const entry of entries) {
      otoMap.set(entry.alias, entry);
    }

    // Cache for future use
    this._otoCache.set(voicebankId, otoMap);

    return otoMap;
  }

  /**
   * Load and cache audio buffers for a list of filenames.
   *
   * Loads files in parallel and caches successful results.
   * Failed loads are logged but don't throw.
   */
  private async _loadAudioBuffers(
    voicebankId: string,
    filenames: string[],
  ): Promise<Map<string, AudioBuffer>> {
    const results = new Map<string, AudioBuffer>();

    // Separate cached vs. uncached files
    const uncached: string[] = [];

    for (const filename of filenames) {
      const cacheKey = this._getAudioCacheKey(voicebankId, filename);
      const cached = this._audioBufferCache.get(cacheKey);
      if (cached) {
        results.set(filename, cached.buffer);
      } else {
        uncached.push(filename);
      }
    }

    // Load uncached files in parallel
    if (uncached.length > 0) {
      const loadPromises = uncached.map(async (filename) => {
        try {
          const buffer = await this._api.loadSampleAsAudioBuffer(
            voicebankId,
            filename,
            this._audioContext,
          );

          // Cache the result (LRU eviction happens automatically)
          const cacheKey = this._getAudioCacheKey(voicebankId, filename);
          this._audioBufferCache.set(cacheKey, { buffer });

          return { filename, buffer, success: true as const };
        } catch (error) {
          console.warn(
            `SampleLoader: Failed to load "${filename}" from voicebank "${voicebankId}":`,
            error,
          );
          return { filename, buffer: null, success: false as const };
        }
      });

      const loadResults = await Promise.all(loadPromises);

      for (const result of loadResults) {
        if (result.success && result.buffer) {
          results.set(result.filename, result.buffer);
        }
      }
    }

    return results;
  }

  /**
   * Generate cache key for audio buffer cache.
   */
  private _getAudioCacheKey(voicebankId: string, filename: string): string {
    return `${voicebankId}:${filename}`;
  }
}

/**
 * Convenience function to load samples for a phrase.
 *
 * Creates a temporary SampleLoader instance and loads samples.
 * For repeated use, create a SampleLoader instance and reuse it
 * to benefit from caching.
 *
 * @param notes - Array of phrase notes
 * @param voicebankId - Voicebank identifier
 * @param audioContext - Web Audio AudioContext
 * @param api - ApiClient instance
 * @returns LoadSamplesResult with sample map and errors
 */
export async function loadSamplesForPhrase(
  notes: PhraseNote[],
  voicebankId: string,
  audioContext: AudioContext,
  api: ApiClient,
): Promise<LoadSamplesResult> {
  const loader = new SampleLoader(audioContext, api);
  return loader.loadSamplesForPhrase(notes, voicebankId);
}
