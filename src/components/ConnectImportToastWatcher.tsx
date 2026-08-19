import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { useToast } from '../context/ToastContext';
import {
  forgetDismissedConnectImport,
  getDismissedConnectImports,
  subscribeDismissedConnectImports,
} from '../lib/connectImportDismissals';

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
const SUCCESS_STATUSES = new Set(['active', 'live', 'review', 'needs-attention', 'complete', 'completed', 'success', 'succeeded']);
const CLOCK_SKEW_MS = 30_000;
const WATCH_TTL_MS = 30 * 60 * 1000;
const REFRESH_MS = 5000;

function normalized(value?: string | null): string {
  return String(value || '').trim().toLowerCase();
}

function platformKey(value?: string | null): string {
  return normalized(value).replace(/[\s_-]+/g, '');
}

function timestamp(value?: string | null): number {
  const parsed = Date.parse(String(value || ''));
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Keeps completion toasts alive after the modal's parent screen unmounts. The
 * existing global ToastHost owns display; this watcher only resolves dismissed
 * imports against the shared platform connection/progress store.
 */
export default function ConnectImportToastWatcher() {
  const imports = useSyncExternalStore(
    subscribeDismissedConnectImports,
    getDismissedConnectImports,
    getDismissedConnectImports,
  );
  const { connections, progressByConnectionId, refresh } = usePlatformConnections();
  const { showToast } = useToast();
  const observedActiveRef = useRef(new Set<number>());

  useEffect(() => {
    if (imports.length === 0) return;

    const refreshIfForegrounded = () => {
      if (AppState.currentState === 'active') void refresh();
    };
    refreshIfForegrounded();
    const interval = setInterval(refreshIfForegrounded, REFRESH_MS);
    let previousState: AppStateStatus = AppState.currentState;
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      const resumed = nextState === 'active' && previousState !== 'active';
      previousState = nextState;
      if (resumed) refreshIfForegrounded();
    });
    return () => {
      clearInterval(interval);
      appStateSubscription.remove();
    };
  }, [imports.length, refresh]);

  useEffect(() => {
    for (const importRun of imports) {
      if (Date.now() - importRun.startedAt > WATCH_TTL_MS) {
        observedActiveRef.current.delete(importRun.token);
        forgetDismissedConnectImport(importRun.token);
        continue;
      }

      const expectedPlatform = platformKey(importRun.platform);
      const connection = importRun.connectionId
        ? connections.find((row) => row.Id === importRun.connectionId)
        : [...connections]
            .filter((row) => platformKey(row.PlatformType) === expectedPlatform)
            .sort((left, right) => timestamp(right.UpdatedAt) - timestamp(left.UpdatedAt))[0];
      if (!connection) continue;

      const connectionStatus = normalized(connection.Status);
      const progressStatus = normalized(progressByConnectionId[connection.Id]?.status);
      const active = ACTIVE_STATUSES.has(connectionStatus) || ACTIVE_STATUSES.has(progressStatus);
      if (active) {
        observedActiveRef.current.add(importRun.token);
        continue;
      }

      const failed = connectionStatus === 'error'
        || connectionStatus.includes('fail')
        || progressStatus === 'error'
        || progressStatus.includes('fail');
      if (failed) {
        observedActiveRef.current.delete(importRun.token);
        forgetDismissedConnectImport(importRun.token);
        continue;
      }

      const syncReceiptIsCurrent = timestamp(connection.LastSyncSuccessAt)
        >= importRun.startedAt - CLOCK_SKEW_MS;
      const terminalProgress = SUCCESS_STATUSES.has(progressStatus);
      const observedThenSettled = observedActiveRef.current.has(importRun.token)
        && SUCCESS_STATUSES.has(connectionStatus);
      if (!syncReceiptIsCurrent && !terminalProgress && !observedThenSettled) continue;

      observedActiveRef.current.delete(importRun.token);
      forgetDismissedConnectImport(importRun.token);
      if (AppState.currentState === 'active') {
        showToast({ title: `${importRun.platformLabel} import done`, tone: 'success' });
      }
    }
  }, [connections, imports, progressByConnectionId, showToast]);

  return null;
}
