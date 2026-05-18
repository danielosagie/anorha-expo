import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ensureSupabaseJwt } from '../lib/supabase';
import { LAST_IMPORT_STORAGE_KEY } from './useImportSession';

const SSSYNC_API_BASE_URL = (
  process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL ||
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  'https://api.sssync.app'
).replace(/\/$/, '');

const TERMINAL = new Set(['completed', 'completed_with_errors', 'failed']);

export interface ImportProgress {
  operationId: string;
  status: string;
  processed: number;
  total: number;
  failed: number;
  active: boolean;
}

/**
 * Surfaces a resumable in-flight CSV/import job. Reads the stored import
 * (written by submitImport), polls the backend status endpoint, and clears
 * itself once the import reaches a terminal state.
 */
export function useImportProgress(pollMs = 5000) {
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);

  const clear = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(LAST_IMPORT_STORAGE_KEY);
    } catch {
      /* no-op */
    }
    setProgress(null);
  }, []);

  const poll = useCallback(async () => {
    if (stopped.current) return;
    let stored: any = null;
    try {
      const raw = await AsyncStorage.getItem(LAST_IMPORT_STORAGE_KEY);
      stored = raw ? JSON.parse(raw) : null;
    } catch {
      stored = null;
    }
    if (!stored?.operationId) {
      setProgress(null);
      return;
    }

    try {
      const token = await ensureSupabaseJwt();
      const res = await fetch(
        `${SSSYNC_API_BASE_URL}/api/sync/operations/${stored.operationId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const d = await res.json();
        const status = String(d?.status || 'queued');
        const isTerminal = TERMINAL.has(status);
        setProgress({
          operationId: stored.operationId,
          status,
          processed: Number(d?.itemsProcessed ?? 0),
          total: Number(d?.itemsTotal ?? stored.itemsTotal ?? 0),
          failed: Number(d?.failedCount ?? 0),
          active: !isTerminal,
        });
        if (isTerminal) {
          await clear();
          return;
        }
      }
    } catch {
      // transient: keep last known progress, try again next tick
    }

    if (!stopped.current) {
      timer.current = setTimeout(poll, pollMs);
    }
  }, [pollMs, clear]);

  useEffect(() => {
    stopped.current = false;
    poll();
    return () => {
      stopped.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [poll]);

  return { progress, dismiss: clear };
}
