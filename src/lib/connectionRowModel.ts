import type {
  ConnectionImportKind,
  ConnectionImportPresentation,
} from './connectionImportPresentation.ts';

const GREEN = '#93C822';
const AMBER = '#A2611A';
const RED = '#DC2626';
const GRAY = '#71717A';

type ConnectionRowStatus = {
  label: string;
  color: string;
};

export type ConnectionRowAction = 'Reconnect' | 'Retry' | 'Review';

export type ConnectionRowTrailing =
  | { type: 'action'; label: ConnectionRowAction }
  | { type: 'chevron' };

export type ConnectionRowModel = {
  status: ConnectionRowStatus;
  trailing: ConnectionRowTrailing;
};

const STATUS_BY_KIND = {
  disconnected: { label: 'Disconnected', color: GRAY },
  synced: { label: 'Synced', color: GREEN },
  review: { label: 'Needs review', color: AMBER },
  failed: { label: 'Import failed', color: RED },
  scanning: { label: 'Importing', color: AMBER },
  importing: { label: 'Importing', color: AMBER },
  checking: { label: 'Checking', color: GRAY },
} satisfies Record<ConnectionImportKind, ConnectionRowStatus>;

const RECONNECT_STATUS: ConnectionRowStatus = {
  label: 'Reconnect needed',
  color: RED,
};

/**
 * Collapses the shared import presentation into the only two signals a
 * connection list row may render: one status and one trailing affordance.
 */
export function connectionRowModel(
  presentation: Pick<
    ConnectionImportPresentation,
    'kind' | 'requiresReconnect' | 'canRetryImport' | 'attentionCount'
  >,
): ConnectionRowModel {
  if (presentation.requiresReconnect) {
    return {
      status: RECONNECT_STATUS,
      trailing: { type: 'action', label: 'Reconnect' },
    };
  }

  const status = STATUS_BY_KIND[presentation.kind];

  if (presentation.kind === 'failed' && presentation.canRetryImport) {
    return { status, trailing: { type: 'action', label: 'Retry' } };
  }

  if (
    presentation.kind === 'review'
    || (presentation.kind === 'synced' && presentation.attentionCount > 0)
  ) {
    return { status, trailing: { type: 'action', label: 'Review' } };
  }

  return { status, trailing: { type: 'chevron' } };
}
