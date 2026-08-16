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
  canRetryImport: boolean;
  secondaryFailure: {
    label: string;
    occurredAt: string;
  } | null;
}

type ConnectionImportPresentationBase = Omit<
  ConnectionImportPresentation,
  'failureReason' | 'canRetryImport' | 'secondaryFailure'
>;

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

// Realtime progress is retained for two minutes in PlatformConnectionsContext,
// and the inbox summary polls every 20 seconds. Run history is not a live source,
// so an unfinished-looking run may bridge only that same six-poll window. After
// it expires, a current connection, aggregate, or realtime signal must confirm
// that work is still active. A completedAt or newer sync success always wins.
export const ACTIVE_IMPORT_EVIDENCE_TTL_MS = 2 * 60 * 1000;

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

function timestamp(value?: string | null): number {
  const parsed = Date.parse(String(value || ''));
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
    return { kind: 'scanning', label: 'Scanning items', color: '#A2611A', importInProgress: true };
  }
  if (ACTIVE_STATUSES.has(status)) {
    return { kind: 'importing', label: 'Importing items', color: '#A2611A', importInProgress: true };
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
  latestSuccessfulImport,
  latestFailedImport,
  progressStatus,
  progressReceivedAt,
  lastSyncSuccessAt,
  connectionUpdatedAt,
  canRetryImport = enabled,
  now = Date.now(),
}: {
  enabled: boolean;
  needsReauth?: boolean;
  connectionStatus?: string | null;
  syncState?: PlatformConnectionSyncState | null;
  recommendedAction?: PlatformConnectionRecommendedAction | null;
  failureReason?: string | null;
  aggregateState?: string | null;
  latestImport?: RecentImportOutcome | null;
  latestSuccessfulImport?: RecentImportOutcome | null;
  latestFailedImport?: RecentImportOutcome | null;
  progressStatus?: string | null;
  progressReceivedAt?: number | null;
  lastSyncSuccessAt?: string | null;
  connectionUpdatedAt?: string | null;
  canRetryImport?: boolean;
  now?: number;
}): ConnectionImportPresentation {
  const connection = normalizedStatus(connectionStatus);
  const aggregate = normalizedStatus(aggregateState);
  const latestStatus = normalizedStatus(latestImport?.status);
  const progress = normalizedStatus(progressStatus);
  const successfulImport = latestSuccessfulImport
    || (SUCCESS_STATUSES.has(latestStatus) ? latestImport : null);
  const failedImport = latestFailedImport
    || (isFailed(latestStatus) ? latestImport : null);
  const successCandidates = [
    successfulImport?.completedAt || successfulImport?.createdAt || null,
    latestImport?.completedAt && !isFailed(latestStatus) ? latestImport.completedAt : null,
    lastSyncSuccessAt || null,
  ].filter((value): value is string => !!value && timestamp(value) !== Number.NEGATIVE_INFINITY);
  const latestSuccessAt = successCandidates.reduce<string | null>((latest, value) => (
    !latest || timestamp(value) > timestamp(latest) ? value : latest
  ), null);
  const latestSuccessTime = timestamp(latestSuccessAt);
  const failedAt = failedImport?.completedAt || failedImport?.createdAt || null;
  const failureIsOlderThanSuccess = !!failedAt && latestSuccessTime > timestamp(failedAt);
  const retryAvailable = canRetryImport && enabled;
  const secondaryFailure = retryAvailable && failedAt && failureIsOlderThanSuccess
    ? { label: 'Import failed', occurredAt: failedAt }
    : null;
  const connectionHealthFailed = isUnhealthyPlatformConnection({
    Status: connectionStatus,
    SyncState: syncState,
    NeedsReauth: needsReauth,
    RecommendedAction: recommendedAction,
  });
  const withFailureReason = (
    presentation: ConnectionImportPresentationBase,
    options: { includeFailureReason?: boolean; allowRetry?: boolean } = {},
  ): ConnectionImportPresentation => ({
    ...presentation,
    failureReason: options.includeFailureReason ? failureReason : null,
    canRetryImport: !!options.allowRetry && retryAvailable,
    secondaryFailure: connectionHealthFailed ? null : secondaryFailure,
  });

  // The current connection row owns health. Run history and realtime progress
  // can enrich a healthy row, but neither may revive a broken connection.
  if (connectionHealthFailed) {
    return withFailureReason({
      kind: 'review',
      label: 'Needs attention',
      color: '#DC2626',
      occurredAt: connectionUpdatedAt || null,
      importInProgress: false,
    }, { includeFailureReason: true });
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
    const connectionStatusAt = timestamp(connectionUpdatedAt);
    const completedLatestAt = latestImport?.completedAt
      ? timestamp(latestImport.completedAt)
      : Number.NEGATIVE_INFINITY;
    const newerTerminalEvidence = Math.max(latestSuccessTime, completedLatestAt);
    if (
      newerTerminalEvidence === Number.NEGATIVE_INFINITY
      || (connectionStatusAt !== Number.NEGATIVE_INFINITY && connectionStatusAt > newerTerminalEvidence)
    ) {
      return withFailureReason({
        ...fallbackPresentation(connection),
        occurredAt: connectionUpdatedAt || latestImport?.createdAt || null,
      });
    }
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
  if (!HEALTHY_CONNECTION_STATUSES.has(connection) && !ACTIVE_STATUSES.has(connection)) {
    return withFailureReason({
      ...fallbackPresentation(String(connectionStatus || aggregateState || '')),
      occurredAt: null,
    });
  }

  const progressTime = typeof progressReceivedAt === 'number'
    ? progressReceivedAt
    : Number.POSITIVE_INFINITY;
  const progressIsFresh = ACTIVE_STATUSES.has(progress)
    && now - progressTime <= ACTIVE_IMPORT_EVIDENCE_TTL_MS
    && progressTime > latestSuccessTime;
  const aggregateIsActive = ACTIVE_STATUSES.has(aggregate);
  const latestRunStartedAt = latestImport
    ? runStartedAt(latestImport)
    : Number.NEGATIVE_INFINITY;
  const historyIsActive = ACTIVE_STATUSES.has(latestStatus)
    && latestImport?.completedAt == null
    && latestRunStartedAt > latestSuccessTime
    && now - latestRunStartedAt <= ACTIVE_IMPORT_EVIDENCE_TTL_MS;
  const activeStatus = progressIsFresh
    ? progress
    : aggregateIsActive
      ? aggregate
      : historyIsActive
        ? latestStatus
        : null;
  if (activeStatus) {
    const scanning = activeStatus === 'pending' || activeStatus === 'scanning';
    return withFailureReason({
      kind: scanning ? 'scanning' : 'importing',
      label: scanning ? 'Scanning items' : 'Importing items',
      color: '#A2611A',
      occurredAt: latestImport?.createdAt || connectionUpdatedAt || null,
      importInProgress: true,
    });
  }

  if (isFailed(latestStatus) && !failureIsOlderThanSuccess && retryAvailable) {
    return withFailureReason({
      kind: 'failed',
      label: 'Import failed',
      color: '#DC2626',
      occurredAt: latestImport?.completedAt || latestImport?.createdAt || null,
      importInProgress: false,
    }, { allowRetry: true });
  }

  if (latestSuccessAt) {
    return withFailureReason({
      kind: 'synced',
      label: 'Synced',
      color: '#93C822',
      occurredAt: latestSuccessAt,
      importInProgress: false,
    }, { allowRetry: !!secondaryFailure });
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
  LastSyncSuccessAt?: string | null;
  UpdatedAt?: string | null;
}

export interface ConnectionImportAggregateState {
  connectionId: string;
  state?: string | null;
}

export interface ConnectionImportProgressState {
  status?: string | null;
  receivedAt?: number | null;
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
  const successfulByConnectionId = latestImportsByConnection(
    recentImports.filter((importRun) => SUCCESS_STATUSES.has(normalizedStatus(importRun.status))),
  );
  const failedByConnectionId = latestImportsByConnection(
    recentImports.filter((importRun) => isFailed(normalizedStatus(importRun.status))),
  );

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
      latestSuccessfulImport: successfulByConnectionId.get(connection.Id),
      latestFailedImport: failedByConnectionId.get(connection.Id),
      progressStatus: progressByConnectionId[connection.Id]?.status,
      progressReceivedAt: progressByConnectionId[connection.Id]?.receivedAt,
      lastSyncSuccessAt: connection.LastSyncSuccessAt,
      connectionUpdatedAt: connection.UpdatedAt,
      canRetryImport: connection.IsEnabled !== false,
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
