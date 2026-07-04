// platformConnectStatus — the ONE definition of "is this platform connected".
//
// A platform is FULLY connected only when every step in connectStepsFor() is
// done: the OAuth marker exists AND (for computer-write platforms like Facebook)
// the user's computer is linked. This replaces the old per-screen connectedKeys
// predicate that marked Facebook "Connected" the instant the OAuth row existed,
// ignoring the computer — the source of the "connected but no computer" confusion.
//
// Pure and framework-free so the connect list, the connect flow, and the publish
// pre-flight all read the same truth. The hook wrapper is usePlatformConnectStatus.

import {
  connectStepsFor,
  resolvePlatformKey,
  type ConnectStepKind,
} from '../config/platforms';
import type { PlatformConnectionRow } from '../context/PlatformConnectionsContext';

// Statuses that mean a connection row is NOT a live marker (mirrors the old
// ConnectPlatformsScreen.connectedKeys set — kept identical on purpose).
const NOT_CONNECTED = new Set(['disconnected', 'error', 'revoked', 'disabled', 'needs_reauth']);

/** Live computer-presence signal (from useFacebookJobStatus). */
export interface ComputerPresence {
  computerOnline: boolean;
  /** False while the first presence result is still loading — do not read
   *  computerOnline=false as "offline" until this is true. */
  presenceLoaded: boolean;
}

export interface PlatformConnectStatus {
  /** The steps this platform requires (e.g. Facebook = ['oauth','linkComputer']). */
  steps: ConnectStepKind[];
  /** A live (non-dead) connection row exists for this platform. */
  oauthConnected: boolean;
  /** This platform posts through the user's computer. */
  requiresComputer: boolean;
  computerOnline: boolean;
  /** Presence has loaded, so computerOnline is trustworthy. */
  computerKnown: boolean;
  /** Every required step is satisfied. */
  isFullyConnected: boolean;
  /** Steps still to do, in order. */
  pendingSteps: ConnectStepKind[];
  /** The next step to run, if any. */
  nextStep?: ConnectStepKind;
  /**
   * What the row/pill should show:
   *   'connected'      → all steps done (or computer status still loading).
   *   'needs-computer' → OAuth done, computer required and KNOWN offline.
   *   'not-connected'  → no OAuth marker yet.
   */
  uiState: 'connected' | 'needs-computer' | 'not-connected';
}

export function derivePlatformConnectStatus(
  platform: string,
  liveConnections: PlatformConnectionRow[] | null | undefined,
  presence: ComputerPresence,
): PlatformConnectStatus {
  const key = resolvePlatformKey(platform);
  const steps = connectStepsFor(platform);
  const oauthConnected =
    !!key &&
    (liveConnections || []).some((c) => {
      const status = (c.Status || '').toLowerCase();
      if (NOT_CONNECTED.has(status) || c.IsEnabled === false) return false;
      return resolvePlatformKey(c.PlatformType) === key;
    });

  const requiresComputer = steps.includes('linkComputer');
  const computerOnline = !!presence.computerOnline;
  const computerKnown = !!presence.presenceLoaded;

  const stepDone = (s: ConnectStepKind) => (s === 'oauth' ? oauthConnected : computerOnline);
  const pendingSteps = steps.filter((s) => !stepDone(s));

  // Only flag 'needs-computer' once presence has loaded, so a connected row does
  // not flash the warning while the presence query is still in flight.
  const knownComputerOffline = requiresComputer && computerKnown && !computerOnline;
  const uiState: PlatformConnectStatus['uiState'] = !oauthConnected
    ? 'not-connected'
    : knownComputerOffline
      ? 'needs-computer'
      : 'connected';

  return {
    steps,
    oauthConnected,
    requiresComputer,
    computerOnline,
    computerKnown,
    // "Fully connected" for UI = the pill shows green. During presence loading we
    // stay optimistic (a just-linked computer shouldn't flicker to not-connected).
    isFullyConnected: uiState === 'connected' && steps.length > 0,
    pendingSteps,
    nextStep: pendingSteps[0],
    uiState,
  };
}
