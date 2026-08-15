import {
  DISCONNECTED_CONNECTION_STATUSES,
  isListedPlatformConnection,
  isUnhealthyPlatformConnection,
  type PlatformConnectionRecommendedAction,
  type PlatformConnectionSyncState,
} from './platformConnectionVisibility.ts';

export interface RecentImportOutcome {
  connectionId: string;
  status: string;
  createdAt: string;
  completedAt?: string | null;
}

export type ConnectionImportKind =
  | 'disconnected'
  | 'synced'
  | 'review'
  | 'failed'
  | 'scanning'
  | 'importing'
  | 'checking';

export interface ConnectionImportPresentation {
  kind: ConnectionImportKind;
  label: string;
  color: string;
  occurredAt: string | null;
  importInProgress: boolean;
  failureReason: string | null;
}

type ConnectionImportPresentationBase = Omit<ConnectionImportPresentation, 'failureReason'>;

const SUCCESS_STATUSES = new Set(['complete', 'completed', 'success', 'succeeded']);
const ACTIVE_STATUSES = new Set([
  'queued',
  'pending',
  'in_progress',
  'processing',
  'scanning',
  'syncing',
  'reconciling',
  'ready_to_sync',
]);
const HEALTHY_CONNECTION_STATUSES = new Set(['active', 'live']);

function normalizedStatus(value?: string | null): string {
  return String(value || '').trim().toLowerCase();
}

export function isActiveConnectionImportStatus(value?: string | null): boolean {
  return ACTIVE_STATUSES.has(normalizedStatus(value));
}

