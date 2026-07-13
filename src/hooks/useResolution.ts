import { useCallback, useEffect, useRef, useState } from 'react';
import { ensureSupabaseJwt } from '../lib/supabase';
import { API_BASE_URL } from '../config/env';
import { createLogger } from '../utils/logger';
import type { ResolveResult, ResolveChoice, ResolveResponse } from '../types/syncItem';

const log = createLogger('useResolution');

// Some deployments set API_BASE_URL with a trailing `/api` (the rest of the app
// normalizes the same way — see ConnectedPlatformItem / InviteMemberModal).
// Normalize once so we never compose `/api/api/…` and silently 404 the inbox.
const API_BASE = (() => {
  const trimmed = API_BASE_URL.replace(/\/$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
})();

// The async-inbox data layer (SYNC_REBUILD stage 3). Reads the resolver's three
// buckets and applies one inbox decision. It does NOT touch the legacy import
// endpoints — the certain buckets are already synced by auto-pilot on connect;
// this only resolves the rare `needsAttention` item, non-blocking.
export function useResolution(connectionId: string | null | undefined) {
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  // Guards against the 3s poll (below) stacking overlapping refreshes: a slow/stalled load
  // must not spawn a second in-flight fetch every tick. The poll only reschedules when
  // `result` changes, so an in-flight refresh naturally paces the next tick to after it lands.
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!connectionId) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    // Without a timeout the inbox fetch could hang forever → permanent SyncInbox spinner.
    // Abort at 12s so it lands in the error state the screen already renders (with Retry).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      setLoading(true);
      setError(null);
      const token = await ensureSupabaseJwt();
      const res = await fetch(`${API_BASE}/sync/connections/${connectionId}/resolution`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Failed to load inbox: ${res.status}`);
      setResult((await res.json()) as ResolveResult);
    } catch (err: any) {
      const msg = err?.name === 'AbortError' ? 'Loading the inbox timed out — pull to retry.' : (err?.message ?? 'Failed to load inbox');
      log.warn('refresh failed', msg);
      setError(msg);
    } finally {
      clearTimeout(timer);
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // A freshly-connected scan is still populating when the inbox first mounts, so
  // the initial fetch lands before any resolver items exist. Without this the
  // user is stranded on an empty list until they pull to refresh. Poll a bounded
  // number of times (≈60s at 3s cadence) until the scan has produced anything
  // (summary.total > 0), then stop. Paused while a resolve is in flight so it
  // can't clobber the optimistic state; the counter persists across re-renders
  // (a ref, not effect-local) and resets only when the connection changes.
  const pollCountRef = useRef(0);
  useEffect(() => {
    pollCountRef.current = 0;
  }, [connectionId]);
  useEffect(() => {
    if (!connectionId) return;
    if ((result?.summary?.total ?? 0) > 0) return; // scan produced data → done
    if (resolving !== null) return; // don't fight an in-flight resolve
    if (pollCountRef.current >= 20) return; // cap reached → give up, manual refresh only
    const id = setTimeout(() => {
      pollCountRef.current += 1;
      refresh();
    }, 3000);
    return () => clearTimeout(id);
  }, [connectionId, result, resolving, refresh]);

  // Apply one decision. The row is removed only AFTER the server confirms, so a
  // failed resolve (or a failed reconcile refresh) can never leave an item hidden
  // while the server still considers it unresolved.
  const resolve = useCallback(
    async (platformId: string, choice: ResolveChoice, canonicalId?: string): Promise<ResolveResponse | null> => {
      if (!connectionId) return null;
      setResolving(platformId);
      try {
        const token = await ensureSupabaseJwt();
        const res = await fetch(`${API_BASE}/sync/connections/${connectionId}/resolve`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ platformId, choice, canonicalId }),
        });
        // 409 = the row's Version CAS was stale: another device/session resolved
        // this item concurrently. Nothing has been removed locally yet, so there
        // is nothing to roll back — quietly re-sync with the server instead. If
        // the other resolution stuck, the item leaves needsAttention on its own;
        // if the row merely changed, it re-renders with fresh data for a retry.
        // (An identical re-send of the SAME decision is a 200 {alreadyResolved},
        // not a 409 — that path falls through to the normal removal below.)
        if (res.status === 409) {
          log.debug('resolve conflicted (409) — refetching', platformId);
          await refresh();
          return null;
        }
        if (!res.ok) throw new Error(`Resolve failed: ${res.status}`);
        setResult((prev) =>
          prev ? { ...prev, needsAttention: prev.needsAttention.filter((i) => i.platformId !== platformId) } : prev,
        );
        return (await res.json().catch(() => ({ success: true }))) as ResolveResponse;
      } catch (err: any) {
        log.warn('resolve failed', err?.message);
        await refresh(); // reconcile with the true server state (keeps the list visible)
        throw err;
      } finally {
        setResolving(null);
      }
    },
    [connectionId, refresh],
  );

  return { result, loading, error, resolving, refresh, resolve };
}
