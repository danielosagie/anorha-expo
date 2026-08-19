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
const SUCCESS_STATUSES = new Set([
  'active',
  'live',
  'review',
  'needs-attention',
  'complete',
  'completed',
  'success',
  'succeeded',
]);

const normalized = (value?: string | null): string => String(value || '').trim().toLowerCase();

function timestamp(value?: string | null): number {
  const parsed = Date.parse(String(value || ''));
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

export type DismissedImportOutcome =
  | { kind: 'wait' }
  | { kind: 'active' }
  | { kind: 'expired' }
  | { kind: 'success'; toastTitle: string }
  | { kind: 'failure'; toastTitle: string; actionLabel: 'Retry' };

export function decideDismissedImportOutcome({
  platformLabel,
  startedAt,
  connectionStatus,
  progressStatus,
  progressReceivedAt,
  lastSyncSuccessAt,
  connectionUpdatedAt,
  observedActive,
  now = Date.now(),
  watchTtlMs = 30 * 60 * 1000,
}: {
  platformLabel: string;
  startedAt: number;
  connectionStatus?: string | null;
  progressStatus?: string | null;
  progressReceivedAt?: number | null;
  lastSyncSuccessAt?: string | null;
  connectionUpdatedAt?: string | null;
  observedActive: boolean;
  now?: number;
  watchTtlMs?: number;
}): DismissedImportOutcome {
  if (now - startedAt > watchTtlMs) return { kind: 'expired' };

  const connection = normalized(connectionStatus);
  const progress = normalized(progressStatus);
  if (ACTIVE_STATUSES.has(connection) || ACTIVE_STATUSES.has(progress)) {
    return { kind: 'active' };
  }

  const failed = connection === 'error'
    || connection.includes('fail')
    || progress === 'error'
    || progress.includes('fail');
  const failureBelongsToAttempt = observedActive
    || timestamp(connectionUpdatedAt) >= startedAt
    || (typeof progressReceivedAt === 'number' && progressReceivedAt >= startedAt);
  if (failed && failureBelongsToAttempt) {
    return {
      kind: 'failure',
      toastTitle: `${platformLabel} import stopped`,
      actionLabel: 'Retry',
    };
  }
  if (failed) return { kind: 'wait' };

  const syncReceiptIsCurrent = timestamp(lastSyncSuccessAt) >= startedAt;
  const terminalProgress = SUCCESS_STATUSES.has(progress);
  const observedThenSettled = observedActive && SUCCESS_STATUSES.has(connection);
  if (syncReceiptIsCurrent || terminalProgress || observedThenSettled) {
    return { kind: 'success', toastTitle: `${platformLabel} import done` };
  }

  return { kind: 'wait' };
}
