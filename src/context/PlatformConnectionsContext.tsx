import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

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

type ContextValue = {
  connections: PlatformConnectionRow[];
  connectedByPlatform: Record<string, boolean>;
  isConnected: (platform: PlatformKey | string) => boolean;
  refresh: () => Promise<void>;
  loading: boolean;
  error?: string;
  toggles: Record<string, { enabled: boolean; allowPublish: boolean; allowSync: boolean; message?: string }>;
};

const PlatformConnectionsContext = createContext<ContextValue | undefined>(undefined);

export const PlatformConnectionsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connections, setConnections] = useState<PlatformConnectionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [toggles, setToggles] = useState<Record<string, { enabled: boolean; allowPublish: boolean; allowSync: boolean; message?: string }>>({});

  const fetchConnections = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || session?.user ? session?.access_token : session?.access_token;
      if (!token) {
        setConnections([]);
        return;
      }
      const base = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || 'https://api.sssync.app';
      const resp = await fetch(`${base}/api/platform-connections`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        setError(`Failed to load connections (${resp.status})`);
        setConnections([]);
        return;
      }
      const rows: PlatformConnectionRow[] = await resp.json();
      setConnections(Array.isArray(rows) ? rows : []);

      // Fetch toggles
      try {
        const togResp = await fetch(`${base}/api/platform-connections/toggles`, {
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

  useEffect(() => {
    fetchConnections();

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let retryCount = 0;
    const maxRetries = 3;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const setupSubscription = () => {
      // Subscribe to realtime updates for PlatformConnections table
      channel = supabase
        .channel('platform-connections-changes')
        .on(
          'postgres_changes',
          {
            event: '*', // Listen for INSERT, UPDATE, DELETE
            schema: 'public',
            table: 'PlatformConnections',
          },
          (payload) => {
            console.log('[PlatformConnectionsContext] Realtime update received:', payload.eventType);
            // Refetch all connections on any change
            fetchConnections();
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

  const connectedByPlatform = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const c of connections) {
      const key = (c.PlatformType || '').toLowerCase();
      const active = c.IsEnabled && (c.Status || '').toLowerCase() === 'active';
      map[key] = map[key] || active;
    }
    return map;
  }, [connections]);

  const isConnected = useCallback((platform: PlatformKey | string) => {
    const key = (platform || '').toString().toLowerCase();
    return !!connectedByPlatform[key];
  }, [connectedByPlatform]);

  const value: ContextValue = {
    connections,
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


