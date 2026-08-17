export const BRIDGE_BOOT_GRACE_MS = 12_000;
export const CLERK_TOKEN_TIMEOUT_MS = 10_000;
export const BRIDGE_CONFIG_TIMEOUT_MS = 12_000;

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

export type BridgeFailureDecision = 'quiet_retry' | 'preserve_live_bridge' | 'degrade';

/** Pure retry policy shared by boot code and its node:test coverage. */
export function decideBridgeFailure(input: {
  kind: 'token_unavailable' | 'configuration_failed';
  retryCount: number;
  bridgeWasReady: boolean;
}): BridgeFailureDecision {
  const maxRetries = input.kind === 'token_unavailable' ? 4 : 2;
  if (input.retryCount < maxRetries) return 'quiet_retry';
  return input.bridgeWasReady ? 'preserve_live_bridge' : 'degrade';
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
