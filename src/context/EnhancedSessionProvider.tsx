import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SessionContext, SessionContextType, SessionMode, SessionUser } from './SessionContext';
import { configureClerkSupabaseBridge, getUserLike, stopClerkSupabaseBridge } from '../lib/supabase';
import { BRIDGE_BOOT_GRACE_MS, CLERK_TOKEN_TIMEOUT_MS, decideBridgeFailure, settleWithin } from '../lib/bootGate';
import { fetchUserEntitlements, UserEntitlements } from '../utils/entitlements';
import { AuthPersistence } from '../utils/AuthPersistence';
import { AppStateManager } from '../utils/AppStateManager';
import { createLogger } from '../utils/logger';
const log = createLogger('EnhancedSessionProvider');


interface EnhancedSessionProviderProps {
  children: React.ReactNode;
  getClerkToken: () => Promise<string | null>;
  // Clerk's current signed-in flag. Used to (re)bootstrap on a warm re-login — see the
  // signed-in-transition effect below.
  isSignedIn?: boolean;
}

const ENTITLEMENTS_CACHE_KEY = 'sssync_entitlements_cache_v1';

export const EnhancedSessionProvider: React.FC<EnhancedSessionProviderProps> = ({
  children,
  getClerkToken,
  isSignedIn,
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

  const validationRunnerRef = useRef<((force?: boolean, retryCount?: number) => Promise<void>) | null>(null);
  const validationInFlightRef = useRef<Promise<void> | null>(null);
  const validationRetryTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const clearValidationRetryTimers = useCallback(() => {
    validationRetryTimersRef.current.forEach(clearTimeout);
    validationRetryTimersRef.current.clear();
  }, []);

  const scheduleValidationRetry = useCallback((force: boolean, retryCount: number, delayMs: number) => {
    validationRetryTimersRef.current.forEach(clearTimeout);
    validationRetryTimersRef.current.clear();
    const timer = setTimeout(() => {
      validationRetryTimersRef.current.delete(timer);
      validationRunnerRef.current?.(force, retryCount).catch(log.error);
    }, delayMs);
    validationRetryTimersRef.current.add(timer);
  }, []);

  // Enhanced token validation with 30-minute intervals and auto-retry. The public
  // wrapper below single-flights this function so init/foreground/interval/sign-in
  // triggers cannot configure or tear down the same bridge concurrently.
  const performAuthValidation = useCallback(async (force: boolean = false, retryCount: number = 0): Promise<void> => {
    try {
      const shouldRevalidateAccount = force || authPersistence.current.shouldValidateAuth();
      const needsBridgeSetup = !configuredRef.current;
      const shouldValidate = needsBridgeSetup || shouldRevalidateAccount;

      if (!shouldValidate) {
        log.debug('[EnhancedSessionProvider] Skipping auth validation (within 30-min window)');
        if (configuredRef.current) {
          setBridgeReady(true);
          setReady(true);
        }
        return;
      }

      log.debug('[EnhancedSessionProvider] Performing auth validation, attempt:', retryCount + 1);

      const token = await settleWithin(
        getClerkToken(),
        CLERK_TOKEN_TIMEOUT_MS,
        'Clerk session token read timed out during auth validation',
      ).catch((error) => {
        log.warn('[EnhancedSessionProvider] Clerk token read did not settle:', error);
        return null;
      });

      if (!token) {
        const decision = decideBridgeFailure({
          kind: 'token_unavailable',
          retryCount,
          bridgeWasReady: configuredRef.current,
        });

        if (decision === 'quiet_retry') {
          const retryDelay = Math.min(Math.pow(2, retryCount) * 500, 4000);
          log.debug(
            `[EnhancedSessionProvider] Clerk token unavailable; retrying quietly in ${retryDelay}ms (attempt ${retryCount + 2})`,
          );
          scheduleValidationRetry(force, retryCount + 1, retryDelay);
          return;
        }

        if (decision === 'preserve_live_bridge') {
          log.warn('[EnhancedSessionProvider] Clerk token retries exhausted; preserving the existing live bridge');
          setBridgeReady(true);
          setReady(true);
          return;
        }

        try {
          stopClerkSupabaseBridge();
        } catch {}
        configuredRef.current = false;
        setBridgeReady(false);

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
        // Reuse the bounded token above. configureClerkSupabaseBridge also bounds the
        // exchange fetch, so every pre-ready await now has a settlement guarantee.
        await configureClerkSupabaseBridge({ getClerkToken, initialClerkToken: token });
        configuredRef.current = true;
      }

      clearValidationRetryTimers();
      setBridgeReady(true);
      setReady(true);
      setSessionMode('live');
      setUsingCachedSession(false);

      if (!shouldRevalidateAccount) {
        setBootstrapError(null);
        log.debug('[EnhancedSessionProvider] Bridge is ready; skipping account revalidation within auth window');
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

      setReady(true);
      setBridgeReady(true);
      setSessionMode('live');
      setUsingCachedSession(false);
      setBootstrapError(null);
      setLastReadyAt(Date.now());

      log.debug('[EnhancedSessionProvider] Session ready for user:', resolvedUser?.id);
    } catch (e) {
      log.error('[EnhancedSessionProvider] Auth validation failed:', e);
      const decision = decideBridgeFailure({
        kind: 'configuration_failed',
        retryCount,
        bridgeWasReady: configuredRef.current,
      });

      if (decision === 'quiet_retry') {
        const retryDelay = Math.pow(2, retryCount) * 1000;
        log.debug(`[EnhancedSessionProvider] Auto-retrying in ${retryDelay}ms...`);
        scheduleValidationRetry(force, retryCount + 1, retryDelay);
        return;
      }

      if (decision === 'preserve_live_bridge') {
        log.warn('[EnhancedSessionProvider] Account refresh failed after bridge setup; preserving live bridge');
        setBridgeReady(true);
        setReady(true);
        return;
      }

      log.error('[EnhancedSessionProvider] Max retries reached, entering degraded mode if cache is available');
      try {
        stopClerkSupabaseBridge();
      } catch {}
      configuredRef.current = false;
      setBridgeReady(false);
      setSessionMode('cached');

      const restoredFromCache = await setCachedSessionState(
        'Live services are unavailable right now. Continuing with cached account data.',
      );
      if (!restoredFromCache) {
        await clearSessionState({ clearPersistedAuth: true });
      }
    }
  }, [
    clearSessionState,
    clearValidationRetryTimers,
    getClerkToken,
    loadCachedEntitlements,
    persistEntitlements,
    scheduleValidationRetry,
    setCachedSessionState,
  ]);

  const validateAuthIfNeeded = useCallback(async (force: boolean = false, retryCount: number = 0): Promise<void> => {
    if (validationInFlightRef.current) {
      return validationInFlightRef.current;
    }

    const validation = performAuthValidation(force, retryCount);
    validationInFlightRef.current = validation;
    try {
      await validation;
    } finally {
      if (validationInFlightRef.current === validation) validationInFlightRef.current = null;
    }
  }, [performAuthValidation]);
  validationRunnerRef.current = validateAuthIfNeeded;

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
      // Force validation for new sessions — but never block the boot forever. A stalled
      // token exchange here used to strand the app on "Restoring your workspace". Cap the
      // wait at 12s and proceed; validateAuthIfNeeded keeps running in the background and
      // flips bridgeReady when it lands, and the app degrades to its reconnect/retry path.
      await Promise.race([
        validateAuthIfNeeded(true),
        new Promise<void>((resolve) => setTimeout(resolve, BRIDGE_BOOT_GRACE_MS)),
      ]).catch(log.error);
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
      clearValidationRetryTimers();
      appStateManager.current.cleanup();
    };
  }, [clearValidationRetryTimers, initializeFromPersistedState, validateAuthIfNeeded]);

  // Re-bootstrap the session when Clerk transitions to signed-in. The init effect only
  // runs on mount and AppStateManager only fires on app-foreground, so a WARM sign-in
  // (sign out → sign back in WITHOUT killing the app, or first login from a cold-booted
  // signed-out state) would otherwise leave the session in the cleared state that the
  // sign-out path set (ready=false + bootstrapError="Unable to restore your session…"),
  // stranding the app on the "Restoring your workspace" shell. We fire ONLY on a strict
  // false→true transition (so a cold-boot signed-in session, already handled by the init
  // effect, is not double-bootstrapped); the configuredRef guard + validateAuthIfNeeded's
  // own guards make any redundant call a no-op.
  const wasSignedInRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const was = wasSignedInRef.current;
    wasSignedInRef.current = isSignedIn;
    if (was === false && isSignedIn === true && !configuredRef.current) {
      log.debug('[EnhancedSessionProvider] Signed-in transition; (re)bootstrapping session');
      setBootstrapError(null);
      validateAuthIfNeeded(true).catch(log.error);
    }
  }, [isSignedIn, validateAuthIfNeeded]);

  const refresh = useCallback(async () => {
    log.debug('[EnhancedSessionProvider] Manual refresh requested');
    try {
      // Retry is a genuine bridge rebuild. configuredRef can be stale-true while its
      // token/socket is dead; trusting it made the reconnect button a no-op.
      clearValidationRetryTimers();
      try {
        stopClerkSupabaseBridge();
      } catch {}
      configuredRef.current = false;
      setBridgeReady(false);
      await validateAuthIfNeeded(true);
      if (!configuredRef.current) {
        throw new Error('Supabase bridge did not reconnect');
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
      if (configuredRef.current) {
        setBridgeReady(true);
        setSessionMode('live');
        setUsingCachedSession(false);
      }
      setBootstrapError(null);
      setLastReadyAt(Date.now());
    } catch (error) {
      log.error('[EnhancedSessionProvider] Refresh failed:', error);
      // TRANSIENT failure (getUserLike/entitlements timeout, token-rotation race,
      // network flake): do NOT demote a LIVE bridge. Demoting here bounced a healthy
      // signed-in session to the reconnect screen and made "Try again" LOOP — each tap
      // re-failed transiently and re-demoted. Genuine token loss is already handled by
      // validateAuthIfNeeded's null-token path (degrades after retries). Only surface
      // degraded if the bridge isn't actually up.
      if (!configuredRef.current) {
        setBridgeReady(false);
        setSessionMode('cached');
        setUsingCachedSession(true);
      }
      setBootstrapError('Refresh failed. Cached account data is still available.');
    }
  }, [clearValidationRetryTimers, loadCachedEntitlements, persistEntitlements, validateAuthIfNeeded]);

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
