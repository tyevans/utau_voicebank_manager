/**
 * AudioProcessorClient - Main-thread client for the PSOLA Web Worker.
 *
 * Provides a Promise-based API for sending audio to the Web Worker for
 * PSOLA processing and receiving the pitch-shifted result. Handles
 * worker lifecycle, message correlation, and AudioBuffer reconstruction.
 *
 * Uses Vite's native Web Worker support for module bundling.
 *
 * @example
 * ```typescript
 * const client = new AudioProcessorClient();
 *
 * // Single buffer processing
 * const shifted = await client.process(audioBuffer, { pitchShift: 5 });
 *
 * // Batch processing with deduplication
 * const results = await client.processBatch([
 *   { audioBuffer: buf1, pitchShift: 3, cacheKey: 'ka_+3' },
 *   { audioBuffer: buf2, pitchShift: 5, cacheKey: 'sa_+5' },
 * ]);
 *
 * // Cleanup (waits for in-flight work to finish, with timeout)
 * await client.dispose();
 * ```
 */
export class AudioProcessorClient {
  /** Timeout in ms to wait for pending requests during graceful shutdown. */
  static readonly DISPOSE_TIMEOUT_MS = 2000;

  private _worker: Worker;
  private _pending = new Map<
    string,
    {
      resolve: (value: { channelData: Float32Array; sampleRate: number }) => void;
      reject: (reason: Error) => void;
    }
  >();
  private _disposed = false;
  /** True once dispose() has been called but before the worker is terminated. */
  private _disposing = false;
  /** Cached promise from the first dispose() call so concurrent callers share the same lifecycle. */
  private _disposePromise: Promise<void> | null = null;

  constructor() {
    this._worker = new Worker(
      new URL('./audio-processor.worker.ts', import.meta.url),
      { type: 'module' }
    );

    this._worker.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { type: 'result'; id: string; channelData: Float32Array; sampleRate: number }
        | { type: 'error'; id: string; message: string };

      const pending = this._pending.get(data.id);
      if (!pending) {
        console.warn(`AudioProcessorClient: received response for unknown request ${data.id}`);
        return;
      }

      this._pending.delete(data.id);

      if (data.type === 'result') {
        pending.resolve({
          channelData: data.channelData,
          sampleRate: data.sampleRate,
        });
      } else {
        pending.reject(new Error(data.message));
      }
    };

