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
  'pending',
  'in_progress',
  'processing',
  'scanning',
  'syncing',
  'reconciling',
  'ready_to_sync',
]);

function normalizedStatus(value?: string | null): string {
  return String(value || '').trim().toLowerCase();
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
}: {
  enabled: boolean;
  connectionStatus?: string | null;
  aggregateState?: string | null;
  latestImport?: RecentImportOutcome | null;
}): ConnectionImportPresentation {
  if (!enabled || normalizedStatus(connectionStatus) === 'inactive') {
    return {
      kind: 'disconnected',
      label: 'Disconnected',
      color: '#71717A',
      occurredAt: null,
      importInProgress: false,
    };
  }

  const aggregate = normalizedStatus(aggregateState);
  const latestStatus = normalizedStatus(latestImport?.status);
  const occurredAt = latestImport?.completedAt || latestImport?.createdAt || null;

  if (ACTIVE_STATUSES.has(latestStatus)) {
    const scanning = latestStatus === 'pending' || latestStatus === 'scanning';
    return {
      kind: scanning ? 'scanning' : 'importing',
      label: scanning ? 'Scanning products...' : 'Importing inventory...',
      color: '#A2611A',
      occurredAt,
      importInProgress: true,
    };
  }

  if (aggregate === 'scanning' || aggregate === 'syncing') {
    return {
      kind: aggregate === 'scanning' ? 'scanning' : 'importing',
      label: aggregate === 'scanning' ? 'Scanning products...' : 'Importing inventory...',
      color: '#A2611A',
      occurredAt: null,
      importInProgress: true,
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
