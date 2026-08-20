import {
  ACTIVE_IMPORT_CONNECTION_STATUSES,
  DISCONNECTED_CONNECTION_STATUSES,
  isListedPlatformConnection,
  UNHEALTHY_CONNECTION_STATUSES,
  type PlatformConnectionRecommendedAction,
  type PlatformConnectionSyncState,
} from './platformConnectionVisibility.ts';

export interface RecentImportOutcome {
  connectionId: string;
  status: string;
  createdAt: string;
  completedAt?: string | null;
  itemsSoFar?: number | null;
  itemsTotal?: number | null;
  itemsCommitted?: number | null;
  phase?: string | null;
  startedAt?: string | null;
  p50DurationMs?: number | null;
  jobId?: string | null;
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
  blocking: boolean;
  requiresReconnect: boolean;
  attentionCount: number;
  attentionColor: string | null;
  itemsSoFar: number | null;
  processed: number | null;
  total: number | null;
  phase: string | null;
  startedAt: string | null;
  p50DurationMs: number | null;
  jobId: string | null;
  secondaryFailure: {
    label: string;
    occurredAt: string;
  } | null;
}

type ConnectionImportPresentationBase = Omit<
  ConnectionImportPresentation,
  | 'failureReason'
  | 'canRetryImport'
  | 'blocking'
  | 'requiresReconnect'
  | 'attentionCount'
  | 'attentionColor'
  | 'itemsSoFar'
  | 'processed'
  | 'total'
  | 'phase'
  | 'startedAt'
  | 'p50DurationMs'
  | 'jobId'
  | 'secondaryFailure'
>;

const SUCCESS_STATUSES = new Set(['active', 'complete', 'completed', 'success', 'succeeded']);
const ACTIVE_STATUSES = ACTIVE_IMPORT_CONNECTION_STATUSES;
const HEALTHY_CONNECTION_STATUSES = new Set(['active', 'live']);
const ATTENTION_STATUSES = new Set(['review', 'needs-attention', 'needs_attention']);
const AMBER = '#A2611A';
const RED = '#DC2626';

// Realtime progress is retained for two minutes in PlatformConnectionsContext,
// and the inbox summary polls every 20 seconds. Run history is not a live source,
// so an unfinished-looking run may bridge only that same six-poll window. After
// it expires, a current connection, aggregate, or realtime signal must confirm
// that work is still active. A completedAt or newer sync success always wins.
export const ACTIVE_IMPORT_EVIDENCE_TTL_MS = 2 * 60 * 1000;

/** A new account/org always starts from an empty import-status snapshot. */
export function resetOwnerScopedImportState<T extends { ownerKey: string }>(
  current: T,
  ownerKey: string,
  createEmpty: (ownerKey: string) => T,
): T {
  return current.ownerKey === ownerKey ? current : createEmpty(ownerKey);
}

function normalizedStatus(value?: string | null): string {
  return String(value || '').trim().toLowerCase();
}

export function isActiveConnectionImportStatus(value?: string | null): boolean {
  return ACTIVE_STATUSES.has(normalizedStatus(value));
}

export function connectionImportPhaseLabel(
  phase?: string | null,
  status?: string | null,
): 'Finding items' | 'Matching' | 'Importing' | 'Checking' {
  const evidence = `${normalizedStatus(phase)} ${normalizedStatus(status)}`.replace(/[_-]+/g, ' ');
  if (/\b(match|matching|suggest|suggesting|reconcile|reconciling)\b/.test(evidence)) {
    return 'Matching';
  }
  if (/\b(commit|committing|import|importing|sync|syncing|ready_to_sync)\b/.test(evidence)) {
    return 'Importing';
  }
  if (/\b(pull|pulling|fetch|fetching|catalog|find|finding|scan|scanning|queue|queued|pending)\b/.test(evidence)) {
    return 'Finding items';
  }
  return 'Checking';
}

export function isFreshActiveImportEvidence({
  status,
  phase,
  receivedAt,
  now = Date.now(),
}: {
  status?: string | null;
  phase?: string | null;
  receivedAt?: number | null;
  now?: number;
}): boolean {
  const evidenceStatus = ACTIVE_STATUSES.has(normalizedStatus(status))
    ? normalizedStatus(status)
    : normalizedStatus(phase);
  return ACTIVE_STATUSES.has(evidenceStatus)
    && typeof receivedAt === 'number'
    && receivedAt <= now
    && now - receivedAt <= ACTIVE_IMPORT_EVIDENCE_TTL_MS;
}

