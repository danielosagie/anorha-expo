import { useCallback, useEffect, useRef, useState } from 'react';
import { ensureSupabaseJwt } from '../lib/supabase';
import { API_BASE_URL } from '../config/env';
import { createLogger } from '../utils/logger';
import type {
  ResolveResult,
  ResolveChoice,
  ResolveResponse,
  ResolveOptions,
  BulkResolveItem,
  BulkResolveResponse,
} from '../types/syncItem';
import {
  chunkBulkResolveItems,
  normalizeBulkResolveResults,
  reconcileNeedsAttentionAfterBulk,
} from '../lib/bulkResolution';

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
export function useResolution(connectionId: string | null | undefined, importId?: string | null) {
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  // Guards explicit refreshes from stacking. This hook intentionally does not poll;
  // callers refresh after a commit or while they own an in-flight scan surface.
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!connectionId) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    // Without a timeout the review fetch could hang forever and leave a permanent spinner.
    // Abort at 12s so it lands in the error state the screen already renders (with Retry).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      setLoading(true);
      setError(null);
      const token = await ensureSupabaseJwt();
      const query = importId ? `?importId=${encodeURIComponent(importId)}` : '';
      const res = await fetch(`${API_BASE}/sync/connections/${connectionId}/resolution${query}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Failed to load inbox: ${res.status}`);
      const payload = (await res.json()) as ResolveResult;
      // Version was added to the rows-backed payload after the original mobile
      // mirror. Accept either casing during the rolling deployment.
      payload.needsAttention = (payload.needsAttention ?? []).map((item: any) => ({
        ...item,
        version: Number.isInteger(item?.version)
          ? item.version
          : Number.isInteger(item?.Version)
            ? item.Version
            : undefined,
      }));
      setResult(payload);
    } catch (err: any) {
      const msg = err?.name === 'AbortError' ? 'Loading the inbox timed out — pull to retry.' : (err?.message ?? 'Failed to load inbox');
      log.warn('refresh failed', msg);
      setError(msg);
    } finally {
      clearTimeout(timer);
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [connectionId, importId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Apply one decision. The row is removed only AFTER the server confirms, so a
  // failed resolve (or a failed reconcile refresh) can never leave an item hidden
  // while the server still considers it unresolved.
  const resolve = useCallback(
    async (
      platformId: string,
      choice: ResolveChoice,
      canonicalId?: string,
      options: ResolveOptions = {},
    ): Promise<ResolveResponse | null> => {
      if (!connectionId) return null;
      setResolving(platformId);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const token = await ensureSupabaseJwt();
        const res = await fetch(`${API_BASE}/sync/connections/${connectionId}/resolve`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platformId,
            choice,
            canonicalId,
            valueOverride: options.valueOverride,
            version: options.version,
            importId: options.importId ?? importId ?? undefined,
          }),
          signal: controller.signal,
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
          throw new Error('This item changed before your choice was saved. Review its latest state and try again.');
        }
        if (!res.ok) throw new Error(`Resolve failed: ${res.status}`);
        setResult((prev) =>
          prev ? { ...prev, needsAttention: prev.needsAttention.filter((i) => i.platformId !== platformId) } : prev,
        );
        return (await res.json().catch(() => ({ success: true }))) as ResolveResponse;
      } catch (err: any) {
        log.warn('resolve failed', err?.name === 'AbortError' ? 'request timed out' : err?.message);
        await refresh(); // reconcile with the true server state (keeps the list visible)
        throw err;
      } finally {
        clearTimeout(timer);
        setResolving(null);
      }
    },
    [connectionId, importId, refresh],
  );

  // Apply independent CAS decisions in server-sized chunks. Only confirmed rows
  // are removed locally; conflicts and errors stay visible with current versions.
  const resolveBulk = useCallback(
    async (items: BulkResolveItem[], bulkImportId?: string): Promise<BulkResolveResponse> => {
      if (!connectionId) return { results: [] };
      if (items.length === 0) return { results: [] };

      setResolving('bulk');
      try {
        const token = await ensureSupabaseJwt();
        const results = [] as BulkResolveResponse['results'];
        for (const chunk of chunkBulkResolveItems(items)) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 20000);
          try {
            const res = await fetch(`${API_BASE}/sync/connections/${connectionId}/resolve-bulk`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ importId: bulkImportId ?? importId ?? undefined, items: chunk }),
              signal: controller.signal,
            });
            if (!res.ok) {
              const message = `Bulk answer failed: ${res.status}`;
              results.push(...chunk.map((item) => ({ platformId: item.platformId, status: 'error' as const, message })));
              continue;
            }
            const payload = (await res.json()) as BulkResolveResponse;
            results.push(...normalizeBulkResolveResults(chunk, payload?.results));
          } catch (chunkError: any) {
            const message = chunkError?.name === 'AbortError'
              ? 'Saving this chunk timed out.'
              : (chunkError?.message ?? 'Could not save this chunk.');
            results.push(...chunk.map((item) => ({ platformId: item.platformId, status: 'error' as const, message })));
          } finally {
            clearTimeout(timer);
          }
        }
        setResult((previous) => previous
          ? { ...previous, needsAttention: reconcileNeedsAttentionAfterBulk(previous.needsAttention, results) }
          : previous);
        // Reconcile summary counts after preserving every conflicted/error row.
        await refresh();
        return { results };
      } catch (err: any) {
        log.warn('bulk resolve failed', err?.name === 'AbortError' ? 'request timed out' : err?.message);
        await refresh();
        throw err;
      } finally {
        setResolving(null);
      }
    },
    [connectionId, importId, refresh],
  );

  return { result, loading, error, resolving, refresh, resolve, resolveBulk };
}
