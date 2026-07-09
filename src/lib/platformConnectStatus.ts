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
   *   'connected'      → every required step done (OAuth, and computer online when required).
   *   'needs-reauth'   → a connection row exists, but its authorization is broken.
   *   'needs-computer' → OAuth done, computer required and KNOWN offline.
   *   'checking'       → OAuth done, computer required, presence still loading (do NOT claim green).
   *   'not-connected'  → no OAuth marker yet.
   */
  uiState: 'connected' | 'needs-reauth' | 'needs-computer' | 'checking' | 'not-connected';
  /** Short action for a broken authorization. */
  ctaLabel?: 'Reconnect';
}

export function derivePlatformConnectStatus(
  platform: string,
  liveConnections: PlatformConnectionRow[] | null | undefined,
  presence: ComputerPresence,
): PlatformConnectStatus {
  const key = resolvePlatformKey(platform);
  const steps = connectStepsFor(platform);
  const matchingConnections = key
    ? (liveConnections || []).filter((c) => resolvePlatformKey(c.PlatformType) === key)
    : [];
  const oauthConnected =
    !!key &&
    matchingConnections.some((c) => {
      const status = (c.Status || '').toLowerCase();
      if (NOT_CONNECTED.has(status) || c.IsEnabled === false) return false;
      return c.NeedsReauth !== true;
    });
  const needsReauth =
    !oauthConnected &&
    matchingConnections.some((c) =>
      (c.Status || '').toLowerCase() === 'error' || c.NeedsReauth === true,
    );

  const requiresComputer = steps.includes('linkComputer');
  const computerOnline = !!presence.computerOnline;
  const computerKnown = !!presence.presenceLoaded;

  const stepDone = (s: ConnectStepKind) => (s === 'oauth' ? oauthConnected : computerOnline);
  const pendingSteps = steps.filter((s) => !stepDone(s));

  // "Connected" requires the computer to be ONLINE when the platform needs one.
  // Never claim connected optimistically while presence is still loading, or a
  // Facebook row with no linked computer would briefly flash a green "Connected".
  // When the computer is required but its status is unknown (presence loading),
  // report 'checking' (a quiet, honest middle state) instead of green or amber.
  let uiState: PlatformConnectStatus['uiState'];
  if (needsReauth) uiState = 'needs-reauth';
  else if (!oauthConnected) uiState = 'not-connected';
  else if (!requiresComputer || computerOnline) uiState = 'connected';
  else if (computerKnown) uiState = 'needs-computer';
  else uiState = 'checking';

  return {
    steps,
    oauthConnected,
    requiresComputer,
    computerOnline,
    computerKnown,
    // Green pill ONLY when truly connected (all steps satisfied). 'checking' and
    // 'needs-computer' are NOT fully connected.
    isFullyConnected: uiState === 'connected' && steps.length > 0,
    pendingSteps,
    nextStep: pendingSteps[0],
    uiState,
    ctaLabel: uiState === 'needs-reauth' ? 'Reconnect' : undefined,
  };
}

export function getPlatformConnectStatusDisplay(
  status: PlatformConnectStatus,
): { label: string; color: string } {
  switch (status.uiState) {
    case 'connected':
      return { label: 'Connected', color: '#43631A' };
    case 'needs-reauth':
      return { label: 'Needs reconnect', color: '#DC2626' };
    case 'needs-computer':
      return { label: 'Needs computer', color: '#A2611A' };
    case 'checking':
      return { label: 'Checking', color: '#71717A' };
    default:
      return { label: 'Not connected', color: '#71717A' };
  }
}