function runStartedAt(importRun: RecentImportOutcome): number {
  const parsed = Date.parse(importRun.createdAt);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function timestamp(value?: string | null): number {
  const parsed = Date.parse(String(value || ''));
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function finiteNonNegativeNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function newestTime(...values: number[]): number {
  return values.reduce((latest, value) => Math.max(latest, value), Number.NEGATIVE_INFINITY);
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
  return status === 'error'
    || status === 'expired'
    || status === 'revoked'
    || status.includes('fail');
}

function fallbackPresentation(rawStatus: string): Omit<ConnectionImportPresentationBase, 'occurredAt'> {
  const status = normalizedStatus(rawStatus);
  if (status === 'active' || status === 'live') {
    return { kind: 'synced', label: 'Synced', color: '#93C822', importInProgress: false };
  }
  if (status === 'review' || status === 'needs-attention') {
    return { kind: 'review', label: 'Needs review', color: AMBER, importInProgress: false };
  }
  if (isFailed(status) || status.includes('expired') || status.includes('revoked')) {
    return { kind: 'failed', label: 'Import failed', color: RED, importInProgress: false };
  }
  if (ACTIVE_STATUSES.has(status)) {
    return { kind: 'checking', label: 'Checking', color: '#71717A', importInProgress: false };
  }
  return { kind: 'checking', label: 'Checking', color: '#71717A', importInProgress: false };
}

export function deriveConnectionImportPresentation({
  enabled,
  needsReauth = false,
  connectionStatus,
  syncState,
  recommendedAction,
  failureReason = null,
  aggregateState,
  aggregateObservedAt,
  aggregateAttentionCount = 0,
  aggregateItemsSoFar,
  aggregatePhase,
  aggregateStartedAt,
  aggregateP50DurationMs,
  aggregateJobId,
  latestImport,
  latestSuccessfulImport,
  latestFailedImport,
  progressStatus,
  progressReceivedAt,
  progressItemsSoFar,
  progressProcessed,
  progressTotal,
  progressPhase,
  progressStartedAt,
  progressP50DurationMs,
  progressJobId,
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
  aggregateObservedAt?: number | null;
  aggregateAttentionCount?: number | null;
  aggregateItemsSoFar?: number | null;
  aggregatePhase?: string | null;
  aggregateStartedAt?: string | null;
  aggregateP50DurationMs?: number | null;
  aggregateJobId?: string | null;
  latestImport?: RecentImportOutcome | null;
  latestSuccessfulImport?: RecentImportOutcome | null;
  latestFailedImport?: RecentImportOutcome | null;
  progressStatus?: string | null;
  progressReceivedAt?: number | null;
  progressItemsSoFar?: number | null;
  progressProcessed?: number | null;
  progressTotal?: number | null;
  progressPhase?: string | null;
  progressStartedAt?: string | null;
  progressP50DurationMs?: number | null;
  progressJobId?: string | null;
  lastSyncSuccessAt?: string | null;
  connectionUpdatedAt?: string | null;
  canRetryImport?: boolean;
  now?: number;
}): ConnectionImportPresentation {
  const connection = normalizedStatus(connectionStatus);
  const aggregate = normalizedStatus(aggregateState);
  const aggregatePhaseStatus = normalizedStatus(aggregatePhase);
  const latestStatus = normalizedStatus(latestImport?.status);
  const progress = normalizedStatus(progressStatus);
  const progressPhaseStatus = normalizedStatus(progressPhase);
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
  const attentionCount = finiteNonNegativeNumber(aggregateAttentionCount) || 0;
  const presentedItemsSoFar = finiteNonNegativeNumber(progressItemsSoFar)
    ?? finiteNonNegativeNumber(aggregateItemsSoFar)
    ?? finiteNonNegativeNumber(latestImport?.itemsSoFar)
    ?? finiteNonNegativeNumber(latestImport?.itemsCommitted);
  const presentedProcessed = finiteNonNegativeNumber(progressProcessed);
  const presentedTotal = finiteNonNegativeNumber(progressTotal)
    ?? finiteNonNegativeNumber(latestImport?.itemsTotal);
  const presentedPhase = progressPhase || aggregatePhase || latestImport?.phase || null;
  const presentedStartedAt = progressStartedAt
    || aggregateStartedAt
    || latestImport?.startedAt
    || latestImport?.createdAt
    || null;
  const presentedP50DurationMs = finiteNonNegativeNumber(progressP50DurationMs)
    ?? finiteNonNegativeNumber(aggregateP50DurationMs)
    ?? finiteNonNegativeNumber(latestImport?.p50DurationMs);
  const presentedJobId = progressJobId || aggregateJobId || latestImport?.jobId || null;
  const withFailureReason = (
    presentation: ConnectionImportPresentationBase,
    options: {
      includeFailureReason?: boolean;
      allowRetry?: boolean;
      blocking?: boolean;
      requiresReconnect?: boolean;
      showAttention?: boolean;
      phaseOverride?: string | null;
    } = {},
  ): ConnectionImportPresentation => ({
    ...presentation,
    failureReason: options.includeFailureReason ? failureReason : null,
    canRetryImport: !!options.allowRetry && retryAvailable,
    blocking: options.blocking === true,
    requiresReconnect: options.requiresReconnect === true,
    attentionCount,
    attentionColor: options.showAttention || attentionCount > 0 ? AMBER : null,
    itemsSoFar: presentedItemsSoFar,
    processed: presentedProcessed,
    total: presentedTotal,
    phase: 'phaseOverride' in options ? options.phaseOverride ?? null : presentedPhase,
    startedAt: presentedStartedAt,
    p50DurationMs: presentedP50DurationMs,
    jobId: presentedJobId,
    secondaryFailure: options.blocking ? null : secondaryFailure,
  });

  // Explicit reauthentication is the only health signal that unconditionally
  // preempts import evidence. It represents broken credentials, not an item that
  // merely needs review. The legacy needs_reauth status is kept for old servers.
  const requiresReauth = needsReauth || connection === 'needs_reauth';
  if (requiresReauth) {
    return withFailureReason({
      kind: 'review',
      label: 'Needs attention',
      color: RED,
      occurredAt: connectionUpdatedAt || null,
      importInProgress: false,
    }, { includeFailureReason: true, blocking: true, requiresReconnect: true });
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

  if (!enabled && !ACTIVE_STATUSES.has(connection)) {
    return withFailureReason({
      kind: 'disconnected',
      label: 'Disconnected',
      color: '#71717A',
      occurredAt: null,
      importInProgress: false,
    });
  }

  const connectionStatusAt = timestamp(connectionUpdatedAt);
  const connectionHasTerminalStatus = isFailed(connection)
    || UNHEALTHY_CONNECTION_STATUSES.has(connection)
    || syncState === 'error';
  const reconnectRequested = recommendedAction === 'reconnect';
  const failedImportTime = timestamp(failedAt);
  const healthFailureTime = connectionHasTerminalStatus || reconnectRequested
    ? connectionStatusAt
    : Number.NEGATIVE_INFINITY;
  const latestFailureTime = newestTime(failedImportTime, healthFailureTime);
  const evidenceMustBeNewerThan = newestTime(latestSuccessTime, latestFailureTime);

  // Every active source carries attempt timing. Realtime progress without a
  // receipt timestamp is deliberately ignored. Aggregate observations retain
  // the timestamp of the last changed server payload.
  const progressTime = typeof progressReceivedAt === 'number'
    ? progressReceivedAt
    : Number.NEGATIVE_INFINITY;
  const progressActiveStatus = ACTIVE_STATUSES.has(progress)
    ? progress
    : ACTIVE_STATUSES.has(progressPhaseStatus)
      ? progressPhaseStatus
      : null;
  const progressIsFresh = isFreshActiveImportEvidence({
    status: progress,
    phase: progressPhaseStatus,
    receivedAt: progressReceivedAt,
    now,
  })
    && progressTime > evidenceMustBeNewerThan;
  const aggregateTime = typeof aggregateObservedAt === 'number'
    ? aggregateObservedAt
    : Number.NEGATIVE_INFINITY;
  const aggregateActiveStatus = ACTIVE_STATUSES.has(aggregate)
    ? aggregate
    : ACTIVE_STATUSES.has(aggregatePhaseStatus)
      ? aggregatePhaseStatus
      : null;
  const aggregateIsFresh = isFreshActiveImportEvidence({
    status: aggregate,
    phase: aggregatePhaseStatus,
    receivedAt: aggregateObservedAt,
    now,
  })
    && aggregateTime > evidenceMustBeNewerThan;
  const latestRunStartedAt = latestImport
    ? runStartedAt(latestImport)
    : Number.NEGATIVE_INFINITY;
  const historyIsActive = ACTIVE_STATUSES.has(latestStatus)
    && latestImport?.completedAt == null
    && latestRunStartedAt > evidenceMustBeNewerThan
    && now - latestRunStartedAt <= ACTIVE_IMPORT_EVIDENCE_TTL_MS;
  const rawConnectionIsActive = isFreshActiveImportEvidence({
    status: connection,
    receivedAt: connectionStatusAt,
    now,
  }) && connectionStatusAt >= evidenceMustBeNewerThan;
  const activeStatus = progressIsFresh
    ? progressActiveStatus
    : aggregateIsFresh
      ? aggregateActiveStatus
      : rawConnectionIsActive
        ? connection
      : historyIsActive
        ? latestStatus
        : null;
  if (activeStatus) {
    const activePhase = progressIsFresh
      ? progressPhaseStatus || progress
      : aggregateIsFresh
        ? aggregatePhaseStatus || aggregate
        : rawConnectionIsActive
          ? connection
          : latestImport?.phase || latestStatus;
    const label = connectionImportPhaseLabel(activePhase, activeStatus);
    const checking = label === 'Checking';
    const importing = label === 'Importing';
    return withFailureReason({
      kind: checking ? 'checking' : importing ? 'importing' : 'scanning',
      label,
      color: checking ? '#71717A' : AMBER,
      occurredAt: presentedStartedAt || connectionUpdatedAt || null,
      importInProgress: true,
    }, { phaseOverride: activePhase });
  }

  const staleConnectionEvidence = ACTIVE_STATUSES.has(connection)
    && (
      connectionStatusAt === Number.NEGATIVE_INFINITY
        ? evidenceMustBeNewerThan === Number.NEGATIVE_INFINITY
        : connectionStatusAt >= evidenceMustBeNewerThan
    );
  const staleProgressEvidence = !!progressActiveStatus && progressTime > evidenceMustBeNewerThan;
  const staleAggregateEvidence = !!aggregateActiveStatus && aggregateTime > evidenceMustBeNewerThan;
  const staleHistoryEvidence = ACTIVE_STATUSES.has(latestStatus)
    && latestImport?.completedAt == null
    && latestRunStartedAt > evidenceMustBeNewerThan;
  if (
    staleConnectionEvidence
    || staleProgressEvidence
    || staleAggregateEvidence
    || staleHistoryEvidence
  ) {
    return withFailureReason({
      kind: 'checking',
      label: 'Checking',
      color: '#71717A',
      occurredAt: null,
      importInProgress: false,
    }, { phaseOverride: null });
  }

  const healthFailureIsOlderThanSuccess = healthFailureTime !== Number.NEGATIVE_INFINITY
    && latestSuccessTime > healthFailureTime;
  const primaryRunFailure = isFailed(latestStatus) && !failureIsOlderThanSuccess;
  const primaryHealthFailure = (connectionHasTerminalStatus || reconnectRequested)
    && !healthFailureIsOlderThanSuccess;
  if (primaryRunFailure || primaryHealthFailure) {
    const reconnectFailure = reconnectRequested && !connectionHasTerminalStatus && !primaryRunFailure;
    return withFailureReason({
      kind: reconnectFailure ? 'review' : 'failed',
      label: reconnectFailure ? 'Needs attention' : 'Import failed',
      color: RED,
      occurredAt: primaryRunFailure
        ? latestImport?.completedAt || latestImport?.createdAt || null
        : connectionUpdatedAt || failedAt,
      importInProgress: false,
    }, {
      allowRetry: primaryRunFailure && !primaryHealthFailure,
      includeFailureReason: true,
      blocking: true,
      requiresReconnect: primaryHealthFailure,
    });
  }

  const hasReviewEvidence = ATTENTION_STATUSES.has(connection)
    || syncState === 'needs-attention'
    || ATTENTION_STATUSES.has(aggregate)
    || ATTENTION_STATUSES.has(latestStatus)
    || recommendedAction === 'rescan'
    || recommendedAction === 'fix_resume'
    || recommendedAction === 'manage';
  if (hasReviewEvidence) {
    return withFailureReason({
      kind: 'review',
      label: 'Needs review',
      color: AMBER,
      occurredAt: latestImport?.completedAt || latestImport?.createdAt || connectionUpdatedAt || null,
      importInProgress: false,
    }, { allowRetry: true, includeFailureReason: true, showAttention: true });
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

  // A healthy row is itself enough to say Synced. This is also the new backend's
  // partial-success shape: Status='active' plus a nonzero attention count. The
  // main pill stays green while the separate per-row badge stays amber.
  if (HEALTHY_CONNECTION_STATUSES.has(connection)) {
    return withFailureReason({
      kind: 'synced',
      label: 'Synced',
      color: '#93C822',
      occurredAt: lastSyncSuccessAt || connectionUpdatedAt || null,
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
  needsAttention?: number | null;
  observedAt?: number | null;
  itemsSoFar?: number | null;
  phase?: string | null;
  startedAt?: string | null;
  p50DurationMs?: number | null;
  jobId?: string | null;
}

export interface ConnectionImportProgressState {
  status?: string | null;
  receivedAt?: number | null;
  itemsSoFar?: number | null;
  processed?: number | null;
  total?: number | null;
  phase?: string | null;
  startedAt?: string | null;
  p50DurationMs?: number | null;
  jobId?: string | null;
  scanState?: string | null;
  details?: Readonly<Record<string, unknown>> | null;
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
    aggregateConnections.map((connection) => [connection.connectionId, connection]),
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
    (() => {
      const aggregate = aggregateByConnectionId.get(connection.Id);
      const progress = progressByConnectionId[connection.Id];
      const progressDetails = progress?.details;
      return deriveConnectionImportPresentation({
        enabled: connection.IsEnabled !== false,
        needsReauth: connection.NeedsReauth === true,
        connectionStatus: connection.Status,
        syncState: connection.SyncState,
        recommendedAction: connection.RecommendedAction,
        failureReason: connection.FailureReason ?? null,
        aggregateState: aggregate?.state,
        aggregateObservedAt: aggregate?.observedAt,
        aggregateAttentionCount: aggregate?.needsAttention,
        aggregateItemsSoFar: aggregate?.itemsSoFar,
        aggregatePhase: aggregate?.phase,
        aggregateStartedAt: aggregate?.startedAt,
        aggregateP50DurationMs: aggregate?.p50DurationMs,
        aggregateJobId: aggregate?.jobId,
        latestImport: latestByConnectionId.get(connection.Id),
        latestSuccessfulImport: successfulByConnectionId.get(connection.Id),
        latestFailedImport: failedByConnectionId.get(connection.Id),
        progressStatus: progress?.status || progress?.scanState || String(progressDetails?.scanState || ''),
        progressReceivedAt: progress?.receivedAt,
        progressItemsSoFar: progress?.itemsSoFar
          ?? finiteNonNegativeNumber(progressDetails?.itemsSoFar),
        progressProcessed: progress?.processed
          ?? finiteNonNegativeNumber(progressDetails?.processed),
        progressTotal: progress?.total
          ?? finiteNonNegativeNumber(progressDetails?.total),
        progressPhase: progress?.phase || String(progressDetails?.phase || ''),
        progressStartedAt: progress?.startedAt || String(progressDetails?.startedAt || ''),
        progressP50DurationMs: progress?.p50DurationMs
          ?? finiteNonNegativeNumber(progressDetails?.p50DurationMs),
        progressJobId: progress?.jobId || String(progressDetails?.jobId || ''),
        lastSyncSuccessAt: connection.LastSyncSuccessAt,
        connectionUpdatedAt: connection.UpdatedAt,
        canRetryImport: connection.IsEnabled !== false,
      });
    })(),
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
