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
}

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
const DISCONNECTED_STATUSES = new Set([
  'inactive',
  'disconnected',
  'disabled',
  'revoked',
  'needs_reauth',
]);

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

function fallbackPresentation(rawStatus: string): Omit<ConnectionImportPresentation, 'occurredAt'> {
  const status = normalizedStatus(rawStatus);
  if (status === 'active' || status === 'live') {
    return { kind: 'synced', label: 'Synced', color: '#43631A', importInProgress: false };
  }
  if (status === 'review' || status === 'needs-attention') {
    return { kind: 'review', label: 'Needs review', color: '#BA7517', importInProgress: false };
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
  connectionStatus,
  aggregateState,
  latestImport,
  progressStatus,
}: {
  enabled: boolean;
  connectionStatus?: string | null;
  aggregateState?: string | null;
  latestImport?: RecentImportOutcome | null;
  progressStatus?: string | null;
}): ConnectionImportPresentation {
  const connection = normalizedStatus(connectionStatus);
  const aggregate = normalizedStatus(aggregateState);
  const latestStatus = normalizedStatus(latestImport?.status);
  const progress = normalizedStatus(progressStatus);
  const occurredAt = latestImport?.completedAt || latestImport?.createdAt || null;

  // A running import is the freshest operational truth. It must beat a stale
  // disabled/disconnected connection snapshot, which is common during the first
  // refresh after OAuth creates a new row and queues its initial scan.
  const activeStatus = [progress, aggregate, latestStatus, connection]
    .find((status) => ACTIVE_STATUSES.has(status));
  if (activeStatus) {
    const scanning = activeStatus === 'pending' || activeStatus === 'scanning';
    return {
      kind: scanning ? 'scanning' : 'importing',
      label: scanning ? 'Scanning products...' : 'Importing inventory...',
      color: '#A2611A',
      occurredAt,
      importInProgress: true,
    };
  }

  if (!enabled || DISCONNECTED_STATUSES.has(connection)) {
    return {
      kind: 'disconnected',
      label: 'Disconnected',
      color: '#71717A',
      occurredAt: null,
      importInProgress: false,
    };
  }

  if (SUCCESS_STATUSES.has(latestStatus)) {
    return {
      kind: 'synced',
      label: 'Synced',
      color: '#43631A',
      occurredAt,
      importInProgress: false,
    };
  }

  if (isFailed(latestStatus)) {
    return {
      kind: 'failed',
      label: 'Import failed',
      color: '#DC2626',
      occurredAt,
      importInProgress: false,
    };
  }

  return {
    ...fallbackPresentation(String(connectionStatus || aggregateState || '')),
    occurredAt: null,
  };
}

export interface ConnectionImportPresentationRow {
  Id: string;
  IsEnabled?: boolean | null;
  Status?: string | null;
  NeedsReauth?: boolean | null;
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
      enabled: connection.IsEnabled !== false && connection.NeedsReauth !== true,
      connectionStatus: connection.NeedsReauth ? 'revoked' : connection.Status,
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

export interface SellingPlatformConnectionPartition<T> {
  active: T[];
  inactive: T[];
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
 * Data-layer partition for selling-platform surfaces. CSV import records never
 * enter either list. A running import stays active even when the cached row still
 * carries a disconnected flag; all other disconnected/revoked rows are quiet.
 */
export function partitionSellingPlatformConnections<T extends SellingPlatformConnectionRow>(
  connections: readonly T[],
  presentationByConnectionId: ReadonlyMap<string, ConnectionImportPresentation> = new Map(),
): SellingPlatformConnectionPartition<T> {
  const active: T[] = [];
  const inactive: T[] = [];

  for (const connection of connections) {
    if (isCsvPseudoConnection(connection)) continue;

    const presentation = presentationByConnectionId.get(connection.Id)
      || deriveConnectionImportPresentation({
        enabled: connection.IsEnabled !== false && connection.NeedsReauth !== true,
        connectionStatus: connection.NeedsReauth ? 'revoked' : connection.Status,
      });

    if (presentation.importInProgress) {
      active.push(connection);
    } else if (connection.NeedsReauth === true || presentation.kind === 'disconnected') {
      inactive.push(connection);
    } else {
      active.push(connection);
    }
  }

  return { active, inactive };
}
