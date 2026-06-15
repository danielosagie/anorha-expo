import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, ensureSupabaseJwt, getSupabaseUserId } from '../../lib/supabase';
import { API_BASE_URL } from '../config/env';
import { acquireCollaborationSocket, releaseCollaborationSocket, type Socket } from '../lib/collaborationSocket';
import { TABLES } from '../constants/tableNames';

export type PlatformKey = 'shopify' | 'square' | 'clover' | 'ebay' | 'facebook' | 'amazon' | 'depop' | 'whatnot' | 'etsy';

export interface PlatformConnectionRow {
  Id: string;
  UserId: string;
  PlatformType: string;
  DisplayName: string;
  Status: string;
  IsEnabled: boolean;
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
  refresh: () => Promise<void>;
  loading: boolean;
  error?: string;
  toggles: Record<string, { enabled: boolean; allowPublish: boolean; allowSync: boolean; message?: string }>;
};

const PlatformConnectionsContext = createContext<ContextValue | undefined>(undefined);

const API_BASE = API_BASE_URL;
const CONNECTION_STATUS_SET = new Set(['active', 'inactive', 'pending', 'review', 'ready_to_sync', 'scanning', 'syncing', 'reconciling', 'error']);
const TERMINAL_STATUS_SET = new Set(['active', 'review', 'error']);
const PROGRESS_OVERRIDE_TTL_MS = 2 * 60 * 1000;

const normalizeStatus = (value?: string) => (value || '').toLowerCase().trim();

export const PlatformConnectionsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connections, setConnections] = useState<PlatformConnectionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [toggles, setToggles] = useState<Record<string, { enabled: boolean; allowPublish: boolean; allowSync: boolean; message?: string }>>({});
  const [progressByConnectionId, setProgressByConnectionId] = useState<Record<string, SyncProgressUpdate>>({});
  const [authReady, setAuthReady] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchConnections = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const token = await ensureSupabaseJwt();
      if (!token) {
        setError('Authentication required to load connections');
        setConnections([]);
        setAuthReady(false);
        return;
      }
      setAuthReady(true);
      const resp = await fetch(`${API_BASE}/api/platform-connections`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        setError(`Failed to load connections (${resp.status})`);
        setConnections([]);
        return;
      }
      const rows: PlatformConnectionRow[] = await resp.json();
      const safeRows = Array.isArray(rows) ? rows : [];
      setConnections(safeRows);
      setProgressByConnectionId(prev => {
        const next = { ...prev };
        const validIds = new Set(safeRows.map(r => r.Id));
        Object.keys(next).forEach((id) => {
          if (!validIds.has(id)) delete next[id];
        });
        return next;
      });

      // Fetch toggles
      try {
        const togResp = await fetch(`${API_BASE}/api/platform-connections/toggles`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (togResp.ok) {
          const arr = await togResp.json();
          const map: Record<string, { enabled: boolean; allowPublish: boolean; allowSync: boolean; message?: string }> = {};
          for (const t of arr || []) {
            const key = (t.PlatformType || '').toLowerCase();
            map[key] = { enabled: !!t.Enabled, allowPublish: t.AllowPublish ?? true, allowSync: t.AllowSync ?? true, message: t.Message };
          }
          setToggles(map);
        }
      } catch { }
    } catch (e: any) {
      setError(e?.message || 'Failed to load connections');
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const scheduleRefresh = useCallback((reason: string) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      console.log(`[PlatformConnectionsContext] Refreshing connections (${reason})`);
      fetchConnections();
    }, 600);
    // NOTE: do NOT add `scheduleRefresh` to its own deps — the self-reference made
    // this callback's identity change every render, which caused the socket effect
    // below (deps include scheduleRefresh) to disconnect/reconnect on every render.
  }, [fetchConnections]);

  useEffect(() => {
    fetchConnections();

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let retryCount = 0;
    const maxRetries = 3;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const setupSubscription = () => {
      // Defense-in-depth: scope the channel to the current user when their id is
      // known (decoded from the Supabase JWT — this provider mounts above the
      // session provider, so we read the id from the token, not context). RLS
      // already enforces row scoping; if the JWT hasn't minted yet we fall back to
      // an unfiltered channel (the previous behaviour), still RLS-protected.
      const currentUserId = getSupabaseUserId();
      // Subscribe to realtime updates for PlatformConnections table
      channel = supabase
        // Stable channel name: a `Date.now()` suffix produced a new, distinctly-named
        // channel on every (re)subscribe, risking orphaned channels on the server.
        .channel('platform-connections-changes')
        .on(
          'postgres_changes',
          {
            event: '*', // Listen for INSERT, UPDATE, DELETE
            schema: 'public',
            table: TABLES.PlatformConnections,
            ...(currentUserId ? { filter: `UserId=eq.${currentUserId}` } : {}),
          },
          (payload) => {
            console.log('[PlatformConnectionsContext] Realtime update received:', payload.eventType);
            // Refetch all connections on any change
            scheduleRefresh('realtime');
          }
        )
        .subscribe((status) => {
          console.log('[PlatformConnectionsContext] Realtime subscription status:', status);
          if (status === 'SUBSCRIBED') {
            retryCount = 0; // Reset on success
          } else if (status === 'CHANNEL_ERROR') {
            // Auto-retry with exponential backoff
            if (retryCount < maxRetries) {
              const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
              console.log(`[PlatformConnectionsContext] Retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
              retryTimeout = setTimeout(() => {
                retryCount++;
                if (channel) supabase.removeChannel(channel);
                setupSubscription();
              }, delay);
            } else {
              console.error('[PlatformConnectionsContext] Max retries reached for realtime subscription');
            }
          }
        });
    };

    setupSubscription();

    // Cleanup subscription on unmount
    return () => {
      console.log('[PlatformConnectionsContext] Unsubscribing from realtime updates');
      if (retryTimeout) clearTimeout(retryTimeout);
      if (channel) supabase.removeChannel(channel);
    };
  }, [fetchConnections]);

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

    // Stable handler refs so cleanup off()s exactly these — the shared socket is
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

    const onConnectionStatus = (data: { connectionId: string; status: string; platformType?: string; timestamp?: string }) => {
      if (!data?.connectionId) return;
      const status = normalizeStatus(data.status);
      if (!status) return;
      setConnections(prev =>
        prev.map(conn => (conn.Id === data.connectionId ? { ...conn, Status: status } : conn))
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
        console.error('[PlatformConnectionsContext] Failed to acquire collaboration socket:', error);
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

  const liveConnections = useMemo(() => {
    if (connections.length === 0) return [];
    return connections.map((conn) => {
      const progress = progressByConnectionId[conn.Id];
      if (!progress) return conn;
      if (Date.now() - progress.receivedAt > PROGRESS_OVERRIDE_TTL_MS) return conn;
      const progressStatus = normalizeStatus(progress.status);
      if (!CONNECTION_STATUS_SET.has(progressStatus)) return conn;
      if (progressStatus === normalizeStatus(conn.Status)) return conn;
    return { ...conn, Status: progressStatus };
    });
  }, [connections, progressByConnectionId]);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgressByConnectionId(prev => {
        const now = Date.now();
        const next: Record<string, SyncProgressUpdate> = {};
        Object.entries(prev).forEach(([id, progress]) => {
          if (now - progress.receivedAt <= PROGRESS_OVERRIDE_TTL_MS) {
            next[id] = progress;
          }
        });
        return next;
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

  const value: ContextValue = {
    connections,
    liveConnections,
    progressByConnectionId,
    connectedByPlatform,
    isConnected,
    refresh: fetchConnections,
    loading,
    error,
    toggles,
  };

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
