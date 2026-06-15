/**
 * One exponential-backoff retry helper.
 *
 * Replaces the hand-rolled `retryCount < max` / `Math.pow(2, n)` loops that were
 * copy-pasted across the realtime, auth, and polling paths. Bounded by default
 * (a rejected call must NOT retry forever) with jitter to avoid thundering-herd
 * reconnects.
 */
export interface RetryOptions {
  /** Total attempts including the first. Default 3. */
  maxAttempts?: number;
  /** Delay before the 2nd attempt, in ms. Default 1000. */
  initialDelayMs?: number;
  /** Multiplier applied each subsequent attempt. Default 2 (exponential). */
  backoffMultiplier?: number;
  /** Upper bound on any single delay, in ms. Default 30000. */
  maxDelayMs?: number;
  /** Apply +/- random jitter to each delay. Default true. */
  jitter?: boolean;
  /** Return false to stop retrying a specific error (e.g. a 4xx). */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Observe each retry (logging/telemetry). */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Abort in-flight waits. */
  signal?: AbortSignal;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    backoffMultiplier = 2,
    maxDelayMs = 30000,
    jitter = true,
    shouldRetry,
    onRetry,
    signal,
  } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw signal.reason ?? new Error('Aborted');
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const isLast = attempt >= maxAttempts;
      if (isLast || (shouldRetry && !shouldRetry(err, attempt))) break;

      const base = Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt - 1), maxDelayMs);
      const delay = jitter ? Math.round(base * (0.5 + Math.random() / 2)) : base;
      onRetry?.(err, attempt, delay);

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        if (signal) {
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(signal.reason ?? new Error('Aborted'));
            },
            { once: true },
          );
        }
      });
    }
  }
  throw lastError;
}
