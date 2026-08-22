import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';

import { apiFetch } from '../lib/apiClient';
import { createLogger } from '../utils/logger';

const log = createLogger('useImportJobProgress');
export const IMPORT_SOCKET_QUIET_MS = 30_000;
const JOB_POLL_MS = 10_000;

export interface ImportJobProgress {
  state: 'active' | 'completed' | 'failed';
  processed: number | null;
  total: number | null;
  itemsSoFar: number | null;
  phase: string | null;
  description: string | null;
}

function optionalCount(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parseImportJobProgress(payload: unknown): ImportJobProgress | null {
  const value = payload as any;
  if (!value || typeof value !== 'object') return null;
  const processed = optionalCount(value.processed);
  const itemsSoFar = optionalCount(value.itemsSoFar) ?? processed;
  if (value.isCompleted === true) {
    return {
      state: 'completed',
      processed,
      total: optionalCount(value.total),
      itemsSoFar,
      phase: typeof value.phase === 'string' ? value.phase : null,
      description: typeof value.description === 'string' ? value.description : null,
    };
  }
  if (value.isFailed === true || value.isActive === false) {
    return {
      state: 'failed',
      processed,
      total: optionalCount(value.total),
      itemsSoFar,
      phase: typeof value.phase === 'string' ? value.phase : null,
      description: typeof value.description === 'string' ? value.description : null,
    };
  }
  if (value.isActive !== true) return null;
  return {
    state: 'active',
    processed,
    total: optionalCount(value.total),
    itemsSoFar,
    phase: typeof value.phase === 'string' ? value.phase : null,
    description: typeof value.description === 'string' ? value.description : null,
  };
}

export function resolveImportJobId(
  jobId?: string | null,
  summaryJobId?: string | null,
): string | null {
  return jobId || summaryJobId || null;
}

export function useImportJobProgress({
  jobId,
  summaryJobId,
  enabled,
  lastSocketAt,
}: {
  jobId?: string | null;
  summaryJobId?: string | null;
  enabled: boolean;
  lastSocketAt?: number | null;
}): { progress: ImportJobProgress | null; polling: boolean } {
  const resolvedJobId = resolveImportJobId(jobId, summaryJobId);
  const isFocused = useIsFocused();
  const [progress, setProgress] = useState<ImportJobProgress | null>(null);
  const [polling, setPolling] = useState(false);
  const inFlightRef = useRef(false);
  const enabledAtRef = useRef(Date.now());

  useEffect(() => {
    enabledAtRef.current = Date.now();
    setProgress(null);
    setPolling(false);
  }, [resolvedJobId]);

  useEffect(() => {
    if (enabled) enabledAtRef.current = Date.now();
  }, [enabled]);

  const poll = useCallback(async (signal?: AbortSignal) => {
    if (!resolvedJobId || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const response = await apiFetch(
        `/api/sync/jobs/${encodeURIComponent(resolvedJobId)}/progress`,
        { signal },
      );
      if (!response.ok) throw new Error(`Job progress failed: ${response.status}`);
      const parsed = parseImportJobProgress(await response.json());
      if (parsed) setProgress(parsed);
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name !== 'AbortError') {
        log.debug('job progress poll failed', error);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [resolvedJobId]);

  const terminal = progress?.state === 'completed' || progress?.state === 'failed';
  useEffect(() => {
    if (!enabled || !isFocused || !resolvedJobId || terminal) {
      setPolling(false);
      return;
    }

    let interval: ReturnType<typeof setInterval> | null = null;
    const controller = new AbortController();
    const startPolling = () => {
      setPolling(true);
      void poll(controller.signal);
      interval = setInterval(() => void poll(controller.signal), JOB_POLL_MS);
    };
    const signalAt = Math.max(enabledAtRef.current, lastSocketAt || 0);
    const delay = Math.max(0, IMPORT_SOCKET_QUIET_MS - (Date.now() - signalAt));
    const timeout = setTimeout(startPolling, delay);
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
      controller.abort();
    };
  }, [enabled, isFocused, resolvedJobId, lastSocketAt, poll, terminal]);

  return { progress, polling };
}
