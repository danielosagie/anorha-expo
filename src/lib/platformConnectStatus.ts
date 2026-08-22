// platformConnectStatus: the ONE definition of "is this platform connected".
//
// A platform is FULLY connected only when every step in connectStepsFor() is
// done: the OAuth marker exists AND (for computer-write platforms like Facebook)
// the user's computer is linked. This replaces the old per-screen connectedKeys
// predicate that marked Facebook "Connected" the instant the OAuth row existed,
// ignoring the computer, which caused the "connected but no computer" confusion.
//
// Pure and framework-free so the connect list, the connect flow, and the publish
// pre-flight all read the same truth. The hook wrapper is usePlatformConnectStatus.

import {
  connectStepsFor,
  resolvePlatformKey,
  type ConnectStepKind,
} from '../config/platforms.ts';
import type { PlatformConnectionRow } from '../context/PlatformConnectionsContext';
import {
  isListedPlatformConnection,
  isUnhealthyPlatformConnection,
  NOT_CONNECTED_STATUSES,
} from './platformConnectionVisibility.ts';
import {
  isActiveConnectionImportStatus,
  type ConnectionImportPresentation,
} from './connectionImportPresentation.ts';

// The row-visibility predicates are pure and live in their own dependency-free
// module (platformConnectionVisibility) so node:test can import them without
// dragging in config/platforms' SVG assets. Re-exported here so every existing
// consumer keeps its import path.
export {
  isVisiblePlatformConnection,
  isListedPlatformConnection,
  isDisconnectedPlatformConnection,
  isUnhealthyPlatformConnection,
  isImportingConnectionStatus,
} from './platformConnectionVisibility.ts';

/** Live computer-presence signal (from useComputerJobStatus). */
export interface ComputerPresence {
  computerOnline: boolean;
  /** False while the first presence result is still loading. Do not read
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
   *   'importing'      → an active import is running for this platform.
   *   'connected'      → every required step done (OAuth, and computer online when required).
   *   'needs-computer' → OAuth done, computer required and KNOWN offline.
   *   'checking'       → OAuth done, computer required, presence still loading (do NOT claim green).
   *   'not-connected'  → no OAuth marker yet.
   */
  uiState: 'importing' | 'connected' | 'needs-computer' | 'checking' | 'not-connected';
  importing: boolean;
}

export interface PlatformConnectStatusOptions {
  presentationByConnectionId?: ReadonlyMap<string, ConnectionImportPresentation>;
}

export function platformConnectStatusLabel(status: PlatformConnectStatus): string {
  switch (status.uiState) {
    case 'importing': return 'Importing';
    case 'connected': return 'Connected';
    case 'needs-computer': return 'Needs computer';
    case 'checking': return 'Checking';
    case 'not-connected': return 'Not connected';
  }
}

export function derivePlatformConnectStatus(
  platform: string,
  liveConnections: PlatformConnectionRow[] | null | undefined,
  presence: ComputerPresence,
  options: PlatformConnectStatusOptions = {},
): PlatformConnectStatus {
  const key = resolvePlatformKey(platform);
  const steps = connectStepsFor(platform);
  const matchingConnections = key
    ? (liveConnections || []).filter((connection) => resolvePlatformKey(connection.PlatformType) === key)
    : [];
  const importing = matchingConnections.some((connection) => {
    const presentation = options.presentationByConnectionId?.get(connection.Id);
    if (!isListedPlatformConnection(connection)) return false;
    if (presentation?.requiresReconnect ?? isUnhealthyPlatformConnection(connection)) return false;
    return presentation
      ? presentation.importInProgress
      : isActiveConnectionImportStatus(connection.Status);
  });
  const oauthConnected =
    !!key &&
    matchingConnections.some((c) => {
      const presentation = options.presentationByConnectionId?.get(c.Id);
      if (!isListedPlatformConnection(c)) return false;
      if (presentation?.requiresReconnect ?? isUnhealthyPlatformConnection(c)) return false;
      if (
        presentation?.importInProgress
        || isActiveConnectionImportStatus(c.Status)
      ) return true;
      const status = (c.Status || '').toLowerCase();
      if (NOT_CONNECTED_STATUSES.has(status) || c.IsEnabled === false) return false;
      return resolvePlatformKey(c.PlatformType) === key;
    });

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
  if (importing) uiState = 'importing';
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
    // Connection completeness stays separate from the visible import state.
    isFullyConnected: pendingSteps.length === 0 && steps.length > 0,
    pendingSteps,
    nextStep: pendingSteps[0],
    uiState,
    importing,
  };
}
