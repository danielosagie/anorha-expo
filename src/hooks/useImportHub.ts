import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ensureSupabaseJwt } from '../lib/supabase';
import { API_BASE_URL } from '../config/env';
import { createLogger } from '../utils/logger';
import { usePlatformConnections, PlatformConnectionRow } from '../context/PlatformConnectionsContext';
import { normalizeDisplayName } from '../config/platforms';
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

// States that mean the connection is still importing — poll it and show the
// in-flight strip until it settles.
const IN_FLIGHT = new Set(['scanning', 'syncing', 'reconciling', 'pending', 'ready_to_sync']);

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
  lanes: {
    matches: { count: number; byConnection: HubLaneConnection[] };
    photos: { count: number };
    details: { count: number };
  };
}

type PerConnResult = {
  connectionId: string;
  platformName: string;
  state: string;
  needsAttention: number;
};

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

// Single aggregate fetch. Like fetchConnectionStatus it NEVER throws: any
// 404 / non-2xx / network error / malformed body returns null so the caller
// falls back to the per-connection fan-out. Fields are coerced defensively so
// a partially-shaped payload can't crash the downstream memos.
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

// Per-connection status fetch. Tries the (unconsumed) /status endpoint first and
// falls back to /resolution's summary — either way it NEVER throws, so one bad
// connection contributes 0 instead of poisoning the whole hub.
async function fetchConnectionStatus(
  conn: PlatformConnectionRow,
  token: string | null,
): Promise<PerConnResult | null> {
  const platformName = normalizeDisplayName(conn.DisplayName || conn.PlatformType);
  const headers = {
    Authorization: `Bearer ${token ?? ''}`,
    'Content-Type': 'application/json',
  };
  try {
    const res = await fetchWithTimeout(`${API_BASE}/sync/connections/${conn.Id}/status`, { headers });
    if (res.ok) {
      const j: any = await res.json();
      return {
        connectionId: conn.Id,
        platformName,
        state: String(j?.state ?? conn.Status ?? '').toLowerCase(),
        needsAttention: Number(j?.counts?.needsAttention ?? 0) || 0,
      };
    }
  } catch (err: any) {
    log.debug('status fetch failed, trying resolution', conn.Id, err?.message);
  }
  try {
    const res = await fetchWithTimeout(`${API_BASE}/sync/connections/${conn.Id}/resolution`, { headers });
    if (res.ok) {
      const j: any = await res.json();
      return {
        connectionId: conn.Id,
        platformName,
        state: String(conn.Status ?? '').toLowerCase(),
        needsAttention: Number(j?.summary?.needsAttention ?? 0) || 0,
      };
    }
  } catch (err: any) {
    log.debug('resolution fallback failed', conn.Id, err?.message);
  }
  return null;
}

