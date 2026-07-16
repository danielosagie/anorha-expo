import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ensureSupabaseJwt } from '../lib/supabase';
import { API_BASE_URL } from '../config/env';
import { createLogger } from '../utils/logger';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { useOptimizerQueues } from './useOptimizerQueues';

const log = createLogger('useImportHub');

// Same `/api` normalization the rest of the app uses (see useResolution) so a
// base URL that already ends in `/api` never composes `/api/api/…`.
const API_BASE = (() => {
  const trimmed = API_BASE_URL.replace(/\/$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
})();

const POLL_MS = 20000;

// A stalled request must never leave `loading` stuck forever: cap every fetch in
// this hook so a hung socket surfaces as an AbortError (which the existing
// try/catch fallbacks already treat as failure).
async function fetchWithTimeout(url: string, init?: RequestInit, ms = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface HubLaneConnection {
  connectionId: string;
  platformName: string;
  count: number;
}

// Full per-connection row for the hub's "Your stores" list (every enabled
// connection, whether or not it needs attention). Additive to the hub's output —
// derived from the same aggregate/fan-out data the lanes already consume.
export interface HubConnection {
  /** PlatformConnections.Id — used to deep-link into SyncInbox / SyncRules. */
  connectionId: string;
  /** Friendly display name (bold row title), e.g. "myshop". */
  platformName: string;
  /** Raw PlatformType (muted subtitle + brand logo), e.g. "shopify". */
  platformType?: string;
  /** Lowercased connection state ('active'|'scanning'|'review'|…). */
  state: string;
  /** Items parked in this connection's inbox (0 ⇒ show the quiet "Synced" state). */
  needsAttention: number;
}

export interface ImportHubScanning {
  connectionId: string;
  platformName: string;
  state: string;
}

export interface ImportHubData {
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** matches + photos + details — the single number the hero shows. */
  totalNeedsYou: number;
  scanning: ImportHubScanning[];
  /** Every enabled connection, for the hub's "Your stores" list. */
  connections: HubConnection[];
  recentImports: InboxRecentImport[];
  lanes: {
    matches: { count: number; byConnection: HubLaneConnection[] };
    photos: { count: number };
    details: { count: number };
  };
}

// ---------------------------------------------------------------------------
// Backend aggregate (GET /api/sync/inbox/summary) — one request that replaces
// the per-connection fan-out below when the endpoint is present. Exported so a
// future typed client can reuse the exact shape. NOT yet in prod: the hook
// falls back to the fan-out path whenever this endpoint is absent/broken.
// ---------------------------------------------------------------------------
export interface InboxSummaryConnection {
  connectionId: string;
  platformType: string;
  displayName: string;
  state: 'scanning' | 'syncing' | 'live' | 'needs-attention' | 'error';
  needsAttention: number;
}

export interface InboxRecentImport {
  importId: string;
  connectionId: string;
  source: string;
  status: string;
  itemsTotal: number;
  itemsCommitted: number;
  itemsFailed: number;
  createdAt: string;
  completedAt: string | null;
}

export interface InboxSummaryResponse {
  totalNeedsAttention: number;
  byReason: Record<string, number>;
  connections: InboxSummaryConnection[];
  recentImports: InboxRecentImport[];
}

// Single authoritative aggregate fetch. A malformed or unavailable response is
// an error state, never a fabricated empty inbox.
async function fetchInboxSummary(token: string | null): Promise<InboxSummaryResponse | null> {
  const headers = {
    Authorization: `Bearer ${token ?? ''}`,
    'Content-Type': 'application/json',
  };
  try {
    const res = await fetchWithTimeout(`${API_BASE}/sync/inbox/summary`, { headers });
    if (!res.ok) return null; // 404 (not shipped yet) or any non-2xx → fall back
    const j: any = await res.json();
    if (!j || typeof j.totalNeedsAttention !== 'number' || !Array.isArray(j.connections)) {
      return null; // malformed body → fall back
    }
    return {
      totalNeedsAttention: Number(j.totalNeedsAttention) || 0,
      byReason: j.byReason && typeof j.byReason === 'object' ? j.byReason : {},
      connections: j.connections.map((c: any) => ({
        connectionId: String(c?.connectionId ?? ''),
        platformType: String(c?.platformType ?? ''),
        displayName: String(c?.displayName ?? ''),
        state: String(c?.state ?? '').toLowerCase() as InboxSummaryConnection['state'],
        needsAttention: Number(c?.needsAttention ?? 0) || 0,
      })),
      recentImports: Array.isArray(j.recentImports)
        ? j.recentImports.map((r: any) => ({
            importId: String(r?.importId ?? ''),
            connectionId: String(r?.connectionId ?? ''),
            source: String(r?.source ?? ''),
            status: String(r?.status ?? ''),
            itemsTotal: Number(r?.itemsTotal ?? 0) || 0,
            itemsCommitted: Number(r?.itemsCommitted ?? 0) || 0,
            itemsFailed: Number(r?.itemsFailed ?? 0) || 0,
            createdAt: String(r?.createdAt ?? ''),
            completedAt: r?.completedAt == null ? null : String(r.completedAt),
          }))
        : [],
    };
  } catch (err: any) {
    log.debug('inbox summary fetch failed, falling back to fan-out', err?.message);
    return null;
  }
}

/**
 * Client-side aggregate for the Import Inbox (see docs/import-hub-redesign.md).
 *
 * Each refresh cycle reads ONE authoritative server aggregate:
 * GET /api/sync/inbox/summary. If it is unavailable, the screen shows an error
 * instead of manufacturing zero counts from partial per-connection responses.
 * The optimizer gaps (photos/details lanes) are always computed client-side via
 * useOptimizerQueues (catalog-wide, unscoped) regardless of which path is used.
 *
 * Refetches on focus and whenever the enabled-connection set changes; polls
 * every 20s while anything is still scanning/syncing.
 */
export function useImportHub(): ImportHubData {
  const { liveConnections } = usePlatformConnections();

  // Optimizer gaps, catalog-wide (unscoped) so the hub's photos/details lanes
  // match the standalone optimize entry exactly.
  const { counts: optCounts, loading: optLoading, refresh: refreshOpt } = useOptimizerQueues();

  const enabled = useMemo(
    () => (liveConnections || []).filter((c) => c.IsEnabled !== false),
    [liveConnections],
  );
  // Refetch only when the SET of connections changes, not on every status flip
  // (status changes are picked up by the poll / the live-status fallback below).
  const connSig = useMemo(() => enabled.map((c) => c.Id).sort().join('|'), [enabled]);

  const [summary, setSummary] = useState<InboxSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const mountedRef = useRef(true);
  // Monotonic refresh id. refresh() runs from focus, the 20s poll, and
  // pull-to-refresh, so a slow older request can resolve after a newer one —
  // every setState below bails unless its request is still the latest.
  const refreshIdRef = useRef(0);
  const firstDoneRef = useRef(false);
  const optFirstDoneRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (!optLoading) optFirstDoneRef.current = true;
  }, [optLoading]);

  const refresh = useCallback(async () => {
    // Claim this refresh as the latest; a later refresh bumps the id and any
    // in-flight setState from this (now stale) run is skipped.
    const myId = ++refreshIdRef.current;
    const isCurrent = () => mountedRef.current && refreshIdRef.current === myId;

    let token: string | null = null;
    try {
      token = await ensureSupabaseJwt();
    } catch {
      token = null;
    }

    const agg = token ? await fetchInboxSummary(token) : null;
    if (!isCurrent()) return;
    setSummary(agg);
    setError(agg ? null : 'Couldn’t verify your import status. Pull to retry.');
    firstDoneRef.current = true;
    setLoading(false);
  }, []);

  const refreshAll = useCallback(async () => {
    // Await BOTH sources so callers (pull-to-refresh) can keep their spinner up
    // until the data has actually settled.
    await Promise.all([refresh(), refreshOpt()]);
  }, [refresh, refreshOpt]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  // Single fetch path: on focus, and whenever the connection set changes while
  // focused. refreshAll is stable, so this doesn't loop.
  useEffect(() => {
    if (!focused) return;
    refreshAll();
  }, [focused, connSig, refreshAll]);

  const scanning = useMemo<ImportHubScanning[]>(() => {
    return (summary?.connections || [])
      .filter((c) => c.state === 'scanning' || c.state === 'syncing')
      .map((c) => ({
        connectionId: c.connectionId,
        platformName: c.displayName || c.platformType,
        state: c.state,
      }));
  }, [summary]);

  const anyScanning = scanning.length > 0;

  // Light poll (connection statuses only) while focused AND something is still
  // importing. Stops the moment nothing is scanning; cleared on blur/unmount.
  useEffect(() => {
    if (!focused || !anyScanning) return;
    const id = setInterval(() => {
      refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [focused, anyScanning, refresh]);

  // When a scan finishes, pull fresh optimizer counts once — the newly-imported
  // items now need photos/details.
  const prevScanningRef = useRef(false);
  useEffect(() => {
    if (prevScanningRef.current && !anyScanning) refreshOpt();
    prevScanningRef.current = anyScanning;
  }, [anyScanning, refreshOpt]);

  const matchesByConnection = useMemo<HubLaneConnection[]>(() => {
    return (summary?.connections || [])
      .filter((c) => c.needsAttention > 0)
      .map((c) => ({
        connectionId: c.connectionId,
        platformName: c.displayName || c.platformType,
        count: c.needsAttention,
      }));
  }, [summary]);
  const matchesCount = summary?.totalNeedsAttention || 0;

  const connections = useMemo<HubConnection[]>(() => {
    return (summary?.connections || []).map((c) => ({
      connectionId: c.connectionId,
      platformName: c.displayName || c.platformType,
      platformType: c.platformType,
      state: c.state,
      needsAttention: c.needsAttention,
    }));
  }, [summary]);

  const photosCount = optCounts.photoNeeded;
  const detailsCount = optCounts.dataNeeded + optCounts.manualQueue;
  const totalNeedsYou = matchesCount + photosCount + detailsCount;

  const initialLoading =
    (loading && !firstDoneRef.current) || (!optFirstDoneRef.current && optLoading);

  return {
    loading: initialLoading,
    error,
    refresh: refreshAll,
    totalNeedsYou,
    scanning,
    connections,
    recentImports: summary?.recentImports || [],
    lanes: {
      matches: { count: matchesCount, byConnection: matchesByConnection },
      photos: { count: photosCount },
      details: { count: detailsCount },
    },
  };
}
