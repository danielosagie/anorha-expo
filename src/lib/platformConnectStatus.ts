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

// Statuses that mean a connection row is NOT a live marker. This includes the
// backend's soft-disconnect status even when the row remains in the payload.
const NOT_CONNECTED = new Set(['inactive', 'disconnected', 'error', 'revoked', 'disabled', 'needs_reauth']);

// Soft-disconnected rows remain in includeDisabled API responses. Lists and
// publish pickers must omit those records while still retaining error rows that
// need a reconnect action.
const HIDDEN_CONNECTION_STATUSES = new Set(['inactive', 'disconnected', 'disabled']);

export function isVisiblePlatformConnection(
  connection: Pick<PlatformConnectionRow, 'IsEnabled' | 'Status'>,
): boolean {
  const status = (connection.Status || '').toLowerCase().trim();
  return connection.IsEnabled !== false && !HIDDEN_CONNECTION_STATUSES.has(status);
}

/** Live computer-presence signal (from useFacebookJobStatus). */
export interface ComputerPresence {
  /** True when at least one computer has been linked, even if it is offline. */
  hasLinkedComputer: boolean;
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
  /** At least one computer has been linked, regardless of current presence. */
  hasLinkedComputer: boolean;
  computerOnline: boolean;
  /** Presence has loaded, so computerOnline is trustworthy. */
  computerKnown: boolean;
  /** A linked computer exists, but none is currently online. */
  offlineComputer: boolean;
  /** Every required step is satisfied. */
  isFullyConnected: boolean;
  /** Steps still to do, in order. */
  pendingSteps: ConnectStepKind[];
  /** The next step to run, if any. */
  nextStep?: ConnectStepKind;
  /**
   * What the row/pill should show:
   *   'connected'      means OAuth and computer linking are complete.
   *   'needs-computer' means OAuth is done, but no computer has ever been linked.
   *   'checking'       means OAuth is done and the computer list is still loading.
   *   'not-connected'  means no OAuth marker exists.
   */
  uiState: 'connected' | 'needs-computer' | 'checking' | 'not-connected';
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
  const hasLinkedComputer = !!presence.hasLinkedComputer;
  const computerOnline = !!presence.computerOnline;
  const computerKnown = !!presence.presenceLoaded;
  const offlineComputer = requiresComputer && computerKnown && hasLinkedComputer && !computerOnline;

  const stepDone = (s: ConnectStepKind) => (s === 'oauth' ? oauthConnected : hasLinkedComputer);
  const pendingSteps = steps.filter((s) => !stepDone(s));

  // Linking satisfies setup. Online presence only decides whether publishing can
  // start now or waits for a linked computer to return.
  let uiState: PlatformConnectStatus['uiState'];
  if (!oauthConnected) uiState = 'not-connected';
  else if (!requiresComputer) uiState = 'connected';
  else if (!computerKnown) uiState = 'checking';
  else if (!hasLinkedComputer) uiState = 'needs-computer';
  else uiState = 'connected';

  return {
    steps,
    oauthConnected,
    requiresComputer,
    hasLinkedComputer,
    computerOnline,
    computerKnown,
    offlineComputer,
    isFullyConnected: uiState === 'connected' && steps.length > 0,
    pendingSteps,
    nextStep: pendingSteps[0],
    uiState,
  };
}