/**
 * Client-side aggregate for the Import Inbox (see docs/import-hub-redesign.md).
 *
 * Each refresh cycle tries ONE server aggregate first —
 * GET /api/sync/inbox/summary — and maps it into the matches lane + scanning
 * strip directly. If that endpoint is absent/broken (it is not in prod yet) it
 * falls back to the original fan-out over the existing prod endpoints:
 *   - per enabled connection: GET /sync/connections/:id/status (→ /resolution)
 * The optimizer gaps (photos/details lanes) are always computed client-side via
 * useOptimizerQueues (catalog-wide, unscoped) regardless of which path is used.
 *
 * The aggregate's absence is remembered for the session (aggregateDeadRef) so
 * poll ticks don't pay a doomed extra request every 20s — but an explicit
 * refresh() (pull-to-refresh, focus re-entry) clears that flag and retries, so
 * once the backend ships it's picked up without an app restart.
 *
 * Refetches on focus and whenever the enabled-connection set changes; polls
 * every 20s (on whichever path is active) while anything is still scanning/syncing.
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
  // Read the live objects inside the stable `refresh` without listing the array
  // (whose identity churns on every progress event) as a dependency.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  // Refetch only when the SET of connections changes, not on every status flip
  // (status changes are picked up by the poll / the live-status fallback below).
  const connSig = useMemo(() => enabled.map((c) => c.Id).sort().join('|'), [enabled]);

  const [results, setResults] = useState<PerConnResult[]>([]);
  // Non-null while the server aggregate is the active data source; null means we
  // are on the fan-out path (or have no data yet). Exactly one of summary /
  // results drives the derived outputs below.
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
  // Once the aggregate endpoint answers 404 / non-2xx / malformed, remember it
  // so 20s poll ticks skip the doomed request. Cleared on explicit refresh().
  const aggregateDeadRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (!optLoading) optFirstDoneRef.current = true;
  }, [optLoading]);

  const refresh = useCallback(async (opts?: { retryAggregate?: boolean }) => {
    // Claim this refresh as the latest; a later refresh bumps the id and any
    // in-flight setState from this (now stale) run is skipped.
    const myId = ++refreshIdRef.current;
    const isCurrent = () => mountedRef.current && refreshIdRef.current === myId;

    const conns = enabledRef.current;
    if (!conns.length) {
      if (isCurrent()) {
        setResults([]);
        setSummary(null);
        setError(null);
        firstDoneRef.current = true;
        setLoading(false);
      }
      return;
    }
    let token: string | null = null;
    try {
      token = await ensureSupabaseJwt();
    } catch {
      token = null;
    }

    // Explicit refresh (pull-to-refresh / focus re-entry) forgets a prior
    // aggregate failure so a freshly-shipped backend is picked up live.
    if (opts?.retryAggregate) aggregateDeadRef.current = false;

    // Preferred path: one server aggregate. Skip it only if we've already
    // learned this session that the endpoint isn't there.
    if (!aggregateDeadRef.current) {
      const agg = await fetchInboxSummary(token);
      if (!isCurrent()) return;
      if (agg) {
        setSummary(agg);
        setResults([]);
        setError(null);
        firstDoneRef.current = true;
        setLoading(false);
        return;
      }
      // Absent / broken — remember so poll ticks don't retry, then fall through.
      aggregateDeadRef.current = true;
    }

    // Fallback path: fan out over the existing per-connection prod endpoints.
    const settled = await Promise.all(conns.map((c) => fetchConnectionStatus(c, token)));
    if (!isCurrent()) return;
    const ok = settled.filter((r): r is PerConnResult => r !== null);
    // Only a TOTAL failure surfaces an error — a single failing connection just
    // contributes 0.
    const allFailed = ok.length === 0;
    setSummary(null);
    setResults(ok);
    setError(allFailed ? 'Couldn’t load your import inbox.' : null);
    firstDoneRef.current = true;
    setLoading(false);
  }, []);

  const refreshAll = useCallback(async () => {
    // Await BOTH sources so callers (pull-to-refresh) can keep their spinner up
    // until the data has actually settled.
    await Promise.all([refresh({ retryAggregate: true }), refreshOpt()]);
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

  const resultById = useMemo(() => {
    const m: Record<string, PerConnResult> = {};
    for (const r of results) m[r.connectionId] = r;
    return m;
  }, [results]);

  const scanning = useMemo<ImportHubScanning[]>(() => {
    // Aggregate path: the server tells us exactly which connections are in
    // flight (scanning | syncing).
    if (summary) {
      return summary.connections
        .filter((c) => c.state === 'scanning' || c.state === 'syncing')
        .map((c) => ({
          connectionId: c.connectionId,
          platformName: c.displayName || c.platformType,
          state: c.state,
        }));
    }
    // Fan-out path: cross-reference the live enabled set with the last fetched
    // per-connection statuses (so a just-started scan shows immediately via the
    // live c.Status even before the next fetch lands).
    const out: ImportHubScanning[] = [];
    for (const c of enabled) {
      const r = resultById[c.Id];
      const state = r?.state || (c.Status || '').toLowerCase();
      if (IN_FLIGHT.has(state)) {
        out.push({
          connectionId: c.Id,
          platformName: r?.platformName || normalizeDisplayName(c.DisplayName || c.PlatformType),
          state,
        });
      }
    }
    return out;
  }, [summary, enabled, resultById]);

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
    // Aggregate path: per-connection needs-attention straight from the server.
    if (summary) {
      return summary.connections
        .filter((c) => c.needsAttention > 0)
        .map((c) => ({
          connectionId: c.connectionId,
          platformName: c.displayName || c.platformType,
          count: c.needsAttention,
        }));
    }
    // Fan-out path.
    return results
      .filter((r) => r.needsAttention > 0)
      .map((r) => ({ connectionId: r.connectionId, platformName: r.platformName, count: r.needsAttention }));
  }, [summary, results]);
  // On the aggregate path the lane total is the server's authoritative
  // totalNeedsAttention (which can include reasons not tied to any one
  // connection); on the fan-out path it's the sum of the per-connection counts.
  const matchesCount = summary
    ? summary.totalNeedsAttention
    : matchesByConnection.reduce((a, b) => a + b.count, 0);

  // Full "Your stores" list: always every enabled connection, enriched with the
  // per-connection state/needsAttention from whichever path is active (aggregate
  // summary or fan-out results). Keyed off `enabled` so a store with nothing to
  // review still lists (as a quiet "Synced" row), not just the ones with matches.
  const connections = useMemo<HubConnection[]>(() => {
    const meta: Record<string, { state: string; needsAttention: number }> = {};
    if (summary) {
      for (const c of summary.connections) {
        meta[c.connectionId] = { state: c.state, needsAttention: c.needsAttention };
      }
    } else {
      for (const r of results) {
        meta[r.connectionId] = { state: r.state, needsAttention: r.needsAttention };
      }
    }
    return enabled.map((c) => {
      const m = meta[c.Id];
      return {
        connectionId: c.Id,
        platformName: normalizeDisplayName(c.DisplayName || c.PlatformType),
        platformType: c.PlatformType,
        state: m?.state || (c.Status || '').toLowerCase(),
        needsAttention: m?.needsAttention || 0,
      };
    });
  }, [enabled, summary, results]);

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
    lanes: {
      matches: { count: matchesCount, byConnection: matchesByConnection },
      photos: { count: photosCount },
      details: { count: detailsCount },
    },
  };
}