    this._worker.onerror = (event: ErrorEvent) => {
      console.error('AudioProcessorClient: worker error', event.message);
      // Reject all pending requests
      for (const [id, pending] of this._pending) {
        pending.reject(new Error(`Worker error: ${event.message}`));
        this._pending.delete(id);
      }
    };
  }

  /**
   * Whether this client has been fully disposed (worker terminated).
   */
  get disposed(): boolean {
    return this._disposed;
  }

  /**
   * Whether this client is in the process of shutting down.
   * New requests are rejected once disposing begins.
   */
  get disposing(): boolean {
    return this._disposing;
  }

  /**
   * Process audio through PSOLA in the worker.
   *
   * Extracts channel data from the input AudioBuffer, sends it to the
   * worker for PSOLA processing, and reconstructs a new AudioBuffer
   * from the result.
   *
   * @param audioBuffer - Source AudioBuffer to process
   * @param options - Processing parameters
   * @returns Promise resolving to a new AudioBuffer with pitch shift applied
   * @throws Error if the worker encounters a processing error
   */
  async process(
    audioBuffer: AudioBuffer,
    options: {
      pitchShift: number;
      timeStretch?: number;
      /** Preserve formants during PSOLA pitch shifting (default: false) */
      preserveFormants?: boolean;
      /** Formant scaling factor 0.0-1.0 (default: 0.0 = full preservation) */
      formantScale?: number;
    }
  ): Promise<AudioBuffer> {
    if (this._disposed || this._disposing) {
      throw new Error('AudioProcessorClient has been disposed');
    }

    const pitchShift = options.pitchShift;
    const timeStretch = options.timeStretch ?? 1.0;
    const preserveFormants = options.preserveFormants ?? false;
    const formantScale = options.formantScale ?? 0.0;

    // Fast path: no processing needed
    if (pitchShift === 0 && timeStretch === 1.0) {
      return audioBuffer;
    }

    // Extract channel data (copy into a fresh ArrayBuffer, since we'll transfer it)
    const inputData = new Float32Array(new ArrayBuffer(audioBuffer.length * 4));
    audioBuffer.copyFromChannel(inputData, 0);

    const id = crypto.randomUUID();
    const sampleRate = audioBuffer.sampleRate;

    // Send to worker with transferable
    const result = await this._sendRequest(id, inputData, sampleRate, pitchShift, timeStretch, preserveFormants, formantScale);

    // Reconstruct AudioBuffer from result
    const outputBuffer = new AudioBuffer({
      numberOfChannels: 1,
      length: result.channelData.length,
      sampleRate: result.sampleRate,
    });
    // Ensure the data is backed by a plain ArrayBuffer (not SharedArrayBuffer)
    // for compatibility with copyToChannel's strict type signature.
    const outputData = new Float32Array(new ArrayBuffer(result.channelData.length * 4));
    outputData.set(result.channelData);
    outputBuffer.copyToChannel(outputData, 0);

    return outputBuffer;
  }

  /**
   * Process multiple audio buffers in parallel through the worker.
   *
   * More efficient than calling process() in a loop because it:
   * - Deduplicates requests with the same cacheKey
   * - Sends all unique requests without waiting for individual responses
   * - Returns a Map keyed by cacheKey for easy lookup
   *
   * @param requests - Array of processing requests with cache keys
   * @returns Map from cacheKey to processed AudioBuffer
   * @throws Error if any individual request fails (all-or-nothing)
   */
  async processBatch(
    requests: Array<{
      audioBuffer: AudioBuffer;
      pitchShift: number;
      timeStretch?: number;
      /** Preserve formants during PSOLA pitch shifting (default: false) */
      preserveFormants?: boolean;
      /** Formant scaling factor 0.0-1.0 (default: 0.0 = full preservation) */
      formantScale?: number;
      cacheKey: string;
    }>
  ): Promise<Map<string, AudioBuffer>> {
    if (this._disposed || this._disposing) {
      throw new Error('AudioProcessorClient has been disposed');
    }

    const results = new Map<string, AudioBuffer>();

    // Deduplicate by cacheKey
    const uniqueRequests = new Map<
      string,
      {
        audioBuffer: AudioBuffer;
        pitchShift: number;
        timeStretch: number;
        preserveFormants: boolean;
        formantScale: number;
      }
    >();

    for (const req of requests) {
      if (!uniqueRequests.has(req.cacheKey)) {
        uniqueRequests.set(req.cacheKey, {
          audioBuffer: req.audioBuffer,
          pitchShift: req.pitchShift,
          timeStretch: req.timeStretch ?? 1.0,
          preserveFormants: req.preserveFormants ?? false,
          formantScale: req.formantScale ?? 0.0,
        });
      }
    }

    // Send all unique requests in parallel
    const promises: Array<{ cacheKey: string; promise: Promise<AudioBuffer> }> = [];

    for (const [cacheKey, req] of uniqueRequests) {
      const { audioBuffer, pitchShift, timeStretch, preserveFormants, formantScale } = req;

      // Fast path: no processing needed
      if (pitchShift === 0 && timeStretch === 1.0) {
        results.set(cacheKey, audioBuffer);
        continue;
      }

      const inputData = new Float32Array(new ArrayBuffer(audioBuffer.length * 4));
      audioBuffer.copyFromChannel(inputData, 0);

      const id = crypto.randomUUID();
      const sampleRate = audioBuffer.sampleRate;

      const promise = this._sendRequest(id, inputData, sampleRate, pitchShift, timeStretch, preserveFormants, formantScale)
        .then((result) => {
          const outputBuffer = new AudioBuffer({
            numberOfChannels: 1,
            length: result.channelData.length,
            sampleRate: result.sampleRate,
          });
          const outputData = new Float32Array(new ArrayBuffer(result.channelData.length * 4));
          outputData.set(result.channelData);
          outputBuffer.copyToChannel(outputData, 0);
          return outputBuffer;
        });

      promises.push({ cacheKey, promise });
    }

    // Await all pending requests
    const settled = await Promise.allSettled(
      promises.map(async ({ cacheKey, promise }) => {
        const buffer = await promise;
        results.set(cacheKey, buffer);
      })
    );

    // Check for failures
    const failures = settled.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      const reasons = failures
        .map((r) => (r as PromiseRejectedResult).reason)
        .map((e) => (e instanceof Error ? e.message : String(e)));
      console.error(`AudioProcessorClient: ${failures.length} batch requests failed:`, reasons);
      // Don't throw -- return partial results so playback can proceed
      // with fallback to playback-rate shifting for failed entries
    }

    return results;
  }

  /**
   * Gracefully shut down the worker.
   *
   * New requests are rejected immediately. The method waits for in-flight
   * requests to complete (up to `DISPOSE_TIMEOUT_MS`). After the timeout
   * or once all pending requests resolve, the worker is terminated and any
   * remaining pending requests are rejected.
   *
   * Safe to call multiple times -- subsequent calls return the same promise.
   *
   * @returns Promise that resolves once the worker has been terminated.
   */
  dispose(): Promise<void> {
    if (this._disposed) {
      return Promise.resolve();
    }

    // Deduplicate concurrent dispose() calls
    if (this._disposePromise) {
      return this._disposePromise;
    }

    this._disposing = true;

    this._disposePromise = this._drainAndTerminate();
    return this._disposePromise;
  }

  /**
   * Wait for pending requests to drain (with timeout), then terminate the worker.
   */
  private async _drainAndTerminate(): Promise<void> {
    // If there are pending requests, give them time to finish
    if (this._pending.size > 0) {
      await Promise.race([
        this._waitForAllPending(),
        this._timeout(AudioProcessorClient.DISPOSE_TIMEOUT_MS),
      ]);
    }

    // Terminate the worker -- this stops all in-flight processing
    this._worker.terminate();

    // Reject any requests that did not complete before the deadline
    for (const [, pending] of this._pending) {
      pending.reject(new Error('AudioProcessorClient disposed (shutdown timeout)'));
    }
    this._pending.clear();

    this._disposed = true;
    this._disposing = false;
  }

  /**
   * Returns a promise that resolves when all currently pending requests
   * have settled (resolved or rejected by the worker).
   */
  private _waitForAllPending(): Promise<void> {
    if (this._pending.size === 0) {
      return Promise.resolve();
    }

    // Wrap each pending entry's resolution in a promise we can track.
    // We cannot simply collect the existing promises because they are
    // stored as resolve/reject callbacks, not as Promises. Instead, we
    // intercept each pending entry so that it also resolves a shared
    // drain signal.
    return new Promise<void>((drainResolve) => {
      let remaining = this._pending.size;

      const onSettle = () => {
        remaining--;
        if (remaining <= 0) {
          drainResolve();
        }
      };

      for (const [id, entry] of this._pending) {
        const origResolve = entry.resolve;
        const origReject = entry.reject;

        entry.resolve = (value) => {
          origResolve(value);
          onSettle();
        };
        entry.reject = (reason) => {
          origReject(reason);
          onSettle();
        };

        // Re-set the wrapped entry (same reference, but be explicit)
        this._pending.set(id, entry);
      }
    });
  }

  /**
   * Returns a promise that resolves after `ms` milliseconds.
   */
  private _timeout(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Send a processing request to the worker and return a promise for the result.
   */
  private _sendRequest(
    id: string,
    channelData: Float32Array,
    sampleRate: number,
    pitchShift: number,
    timeStretch: number,
    preserveFormants: boolean = false,
    formantScale: number = 0.0,
  ): Promise<{ channelData: Float32Array; sampleRate: number }> {
    if (this._disposing || this._disposed) {
      return Promise.reject(new Error('AudioProcessorClient has been disposed'));
    }

    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });

      const message = {
        type: 'process' as const,
        id,
        channelData,
        sampleRate,
        pitchShift,
        timeStretch,
        preserveFormants,
        formantScale,
      };

      // Transfer the channelData buffer for zero-copy send
      this._worker.postMessage(message, [channelData.buffer]);
    });
  }
}
