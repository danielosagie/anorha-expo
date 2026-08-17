export const BRIDGE_BOOT_GRACE_MS = 12_000;
export const CLERK_TOKEN_TIMEOUT_MS = 10_000;
export const BRIDGE_CONFIG_TIMEOUT_MS = 12_000;

// Receipts for the existing null-token backoff:
// base = 500ms and cap = 4,000ms, so log2(4,000 / 500) + 1 = 4 delay slots.
// Those slots are 500 + 1,000 + 2,000 + 4,000 = 7,500ms, and the fifth
// null-token attempt classifies the exhausted cycle.
export const TOKEN_RETRY_BASE_MS = 500;
export const TOKEN_RETRY_CAP_MS = 4_000;
export const TOKEN_UNAVAILABLE_RETRY_LIMIT =
  Math.log2(TOKEN_RETRY_CAP_MS / TOKEN_RETRY_BASE_MS) + 1;
export const TOKEN_FULL_BACKOFF_ELAPSED_MS = Array.from(
  { length: TOKEN_UNAVAILABLE_RETRY_LIMIT },
  (_value, retryCount) => tokenRetryDelayMs(retryCount),
).reduce((elapsedMs, delayMs) => elapsedMs + delayMs, 0);

// Receipt: 12,000ms boot grace - 7,500ms full backoff - one 500ms base-delay
// safety margin = a 4,000ms reachability budget. The positive verdict therefore
// lands by 7,500 + 4,000 = 11,500ms, leaving 500ms inside the boot grace.
export const BACKEND_REACHABILITY_TIMEOUT_MS =
  BRIDGE_BOOT_GRACE_MS - TOKEN_FULL_BACKOFF_ELAPSED_MS - TOKEN_RETRY_BASE_MS;

export function tokenRetryDelayMs(retryCount: number): number {
  return Math.min(Math.pow(2, retryCount) * TOKEN_RETRY_BASE_MS, TOKEN_RETRY_CAP_MS);
}

export type BootSurface = 'ready' | 'connecting' | 'reconnect' | 'signed_out';

export type BootGateSnapshot = {
  surface: BootSurface;
  deadlineAt: number | null;
  remainingMs: number;
};

/**
 * Process-lifetime boot deadline. React component remounts re-read this store instead
 * of starting a fresh timer, so a remount can never extend the quiet boot window.
 */
export class BridgeBootGate {
  private deadlineAt: number | null = null;
  private reconnectLatched = false;
  private hasBeenReady = false;

  observe(input: { isSignedIn: boolean; bridgeReady: boolean; now: number }): BootGateSnapshot {
    const { isSignedIn, bridgeReady, now } = input;

    if (!isSignedIn) {
      this.reset();
      return { surface: 'signed_out', deadlineAt: null, remainingMs: 0 };
    }

    if (bridgeReady) {
      this.hasBeenReady = true;
      this.reconnectLatched = false;
      return { surface: 'ready', deadlineAt: this.deadlineAt, remainingMs: 0 };
    }

    // A live session that drops its bridge should fail loud immediately. Initial boot
    // gets one grace window; a ready->false flap must not buy another one.
    if (this.hasBeenReady) {
      this.reconnectLatched = true;
    }

    if (this.deadlineAt == null) {
      this.deadlineAt = now + BRIDGE_BOOT_GRACE_MS;
    }

    if (this.reconnectLatched || now >= this.deadlineAt) {
      this.reconnectLatched = true;
      return { surface: 'reconnect', deadlineAt: this.deadlineAt, remainingMs: 0 };
    }

    return {
      surface: 'connecting',
      deadlineAt: this.deadlineAt,
      remainingMs: this.deadlineAt - now,
    };
  }

  reset(): void {
    this.deadlineAt = null;
    this.reconnectLatched = false;
    this.hasBeenReady = false;
  }
}

export const bridgeBootGate = new BridgeBootGate();

export type BackendReachability = 'reachable' | 'ambiguous';
export type BridgeFailureDecision =
  | 'quiet_retry'
  | 'preserve_live_bridge'
  | 'degrade'
  | 'invalid_session'
  | 'signed_out';

export type ValidationLoopDecision = {
  shouldRun: boolean;
  shouldScheduleRetry: boolean;
  shouldClearRetryTimers: boolean;
};

/** Pure gate used by every validation trigger and retry timer. */
export function decideValidationLoop(isSignedIn: boolean): ValidationLoopDecision {
  return isSignedIn
    ? { shouldRun: true, shouldScheduleRetry: true, shouldClearRetryTimers: false }
    : { shouldRun: false, shouldScheduleRetry: false, shouldClearRetryTimers: true };
}

/** Pure retry policy shared by boot code and its node:test coverage. */
export function decideBridgeFailure(input: {
  kind: 'token_unavailable' | 'configuration_failed';
  retryCount: number;
  bridgeWasReady: boolean;
  isSignedIn: boolean;
  backendReachability?: BackendReachability;
}): BridgeFailureDecision {
  if (!input.isSignedIn) return 'signed_out';

  // Receipt: configuration failures retain the existing two-retry policy. Token
  // failures use the four delay slots derived above, then classify attempt five.
  const maxRetries = input.kind === 'token_unavailable' ? TOKEN_UNAVAILABLE_RETRY_LIMIT : 2;
  if (input.retryCount < maxRetries) return 'quiet_retry';
  if (input.bridgeWasReady) return 'preserve_live_bridge';
  if (input.kind === 'token_unavailable') {
    return input.backendReachability === 'reachable' ? 'invalid_session' : 'quiet_retry';
  }
  return 'degrade';
}

/** Bound SDK/network promises that otherwise have no settlement guarantee. */
export async function settleWithin<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
