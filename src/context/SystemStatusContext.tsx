import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type RemoteStatusMode = 'operational' | 'degraded' | 'maintenance';
export type EffectiveSystemMode = RemoteStatusMode | 'offline';

export interface RemoteStatusManifest {
  mode: RemoteStatusMode;
  message?: string;
  updatedAt?: string;
}

interface SystemStatusContextValue {
  backendReachable: boolean | null;
  effectiveMode: EffectiveSystemMode;
  isRefreshing: boolean;
  lastCheckedAt: string | null;
  lastHealthyAt: string | null;
  manifest: RemoteStatusManifest | null;
  message: string;
  usingCachedStatus: boolean;
  retry: () => Promise<void>;
}

const STATUS_CACHE_KEY = 'sssync_system_status_cache_v1';
const STATUS_HEALTHY_AT_KEY = 'sssync_system_status_last_healthy_at';
const STATUS_POLL_INTERVAL_MS = 60_000;

const API_BASE_URL = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app';
const STATUS_MANIFEST_URL = process.env.EXPO_PUBLIC_STATUS_MANIFEST_URL?.trim() || '';

const defaultStatusValue: SystemStatusContextValue = {
  backendReachable: null,
  effectiveMode: 'operational',
  isRefreshing: false,
  lastCheckedAt: null,
  lastHealthyAt: null,
  manifest: null,
  message: '',
  usingCachedStatus: false,
  retry: async () => { },
};

const SystemStatusContext = createContext<SystemStatusContextValue>(defaultStatusValue);

function buildStatusMessage(params: {
  effectiveMode: EffectiveSystemMode;
  manifest: RemoteStatusManifest | null;
  backendReachable: boolean | null;
}): string {
  if (params.manifest?.message?.trim()) {
    return params.manifest.message.trim();
  }

  if (params.effectiveMode === 'maintenance') {
    return 'Scheduled maintenance is in progress. Some actions may be unavailable.';
  }

  if (params.effectiveMode === 'degraded') {
    return 'Some backend systems are degraded. Cached data will stay available while services recover.';
  }

  if (params.effectiveMode === 'offline' || params.backendReachable === false) {
    return 'Backend connection is unavailable. The app is using cached data where possible.';
  }

  return '';
}

export const SystemStatusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);
  const [manifest, setManifest] = useState<RemoteStatusManifest | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [lastHealthyAt, setLastHealthyAt] = useState<string | null>(null);
  const [usingCachedStatus, setUsingCachedStatus] = useState(false);

  const loadCachedStatus = useCallback(async () => {
    try {
      const [cachedManifest, cachedHealthyAt] = await Promise.all([
        AsyncStorage.getItem(STATUS_CACHE_KEY),
        AsyncStorage.getItem(STATUS_HEALTHY_AT_KEY),
      ]);

      if (cachedManifest) {
        setManifest(JSON.parse(cachedManifest));
        setUsingCachedStatus(true);
      }

      if (cachedHealthyAt) {
        setLastHealthyAt(cachedHealthyAt);
      }
    } catch (error) {
      console.warn('[SystemStatus] Failed to load cached status state:', error);
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    setIsRefreshing(true);

    const statusFetch = STATUS_MANIFEST_URL
      ? fetch(STATUS_MANIFEST_URL, { headers: { Accept: 'application/json' } })
      : Promise.resolve(null);
    const backendFetch = fetch(`${API_BASE_URL}/health`, { headers: { Accept: 'application/json' } });

    try {
      const [statusResult, backendResult] = await Promise.allSettled([statusFetch, backendFetch]);
      const nowIso = new Date().toISOString();

      let nextManifest = manifest;
      let manifestFetched = false;

      if (statusResult.status === 'fulfilled' && statusResult.value && statusResult.value.ok) {
        const payload = await statusResult.value.json().catch(() => null);
        if (payload?.mode) {
          nextManifest = {
            mode: payload.mode,
            message: payload.message,
            updatedAt: payload.updatedAt || nowIso,
          };
          manifestFetched = true;
          setManifest(nextManifest);
          await AsyncStorage.setItem(STATUS_CACHE_KEY, JSON.stringify(nextManifest));
        }
      }

      const backendOk =
        backendResult.status === 'fulfilled' &&
        backendResult.value.ok;

      setBackendReachable(backendOk);
      setLastCheckedAt(nowIso);

      if (backendOk) {
        setUsingCachedStatus(false);
        setLastHealthyAt(nowIso);
        await AsyncStorage.setItem(STATUS_HEALTHY_AT_KEY, nowIso);
      } else if (manifestFetched || nextManifest) {
        setUsingCachedStatus(true);
      }
    } catch (error) {
      console.warn('[SystemStatus] Status refresh failed:', error);
      setBackendReachable(false);
      setUsingCachedStatus(true);
      setLastCheckedAt(new Date().toISOString());
    } finally {
      setIsRefreshing(false);
    }
  }, [manifest]);

  useEffect(() => {
    loadCachedStatus().catch(console.error);
    refreshStatus().catch(console.error);

    const interval = setInterval(() => {
      refreshStatus().catch(console.error);
    }, STATUS_POLL_INTERVAL_MS);

    let appState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const wasBackgrounded = appState.match(/inactive|background/);
      appState = nextState;

      if (nextState === 'active' && wasBackgrounded) {
        refreshStatus().catch(console.error);
      }
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [loadCachedStatus, refreshStatus]);

  const effectiveMode: EffectiveSystemMode = useMemo(() => {
    if (backendReachable === false && manifest?.mode !== 'maintenance') {
      return manifest?.mode === 'degraded' ? 'degraded' : 'offline';
    }

    return manifest?.mode || 'operational';
  }, [backendReachable, manifest]);

  const message = useMemo(() => buildStatusMessage({
    effectiveMode,
    manifest,
    backendReachable,
  }), [backendReachable, effectiveMode, manifest]);

  const value = useMemo<SystemStatusContextValue>(() => ({
    backendReachable,
    effectiveMode,
    isRefreshing,
    lastCheckedAt,
    lastHealthyAt,
    manifest,
    message,
    usingCachedStatus,
    retry: refreshStatus,
  }), [
    backendReachable,
    effectiveMode,
    isRefreshing,
    lastCheckedAt,
    lastHealthyAt,
    manifest,
    message,
    usingCachedStatus,
    refreshStatus,
  ]);

  return (
    <SystemStatusContext.Provider value={value}>
      {children}
    </SystemStatusContext.Provider>
  );
};

export function useSystemStatus(): SystemStatusContextValue {
  return useContext(SystemStatusContext);
}
