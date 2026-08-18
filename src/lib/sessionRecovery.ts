export const SESSION_WATCHDOG_DELAYS_MS = [8_000, 16_000, 32_000] as const;
export const SESSION_WATCHDOG_MAX_ATTEMPTS = SESSION_WATCHDOG_DELAYS_MS.length;

type CleanSessionMarkers = {
  configured: false;
  ready: false;
  bridgeReady: false;
  sessionMode: 'cached';
  usingCachedSession: false;
  user: null;
  entitlements: null;
  bootstrapError: null;
  lastReadyAt: null;
  invalidSessionInFlight: false;
};

const CLEAN_SESSION_MARKERS: CleanSessionMarkers = {
  configured: false,
  ready: false,
  bridgeReady: false,
  sessionMode: 'cached',
  usingCachedSession: false,
  user: null,
  entitlements: null,
  bootstrapError: null,
  lastReadyAt: null,
  invalidSessionInFlight: false,
};

export type SessionTransitionPlan =
  | { action: 'none' }
  | ({ action: 'reset'; clearPersistedAuth: false; initializing: false } & CleanSessionMarkers)
  | ({ action: 'bootstrap'; forceValidation: true; initializing: true } & CleanSessionMarkers);

export type SessionWatchdogDecision =
  | { action: 'inactive' | 'waiting' | 'exhausted' }
  | { action: 'schedule'; attemptIndex: number; attemptNumber: number; delayMs: number };

/**
 * Process-local policy for sign-in transitions and bounded stranded-session recovery.
 * React owns the timers and state mutations. This class owns only deterministic
 * transition history and the watchdog attempt budget.
 */
export class SessionRecoveryPolicy {
  private previousSignedIn: boolean | undefined;
  private watchdogAttempts = 0;

  observeSignIn(isSignedIn: boolean): SessionTransitionPlan {
    const previous = this.previousSignedIn;
    this.previousSignedIn = isSignedIn;

    if (!isSignedIn) {
      this.resetWatchdog();
      return {
        action: 'reset',
        clearPersistedAuth: false,
        initializing: false,
        ...CLEAN_SESSION_MARKERS,
      };
    }

    if (previous === false) {
      this.resetWatchdog();
      return {
        action: 'bootstrap',
        forceValidation: true,
        initializing: true,
        ...CLEAN_SESSION_MARKERS,
      };
    }

    return { action: 'none' };
  }

  observeWatchdog(input: {
    isSignedIn: boolean;
    ready: boolean;
    bootstrapError: string | null;
    validationInFlight: boolean;
  }): SessionWatchdogDecision {
    if (!input.isSignedIn || input.ready || !input.bootstrapError) {
      this.resetWatchdog();
      return { action: 'inactive' };
    }

    if (input.validationInFlight) {
      return { action: 'waiting' };
    }

    const delayMs = SESSION_WATCHDOG_DELAYS_MS[this.watchdogAttempts];
    if (delayMs == null) {
      return { action: 'exhausted' };
    }

    return {
      action: 'schedule',
      attemptIndex: this.watchdogAttempts,
      attemptNumber: this.watchdogAttempts + 1,
      delayMs,
    };
  }

  recordWatchdogAttempt(attemptIndex: number): boolean {
    if (attemptIndex !== this.watchdogAttempts || this.watchdogAttempts >= SESSION_WATCHDOG_MAX_ATTEMPTS) {
      return false;
    }

    this.watchdogAttempts += 1;
    return true;
  }

  resetWatchdog(): void {
    this.watchdogAttempts = 0;
  }
}
