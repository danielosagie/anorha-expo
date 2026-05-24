import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SessionContext, SessionContextType, SessionMode, SessionUser } from './SessionContext';
import { configureClerkSupabaseBridge, getUserLike, stopClerkSupabaseBridge } from '../lib/supabase';
import { fetchUserEntitlements, UserEntitlements } from '../utils/entitlements';
import { AuthPersistence } from '../utils/AuthPersistence';
import { AppStateManager } from '../utils/AppStateManager';
import { ProcessPersistence } from '../utils/ProcessPersistence';

interface EnhancedSessionProviderProps {
  children: React.ReactNode;
  getClerkToken: () => Promise<string | null>;
}

const ENTITLEMENTS_CACHE_KEY = 'sssync_entitlements_cache_v1';

export const EnhancedSessionProvider: React.FC<EnhancedSessionProviderProps> = ({ 
  children, 
  getClerkToken 
}) => {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SessionUser>(null);
  const [entitlements, setEntitlements] = useState<UserEntitlements | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [usingCachedSession, setUsingCachedSession] = useState(false);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>('cached');
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [lastReadyAt, setLastReadyAt] = useState<number | null>(null);
  
  const configuredRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const userRef = useRef<SessionUser>(null);
  const authPersistence = useRef(AuthPersistence.getInstance());
  const appStateManager = useRef(AppStateManager.getInstance());
  const processPersistence = useRef(ProcessPersistence.getInstance());

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const loadCachedEntitlements = useCallback(async (): Promise<UserEntitlements | null> => {
    try {
      const stored = await AsyncStorage.getItem(ENTITLEMENTS_CACHE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      console.warn('[EnhancedSessionProvider] Failed to load cached entitlements:', error);
      return null;
    }
  }, []);

  const persistEntitlements = useCallback(async (nextEntitlements: UserEntitlements | null) => {
    try {
      if (!nextEntitlements) {
        await AsyncStorage.removeItem(ENTITLEMENTS_CACHE_KEY);
        return;
      }

      await AsyncStorage.setItem(ENTITLEMENTS_CACHE_KEY, JSON.stringify(nextEntitlements));
    } catch (error) {
      console.warn('[EnhancedSessionProvider] Failed to persist entitlements:', error);
    }
  }, []);

  const setCachedSessionState = useCallback(async (
    overrideMessage?: string,
    overrideLastReadyAt?: number | null,
  ) => {
    const persistedState = await authPersistence.current.getAuthState();
    const cachedEntitlements = await loadCachedEntitlements();

    if (persistedState?.isAuthenticated && persistedState.userId) {
      const cachedUser = {
        id: persistedState.userId,
        email: persistedState.email || '',
      };
      setUser((currentUser) => currentUser ?? {
        ...cachedUser,
      });
      setEntitlements((currentEntitlements) => currentEntitlements ?? cachedEntitlements);
      setReady(true);
      setBridgeReady(false);
      setSessionMode('cached');
      setUsingCachedSession(true);
      setBootstrapError(
        overrideMessage ??
        'Live services are unavailable right now. Continuing with cached account data.',
      );
      setLastReadyAt(overrideLastReadyAt ?? persistedState.lastAuthCheck ?? null);
      return true;
    }

    return false;
  }, [loadCachedEntitlements]);

  const clearSessionState = useCallback(async (options: { clearPersistedAuth?: boolean } = {}) => {
    if (options.clearPersistedAuth) {
      await authPersistence.current.clearAuthData();
    }

    try {
      stopClerkSupabaseBridge();
    } catch {}

    configuredRef.current = false;
    setReady(false);
    setBridgeReady(false);
    setSessionMode('cached');
    setUser(null);
    setEntitlements(null);
    setUsingCachedSession(false);
    setBootstrapError(options.clearPersistedAuth ? 'Unable to restore your session right now.' : null);
    setLastReadyAt(null);
  }, []);

  // Enhanced token validation with 30-minute intervals and auto-retry
  const validateAuthIfNeeded = useCallback(async (force: boolean = false, retryCount: number = 0): Promise<void> => {
    const shouldRevalidateAccount = force || authPersistence.current.shouldValidateAuth();
    const needsBridgeSetup = !configuredRef.current;
    const shouldValidate = needsBridgeSetup || shouldRevalidateAccount;
    
    if (!shouldValidate) {
      console.log('[EnhancedSessionProvider] Skipping auth validation (within 30-min window)');
      return;
    }

    console.log('[EnhancedSessionProvider] Performing auth validation, attempt:', retryCount + 1);
    
    try {
      const token = await getClerkToken();

      if (!token) {
        if (configuredRef.current) {
          try {
            stopClerkSupabaseBridge();
          } catch {}
          configuredRef.current = false;
          setBridgeReady(false);
        }

        const restoredFromCache = await setCachedSessionState(
          'Session token is unavailable. Continuing with cached account data while the session reconnects.',
        );

        if (!restoredFromCache) {
          await clearSessionState({ clearPersistedAuth: true });
        }
        return;
      }

      if (!configuredRef.current) {
        console.log('[EnhancedSessionProvider] Configuring Supabase bridge...');
        
        // Extended to 30 minutes instead of 9
        await configureClerkSupabaseBridge({ getClerkToken, autoRefreshMinutes: 30 });
        configuredRef.current = true;
      }

      setBridgeReady(true);
      setReady(true);
      setSessionMode('live');
      setUsingCachedSession(false);

      if (!shouldRevalidateAccount) {
        setBootstrapError(null);
        console.log('[EnhancedSessionProvider] Bridge is ready; skipping account revalidation within auth window');
        // Still refresh user from me so session.user.id matches JWT sub (fixes onboarding identity mismatch)
        try {
          const { user: me } = await getUserLike();
          if (me?.id) {
            await authPersistence.current.saveAuthState({
              isAuthenticated: true,
              userId: me.id,
              email: me.email || userRef.current?.email || null,
              tokenExpiry: Date.now() + (30 * 60 * 1000),
            });
            setUser(me);
          }
        } catch (refreshErr) {
          console.warn('[EnhancedSessionProvider] Could not refresh user from me (within auth window):', refreshErr);
        }
        return;
      }

      console.log('[EnhancedSessionProvider] Bridge configured. Loading user data...');
      const { user: me } = await getUserLike();
      const ents = await fetchUserEntitlements().catch(async (error) => {
        console.warn('[EnhancedSessionProvider] Falling back to cached entitlements:', error);
        return loadCachedEntitlements();
      });

      await authPersistence.current.saveAuthState({
        isAuthenticated: true,
        userId: me?.id || userRef.current?.id || null,
        email: me?.email || userRef.current?.email || null,
        tokenExpiry: Date.now() + (30 * 60 * 1000),
      });

      const resolvedUser = me ?? userRef.current;
      setUser(resolvedUser);
      setEntitlements(ents);
      await persistEntitlements(ents);

      if (resolvedUser?.id) {
        await processPersistence.current.initialize(resolvedUser.id);
        console.log('[EnhancedSessionProvider] Process persistence initialized');
      }

      setReady(true);
      setBridgeReady(true);
      setSessionMode('live');
      setUsingCachedSession(false);
      setBootstrapError(null);
      setLastReadyAt(Date.now());

      console.log('[EnhancedSessionProvider] Session ready for user:', resolvedUser?.id);
    } catch (e) {
      console.error('[EnhancedSessionProvider] Auth validation failed:', e);
      
      // Auto-retry with exponential backoff (max 3 attempts)
      if (retryCount < 2) {
        const retryDelay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
        console.log(`[EnhancedSessionProvider] Auto-retrying in ${retryDelay}ms...`);
        
        setTimeout(() => {
          validateAuthIfNeeded(force, retryCount + 1).catch(console.error);
        }, retryDelay);
      } else {
        console.error('[EnhancedSessionProvider] Max retries reached, entering degraded mode if cache is available');
        configuredRef.current = false;
        setBridgeReady(false);
        setSessionMode('cached');

        const restoredFromCache = await setCachedSessionState(
          'Live services are unavailable right now. Continuing with cached account data.',
        );
        if (restoredFromCache) {
          return;
        }

        await clearSessionState({ clearPersistedAuth: true });
      }
    }
  }, [clearSessionState, getClerkToken, loadCachedEntitlements, persistEntitlements, setCachedSessionState]);

  // Initialize session from persisted state
  const initializeFromPersistedState = useCallback(async (): Promise<void> => {
    console.log('[EnhancedSessionProvider] Checking persisted auth state...');
    
    const persistedState = await authPersistence.current.getAuthState();
    const cachedEntitlements = await loadCachedEntitlements();
    
    if (persistedState?.isAuthenticated && persistedState.userId) {
      console.log('[EnhancedSessionProvider] Found valid persisted state for user:', persistedState.userId);
      
      // Set user immediately from cache for better UX
      setUser((currentUser) => {
        const nextUser = {
          id: persistedState.userId,
          email: persistedState.email || '',
        };

        if (currentUser?.id === nextUser.id && currentUser?.email === nextUser.email) {
          return currentUser;
        }

        return nextUser as any;
      });
      setUsingCachedSession(true);
      setBridgeReady(false);
      setSessionMode('cached');
      setBootstrapError('Restoring your workspace from cached session data.');
      setLastReadyAt(persistedState.lastAuthCheck || null);
      
      if (cachedEntitlements) {
        setEntitlements(cachedEntitlements);
      }
      
      setReady(true);
      
      // Always attempt to establish the live bridge in background for cached sessions.
      validateAuthIfNeeded(false).catch(console.error);
    } else {
      console.log('[EnhancedSessionProvider] No valid persisted state found');
      // Force validation for new sessions
      await validateAuthIfNeeded(true);
    }
    
    setInitializing(false);
  }, [loadCachedEntitlements, validateAuthIfNeeded]);

  useEffect(() => {
    let cancelled = false;
    
    console.log('[EnhancedSessionProvider] Initializing...');
    
    // Initialize app state manager
    appStateManager.current.initialize(() => {
      console.log('[EnhancedSessionProvider] App state manager requested auth validation');
      validateAuthIfNeeded(true).catch(console.error);
    });
    
    // Initialize from persisted state
    initializeFromPersistedState().catch(console.error);
    
    // Set up periodic validation (every 10 minutes, but actual validation only happens every 30 minutes)
    timerRef.current = setInterval(() => {
      if (!cancelled) {
        validateAuthIfNeeded().catch(console.error);
      }
    }, 10 * 60 * 1000); // Check every 10 minutes
    
    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      appStateManager.current.cleanup();
    };
  }, [initializeFromPersistedState, validateAuthIfNeeded]);

  const refresh = useCallback(async () => {
    console.log('[EnhancedSessionProvider] Manual refresh requested');
    try {
      if (!bridgeReady) {
        await validateAuthIfNeeded(true);
      }

      const { user: me } = await getUserLike();
      const ents = await fetchUserEntitlements().catch(async () => loadCachedEntitlements());
      
      // Update persisted state
      await authPersistence.current.saveAuthState({
        isAuthenticated: true,
        userId: me?.id || null,
        email: me?.email || null,
      });
      
      setUser(me);
      setEntitlements(ents);
      await persistEntitlements(ents);
      setBridgeReady(true);
      setSessionMode('live');
      setUsingCachedSession(false);
      setBootstrapError(null);
      setLastReadyAt(Date.now());
    } catch (error) {
      console.error('[EnhancedSessionProvider] Refresh failed:', error);
      // Don't clear state on refresh failures - might be network issue
      setBridgeReady(false);
      setSessionMode('cached');
      setUsingCachedSession(true);
      setBootstrapError('Refresh failed. Cached account data is still available.');
    }
  }, [bridgeReady, loadCachedEntitlements, persistEntitlements, validateAuthIfNeeded]);

  const value: SessionContextType = useMemo(() => ({ 
    ready: ready && !initializing, 
    bridgeReady,
    user, 
    entitlements, 
    bootstrapState: !ready || initializing ? 'initializing' : (usingCachedSession || !!bootstrapError ? 'degraded' : 'ready'),
    usingCachedSession,
    sessionMode,
    bootstrapError,
    lastReadyAt,
    refresh 
  }), [ready, initializing, bridgeReady, user, entitlements, usingCachedSession, sessionMode, bootstrapError, lastReadyAt, refresh]);

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
};
