// platformConnectionVisibility: pure predicates for connection-row lifecycle.
//
// Dependency-free on purpose (no config/platforms, no react-native) so the
// node:test suite can import it directly. platformConnectStatus.ts re-exports
// everything here; consumers keep importing from there.
//
// The lifecycle truth (backend platform-connections.service):
//   disconnect → SOFT: row stays, IsEnabled=false + Status='inactive'.
//   delete     → HARD: the row is removed and never returns from the API.
// So every row the API returns is either usable, mid-import, broken (review /
// error), or soft-disconnected. "Deleted" rows simply don't exist in
// payloads. The defensive 'deleted' check below is a tripwire, not a state.

export type PlatformConnectionSyncState =
  | 'scanning'
  | 'syncing'
  | 'live'
  | 'needs-attention'
  | 'error';

export type PlatformConnectionRecommendedAction =
  | 'reconnect'
  | 'rescan'
  | 'fix_resume';

/** Structural subset of PlatformConnectionRow these predicates read. */
export interface ConnectionVisibilityFields {
  IsEnabled?: boolean | null;
  Status?: string | null;
  SyncState?: PlatformConnectionSyncState | null;
  NeedsReauth?: boolean | null;
  RecommendedAction?: PlatformConnectionRecommendedAction | null;
}

// Statuses that mean a connection row is NOT a live OAuth marker. Includes the
// backend's soft-disconnect status even when the row remains in the payload.
export const NOT_CONNECTED_STATUSES = new Set([
  'inactive',
  'disconnected',
  'error',
  'revoked',
  'expired',
  'failed',
  'disabled',
  'needs_reauth',
]);

// Soft-disconnected rows remain in includeDisabled API responses.
export const DISCONNECTED_CONNECTION_STATUSES = new Set([
  'inactive',
  'disconnected',
  'disabled',
]);

// These rows still belong in the Connections list because the user can repair
// them, but they are not healthy OAuth markers and cannot be used for work.
export const UNHEALTHY_CONNECTION_STATUSES = new Set([
  'error',
  'needs_reauth',
  'revoked',
  'expired',
  'failed',
]);

const normalize = (value?: string | null) => (value || '').toLowerCase().trim();

export const ACTIVE_IMPORT_CONNECTION_STATUSES = new Set([
  'queued',
  'pending',
  'in_progress',
  'processing',
  'scanning',
  'syncing',
  'reconciling',
  'ready_to_sync',
  'importing',
  'running',
]);

/**
 * Usable for work: enabled and not soft-disconnected. Publish pickers, the
 * optimizer, setup/checklist logic, and account-stage classification use this.
 * a disconnected store must not count as "connected" anywhere.
 */
export function isVisiblePlatformConnection(connection: ConnectionVisibilityFields): boolean {
  const status = normalize(connection.Status);
  return connection.IsEnabled !== false
    && !DISCONNECTED_CONNECTION_STATUSES.has(status)
    && !UNHEALTHY_CONNECTION_STATUSES.has(status)
    && connection.SyncState !== 'error'
    && connection.NeedsReauth !== true
    && connection.RecommendedAction !== 'reconnect';
}

/**
 * Shown in the Connections list: usable and repairable rows only. The disconnect
 * endpoint leaves inactive rows in includeDisabled responses, so those rows must
 * be filtered here instead of presented in a second section.
 */
export function isListedPlatformConnection(connection: ConnectionVisibilityFields): boolean {
  const status = normalize(connection.Status);
  return status !== 'deleted' && !DISCONNECTED_CONNECTION_STATUSES.has(status);
}

/** A soft-disconnected row, used before the Connections list filters it out. */
export function isDisconnectedPlatformConnection(connection: ConnectionVisibilityFields): boolean {
  return connection.IsEnabled === false
    || DISCONNECTED_CONNECTION_STATUSES.has(normalize(connection.Status));
}

/** A current connection health failure that must lead to reconnect. */
export function isUnhealthyPlatformConnection(connection: ConnectionVisibilityFields): boolean {
  return connection.NeedsReauth === true
    || connection.SyncState === 'error'
    || connection.RecommendedAction === 'reconnect'
    || UNHEALTHY_CONNECTION_STATUSES.has(normalize(connection.Status));
}

/**
 * Connection statuses that mean an import/sync is still running. The inbox
 * summary's per-connection state can flip to 'needs-attention' MID-scan (items
 * parked early), so polls must key off the connection row's own status too,
 * never only the aggregate.
 */
export function isImportingConnectionStatus(status?: string | null): boolean {
  return ACTIVE_IMPORT_CONNECTION_STATUSES.has(normalize(status));
}