function runStartedAt(importRun: RecentImportOutcome): number {
  const parsed = Date.parse(importRun.createdAt);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

export function latestImportsByConnection<T extends RecentImportOutcome>(
  imports: readonly T[],
): Map<string, T> {
  const latest = new Map<string, T>();
  for (const importRun of imports) {
    if (!importRun.connectionId) continue;
    const current = latest.get(importRun.connectionId);
    if (!current || runStartedAt(importRun) >= runStartedAt(current)) {
      latest.set(importRun.connectionId, importRun);
    }
  }
  return latest;
}

function isFailed(status: string): boolean {
  return status === 'error' || status.includes('fail');
}

function fallbackPresentation(rawStatus: string): Omit<ConnectionImportPresentationBase, 'occurredAt'> {
  const status = normalizedStatus(rawStatus);
  if (status === 'active' || status === 'live') {
    return { kind: 'synced', label: 'Synced', color: '#93C822', importInProgress: false };
  }
  if (status === 'review' || status === 'needs-attention') {
    return { kind: 'review', label: 'Needs attention', color: '#DC2626', importInProgress: false };
  }
  if (isFailed(status) || status.includes('expired') || status.includes('revoked')) {
    return { kind: 'failed', label: 'Import failed', color: '#DC2626', importInProgress: false };
  }
  if (status === 'pending' || status === 'scanning') {
    return { kind: 'scanning', label: 'Scanning products...', color: '#A2611A', importInProgress: true };
  }
  if (ACTIVE_STATUSES.has(status)) {
    return { kind: 'importing', label: 'Importing inventory...', color: '#A2611A', importInProgress: true };
  }
  return { kind: 'checking', label: 'Checking status', color: '#71717A', importInProgress: false };
}

export function deriveConnectionImportPresentation({
  enabled,
  needsReauth = false,
  connectionStatus,
  syncState,
  recommendedAction,
  failureReason = null,
  aggregateState,
  latestImport,
  progressStatus,
}: {
  enabled: boolean;
  needsReauth?: boolean;
  connectionStatus?: string | null;
  syncState?: PlatformConnectionSyncState | null;
  recommendedAction?: PlatformConnectionRecommendedAction | null;
  failureReason?: string | null;
  aggregateState?: string | null;
  latestImport?: RecentImportOutcome | null;
  progressStatus?: string | null;
}): ConnectionImportPresentation {
  const connection = normalizedStatus(connectionStatus);
  const aggregate = normalizedStatus(aggregateState);
  const latestStatus = normalizedStatus(latestImport?.status);
  const progress = normalizedStatus(progressStatus);
  const occurredAt = latestImport?.completedAt || latestImport?.createdAt || null;
  const withFailureReason = (
    presentation: ConnectionImportPresentationBase,
  ): ConnectionImportPresentation => ({ ...presentation, failureReason });

  // The current connection row owns health. Run history and realtime progress
  // can enrich a healthy row, but neither may revive a broken connection.
  if (isUnhealthyPlatformConnection({
    Status: connectionStatus,
    SyncState: syncState,
    NeedsReauth: needsReauth,
    RecommendedAction: recommendedAction,
  })) {
    return withFailureReason({
      kind: 'failed',
      label: 'Needs attention',
      color: '#DC2626',
      occurredAt,
      importInProgress: false,
    });
  }

  // A disconnected row stays disconnected even if a stale run still says it is
  // processing. A new pending connection may briefly carry IsEnabled=false, so
  // the row's active import status is evaluated before that fallback flag.
  if (DISCONNECTED_CONNECTION_STATUSES.has(connection)) {
    return withFailureReason({
      kind: 'disconnected',
      label: 'Disconnected',
      color: '#71717A',
      occurredAt: null,
      importInProgress: false,
    });
  }

  if (ACTIVE_STATUSES.has(connection)) {
    return withFailureReason({
      ...fallbackPresentation(connection),
      occurredAt,
    });
  }

  if (!enabled) {
    return withFailureReason({
      kind: 'disconnected',
      label: 'Disconnected',
      color: '#71717A',
      occurredAt: null,
      importInProgress: false,
    });
  }

  // Import history is descriptive only after the connection row has confirmed
  // a healthy state. Unknown row states stay neutral instead of becoming green.
  if (!HEALTHY_CONNECTION_STATUSES.has(connection)) {
    return withFailureReason({
      ...fallbackPresentation(String(connectionStatus || aggregateState || '')),
      occurredAt: null,
    });
  }

  const activeStatus = [progress, aggregate, latestStatus]
    .find((status) => ACTIVE_STATUSES.has(status));
  if (activeStatus) {
    const scanning = activeStatus === 'pending' || activeStatus === 'scanning';
    return withFailureReason({
      kind: scanning ? 'scanning' : 'importing',
      label: scanning ? 'Scanning products...' : 'Importing inventory...',
      color: '#A2611A',
      occurredAt,
      importInProgress: true,
    });
  }

  if (SUCCESS_STATUSES.has(latestStatus)) {
    return withFailureReason({
      kind: 'synced',
      label: 'Synced',
      color: '#93C822',
      occurredAt,
      importInProgress: false,
    });
  }

  if (isFailed(latestStatus)) {
    return withFailureReason({
      kind: 'failed',
      label: 'Import failed',
      color: '#DC2626',
      occurredAt,
      importInProgress: false,
    });
  }

  return withFailureReason({
    ...fallbackPresentation(String(connectionStatus || aggregateState || '')),
    occurredAt: null,
  });
}

export interface ConnectionImportPresentationRow {
  Id: string;
  IsEnabled?: boolean | null;
  Status?: string | null;
  SyncState?: PlatformConnectionSyncState | null;
  NeedsReauth?: boolean | null;
  RecommendedAction?: PlatformConnectionRecommendedAction | null;
  FailureReason?: string | null;
}

export interface ConnectionImportAggregateState {
  connectionId: string;
  state?: string | null;
}

export interface ConnectionImportProgressState {
  status?: string | null;
}

/**
 * Builds the shared per-connection presentation used by every connection status
 * renderer. Inputs are intentionally structural so screens can pass context,
 * inbox-summary, and realtime-progress values without UI-specific adapters.
 */
export function connectionImportPresentationsById({
  connections,
  aggregateConnections = [],
  recentImports = [],
  progressByConnectionId = {},
}: {
  connections: readonly ConnectionImportPresentationRow[];
  aggregateConnections?: readonly ConnectionImportAggregateState[];
  recentImports?: readonly RecentImportOutcome[];
  progressByConnectionId?: Readonly<Record<string, ConnectionImportProgressState | undefined>>;
}): Map<string, ConnectionImportPresentation> {
  const aggregateByConnectionId = new Map(
    aggregateConnections.map((connection) => [connection.connectionId, connection.state]),
  );
  const latestByConnectionId = latestImportsByConnection(recentImports);

  return new Map(connections.map((connection) => [
    connection.Id,
    deriveConnectionImportPresentation({
      enabled: connection.IsEnabled !== false,
      needsReauth: connection.NeedsReauth === true,
      connectionStatus: connection.Status,
      syncState: connection.SyncState,
      recommendedAction: connection.RecommendedAction,
      failureReason: connection.FailureReason ?? null,
      aggregateState: aggregateByConnectionId.get(connection.Id),
      latestImport: latestByConnectionId.get(connection.Id),
      progressStatus: progressByConnectionId[connection.Id]?.status,
    }),
  ]));
}

export interface SellingPlatformConnectionRow {
  Id: string;
  PlatformType?: string | null;
  Status?: string | null;
  IsEnabled?: boolean | null;
  NeedsReauth?: boolean | null;
}

export function isCsvPseudoConnection(
  connection: Pick<SellingPlatformConnectionRow, 'PlatformType'>,
): boolean {
  const compactType = String(connection.PlatformType || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  return compactType === 'csv' || compactType === 'csvimport';
}

/**
 * Data-layer list derivation for selling-platform surfaces. CSV import records
 * and soft-disconnected rows never enter the rendered list. Health failures stay
 * listed so the row can lead to the shared reconnect flow.
 */
export function listSellingPlatformConnections<T extends SellingPlatformConnectionRow>(
  connections: readonly T[],
): T[] {
  return connections.filter((connection) => (
    !isCsvPseudoConnection(connection) && isListedPlatformConnection(connection)
  ));
}
