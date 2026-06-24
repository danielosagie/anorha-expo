import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SessionContext, SessionContextType, SessionMode, SessionUser } from './SessionContext';
import { configureClerkSupabaseBridge, forceRefreshSupabaseJwt, getUserLike, stopClerkSupabaseBridge } from '../lib/supabase';
import { fetchUserEntitlements, UserEntitlements } from '../utils/entitlements';
import { AuthPersistence } from '../utils/AuthPersistence';
import { AppStateManager } from '../utils/AppStateManager';
import { ProcessPersistence } from '../utils/ProcessPersistence';
import { createLogger } from '../utils/logger';
const log = createLogger('EnhancedSessionProvider');


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
      log.warn('[EnhancedSessionProvider] Failed to load cached entitlements:', error);
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
      log.warn('[EnhancedSessionProvider] Failed to persist entitlements:', error);
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
      log.debug('[EnhancedSessionProvider] Skipping auth validation (within 30-min window)');
      // shouldValidate was false because needsBridgeSetup was false → the bridge IS
      // configured. The init effect can re-run (callback deps churn) and reset
      // bridgeReady=false; a skipped validation must NOT leave it stuck false, or the
      // app bounces to the reconnect screen over a perfectly live bridge. Re-affirm.
      if (configuredRef.current) {
        setBridgeReady(true);
        setReady(true);
      }
      return;
    }

    log.debug('[EnhancedSessionProvider] Performing auth validation, attempt:', retryCount + 1);
    
    try {
      const token = await getClerkToken();

      if (!token) {
        // A null Clerk token is almost always TRANSIENT — the token is mid-rotation, a
        // concurrent validation grabbed it, or the SDK is still warming on cold start.
        // It is NOT a sign-out. Do NOT tear down a HEALTHY bridge or flip the app to the
        // reconnect screen on the first null (that's what made a normal online login
        // briefly show home, then bounce to "Can't reach your account" until Try again).
        // Retry QUIETLY, leaving bridgeReady as-is so the app stays up; only after the
        // retries are exhausted do we treat the token as genuinely gone and degrade.
        if (retryCount < 4) {
          const retryDelay = Math.min(Math.pow(2, retryCount) * 500, 4000); // 0.5s,1s,2s,4s
          log.debug(
            `[EnhancedSessionProvider] Clerk token unavailable; retrying quietly in ${retryDelay}ms (attempt ${retryCount + 2})`,
          );
          setTimeout(() => {
            validateAuthIfNeeded(force, retryCount + 1).catch(log.error);
          }, retryDelay);
          return;
        }

        // Retries exhausted — token genuinely unavailable. NOW tear down the bridge and
        // degrade (cached data → loud reconnect screen, or clear if there's no cache).
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
        log.debug('[EnhancedSessionProvider] Configuring Supabase bridge...');
        // Refresh cadence is derived from the token's expires_in inside the bridge.
        await configureClerkSupabaseBridge({ getClerkToken });
        configuredRef.current = true;
      }

      setBridgeReady(true);
      setReady(true);
      setSessionMode('live');
      setUsingCachedSession(false);

      if (!shouldRevalidateAccount) {
        setBootstrapError(null);
        log.debug('[EnhancedSessionProvider] Bridge is ready; skipping account revalidation within auth window');
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
          log.warn('[EnhancedSessionProvider] Could not refresh user from me (within auth window):', refreshErr);
        }
        return;
      }

      log.debug('[EnhancedSessionProvider] Bridge configured. Loading user data...');
      const { user: me } = await getUserLike();
      const ents = await fetchUserEntitlements().catch(async (error) => {
        log.warn('[EnhancedSessionProvider] Falling back to cached entitlements:', error);
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
        log.debug('[EnhancedSessionProvider] Process persistence initialized');
      }

      setReady(true);
      setBridgeReady(true);
      setSessionMode('live');
      setUsingCachedSession(false);
      setBootstrapError(null);
      setLastReadyAt(Date.now());

      log.debug('[EnhancedSessionProvider] Session ready for user:', resolvedUser?.id);
    } catch (e) {
      log.error('[EnhancedSessionProvider] Auth validation failed:', e);
      
      // Auto-retry with exponential backoff (max 3 attempts)
      if (retryCount < 2) {
        const retryDelay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
        log.debug(`[EnhancedSessionProvider] Auto-retrying in ${retryDelay}ms...`);
        
        setTimeout(() => {
          validateAuthIfNeeded(force, retryCount + 1).catch(log.error);
        }, retryDelay);
      } else {
        log.error('[EnhancedSessionProvider] Max retries reached, entering degraded mode if cache is available');
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
    log.debug('[EnhancedSessionProvider] Checking persisted auth state...');

    // If the live bridge is already up, this is an effect RE-RUN (the init effect's
    // callback deps churned), not a fresh boot. Do NOT demote the session back to
    // cached/bridgeReady=false — that, combined with the 30-min skip in
    // validateAuthIfNeeded, left bridgeReady stuck false and bounced the app to the
    // reconnect screen over a healthy session. Re-affirm the live state and bail.
    if (configuredRef.current) {
      setBridgeReady(true);
      setReady(true);
      setInitializing(false);
      return;
    }

    const persistedState = await authPersistence.current.getAuthState();
    const cachedEntitlements = await loadCachedEntitlements();
    
    if (persistedState?.isAuthenticated && persistedState.userId) {
      log.debug('[EnhancedSessionProvider] Found valid persisted state for user:', persistedState.userId);
      
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
      validateAuthIfNeeded(false).catch(log.error);
    } else {
      log.debug('[EnhancedSessionProvider] No valid persisted state found');
      // Force validation for new sessions
      await validateAuthIfNeeded(true);
    }
    
    setInitializing(false);
  }, [loadCachedEntitlements, validateAuthIfNeeded]);

  useEffect(() => {
    let cancelled = false;
    
    log.debug('[EnhancedSessionProvider] Initializing...');
    
    // Initialize app state manager
    appStateManager.current.initialize(() => {
      log.debug('[EnhancedSessionProvider] App state manager requested auth validation');
      validateAuthIfNeeded(true).catch(log.error);
    });
    
    // Initialize from persisted state
    initializeFromPersistedState().catch(log.error);
    
    // Set up periodic validation (every 10 minutes, but actual validation only happens every 30 minutes)
    timerRef.current = setInterval(() => {
      if (!cancelled) {
        validateAuthIfNeeded().catch(log.error);
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
    log.debug('[EnhancedSessionProvider] Manual refresh requested');
    try {
      if (!bridgeReady) {
        await validateAuthIfNeeded(true);
      }

      // Always re-warm the token + re-auth Realtime on a manual refresh, even if the
      // bridge already reads ready — the reconnect "Try again" must recover stale
      // Realtime channels (validateAuthIfNeeded skips reconfigure once configured).
      await forceRefreshSupabaseJwt().catch(() => false);

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
      log.error('[EnhancedSessionProvider] Refresh failed:', error);
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
