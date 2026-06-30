import { useCallback, useEffect, useState } from 'react';
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

  const refresh = useCallback(async () => {
    if (!connectionId) return;
    try {
      setLoading(true);
      setError(null);
      const token = await ensureSupabaseJwt();
      const res = await fetch(`${API_BASE}/sync/connections/${connectionId}/resolution`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`Failed to load inbox: ${res.status}`);
      setResult((await res.json()) as ResolveResult);
    } catch (err: any) {
      log.warn('refresh failed', err?.message);
      setError(err?.message ?? 'Failed to load inbox');
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
        // 409 = already resolved → treat as success (drop it too).
        if (!res.ok && res.status !== 409) throw new Error(`Resolve failed: ${res.status}`);
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
