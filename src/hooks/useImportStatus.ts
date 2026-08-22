import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useUser } from '@clerk/expo';
import { ensureSupabaseJwt } from '../lib/supabase';
import { apiFetch } from '../lib/apiClient';
import { createLogger } from '../utils/logger';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { useOrg } from '../context/OrgContext';
import { useOptimizerQueues } from './useOptimizerQueues';
import { isVisiblePlatformConnection, isImportingConnectionStatus } from '../lib/platformConnectStatus';
import {
  isFreshActiveImportEvidence,
  resetOwnerScopedImportState,
} from '../lib/connectionImportPresentation';
import { reconcileVerifiedAttentionCount } from '../lib/reviewQueueTruth';
import { deriveV7AttentionCounts } from '../components/import/questionQueue';
import type { SyncItem } from '../types/syncItem';

const log = createLogger('useImportStatus');

const POLL_MS = 20000;

export interface HubLaneConnection {
  connectionId: string;
  platformName: string;
  count: number;
}

// Full per-connection row for the hub's "Your stores" list (every enabled
// connection, whether or not it needs attention). Additive to the hub's output,
// derived from the same aggregate/fan-out data the lanes already consume.
export interface HubConnection {
  /** PlatformConnections.Id used to open import review or sync settings. */
  connectionId: string;
  /** Friendly display name (bold row title), e.g. "myshop". */
  platformName: string;
  /** Raw PlatformType (muted subtitle + brand logo), e.g. "shopify". */
  platformType?: string;
  /** Lowercased connection state ('active'|'scanning'|'review'|…). */
  state: string;
  /** Items parked in this connection's inbox (0 ⇒ show the quiet "Synced" state). */
  needsAttention: number;
  /** True once this count has been reconciled by the inbox refresh cycle. */
  attentionVerified: boolean;
  /** Time when the import evidence last changed. */
  observedAt: number;
  itemsSoFar?: number;
  phase?: string;
  startedAt?: string;
  p50DurationMs?: number;
  jobId?: string;
}

export interface ImportScanning {
  connectionId: string;
  platformName: string;
  state: string;
}

export interface ImportStatusData {
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Exact number of items the V7 review queue will ask about. */
  totalNeedsYou: number;
  scanning: ImportScanning[];
  /** Every enabled connection, for the hub's "Your stores" list. */
  connections: HubConnection[];
  recentImports: InboxRecentImport[];
  lanes: {
    /** Questions: items waiting on a human answer (the deck). */
    matches: { count: number; byConnection: HubLaneConnection[] };
    /** Required: a connected store refuses these until fixed. OWED. */
    required: { count: number; platforms: string[] };
    /** Polish: publishable but thin. Invited, never owed, never in the hero. */
    polish: { count: number };
  };
}

// ---------------------------------------------------------------------------
// Backend aggregate (GET /api/sync/inbox/summary), verified against each
// connection's exact V7 resolution payload before any attention count renders.
// Exported so a future typed client can reuse the exact shape.
// ---------------------------------------------------------------------------
export interface InboxSummaryConnection {
  connectionId: string;
  platformType: string;
  displayName: string;
  state: 'active' | 'scanning' | 'syncing' | 'live' | 'review' | 'needs-attention' | 'error';
  needsAttention: number;
  attentionVerified?: boolean;
  observedAt: number;
  itemsSoFar?: number;
  phase?: string;
  startedAt?: string;
  p50DurationMs?: number;
  jobId?: string;
}

export interface InboxRecentImport {
  importId: string;
  connectionId: string;
  source: string;
  status: string;
  itemsTotal: number;
  itemsCommitted: number;
  itemsFailed: number;
  itemsSoFar?: number;
  phase?: string;
  startedAt?: string;
  p50DurationMs?: number;
  jobId?: string;
  createdAt: string;
  completedAt: string | null;
}

