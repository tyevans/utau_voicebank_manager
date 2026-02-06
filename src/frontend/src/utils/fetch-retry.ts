/**
 * Fetch wrapper with exponential backoff retry logic.
 *
 * Retries on transient server errors (5xx) and rate limiting (429).
 * Does NOT retry on client errors (4xx except 429) or network errors
 * (TypeError from fetch, which indicates offline/DNS failure).
 *
 * Respects the Retry-After header on 429 responses when present.
 */

/**
 * Configuration for retry behavior.
 */
export interface RetryOptions {
  /** Maximum number of retry attempts. Defaults to 3. */
  maxRetries?: number;

  /** Base delay in milliseconds for exponential backoff. Defaults to 1000. */
  baseDelayMs?: number;

  /** Maximum jitter in milliseconds added to each delay. Defaults to 500. */
  maxJitterMs?: number;

  /**
   * Set to true to disable retries for this request.
   * Useful for mutations that should not be repeated (e.g., payment, delete).
   */
  noRetry?: boolean;
}

/**
 * Default retry configuration.
 */
const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'noRetry'>> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxJitterMs: 500,
};

/**
 * HTTP status codes that are eligible for retry.
 *
 * - 429: Too Many Requests (rate limited)
 * - 500: Internal Server Error
 * - 502: Bad Gateway
 * - 503: Service Unavailable
 * - 504: Gateway Timeout
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Parse the Retry-After header value into milliseconds.
 *
 * The header can be either:
 * - A number of seconds (e.g., "120")
 * - An HTTP-date (e.g., "Wed, 21 Oct 2015 07:28:00 GMT")
 *
 * Returns null if the header is missing or unparseable.
 */
function parseRetryAfterMs(response: Response): number | null {
  const header = response.headers.get('Retry-After');
  if (!header) {
    return null;
  }

  // Try parsing as a number of seconds
  const seconds = Number(header);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  // Try parsing as an HTTP-date
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    const delayMs = date - Date.now();
    return delayMs > 0 ? delayMs : 0;
  }

  return null;
}

/**
 * Calculate the delay for a given retry attempt using exponential backoff
 * with random jitter.
 *
 * Delay = baseDelay * 2^attempt + random(0, maxJitter)
 *
 * For default settings (base=1000, jitter=0-500):
 * - Attempt 0: 1000-1500ms
 * - Attempt 1: 2000-2500ms
 * - Attempt 2: 4000-4500ms
 */
function calculateBackoffMs(
  attempt: number,
  baseDelayMs: number,
  maxJitterMs: number,
): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * maxJitterMs;
  return exponentialDelay + jitter;
}

/**
 * Sleep for the specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with automatic retry on transient failures.
 *
 * Wraps the global fetch with exponential backoff retry logic.
 * Only retries on 5xx server errors and 429 rate limiting.
 * Never retries on 4xx client errors (except 429) or network errors.
 *
 * @param input - The fetch URL or Request
 * @param init - Standard fetch RequestInit options
 * @param retryOptions - Retry configuration (optional)
 * @returns The fetch Response
 *
 * @example
 * ```typescript
 * // Basic usage - retries up to 3 times on server errors
 * const response = await fetchWithRetry('/api/data');
 *
 * // Disable retries for a destructive mutation
 * const response = await fetchWithRetry('/api/delete', { method: 'DELETE' }, { noRetry: true });
 *
 * // Custom retry config
 * const response = await fetchWithRetry('/api/data', {}, { maxRetries: 5, baseDelayMs: 500 });
 * ```
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  retryOptions?: RetryOptions,
): Promise<Response> {
  // If retries are explicitly disabled, pass through to fetch directly
  if (retryOptions?.noRetry) {
    return fetch(input, init);
  }

  const {
    maxRetries,
    baseDelayMs,
    maxJitterMs,
  } = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions };

  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response;

    try {
      response = await fetch(input, init);
    } catch (error) {
      // Network errors (TypeError) indicate the browser cannot reach the server.
      // Retrying immediately is unlikely to help (offline, DNS failure, CORS block).
      // Throw immediately so the caller can show an appropriate offline message.
      throw error;
    }

    // If the response is successful or a non-retryable error, return immediately
    if (response.ok || !isRetryableStatus(response.status)) {
      return response;
    }

    // Store the last response in case we exhaust retries
    lastResponse = response;

    // If we have retries remaining, wait and try again
    if (attempt < maxRetries) {
      // For 429 responses, prefer the server-specified Retry-After delay
      let delayMs: number;
      if (response.status === 429) {
        const retryAfterMs = parseRetryAfterMs(response);
        delayMs = retryAfterMs ?? calculateBackoffMs(attempt, baseDelayMs, maxJitterMs);
      } else {
        delayMs = calculateBackoffMs(attempt, baseDelayMs, maxJitterMs);
      }

      // Consume the error response body to free the connection
      try {
        await response.text();
      } catch {
        // Ignore body read errors
      }

      await sleep(delayMs);
    }
  }

  // All retries exhausted, return the last response for the caller to handle
  return lastResponse!;
}
