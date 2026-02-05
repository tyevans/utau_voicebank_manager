/**
 * LRU cache for processed (pitch-shifted) AudioBuffers.
 *
 * Stores PSOLA-processed AudioBuffers keyed by a combination of the
 * source buffer identity and processing parameters. Uses Map insertion
 * order for LRU eviction.
 *
 * @example
 * ```typescript
 * const cache = new ProcessedBufferCache(100);
 * const hash = ProcessedBufferCache.hashBuffer(audioBuffer);
 * const key = ProcessedBufferCache.makeKey(hash, 5, 1.0);
 *
 * if (!cache.has(key)) {
 *   const processed = await processWithPSOLA(audioBuffer, 5);
 *   cache.set(key, processed);
 * }
 *
 * const result = cache.get(key)!;
 * ```
 */
export class ProcessedBufferCache {
  private _cache = new Map<string, AudioBuffer>();
  private _maxSize: number;

  /**
   * Create a new ProcessedBufferCache.
   *
   * @param maxSize - Maximum number of entries before LRU eviction (default: 100)
   */
  constructor(maxSize = 100) {
    this._maxSize = maxSize;
  }

  /**
   * Generate a cache key from buffer identity and processing parameters.
   *
   * @param bufferHash - Hash string identifying the source AudioBuffer
   * @param pitchShift - Pitch shift in semitones
   * @param timeStretch - Time stretch factor
   * @param preserveFormants - Whether formant preservation is enabled (default: false)
   * @param formantScale - Formant scaling factor (default: 0.0)
   * @returns Composite cache key string
   */
  static makeKey(
    bufferHash: string,
    pitchShift: number,
    timeStretch: number,
    preserveFormants: boolean = false,
    formantScale: number = 0.0,
  ): string {
    // Round to avoid floating-point key mismatches
    const ps = Math.round(pitchShift * 100) / 100;
    const ts = Math.round(timeStretch * 1000) / 1000;
    const fs = Math.round(formantScale * 100) / 100;
    // Only include formant params in key when active, to maintain backward
    // compatibility with existing cache entries that lack these fields.
    const formantSuffix = preserveFormants ? `|fp=1|fs=${fs}` : '';
    return `${bufferHash}|ps=${ps}|ts=${ts}${formantSuffix}`;
  }

  /**
   * Hash an AudioBuffer for cache identity.
   *
   * Uses a fast fingerprint from the first 128 samples combined with
   * length and sampleRate. This is NOT a cryptographic hash -- it is
   * designed for speed with low collision probability on real audio.
   *
   * @param audioBuffer - The AudioBuffer to fingerprint
   * @returns Hash string suitable for use as a cache key component
   */
  static hashBuffer(audioBuffer: AudioBuffer): string {
    const channelData = audioBuffer.getChannelData(0);
    const sampleCount = Math.min(128, channelData.length);
    let hash = channelData.length ^ (audioBuffer.sampleRate * 31);

    for (let i = 0; i < sampleCount; i++) {
      const bits = Math.round(channelData[i] * 1e6);
      hash = ((hash << 5) - hash + bits) | 0;
    }

    return `${hash}_${channelData.length}_${audioBuffer.sampleRate}`;
  }

  /**
   * Retrieve a cached buffer, refreshing its LRU position.
   *
   * @param key - Cache key from makeKey()
   * @returns The cached AudioBuffer, or undefined if not found
   */
  get(key: string): AudioBuffer | undefined {
    const buffer = this._cache.get(key);
    if (buffer !== undefined) {
      // Move to end (LRU refresh)
      this._cache.delete(key);
      this._cache.set(key, buffer);
    }
    return buffer;
  }

  /**
   * Store a processed buffer in the cache.
   *
   * If the cache is at capacity, the least-recently-used entry is evicted.
   *
   * @param key - Cache key from makeKey()
   * @param buffer - The processed AudioBuffer to cache
   */
  set(key: string, buffer: AudioBuffer): void {
    // If key already exists, delete it first so re-insertion moves it to end
    if (this._cache.has(key)) {
      this._cache.delete(key);
    }

    // Evict oldest if at capacity
    if (this._cache.size >= this._maxSize) {
      const oldest = this._cache.keys().next().value;
      if (oldest !== undefined) {
        this._cache.delete(oldest);
      }
    }

    this._cache.set(key, buffer);
  }

  /**
   * Check if a key exists in the cache (does NOT refresh LRU position).
   *
   * @param key - Cache key to check
   * @returns true if the key exists in the cache
   */
  has(key: string): boolean {
    return this._cache.has(key);
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this._cache.clear();
  }

  /**
   * Number of entries currently in the cache.
   */
  get size(): number {
    return this._cache.size;
  }
}
