import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { useToast } from '../context/ToastContext';
import {
  forgetDismissedConnectImport,
  getDismissedConnectImports,
  subscribeDismissedConnectImports,
  trackDismissedConnectImport,
} from '../lib/connectImportDismissals';
import { decideDismissedImportOutcome } from '../lib/dismissedImportOutcome';
import { usePlatformConnect } from '../hooks/usePlatformConnect';

const REFRESH_MS = 5000;

function normalized(value?: string | null): string {
  return String(value || '').trim().toLowerCase();
}

function platformKey(value?: string | null): string {
  return normalized(value).replace(/[\s_-]+/g, '');
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
  const { startScan } = usePlatformConnect();
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
      const expectedPlatform = platformKey(importRun.platform);
      const connection = importRun.connectionId
        ? connections.find((row) => row.Id === importRun.connectionId)
        : [...connections]
            .filter((row) => platformKey(row.PlatformType) === expectedPlatform)
            .sort((left, right) => Date.parse(right.UpdatedAt) - Date.parse(left.UpdatedAt))[0];

      const progress = connection ? progressByConnectionId[connection.Id] : undefined;
      const outcome = decideDismissedImportOutcome({
        platformLabel: importRun.platformLabel,
        startedAt: importRun.startedAt,
        connectionStatus: connection?.Status,
        progressStatus: progress?.status,
        progressReceivedAt: progress?.receivedAt,
        lastSyncSuccessAt: connection?.LastSyncSuccessAt,
        connectionUpdatedAt: connection?.UpdatedAt,
        observedActive: observedActiveRef.current.has(importRun.token),
      });

      if (outcome.kind === 'active') {
        observedActiveRef.current.add(importRun.token);
        continue;
      }
      if (outcome.kind === 'wait') continue;

      if (outcome.kind === 'expired') {
        observedActiveRef.current.delete(importRun.token);
        forgetDismissedConnectImport(importRun.token);
        continue;
      }

      observedActiveRef.current.delete(importRun.token);
      forgetDismissedConnectImport(importRun.token);
      if (AppState.currentState !== 'active') continue;

      if (outcome.kind === 'failure' && connection) {
        showToast({
          title: outcome.toastTitle,
          tone: 'danger',
          action: {
            label: outcome.actionLabel,
            onPress: () => {
              void startScan(connection.Id).then((started) => {
                if (!started) {
                  showToast({ title: `${importRun.platformLabel} retry failed`, tone: 'danger' });
                  return;
                }
                trackDismissedConnectImport({
                  connectionId: connection.Id,
                  platform: importRun.platform,
                  platformLabel: importRun.platformLabel,
                  startedAt: Date.now(),
                });
                void refresh();
              });
            },
          },
        });
      } else if (outcome.kind === 'success') {
        showToast({ title: outcome.toastTitle, tone: 'success' });
      }
    }
  }, [connections, imports, progressByConnectionId, refresh, showToast, startScan]);

  return null;
}
