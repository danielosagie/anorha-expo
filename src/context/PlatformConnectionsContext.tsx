import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUser } from '@clerk/expo';
import { ensureSupabaseJwt, getSupabaseJwtState, subscribeToSupabaseJwtState } from '../lib/supabase';
import { subscribePlatformConnectionChanges } from '../lib/platformConnectionsRealtime';
import { API_BASE_URL } from '../config/env';
import { acquireCollaborationSocket, releaseCollaborationSocket, type Socket } from '../lib/collaborationSocket';
import { createLogger } from '../utils/logger';
import {
  parsePlatformConnectionsCache,
  platformConnectionsCacheKey,
  serializePlatformConnectionsCache,
} from '../lib/platformConnectionsCache';
import {
  isUnhealthyPlatformConnection,
  type PlatformConnectionRecommendedAction,
  type PlatformConnectionSyncState,
} from '../lib/platformConnectionVisibility';
import { ACTIVE_IMPORT_EVIDENCE_TTL_MS } from '../lib/connectionImportPresentation';
const log = createLogger('PlatformConnectionsContext');


// Mirrors the canonical registry key set (src/config/platforms.ts). 'etsy' was a
// ghost. It was never in the registry, had no adapter, and had no column.
export type PlatformKey = 'shopify' | 'square' | 'clover' | 'ebay' | 'facebook' | 'amazon' | 'depop' | 'whatnot';

export interface PlatformConnectionRow {
  Id: string;
  UserId: string;
  PlatformType: string;
  DisplayName: string;
  Status: string;
  IsEnabled: boolean;
  SyncState?: PlatformConnectionSyncState | null;
  NeedsReauth?: boolean | null;
  RecommendedAction?: PlatformConnectionRecommendedAction | null;
  FailureReason?: string | null;
  LastSyncSuccessAt?: string | null;
  CreatedAt: string;
  UpdatedAt: string;
}

type SyncProgressUpdate = {
  connectionId: string;
  progress: number;
  description?: string;
  status?: string;
  jobId?: string;
  elapsedSeconds?: number;
  details?: Record<string, any>;
  receivedAt: number;
};

type ContextValue = {
  connections: PlatformConnectionRow[];
  liveConnections: PlatformConnectionRow[];
  progressByConnectionId: Record<string, SyncProgressUpdate>;
  connectedByPlatform: Record<string, boolean>;
  isConnected: (platform: PlatformKey | string) => boolean;
  updateConnectionLocally: (connectionId: string, patch: Partial<PlatformConnectionRow>) => void;
  refresh: () => Promise<void>;
  loading: boolean;
  hasResolvedConnections: boolean;
  error?: string;
};

const PlatformConnectionsContext = createContext<ContextValue | undefined>(undefined);

const API_BASE = API_BASE_URL;
const CONNECTION_STATUS_SET = new Set(['active', 'inactive', 'pending', 'review', 'ready_to_sync', 'scanning', 'syncing', 'reconciling', 'error']);
// Statuses that end a lifecycle transition and warrant an authoritative refetch.
// 'inactive' is here so a disconnect event (from this device or another) pulls
// the real row state instead of leaving a stale "connected" row on screen.
const TERMINAL_STATUS_SET = new Set(['active', 'review', 'error', 'inactive']);
const PROGRESS_OVERRIDE_TTL_MS = ACTIVE_IMPORT_EVIDENCE_TTL_MS;

const normalizeStatus = (value?: string) => (value || '').toLowerCase().trim();

