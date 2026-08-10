// platformConnectionVisibility — pure predicates for connection-row lifecycle.
//
// Dependency-free on purpose (no config/platforms, no react-native) so the
// node:test suite can import it directly. platformConnectStatus.ts re-exports
// everything here; consumers keep importing from there.
//
// The lifecycle truth (backend platform-connections.service):
//   disconnect → SOFT: row stays, IsEnabled=false + Status='inactive'.
//   delete     → HARD: the row is removed and never returns from the API.
// So every row the API returns is either usable, mid-import, broken (error /
// needs_reauth), or soft-disconnected. "Deleted" rows simply don't exist in
// payloads — the defensive 'deleted' check below is a tripwire, not a state.

/** Structural subset of PlatformConnectionRow these predicates read. */
export interface ConnectionVisibilityFields {
  IsEnabled?: boolean | null;
  Status?: string | null;
}

// Statuses that mean a connection row is NOT a live OAuth marker. Includes the
// backend's soft-disconnect status even when the row remains in the payload.
export const NOT_CONNECTED_STATUSES = new Set([
  'inactive',
  'disconnected',
  'error',
  'revoked',
  'disabled',
  'needs_reauth',
]);

// Soft-disconnected rows remain in includeDisabled API responses. Publish
// pickers, optimizer lanes, and "is this platform usable" checks must omit
// them while still retaining error rows that need a reconnect action.
const DISCONNECTED_STATUSES = new Set(['inactive', 'disconnected', 'disabled']);

const normalize = (value?: string | null) => (value || '').toLowerCase().trim();

/**
 * Usable for work: enabled and not soft-disconnected. Publish pickers, the
 * optimizer, setup/checklist logic, and account-stage classification use this —
 * a disconnected store must not count as "connected" anywhere.
 */
export function isVisiblePlatformConnection(connection: ConnectionVisibilityFields): boolean {
  const status = normalize(connection.Status);
  return connection.IsEnabled !== false && !DISCONNECTED_STATUSES.has(status);
}

/**
 * Shown in the Connections list: everything the API returns, INCLUDING
 * soft-disconnected rows — those render the Disconnected state with the
 * tap-to-re-enable path (PATCH /enable). Hiding them made a failed disconnect
 * indistinguishable from a successful one and left reconnect-in-place
 * unreachable. Genuinely-deleted connections are hard-deleted server-side, so
 * they never reach this predicate.
 */
export function isListedPlatformConnection(connection: ConnectionVisibilityFields): boolean {
  return normalize(connection.Status) !== 'deleted';
}

/** A soft-disconnected row: listed, labelled Disconnected, tap re-enables. */
export function isDisconnectedPlatformConnection(connection: ConnectionVisibilityFields): boolean {
  return connection.IsEnabled === false || DISCONNECTED_STATUSES.has(normalize(connection.Status));
}

/**
 * Connection statuses that mean an import/sync is still running. The inbox
 * summary's per-connection state can flip to 'needs-attention' MID-scan (items
 * parked early), so polls must key off the connection row's own status too —
 * never only the aggregate.
 */
export function isImportingConnectionStatus(status?: string | null): boolean {
  const s = normalize(status);
  return s === 'pending' || s === 'scanning' || s === 'syncing' || s === 'reconciling' || s === 'ready_to_sync';
}
