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
import { romajiToKana, kanaToRomaji } from "../utils/kana-romaji.js";

/**
 * Common alias prefix patterns used in voicebanks.
 * Japanese CV voicebanks often use "- " prefix for consonant-vowel sounds.
 * VCV voicebanks use vowel prefixes like "a ", "i ", etc.
 */
const CV_PREFIX = '- ';
const VOWELS = ['a', 'i', 'u', 'e', 'o'];

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
 * Parse a VCV alias into its vowel and CV components.
 *
 * VCV aliases follow the format "[vowel] [cv]" where the vowel is the
 * preceding vowel context (a, i, u, e, o) and cv is the consonant-vowel
 * or vowel being sung.
 *
 * @param alias - The alias to parse
 * @returns Object with vowel and cv parts, or null if not VCV format
 *
 * @example
 * parseVCVAlias('a sa')  // { vowel: 'a', cv: 'sa' }
 * parseVCVAlias('o i')   // { vowel: 'o', cv: 'i' }
 * parseVCVAlias('sa')    // null (not VCV format)
 * parseVCVAlias('- sa')  // null (CV prefix format, not VCV)
 */
function parseVCVAlias(alias: string): { vowel: string; cv: string } | null {
  const parts = alias.split(' ');
  if (parts.length === 2 && VOWELS.includes(parts[0])) {
    return { vowel: parts[0], cv: parts[1] };
  }
  return null;
}

/**
 * Find an OtoEntry for an alias, accounting for common voicebank alias format variations.
 *
 * Checks in order:
 * 1. Exact match (e.g., "ka")
 * 2. CV prefix format (e.g., "- ka")
 * 3. VCV format with vowel prefix (e.g., "a ka", "i ka", etc.)
 * 4. Kana conversion for romaji phonemes (e.g., "ku" -> "く")
 * 5. Romaji conversion for kana aliases (e.g., "く" -> "ku")
 * 6. VCV decomposition with all above fallbacks
 *
 * @param alias - The alias to look for
 * @param otoMap - Map of alias to OtoEntry
 * @param depth - Internal recursion depth tracker (prevents infinite recursion)
 * @returns The matching OtoEntry and the actual alias used, or undefined if not found
 */
function findOtoEntry(
  alias: string,
  otoMap: Map<string, OtoEntry>,
  depth = 0
): { entry: OtoEntry; actualAlias: string } | undefined {
  // Prevent infinite recursion
  if (depth > 2) {
    return undefined;
  }

  // Check exact match first
  let entry = otoMap.get(alias);
  if (entry) {
    return { entry, actualAlias: alias };
  }

  // Check CV prefix format (e.g., "- ka")
  const cvAlias = CV_PREFIX + alias;
  entry = otoMap.get(cvAlias);
  if (entry) {
    return { entry, actualAlias: cvAlias };
  }

  // Check VCV format with vowel prefix (e.g., "a ka", "i ka")
  for (const vowel of VOWELS) {
    const vcvAlias = `${vowel} ${alias}`;
    entry = otoMap.get(vcvAlias);
    if (entry) {
      return { entry, actualAlias: vcvAlias };
    }
  }

  // Try kana conversion: if alias is romaji (e.g., "ku"), check for kana (e.g., "く")
  // This is crucial for VCV songs playing on CV voicebanks with hiragana aliases
  const kana = romajiToKana(alias);
  if (kana && kana !== alias) {
    // Check exact kana match
    entry = otoMap.get(kana);
    if (entry) {
      return { entry, actualAlias: kana };
    }
    // Check with CV prefix (e.g., "- く")
    const kanaCvAlias = CV_PREFIX + kana;
    entry = otoMap.get(kanaCvAlias);
    if (entry) {
      return { entry, actualAlias: kanaCvAlias };
    }
  }

  // Try romaji conversion: if alias is kana (e.g., "く"), check for romaji (e.g., "ku")
  const romaji = kanaToRomaji(alias);
  if (romaji && romaji !== alias) {
    entry = otoMap.get(romaji);
    if (entry) {
      return { entry, actualAlias: romaji };
    }
    const romajiCvAlias = CV_PREFIX + romaji;
    entry = otoMap.get(romajiCvAlias);
    if (entry) {
      return { entry, actualAlias: romajiCvAlias };
    }
  }

  // Try dash-prefix decomposition: if alias starts with "- " (e.g., "- sa"),
  // strip the prefix and check for just the CV part (e.g., "sa").
  // This allows VCV songs with dash-prefixed phonemes to play on CV voicebanks.
  if (alias.startsWith(CV_PREFIX)) {
    const cvPart = alias.slice(CV_PREFIX.length);
    if (cvPart) {
      const cvResult = findOtoEntry(cvPart, otoMap, depth + 1);
      if (cvResult) {
        return cvResult;
      }
    }
  }

  // Try VCV decomposition: if alias is VCV format (e.g., "a sa"),
  // try to find just the CV part (e.g., "sa" or "- sa") as a fallback.
  // This allows VCV songs to play on CV voicebanks with graceful degradation.
  const vcvParts = parseVCVAlias(alias);
  if (vcvParts) {
    // Recursively search for just the CV part
    // This will check exact match, CV prefix, VCV variants, AND kana conversion
    const cvResult = findOtoEntry(vcvParts.cv, otoMap, depth + 1);
    if (cvResult) {
      return cvResult;
    }
  }

  return undefined;
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
 * Cached audio buffer entry with timestamp for potential TTL eviction.
 */
interface CachedAudioBuffer {
  buffer: AudioBuffer;
  cachedAt: number;
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
   * Cache of decoded AudioBuffers.
   * Maps "voicebankId:filename" -> CachedAudioBuffer
   */
  private readonly _audioBufferCache: Map<string, CachedAudioBuffer> =
    new Map();

  /**
   * Create a new SampleLoader.
   *
   * @param audioContext - Web Audio AudioContext for decoding audio
   * @param api - ApiClient instance for fetching data from backend
   */
  constructor(audioContext: AudioContext, api: ApiClient) {
    this._audioContext = audioContext;
    this._api = api;
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

    // Clear audio buffer cache entries for this voicebank
    const prefix = `${voicebankId}:`;
    for (const key of this._audioBufferCache.keys()) {
      if (key.startsWith(prefix)) {
        this._audioBufferCache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics for debugging.
   */
  getCacheStats(): {
    otoEntriesCached: number;
    audioBuffersCached: number;
    voicebanksCached: string[];
  } {
    return {
      otoEntriesCached: Array.from(this._otoCache.values()).reduce(
        (sum, map) => sum + map.size,
        0,
      ),
      audioBuffersCached: this._audioBufferCache.size,
      voicebanksCached: Array.from(this._otoCache.keys()),
    };
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

          // Cache the result
          const cacheKey = this._getAudioCacheKey(voicebankId, filename);
          this._audioBufferCache.set(cacheKey, {
            buffer,
            cachedAt: Date.now(),
          });

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