export const PlatformConnectionsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isLoaded: clerkLoaded, user: clerkUser } = useUser();
  const cacheOwnerId = clerkUser?.id || '';
  const [connections, setConnections] = useState<PlatformConnectionRow[]>([]);
  const [connectionsOwnerId, setConnectionsOwnerId] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasResolvedConnections, setHasResolvedConnections] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [progressByConnectionId, setProgressByConnectionId] = useState<Record<string, SyncProgressUpdate>>({});
  const [authReady, setAuthReady] = useState(false);
  const [jwtReady, setJwtReady] = useState(() => !!getSupabaseJwtState().token);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeOwnerRef = useRef(cacheOwnerId);
  activeOwnerRef.current = cacheOwnerId;

  useEffect(() => subscribeToSupabaseJwtState(({ token }) => {
    setJwtReady(!!token);
  }), []);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    if (!clerkLoaded || !cacheOwnerId) {
      setConnections([]);
      setConnectionsOwnerId('');
      setHasResolvedConnections(false);
      setAuthReady(false);
      setLoading(!clerkLoaded);
      return () => { cancelled = true; };
    }

    setAuthReady(false);
    setConnections([]);
    setConnectionsOwnerId('');
    setProgressByConnectionId({});
    setLoading(true);
    setHasResolvedConnections(false);
    AsyncStorage.getItem(platformConnectionsCacheKey(cacheOwnerId))
      .then((raw) => {
        if (cancelled || activeOwnerRef.current !== cacheOwnerId) return;
        const cachedRows = parsePlatformConnectionsCache(raw, cacheOwnerId);
        if (!cachedRows) return;
        setConnections(cachedRows);
        setConnectionsOwnerId(cacheOwnerId);
        log.debug('[PlatformConnectionsContext][measure] cache hydrated', {
          rows: cachedRows.length,
          durationMs: Date.now() - startedAt,
        });
      })
      .catch((cacheError) => {
        log.warn('[PlatformConnectionsContext] Could not hydrate connection cache:', cacheError);
      });

    return () => { cancelled = true; };
  }, [cacheOwnerId, clerkLoaded]);

  const fetchConnections = useCallback(async () => {
    if (!cacheOwnerId) return;
    const requestedOwnerId = cacheOwnerId;
    const startedAt = Date.now();
    setLoading(true);
    setError(undefined);
    try {
      const token = await ensureSupabaseJwt();
      if (activeOwnerRef.current !== requestedOwnerId) return;
      if (!token) {
        setError('Authentication required to load connections');
        setAuthReady(false);
        return;
      }
      setAuthReady(true);
      const resp = await fetch(`${API_BASE}/api/platform-connections?includeDisabled=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (activeOwnerRef.current !== requestedOwnerId) return;
      if (!resp.ok) {
        setError(`Failed to load connections (${resp.status})`);
        return;
      }
      const rows: PlatformConnectionRow[] = await resp.json();
      if (activeOwnerRef.current !== requestedOwnerId) return;
      const safeRows = Array.isArray(rows) ? rows : [];
      setConnections(safeRows);
      setConnectionsOwnerId(requestedOwnerId);
      setHasResolvedConnections(true);
      void AsyncStorage.setItem(
        platformConnectionsCacheKey(requestedOwnerId),
        serializePlatformConnectionsCache(requestedOwnerId, safeRows),
      ).catch((cacheError) => {
        log.warn('[PlatformConnectionsContext] Could not persist connection cache:', cacheError);
      });
      log.debug('[PlatformConnectionsContext][measure] live rows received', {
        rows: safeRows.length,
        durationMs: Date.now() - startedAt,
      });
      setProgressByConnectionId(prev => {
        const next = { ...prev };
        const validIds = new Set(safeRows.map(r => r.Id));
        Object.keys(next).forEach((id) => {
          if (!validIds.has(id)) delete next[id];
        });
        return next;
      });

      // NOTE: no toggles fetch. GET /api/platform-connections/toggles no longer
      // exists on the backend. The path fell into the :id route and 400'd on
      // every refresh. Nothing consumed the result.
    } catch (e: any) {
      if (activeOwnerRef.current === requestedOwnerId) {
        setError(e?.message || 'Failed to load connections');
      }
    } finally {
      if (activeOwnerRef.current === requestedOwnerId) setLoading(false);
    }
  }, [cacheOwnerId]);

  const scheduleRefresh = useCallback((reason: string) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      log.debug(`[PlatformConnectionsContext] Refreshing connections (${reason})`);
      fetchConnections();
    }, 600);
    // NOTE: do NOT add `scheduleRefresh` to its own deps. The self-reference made
    // this callback's identity change every render, which caused the socket effect
    // below (deps include scheduleRefresh) to disconnect/reconnect on every render.
  }, [fetchConnections]);

  useEffect(() => {
    if (!clerkLoaded || !cacheOwnerId || !jwtReady) return;
    fetchConnections();
    // Realtime change-signal now lives in the data layer (src/lib) per the
    // no-raw-channel-in-contexts rule; on any PlatformConnections change we refetch
    // (the API enriches the rows beyond what a raw table row provides).
    const unsubscribe = subscribePlatformConnectionChanges(() => scheduleRefresh('realtime'));
    return unsubscribe;
  }, [cacheOwnerId, clerkLoaded, fetchConnections, jwtReady, scheduleRefresh]);

  useEffect(() => {
    if (!authReady) return;

    let isCancelled = false;
    let socket: Socket | null = null;
    // Exactly-once release: acquireCollaborationSocket() bumps the refcount
    // synchronously, so every acquire must be balanced by one release regardless
    // of how this effect resolves or unmounts.
    let released = false;
    const releaseOnce = () => {
      if (!released) {
        released = true;
        releaseCollaborationSocket();
      }
    };

    // Stable handler refs so cleanup off()s exactly these. The shared socket is
    // also used by useSyncProgress/useCollaboration, so never blanket-remove.
    const onSyncProgress = (data: Omit<SyncProgressUpdate, 'receivedAt'>) => {
      if (!data?.connectionId) return;
      const receivedAt = Date.now();
      setProgressByConnectionId(prev => ({
        ...prev,
        [data.connectionId]: { ...data, receivedAt },
      }));

      const status = normalizeStatus(data.status);
      if (TERMINAL_STATUS_SET.has(status) || (typeof data.progress === 'number' && data.progress >= 100)) {
        scheduleRefresh('progress-terminal');
      }
    };

    // The backend is being upgraded to include isEnabled/platformType on
    // connection:status (disconnect events especially). Handle BOTH the old
    // {connectionId,status} shape and the richer one.
    const onConnectionStatus = (data: { connectionId: string; status: string; isEnabled?: boolean; platformType?: string; timestamp?: string }) => {
      if (!data?.connectionId) return;
      const status = normalizeStatus(data.status);
      if (!status) return;
      setConnections(prev =>
        prev.map(conn => {
          if (conn.Id !== data.connectionId) return conn;
          const patch: Partial<PlatformConnectionRow> = { Status: status };
          if (typeof data.isEnabled === 'boolean') {
            patch.IsEnabled = data.isEnabled;
          } else if (status === 'inactive') {
            // Old payload shape: the disconnect cascade always pairs
            // Status='inactive' with IsEnabled=false, so mirror it locally
            // until the authoritative refetch below lands.
            patch.IsEnabled = false;
          }
          if (data.platformType && !conn.PlatformType) patch.PlatformType = data.platformType;
          return { ...conn, ...patch };
        })
      );
      if (TERMINAL_STATUS_SET.has(status)) {
        scheduleRefresh('connection-status');
      }
    };

    // Use the ONE shared, ref-counted /collaboration socket instead of opening a
    // second io() connection to the same namespace.
    acquireCollaborationSocket()
      .then((s) => {
        if (isCancelled || !s) {
          releaseOnce();
          return;
        }
        socket = s;
        s.on('sync:progress', onSyncProgress);
        s.on('connection:status', onConnectionStatus);
      })
      .catch((error) => {
        log.error('[PlatformConnectionsContext] Failed to acquire collaboration socket:', error);
        releaseOnce();
      });

    return () => {
      isCancelled = true;
      if (socket) {
        socket.off('sync:progress', onSyncProgress);
        socket.off('connection:status', onConnectionStatus);
        socket = null;
      }
      releaseOnce();
    };
  }, [authReady, scheduleRefresh]);

  const ownedConnections = connectionsOwnerId === cacheOwnerId ? connections : [];

  const liveConnections = useMemo(() => {
    if (ownedConnections.length === 0) return [];
    return ownedConnections.map((conn) => {
      const storedStatus = normalizeStatus(conn.Status);
      // A stale sync-progress event must never revive a row the disconnect
      // endpoint has already marked inactive/disabled.
      if (
        isUnhealthyPlatformConnection(conn)
        || conn.IsEnabled === false
        || storedStatus === 'inactive'
        || storedStatus === 'disconnected'
        || storedStatus === 'disabled'
      ) {
        return conn;
      }
      const progress = progressByConnectionId[conn.Id];
      if (!progress) return conn;
      if (Date.now() - progress.receivedAt > PROGRESS_OVERRIDE_TTL_MS) return conn;
      const progressStatus = normalizeStatus(progress.status);
      if (!CONNECTION_STATUS_SET.has(progressStatus)) return conn;
      if (progressStatus === normalizeStatus(conn.Status)) return conn;
    return { ...conn, Status: progressStatus };
    });
  }, [ownedConnections, progressByConnectionId]);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgressByConnectionId(prev => {
        const now = Date.now();
        const next: Record<string, SyncProgressUpdate> = {};
        let expired = false;
        Object.entries(prev).forEach(([id, progress]) => {
          if (now - progress.receivedAt <= PROGRESS_OVERRIDE_TTL_MS) {
            next[id] = progress;
          } else {
            expired = true;
          }
        });
        return expired ? next : prev;
      });
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const connectedByPlatform = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const c of liveConnections) {
      const key = (c.PlatformType || '').toLowerCase();
      const active = c.IsEnabled && (c.Status || '').toLowerCase() === 'active';
      map[key] = map[key] || active;
    }
    return map;
  }, [liveConnections]);

  const isConnected = useCallback((platform: PlatformKey | string) => {
    const key = (platform || '').toString().toLowerCase();
    return !!connectedByPlatform[key];
  }, [connectedByPlatform]);

  // Immediate shared-store update for mutations such as disconnect. On failure
  // callers must refetch (refresh()) rather than restore the previous row. The
  // backend disables the row BEFORE its cascade and can leave it disabled even
  // when the request reports failure, so only the server knows the real state.
  const updateConnectionLocally = useCallback((connectionId: string, patch: Partial<PlatformConnectionRow>) => {
    setConnections(prev =>
      prev.map(connection => connection.Id === connectionId ? { ...connection, ...patch } : connection)
    );
  }, []);

  const value = useMemo<ContextValue>(() => ({
    connections: ownedConnections,
    liveConnections,
    progressByConnectionId,
    connectedByPlatform,
    isConnected,
    updateConnectionLocally,
    refresh: fetchConnections,
    loading,
    hasResolvedConnections,
    error,
  }), [ownedConnections, liveConnections, progressByConnectionId, connectedByPlatform, isConnected, updateConnectionLocally, fetchConnections, loading, hasResolvedConnections, error]);

  return (
    <PlatformConnectionsContext.Provider value={value}>
      {children}
    </PlatformConnectionsContext.Provider>
  );
};

export const usePlatformConnections = (): ContextValue => {
  const ctx = useContext(PlatformConnectionsContext);
  if (!ctx) throw new Error('usePlatformConnections must be used within PlatformConnectionsProvider');
  return ctx;
};
