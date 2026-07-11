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

// States that mean the connection is still importing — poll it and show the
// in-flight strip until it settles.
const IN_FLIGHT = new Set(['scanning', 'syncing', 'reconciling', 'pending', 'ready_to_sync']);

export interface HubLaneConnection {
  connectionId: string;
  platformName: string;
  count: number;
}

export interface ImportHubScanning {
  connectionId: string;
  platformName: string;
  state: string;
}

export interface ImportHubData {
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** matches + photos + details — the single number the hero shows. */
  totalNeedsYou: number;
  scanning: ImportHubScanning[];
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
    const res = await fetch(`${API_BASE}/sync/connections/${conn.Id}/status`, { headers });
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
    const res = await fetch(`${API_BASE}/sync/connections/${conn.Id}/resolution`, { headers });
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
 * Fans out over the existing prod endpoints — no new backend in v1:
 *   - per enabled connection: GET /sync/connections/:id/status (→ /resolution)
 *   - optimizer gaps: useOptimizerQueues (catalog-wide, unscoped)
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
  // Read the live objects inside the stable `refresh` without listing the array
  // (whose identity churns on every progress event) as a dependency.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  // Refetch only when the SET of connections changes, not on every status flip
  // (status changes are picked up by the poll / the live-status fallback below).
  const connSig = useMemo(() => enabled.map((c) => c.Id).sort().join('|'), [enabled]);

  const [results, setResults] = useState<PerConnResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const mountedRef = useRef(true);
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
    const conns = enabledRef.current;
    if (!conns.length) {
      if (mountedRef.current) {
        setResults([]);
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
    const settled = await Promise.all(conns.map((c) => fetchConnectionStatus(c, token)));
    if (!mountedRef.current) return;
    const ok = settled.filter((r): r is PerConnResult => r !== null);
    // Only a TOTAL failure surfaces an error — a single failing connection just
    // contributes 0.
    const allFailed = ok.length === 0;
    setResults(ok);
    setError(allFailed ? 'Couldn’t load your import inbox.' : null);
    firstDoneRef.current = true;
    setLoading(false);
  }, []);

  const refreshAll = useCallback(() => {
    refresh();
    refreshOpt();
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
  }, [enabled, resultById]);

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

  const matchesByConnection = useMemo<HubLaneConnection[]>(
    () =>
      results
        .filter((r) => r.needsAttention > 0)
        .map((r) => ({ connectionId: r.connectionId, platformName: r.platformName, count: r.needsAttention })),
    [results],
  );
  const matchesCount = matchesByConnection.reduce((a, b) => a + b.count, 0);

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
    lanes: {
      matches: { count: matchesCount, byConnection: matchesByConnection },
      photos: { count: photosCount },
      details: { count: detailsCount },
    },
  };
}
