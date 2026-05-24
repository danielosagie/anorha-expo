import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import * as Network from 'expo-network';
import {
  getSupabaseJwtState,
  isSupabaseBridgeUnavailableState,
  isSupabaseBridgeWarmingUp,
  subscribeToSupabaseJwtState,
  type SupabaseJwtAcquisitionState,
} from '../lib/supabase';
import { API_BASE_URL as ENV_API_BASE_URL } from '../config/env';

export type RemoteStatusMode = 'operational' | 'degraded' | 'maintenance';
export type EffectiveSystemMode = RemoteStatusMode | 'offline';
export type ConnectivityState = 'online' | 'offline' | 'unknown';
export type BackendState = RemoteStatusMode | 'unknown';
export type AuthBridgeState = 'ready' | 'refreshing' | 'unavailable';

export interface RemoteStatusManifest {
  mode: RemoteStatusMode;
  message?: string;
  updatedAt?: string;
}

interface SystemStatusContextValue {
  backendReachable: boolean | null;
  connectivityState: ConnectivityState;
  backendState: BackendState;
  authBridgeState: AuthBridgeState;
  effectiveMode: EffectiveSystemMode;
  forceOfflineMode: boolean;
  hasCheckedOnce: boolean;
  isRefreshing: boolean;
  lastCheckedAt: string | null;
  lastHealthyAt: string | null;
  manifest: RemoteStatusManifest | null;
  message: string;
  usingCachedStatus: boolean;
  retry: () => Promise<void>;
}

const API_BASE_URL = ENV_API_BASE_URL;
const STATUS_MANIFEST_URL = process.env.EXPO_PUBLIC_STATUS_MANIFEST_URL?.trim() || '';
const STATUS_POLL_INTERVAL_MS = 60_000;
const FORCE_OFFLINE_MODE = String(process.env.EXPO_PUBLIC_FORCE_OFFLINE_MODE).toLowerCase() === 'true';

const defaultStatusValue: SystemStatusContextValue = {
  backendReachable: true,
  connectivityState: FORCE_OFFLINE_MODE ? 'offline' : 'unknown',
  backendState: 'unknown',
  authBridgeState: 'ready',
  effectiveMode: FORCE_OFFLINE_MODE ? 'offline' : 'operational',
  forceOfflineMode: FORCE_OFFLINE_MODE,
  hasCheckedOnce: false,
  isRefreshing: false,
  lastCheckedAt: null,
  lastHealthyAt: null,
  manifest: null,
  message: '',
  usingCachedStatus: false,
  retry: async () => { },
};

const SystemStatusContext = createContext<SystemStatusContextValue>(defaultStatusValue);

function mapAuthBridgeState(isSignedIn: boolean, jwtState: SupabaseJwtAcquisitionState): AuthBridgeState {
  if (!isSignedIn) return 'ready';
  if (jwtState === 'ready') return 'ready';
  if (isSupabaseBridgeWarmingUp(jwtState)) return 'refreshing';
  if (isSupabaseBridgeUnavailableState(jwtState)) return 'unavailable';
  return 'unavailable';
}

function buildStatusMessage(params: {
  isSignedIn: boolean;
  connectivityState: ConnectivityState;
  backendState: BackendState;
  authBridgeState: AuthBridgeState;
  manifest: RemoteStatusManifest | null;
}): string {
  if (params.connectivityState === 'offline') {
    return 'You appear to be offline. Cached data will stay available until the connection returns.';
  }

  if (params.manifest?.message?.trim()) {
    return params.manifest.message.trim();
  }

  if (params.backendState === 'maintenance') {
    return 'Scheduled maintenance is in progress. Some actions may be unavailable.';
  }

  if (params.backendState === 'degraded') {
    return 'Some backend systems are degraded. Cached data will stay available while services recover.';
  }

  if (!params.isSignedIn) {
    return '';
  }

  if (params.authBridgeState === 'refreshing') {
    return 'Refreshing your live session. Network features may appear shortly.';
  }

  if (params.authBridgeState === 'unavailable') {
    return 'Live account access is unavailable right now. Cached workspace data is still available.';
  }

  return '';
}

