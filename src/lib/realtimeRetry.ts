export const PLATFORM_CONNECTION_REALTIME_MAX_RETRIES = 3;

export function realtimeRetryDelayMs(retryIndex: number): number {
  return Math.min(1000 * (2 ** Math.max(0, retryIndex)), 10_000);
}

export function nextRealtimeRetry(
  retriesScheduled: number,
  maxRetries = PLATFORM_CONNECTION_REALTIME_MAX_RETRIES,
): { terminal: true } | { terminal: false; attempt: number; delayMs: number } {
  if (retriesScheduled >= maxRetries) return { terminal: true };
  return {
    terminal: false,
    attempt: retriesScheduled + 1,
    delayMs: realtimeRetryDelayMs(retriesScheduled),
  };
}
