/**
 * One polling hook for async job status.
 *
 * Replaces the copy-pasted `setInterval` + terminal-check + (inconsistent)
 * AppState handling that was reimplemented in every review sheet and job screen.
 * Built from the one site that did it right (LoadingScreen): it pauses while the
 * app is backgrounded, polls immediately on resume, never overlaps requests,
 * stops on a terminal status, and cleans up its interval + AppState listener.
 *
 * The caller supplies how to fetch a snapshot (so it works for manifests,
 * receipts, match/generate jobs alike); this hook owns the timing only.
 *
 *   const { snapshot, status, isPolling } = useJobStatus(jobId,
 *     (id) => api.get(`/api/products/manifests/${id}/status`),
 *     { intervalMs: 2000, onTerminal: (s) => applyResult(s) });
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { withRetry } from '../lib/withRetry';
import { createLogger } from '../utils/logger';
import { isTerminalJobStatus } from '../constants/jobStatus';

const log = createLogger('useJobStatus');

export interface UseJobStatusOptions<T> {
  /** Poll cadence in ms. Default 2000. */
  intervalMs?: number;
  /** Skip polling entirely when false (still returns a stable result). Default true. */
  enabled?: boolean;
  /** Pause while the app is backgrounded; resume + poll on foreground. Default true. */
  pauseInBackground?: boolean;
  /** Extract the status string from a snapshot. Default `s.status`. */
  getStatus?: (snapshot: T) => string | undefined;
  /** Override the stop condition. Defaults to status ∈ {completed, failed}. */
  isTerminal?: (snapshot: T) => boolean;
  /** Called for every successful snapshot. */
  onSnapshot?: (snapshot: T) => void;
  /** Called once, when a terminal snapshot is seen. */
  onTerminal?: (snapshot: T) => void;
  /** Called when a poll attempt ultimately fails (after in-tick retries). */
  onError?: (error: unknown) => void;
  /** Per-tick transient-error retries before surfacing. Default 2. */
  retryAttempts?: number;
}

export interface UseJobStatusResult<T> {
  snapshot: T | null;
  status: string | undefined;
  error: unknown;
  isPolling: boolean;
  /** Force an immediate poll (e.g. after a user action). */
  refresh: () => void;
  /** Stop polling permanently (until jobId/enabled changes). */
  stop: () => void;
}

export function useJobStatus<T = unknown>(
  jobId: string | null | undefined,
  fetchSnapshot: (jobId: string) => Promise<T>,
  options: UseJobStatusOptions<T> = {},
): UseJobStatusResult<T> {
  const { intervalMs = 2000, enabled = true, pauseInBackground = true } = options;

  const [snapshot, setSnapshot] = useState<T | null>(null);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [isPolling, setIsPolling] = useState(false);

  // Latest fetch fn + callbacks in refs so the polling effect's identity depends
  // only on (jobId, enabled, intervalMs) — it must not tear down/reset on every
  // render just because an inline callback changed.
  const fetchRef = useRef(fetchSnapshot);
  fetchRef.current = fetchSnapshot;
  const optsRef = useRef(options);
  optsRef.current = options;

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef(false);
  const stoppedRef = useRef(false);
  const pollNowRef = useRef<() => Promise<void>>(async () => {});

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    clearTimer();
    setIsPolling(false);
  }, [clearTimer]);

  const refresh = useCallback(() => {
    void pollNowRef.current();
  }, []);

  useEffect(() => {
    stoppedRef.current = false;
    if (!enabled || !jobId) {
      clearTimer();
      setIsPolling(false);
      return;
    }

    let cancelled = false;
    setIsPolling(true);

    const isTerminalSnapshot = (snap: T): boolean => {
      const o = optsRef.current;
      if (o.isTerminal) return o.isTerminal(snap);
      const status = (o.getStatus ?? ((s: any) => s?.status))(snap);
      return isTerminalJobStatus(status);
    };

    const startTimer = () => {
      if (!intervalRef.current && !stoppedRef.current) {
        intervalRef.current = setInterval(() => void poll(), intervalMs);
      }
    };

    const poll = async () => {
      if (cancelled || stoppedRef.current || inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const o = optsRef.current;
        const snap = await withRetry(() => fetchRef.current(jobId), {
          maxAttempts: o.retryAttempts ?? 2,
          initialDelayMs: 400,
          maxDelayMs: 2000,
        });
        if (cancelled || stoppedRef.current) return;
        setSnapshot(snap);
        setError(null);
        setStatus((o.getStatus ?? ((s: any) => s?.status))(snap));
        o.onSnapshot?.(snap);
        if (isTerminalSnapshot(snap)) {
          stoppedRef.current = true;
          clearTimer();
          setIsPolling(false);
          o.onTerminal?.(snap);
        }
      } catch (err) {
        if (cancelled || stoppedRef.current) return;
        setError(err);
        optsRef.current.onError?.(err);
        log.warn(`poll failed for job ${jobId}`, err);
        // Transient: leave the interval running so the next tick retries.
      } finally {
        inFlightRef.current = false;
      }
    };

    pollNowRef.current = poll;
    void poll();
    startTimer();

    let appStateSub: { remove: () => void } | undefined;
    if (pauseInBackground) {
      let prev: AppStateStatus = AppState.currentState;
      appStateSub = AppState.addEventListener('change', (next) => {
        const wasBackground = /inactive|background/.test(prev);
        prev = next;
        if (next === 'active') {
          startTimer();
          if (wasBackground) void poll();
        } else if (/inactive|background/.test(next)) {
          clearTimer();
        }
      });
    }

    return () => {
      cancelled = true;
      pollNowRef.current = async () => {};
      clearTimer();
      appStateSub?.remove();
    };
  }, [jobId, enabled, intervalMs, pauseInBackground, clearTimer]);

  return { snapshot, status, error, isPolling, refresh, stop };
}