export const SystemStatusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isSignedIn } = useAuth();
  const [connectivityState, setConnectivityState] = useState<ConnectivityState>(
    FORCE_OFFLINE_MODE ? 'offline' : 'unknown',
  );
  const [backendReachable, setBackendReachable] = useState<boolean | null>(FORCE_OFFLINE_MODE ? false : null);
  const [backendState, setBackendState] = useState<BackendState>(FORCE_OFFLINE_MODE ? 'unknown' : 'unknown');
  const [manifest, setManifest] = useState<RemoteStatusManifest | null>(null);
  const [authBridgeState, setAuthBridgeState] = useState<AuthBridgeState>(
    mapAuthBridgeState(!!isSignedIn, getSupabaseJwtState().state),
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasCheckedOnce, setHasCheckedOnce] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [lastHealthyAt, setLastHealthyAt] = useState<string | null>(null);
  const [usingCachedStatus, setUsingCachedStatus] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (FORCE_OFFLINE_MODE) {
      setConnectivityState('offline');
      setBackendReachable(false);
      setBackendState('unknown');
      setHasCheckedOnce(true);
      setLastCheckedAt(new Date().toISOString());
      return;
    }

    setIsRefreshing(true);
    try {
      const networkState = await Network.getNetworkStateAsync();
      const online = Boolean(networkState.isConnected && networkState.isInternetReachable !== false);
      const nowIso = new Date().toISOString();

      setConnectivityState(online ? 'online' : 'offline');
      setLastCheckedAt(nowIso);
      setHasCheckedOnce(true);

      if (!online) {
        setBackendReachable(false);
        setBackendState('unknown');
        setUsingCachedStatus(true);
        return;
      }

      const manifestFetch = STATUS_MANIFEST_URL
        ? fetch(STATUS_MANIFEST_URL, { headers: { Accept: 'application/json' } }).catch(() => null)
        : Promise.resolve(null);
      const healthFetch = fetch(`${API_BASE_URL}/health`, { headers: { Accept: 'application/json' } }).catch(() => null);

      const [manifestResponse, healthResponse] = await Promise.all([manifestFetch, healthFetch]);

      let nextManifest: RemoteStatusManifest | null = null;
      if (manifestResponse?.ok) {
        const payload = await manifestResponse.json().catch(() => null);
        if (payload?.mode) {
          nextManifest = {
            mode: payload.mode,
            message: payload.message,
            updatedAt: payload.updatedAt || nowIso,
          };
        }
      }

      setManifest(nextManifest);
      const backendOk = !!healthResponse?.ok;
      setBackendReachable(backendOk);
      if (backendOk) {
        setLastHealthyAt(nowIso);
        setUsingCachedStatus(false);
      } else {
        setUsingCachedStatus(true);
      }

      if (nextManifest?.mode) {
        setBackendState(nextManifest.mode);
      } else {
        setBackendState(backendOk ? 'operational' : 'degraded');
      }
    } catch (error) {
      console.warn('[SystemStatus] Status refresh failed:', error);
      setConnectivityState('unknown');
      setBackendReachable(false);
      setBackendState('degraded');
      setUsingCachedStatus(true);
      setHasCheckedOnce(true);
      setLastCheckedAt(new Date().toISOString());
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setAuthBridgeState(mapAuthBridgeState(!!isSignedIn, getSupabaseJwtState().state));
    const unsubscribe = subscribeToSupabaseJwtState((status) => {
      setAuthBridgeState(mapAuthBridgeState(!!isSignedIn, status.state));
    });
    return unsubscribe;
  }, [isSignedIn]);

  useEffect(() => {
    refreshStatus().catch(console.error);

    const interval = setInterval(() => {
      refreshStatus().catch(console.error);
    }, STATUS_POLL_INTERVAL_MS);

    let appState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const wasBackgrounded = /inactive|background/.test(appState);
      appState = nextState;

      if (nextState === 'active' && wasBackgrounded) {
        refreshStatus().catch(console.error);
      }
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [refreshStatus]);

  const effectiveMode: EffectiveSystemMode = useMemo(() => {
    if (FORCE_OFFLINE_MODE || connectivityState === 'offline') {
      return 'offline';
    }

    if (backendState === 'maintenance') {
      return 'maintenance';
    }

    if (backendState === 'degraded') {
      return 'degraded';
    }

    return 'operational';
  }, [backendState, connectivityState]);

  const message = useMemo(() => buildStatusMessage({
    isSignedIn: !!isSignedIn,
    connectivityState,
    backendState,
    authBridgeState,
    manifest,
  }), [isSignedIn, connectivityState, backendState, authBridgeState, manifest]);

  const value = useMemo<SystemStatusContextValue>(() => ({
    backendReachable,
    connectivityState,
    backendState,
    authBridgeState,
    effectiveMode,
    forceOfflineMode: FORCE_OFFLINE_MODE,
    hasCheckedOnce,
    isRefreshing,
    lastCheckedAt,
    lastHealthyAt,
    manifest,
    message,
    usingCachedStatus,
    retry: refreshStatus,
  }), [
    backendReachable,
    connectivityState,
    backendState,
    authBridgeState,
    effectiveMode,
    hasCheckedOnce,
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