const optionalNumber = (value: unknown): number | undefined => {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const optionalString = (value: unknown): string | undefined => {
  if (value == null) return undefined;
  const parsed = String(value).trim();
  return parsed || undefined;
};

export function parseInboxSummaryPayload(
  payload: unknown,
  observedAt = Date.now(),
): InboxSummaryResponse | null {
  const j = payload as any;
  if (!j || typeof j.totalNeedsAttention !== 'number' || !Array.isArray(j.connections)) {
    return null;
  }

  const connections: InboxSummaryConnection[] = j.connections.map((c: any) => ({
      connectionId: String(c?.connectionId ?? ''),
      platformType: String(c?.platformType ?? ''),
      displayName: String(c?.displayName ?? ''),
      state: String(c?.state ?? '').toLowerCase() as InboxSummaryConnection['state'],
      needsAttention: Number(c?.needsAttention ?? c?.attentionCount ?? 0) || 0,
      attentionVerified: false,
      observedAt,
      itemsSoFar: optionalNumber(c?.itemsSoFar),
      phase: optionalString(c?.phase ?? c?.scanState),
      startedAt: optionalString(c?.startedAt),
      p50DurationMs: optionalNumber(c?.p50DurationMs),
      jobId: optionalString(c?.jobId),
    }));
  const connectionById = new Map(connections.map((connection) => [connection.connectionId, connection]));
  const recentImports: InboxRecentImport[] = Array.isArray(j.recentImports)
    ? j.recentImports.map((r: any) => {
          const aggregateConnection = connectionById.get(String(r?.connectionId ?? ''));
          const itemsSoFar = optionalNumber(r?.itemsSoFar) ?? aggregateConnection?.itemsSoFar;
          return {
            importId: String(r?.importId ?? ''),
            connectionId: String(r?.connectionId ?? ''),
            source: String(r?.source ?? ''),
            status: String(r?.status ?? ''),
            itemsTotal: Number(r?.itemsTotal ?? 0) || 0,
            // RW3 already reads itemsCommitted for its live receipt. Falling back
            // to the additive counter keeps that modal compatible with RW2.
            itemsCommitted: Number(r?.itemsCommitted ?? itemsSoFar ?? 0) || 0,
            itemsFailed: Number(r?.itemsFailed ?? 0) || 0,
            itemsSoFar,
            phase: optionalString(r?.phase ?? r?.scanState) ?? aggregateConnection?.phase,
            startedAt: optionalString(r?.startedAt) ?? aggregateConnection?.startedAt,
            p50DurationMs: optionalNumber(r?.p50DurationMs) ?? aggregateConnection?.p50DurationMs,
            jobId: optionalString(r?.jobId) ?? aggregateConnection?.jobId,
            createdAt: String(r?.createdAt ?? ''),
            completedAt: r?.completedAt == null ? null : String(r.completedAt),
          };
        })
    : [];

  return {
    totalNeedsAttention: Number(j.totalNeedsAttention) || 0,
    byReason: j.byReason && typeof j.byReason === 'object' ? j.byReason : {},
    connections,
    recentImports,
  };
}

export interface InboxSummaryResponse {
  totalNeedsAttention: number;
  byReason: Record<string, number>;
  connections: InboxSummaryConnection[];
  recentImports: InboxRecentImport[];
}

function connectionEvidenceSignature(connection: InboxSummaryConnection): string {
  return JSON.stringify([
    connection.state,
    connection.itemsSoFar ?? null,
    connection.phase ?? null,
    connection.startedAt ?? null,
    connection.jobId ?? null,
  ]);
}

export function preserveImportEvidenceObservedAt(
  previous: InboxSummaryResponse | null | undefined,
  next: InboxSummaryResponse,
): InboxSummaryResponse {
  if (!previous) return next;
  const previousById = new Map(
    previous.connections.map((connection) => [connection.connectionId, connection]),
  );
  return {
    ...next,
    connections: next.connections.map((connection) => {
      const prior = previousById.get(connection.connectionId);
      if (!prior || connectionEvidenceSignature(prior) !== connectionEvidenceSignature(connection)) {
        return connection;
      }
      return { ...connection, observedAt: prior.observedAt };
    }),
  };
}

// A malformed or unavailable aggregate payload is an error state. Resolution
// failures preserve only that connection's server count.
export async function reconcileInboxAttention(
  aggregate: InboxSummaryResponse,
  fetchResolutionItems: (connectionId: string) => Promise<SyncItem[]>,
): Promise<InboxSummaryResponse> {
  const connections = await Promise.all(aggregate.connections.map(async (connection) => {
    if (connection.needsAttention === 0) {
      return reconcileVerifiedAttentionCount(connection, 0);
    }

    try {
      const items = await fetchResolutionItems(connection.connectionId);
      const derived = deriveV7AttentionCounts([{
        connectionId: connection.connectionId,
        platformName: connection.displayName || connection.platformType,
        items,
      }]);
      return reconcileVerifiedAttentionCount(connection, derived.count);
    } catch {
      return connection;
    }
  }));

  return {
    ...aggregate,
    totalNeedsAttention: connections.reduce(
      (total, connection) => total + connection.needsAttention,
      0,
    ),
    connections,
  };
}

async function fetchInboxSummary(
  previous: InboxSummaryResponse | null,
): Promise<InboxSummaryResponse | null> {
  try {
    const res = await apiFetch('/api/sync/inbox/summary');
    if (!res.ok) return null; // 404 (not shipped yet) or any non-2xx → fall back
    const aggregate = parseInboxSummaryPayload(await res.json());
    if (!aggregate) return null; // malformed body → fall back

    const ageBoundAggregate = preserveImportEvidenceObservedAt(previous, aggregate);
    return reconcileInboxAttention(ageBoundAggregate, async (connectionId) => {
      const resolution = await apiFetch(
        `/api/sync/connections/${encodeURIComponent(connectionId)}/resolution`,
      );
      if (!resolution.ok) {
        throw new Error(`resolution fetch failed: ${resolution.status}`);
      }
      const payload = await resolution.json() as { needsAttention?: SyncItem[] };
      if (!Array.isArray(payload?.needsAttention)) {
        throw new Error('resolution payload missing needsAttention');
      }
      return payload.needsAttention;
    });
  } catch (err: any) {
    log.debug('inbox status verification failed', err?.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Shared summary store — ONE inbox summary for every consumer.
//
// The hook used to keep its summary in per-instance useState, so the three
// simultaneous instances (Connections, Settings, SyncRules) each held their own
// copy: a refresh in one screen never reached the others, and connect/
// disconnect flows had no way to freshen the inbox at all. The summary now
// lives in this module-level store; hooks subscribe via useSyncExternalStore,
// and refreshInboxSummary() is callable from anywhere (ConnectFlowSheet's
// post-OAuth path included) to update every consumer at once.
// ---------------------------------------------------------------------------
interface InboxSummaryStore {
  ownerKey: string;
  summary: InboxSummaryResponse | null;
  error: string | null;
  loading: boolean;
  /** At least one fetch attempt has settled (success or failure). */
  firstDone: boolean;
}

const emptyInboxStore = (ownerKey: string): InboxSummaryStore => ({
  ownerKey,
  summary: null,
  error: null,
  loading: !!ownerKey,
  firstDone: false,
});

let inboxStore: InboxSummaryStore = emptyInboxStore('');
const inboxListeners = new Set<() => void>();

function setInboxStore(patch: Partial<InboxSummaryStore>) {
  inboxStore = { ...inboxStore, ...patch };
  inboxListeners.forEach((listener) => listener());
}

function subscribeInboxStore(listener: () => void): () => void {
  inboxListeners.add(listener);
  return () => {
    inboxListeners.delete(listener);
  };
}

// Monotonic refresh id. Refreshes run from focus, the 20s poll, pull-to-refresh,
// and connect/disconnect flows, so a slow older request can resolve after a
// newer one — the write below is skipped unless its request is still latest.
let inboxRefreshSeq = 0;

function activateInboxOwner(ownerKey: string): void {
  const next = resetOwnerScopedImportState(inboxStore, ownerKey, emptyInboxStore);
  if (next === inboxStore) return;
  inboxRefreshSeq += 1;
  inboxStore = next;
  inboxListeners.forEach((listener) => listener());
}

/**
 * Refresh the shared inbox summary. Call after every connect, disconnect, or
 * re-enable so the inbox numbers move WITH the connection set instead of
 * waiting for the next focus/poll. Safe to fire-and-forget.
 */
export async function refreshInboxSummary(
  expectedOwnerKey = inboxStore.ownerKey,
): Promise<InboxSummaryResponse | null> {
  if (!expectedOwnerKey) {
    activateInboxOwner('');
    return null;
  }
  activateInboxOwner(expectedOwnerKey);
  const myId = ++inboxRefreshSeq;
  const requestedOwnerKey = expectedOwnerKey;
  let token: string | null = null;
  try {
    token = await ensureSupabaseJwt();
  } catch {
    token = null;
  }
  const agg = token ? await fetchInboxSummary(inboxStore.summary) : null;
  if (inboxRefreshSeq !== myId || inboxStore.ownerKey !== requestedOwnerKey) return null;
  setInboxStore({
    summary: agg,
    error: agg ? null : 'Couldn’t verify your import status. Pull to retry.',
    loading: false,
    firstDone: true,
  });
  return agg;
}

/**
 * Client-side aggregate for the Import Inbox (see docs/import-hub-redesign.md).
 *
 * Each refresh cycle reads the server aggregate, then verifies connections with
 * nonzero server counts against the same resolution payload and V7 card builder
 * used by the queue. A failed resolution request preserves that connection's
 * server count while successful derivations remain authoritative.
 * The optimizer gaps (photos/details lanes) are always computed client-side via
 * useOptimizerQueues (catalog-wide, unscoped) regardless of which path is used.
 *
 * Refetches on focus and whenever the enabled-connection set changes; polls
 * every 20s while anything is still scanning/syncing.
 */
export function useImportStatus(): ImportStatusData {
  const { user } = useUser();
  const { currentOrg } = useOrg();
  const ownerKey = user?.id
    ? `${user.id}:${currentOrg?.id || 'personal'}`
    : '';
  const {
    connections: connectionRows,
    liveConnections,
    progressByConnectionId,
  } = usePlatformConnections();

  // Optimizer gaps, catalog-wide (unscoped) so the hub's required/polish lanes
  // match the standalone optimize entry exactly. Required-ness is platform-aware
  // (registry requiredFields × the platforms each item is missing from).
  const {
    counts: optCounts,
    requiredPlatforms,
    loading: optLoading,
    refresh: refreshOpt,
  } = useOptimizerQueues();

  const enabled = useMemo(
    () => (liveConnections || []).filter(isVisiblePlatformConnection),
    [liveConnections],
  );
  // Refetch only when the SET of connections changes, not on every status flip
  // (status changes are picked up by the poll / the live-status fallback below).
  const connSig = useMemo(() => enabled.map((c) => c.Id).sort().join('|'), [enabled]);

  const emptyOwnerSnapshot = useMemo(() => emptyInboxStore(ownerKey), [ownerKey]);
  const getOwnerSnapshot = useCallback(
    () => inboxStore.ownerKey === ownerKey ? inboxStore : emptyOwnerSnapshot,
    [emptyOwnerSnapshot, ownerKey],
  );
  const { summary, error, loading, firstDone } = useSyncExternalStore(
    subscribeInboxStore,
    getOwnerSnapshot,
    getOwnerSnapshot,
  );
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    activateInboxOwner(ownerKey);
  }, [ownerKey]);

  const optFirstDoneRef = useRef(false);
  useEffect(() => {
    if (!optLoading) optFirstDoneRef.current = true;
  }, [optLoading]);

  const refreshAll = useCallback(async () => {
    // Await BOTH sources so callers (pull-to-refresh) can keep their spinner up
    // until the data has actually settled.
    await Promise.all([refreshInboxSummary(ownerKey), refreshOpt()]);
  }, [ownerKey, refreshOpt]);

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

  const scanning = useMemo<ImportScanning[]>(() => {
    return (summary?.connections || [])
      .filter((c) => c.state === 'scanning' || c.state === 'syncing')
      .map((c) => ({
        connectionId: c.connectionId,
        platformName: c.displayName || c.platformType,
        state: c.state,
      }));
  }, [summary]);

  // Poll while ANYTHING is still importing — judged from the summary lanes OR
  // the live connection rows. The summary alone is not enough: a connection's
  // summary state can flip to 'needs-attention' MID-scan (items parked early),
  // which used to stop the 20s poll while the scan was still running.
  const anyConnectionImporting = useMemo(
    () => connectionRows.some((connection) => isImportingConnectionStatus(connection.Status))
      || Object.values(progressByConnectionId).some((progress) => isFreshActiveImportEvidence({
        status: progress.status,
        phase: progress.phase || (typeof progress.details?.phase === 'string' ? progress.details.phase : null),
        receivedAt: progress.receivedAt,
      })),
    [connectionRows, progressByConnectionId],
  );
  const anyScanning = scanning.length > 0 || anyConnectionImporting;

  // Light poll (connection statuses only) while focused AND something is still
  // importing. Stops the moment nothing is scanning; cleared on blur/unmount.
  useEffect(() => {
    if (!focused || !anyScanning) return;
    const id = setInterval(() => {
      void refreshInboxSummary(ownerKey);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [focused, anyScanning, ownerKey]);

  // When a scan finishes, pull fresh optimizer counts once. The newly imported
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
  const matchesCount = matchesByConnection.reduce((total, connection) => total + connection.count, 0);

  const connections = useMemo<HubConnection[]>(() => {
    return (summary?.connections || []).map((c) => ({
      connectionId: c.connectionId,
      platformName: c.displayName || c.platformType,
      platformType: c.platformType,
      state: c.state,
      needsAttention: c.needsAttention,
      attentionVerified: c.attentionVerified === true,
      observedAt: c.observedAt,
      itemsSoFar: c.itemsSoFar,
      phase: c.phase,
      startedAt: c.startedAt,
      p50DurationMs: c.p50DurationMs,
      jobId: c.jobId,
    }));
  }, [summary]);

  // "Needs you" has one V7 meaning everywhere: a pair or pick-one question.
  const totalNeedsYou = matchesCount;

  const initialLoading =
    (loading && !firstDone) || (!optFirstDoneRef.current && optLoading);

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
      required: { count: optCounts.required, platforms: requiredPlatforms },
      polish: { count: optCounts.polish },
    },
  };
}
