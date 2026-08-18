import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SessionContext, SessionContextType, SessionMode, SessionUser } from './SessionContext';
import { configureClerkSupabaseBridge, getUserLike, stopClerkSupabaseBridge } from '../lib/supabase';
import {
  BACKEND_REACHABILITY_TIMEOUT_MS,
  BackendReachability,
  BRIDGE_BOOT_GRACE_MS,
  CLERK_TOKEN_TIMEOUT_MS,
  TOKEN_UNAVAILABLE_RETRY_LIMIT,
  decideBridgeFailure,
  decideValidationLoop,
  settleWithin,
  tokenRetryDelayMs,
} from '../lib/bootGate';
import { SESSION_WATCHDOG_MAX_ATTEMPTS, SessionRecoveryPolicy } from '../lib/sessionRecovery';
import { API_BASE_URL } from '../config/env';
import { fetchUserEntitlements, UserEntitlements } from '../utils/entitlements';
import { AuthPersistence } from '../utils/AuthPersistence';
import { AppStateManager } from '../utils/AppStateManager';
import { createLogger } from '../utils/logger';
const log = createLogger('EnhancedSessionProvider');


interface EnhancedSessionProviderProps {
  children: React.ReactNode;
  getClerkToken: () => Promise<string | null>;
  // Verified signed-in flag. Used to (re)bootstrap on a warm re-login. See the
  // signed-in-transition effect below.
  isSignedIn: boolean;
  onInvalidSession: () => Promise<void>;
}

const ENTITLEMENTS_CACHE_KEY = 'sssync_entitlements_cache_v1';

export const EnhancedSessionProvider: React.FC<EnhancedSessionProviderProps> = ({
  children,
  getClerkToken,
  isSignedIn,
  onInvalidSession,
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
  const [validationInFlight, setValidationInFlight] = useState(false);
  
  const configuredRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const userRef = useRef<SessionUser>(null);
  const authPersistence = useRef(AuthPersistence.getInstance());
  const appStateManager = useRef(AppStateManager.getInstance());
  const isSignedInRef = useRef(isSignedIn);
  const invalidSessionInFlightRef = useRef(false);
  const readyRef = useRef(ready);
  const bootstrapErrorRef = useRef(bootstrapError);
  const sessionEpochRef = useRef(0);
  const validationRunnerRef = useRef<((force?: boolean, retryCount?: number) => Promise<void>) | null>(null);
  const validationInFlightRef = useRef<Promise<void> | null>(null);
  const validationRetryTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const sessionWatchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryPolicyRef = useRef(new SessionRecoveryPolicy());
  isSignedInRef.current = isSignedIn;
  readyRef.current = ready;
  bootstrapErrorRef.current = bootstrapError;

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
    expectedSessionEpoch?: number,
  ) => {
    const persistedState = await authPersistence.current.getAuthState();
    const cachedEntitlements = await loadCachedEntitlements();

    if (
      expectedSessionEpoch != null &&
      (expectedSessionEpoch !== sessionEpochRef.current || !isSignedInRef.current)
    ) {
      return false;
    }

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

  const clearValidationRetryTimers = useCallback(() => {
    validationRetryTimersRef.current.forEach(clearTimeout);
    validationRetryTimersRef.current.clear();
  }, []);

  const clearSessionWatchdogTimer = useCallback(() => {
    if (sessionWatchdogTimerRef.current) {
      clearTimeout(sessionWatchdogTimerRef.current);
      sessionWatchdogTimerRef.current = null;
    }
  }, []);

  const clearSessionState = useCallback(async (options: { clearPersistedAuth?: boolean } = {}) => {
    const shouldClearPersistedAuth = options.clearPersistedAuth === true;
    sessionEpochRef.current += 1;
    clearValidationRetryTimers();
    clearSessionWatchdogTimer();

    try {
      stopClerkSupabaseBridge();
    } catch {}

    configuredRef.current = false;
    invalidSessionInFlightRef.current = false;
    setReady(false);
    setBridgeReady(false);
    setSessionMode('cached');
    setUser(null);
    setEntitlements(null);
    setUsingCachedSession(false);
    setBootstrapError(shouldClearPersistedAuth ? 'Unable to restore your session right now.' : null);
    setLastReadyAt(null);
    setInitializing(false);

    if (shouldClearPersistedAuth) {
      await authPersistence.current.clearAuthData();
    }
  }, [clearSessionWatchdogTimer, clearValidationRetryTimers]);

  const scheduleValidationRetry = useCallback((force: boolean, retryCount: number, delayMs: number) => {
    const loopDecision = decideValidationLoop(isSignedInRef.current);
    if (!loopDecision.shouldScheduleRetry || invalidSessionInFlightRef.current) {
      clearValidationRetryTimers();
      return;
    }

    clearValidationRetryTimers();
    const timer = setTimeout(() => {
      validationRetryTimersRef.current.delete(timer);
      if (!decideValidationLoop(isSignedInRef.current).shouldRun || invalidSessionInFlightRef.current) {
        clearValidationRetryTimers();
        return;
      }
      validationRunnerRef.current?.(force, retryCount).catch(log.error);
    }, delayMs);
    validationRetryTimersRef.current.add(timer);
  }, [clearValidationRetryTimers]);

  const checkBackendReachability = useCallback(async (): Promise<BackendReachability> => {
    const controller = new AbortController();
    try {
      // The backend root GET is an existing unauthenticated liveness route that returns
      // directly without database or queue work. It is called only after the full
      // 7,500ms null-token backoff, and its 4,000ms budget is derived in bootGate.ts.
      const response = await settleWithin(
        fetch(`${API_BASE_URL}/`, { signal: controller.signal }),
        BACKEND_REACHABILITY_TIMEOUT_MS,
        'Backend reachability check timed out',
      );
      return response.ok ? 'reachable' : 'ambiguous';
    } catch {
      return 'ambiguous';
    } finally {
      controller.abort();
    }
  }, []);

  // Enhanced token validation with 30-minute intervals and auto-retry. The public
  // wrapper below single-flights this function so init/foreground/interval/sign-in
  // triggers cannot configure or tear down the same bridge concurrently.
  const performAuthValidation = useCallback(async (
    force: boolean,
    retryCount: number,
    expectedSessionEpoch: number,
  ): Promise<void> => {
    const isValidationCurrent = () =>
      expectedSessionEpoch === sessionEpochRef.current &&
      decideValidationLoop(isSignedInRef.current).shouldRun &&
      !invalidSessionInFlightRef.current;

    if (!isValidationCurrent()) {
      clearValidationRetryTimers();
      return;
    }

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

      if (!isValidationCurrent()) {
        clearValidationRetryTimers();
        return;
      }

      if (!token) {
        const backendReachability =
          retryCount >= TOKEN_UNAVAILABLE_RETRY_LIMIT && !configuredRef.current
            ? await checkBackendReachability()
            : undefined;
        if (!isValidationCurrent()) {
          clearValidationRetryTimers();
          return;
        }
        const decision = decideBridgeFailure({
          kind: 'token_unavailable',
          retryCount,
          bridgeWasReady: configuredRef.current,
          isSignedIn: isSignedInRef.current,
          backendReachability,
        });

        if (decision === 'signed_out') {
          clearValidationRetryTimers();
          return;
        }

        if (decision === 'invalid_session') {
          clearValidationRetryTimers();
          invalidSessionInFlightRef.current = true;
          setBridgeReady(false);
          setBootstrapError('Session expired. Sign in again.');
          log.warn('[EnhancedSessionProvider] Stored session is invalid; running hardened sign-out');
          await onInvalidSession().catch((error) => {
            log.error('[EnhancedSessionProvider] Hardened invalid-session sign-out failed:', error);
          });
          return;
        }

        if (decision === 'quiet_retry') {
          const retryDelay = tokenRetryDelayMs(retryCount);
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
          undefined,
          expectedSessionEpoch,
        );
        if (!isValidationCurrent()) return;
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
        if (!isValidationCurrent()) {
          try {
            stopClerkSupabaseBridge();
          } catch {}
          return;
        }
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
          if (!isValidationCurrent()) return;
          if (me?.id) {
            await authPersistence.current.saveAuthState({
              isAuthenticated: true,
              userId: me.id,
              email: me.email || userRef.current?.email || null,
              tokenExpiry: Date.now() + (30 * 60 * 1000),
            });
            if (!isValidationCurrent()) return;
            setUser(me);
          }
        } catch (refreshErr) {
          if (isValidationCurrent()) {
            log.warn('[EnhancedSessionProvider] Could not refresh user from me (within auth window):', refreshErr);
          }
        }
        return;
      }

      log.debug('[EnhancedSessionProvider] Bridge configured. Loading user data...');
      const { user: me } = await getUserLike();
      if (!isValidationCurrent()) return;
      const ents = await fetchUserEntitlements().catch(async (error) => {
        log.warn('[EnhancedSessionProvider] Falling back to cached entitlements:', error);
        return loadCachedEntitlements();
      });
      if (!isValidationCurrent()) return;

      await authPersistence.current.saveAuthState({
        isAuthenticated: true,
        userId: me?.id || userRef.current?.id || null,
        email: me?.email || userRef.current?.email || null,
        tokenExpiry: Date.now() + (30 * 60 * 1000),
      });
      if (!isValidationCurrent()) return;

      const resolvedUser = me ?? userRef.current;
      setUser(resolvedUser);
      setEntitlements(ents);
      await persistEntitlements(ents);
      if (!isValidationCurrent()) return;

      setReady(true);
      setBridgeReady(true);
      setSessionMode('live');
      setUsingCachedSession(false);
      setBootstrapError(null);
      setLastReadyAt(Date.now());

      log.debug('[EnhancedSessionProvider] Session ready for user:', resolvedUser?.id);
    } catch (e) {
      if (!isValidationCurrent()) {
        clearValidationRetryTimers();
        return;
      }
      log.error('[EnhancedSessionProvider] Auth validation failed:', e);
      const decision = decideBridgeFailure({
        kind: 'configuration_failed',
        retryCount,
        bridgeWasReady: configuredRef.current,
        isSignedIn: isSignedInRef.current,
      });

      if (decision === 'signed_out') {
        clearValidationRetryTimers();
        return;
      }

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
        undefined,
        expectedSessionEpoch,
      );
      if (!isValidationCurrent()) return;
      if (!restoredFromCache) {
        await clearSessionState({ clearPersistedAuth: true });
      }
    }
  }, [
    clearSessionState,
    clearValidationRetryTimers,
    checkBackendReachability,
    getClerkToken,
    loadCachedEntitlements,
    onInvalidSession,
    persistEntitlements,
    scheduleValidationRetry,
    setCachedSessionState,
  ]);

  const validateAuthIfNeeded = useCallback(async (force: boolean = false, retryCount: number = 0): Promise<void> => {
    if (!decideValidationLoop(isSignedInRef.current).shouldRun || invalidSessionInFlightRef.current) {
      clearValidationRetryTimers();
      return;
    }

    if (validationInFlightRef.current) {
      return validationInFlightRef.current;
    }

    const validation = performAuthValidation(force, retryCount, sessionEpochRef.current);
    validationInFlightRef.current = validation;
    setValidationInFlight(true);
    try {
      await validation;
    } finally {
      if (validationInFlightRef.current === validation) {
        validationInFlightRef.current = null;
        setValidationInFlight(false);
      }
    }
  }, [clearValidationRetryTimers, performAuthValidation]);
  validationRunnerRef.current = validateAuthIfNeeded;

  // Initialize session from persisted state
  const initializeFromPersistedState = useCallback(async (): Promise<void> => {
    const expectedSessionEpoch = sessionEpochRef.current;
    const isInitializationCurrent = () =>
      expectedSessionEpoch === sessionEpochRef.current &&
      decideValidationLoop(isSignedInRef.current).shouldRun;
    log.debug('[EnhancedSessionProvider] Checking persisted auth state...');

    if (!isInitializationCurrent()) {
      clearValidationRetryTimers();
      setInitializing(false);
      return;
    }

    // If the live bridge is already up, this is an effect RE-RUN (the init effect's
    // callback deps churned), not a fresh boot. Do NOT demote the session back to
    // cached/bridgeReady=false. That, combined with the 30-min skip in
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
    if (!isInitializationCurrent()) return;
    
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
      // Force validation for new sessions, but never block the boot forever. A stalled
      // token exchange here used to strand the app on "Restoring your workspace". Cap the
      // wait at 12s and proceed; validateAuthIfNeeded keeps running in the background and
      // flips bridgeReady when it lands, and the app degrades to its reconnect/retry path.
      await Promise.race([
        validateAuthIfNeeded(true),
        new Promise<void>((resolve) => setTimeout(resolve, BRIDGE_BOOT_GRACE_MS)),
      ]).catch(log.error);
    }

    if (!isInitializationCurrent()) return;
    setInitializing(false);
  }, [clearValidationRetryTimers, loadCachedEntitlements, validateAuthIfNeeded]);

  useEffect(() => {
    let cancelled = false;

    if (!decideValidationLoop(isSignedIn).shouldRun) {
      clearValidationRetryTimers();
      setInitializing(false);
      appStateManager.current.cleanup();
      return;
    }
    
    log.debug('[EnhancedSessionProvider] Initializing...');
    setInitializing(true);
    
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
  }, [clearValidationRetryTimers, initializeFromPersistedState, isSignedIn, validateAuthIfNeeded]);

  // Every signed-out observation resets local provider state. Persisted auth is already
  // removed by hardenedSignOut, so this reset does not wipe that cache a second time.
  // A strict false-to-true transition always rebuilds the bridge, even if configuredRef
  // was left stale-true by an older bundle or an interrupted teardown.
  useEffect(() => {
    const transition = recoveryPolicyRef.current.observeSignIn(isSignedIn);
    if (transition.action === 'reset') {
      clearSessionState({ clearPersistedAuth: transition.clearPersistedAuth }).catch(log.error);
      return;
    }

    if (transition.action !== 'bootstrap') return;

    const bootstrapEpoch = sessionEpochRef.current + 1;
    sessionEpochRef.current = bootstrapEpoch;
    clearValidationRetryTimers();
    clearSessionWatchdogTimer();
    try {
      stopClerkSupabaseBridge();
    } catch {}
    configuredRef.current = transition.configured;
    invalidSessionInFlightRef.current = transition.invalidSessionInFlight;
    setInitializing(transition.initializing);
    setReady(transition.ready);
    setBridgeReady(transition.bridgeReady);
    setSessionMode(transition.sessionMode);
    setUsingCachedSession(transition.usingCachedSession);
    setUser(transition.user);
    setEntitlements(transition.entitlements);
    setBootstrapError(transition.bootstrapError);
    setLastReadyAt(transition.lastReadyAt);

    const bootstrap = async () => {
      const staleValidation = validationInFlightRef.current;
      if (staleValidation) await staleValidation.catch(() => undefined);
      if (bootstrapEpoch !== sessionEpochRef.current || !isSignedInRef.current) return;
      log.debug('[EnhancedSessionProvider] Signed-in transition; re-bootstrapping session');
      try {
        await validateAuthIfNeeded(transition.forceValidation);
      } finally {
        if (bootstrapEpoch === sessionEpochRef.current && isSignedInRef.current) {
          setInitializing(false);
        }
      }
    };
    bootstrap().catch(log.error);
  }, [clearSessionState, clearSessionWatchdogTimer, clearValidationRetryTimers, isSignedIn, validateAuthIfNeeded]);

  // A stranded signed-in provider gets three fresh bridge rebuilds. The policy owns
  // the 8s, 16s, and 32s budget. React owns one timer and clears it on every state
  // change, unmount, or sign-out.
  useEffect(() => {
    clearSessionWatchdogTimer();
    const decision = recoveryPolicyRef.current.observeWatchdog({
      isSignedIn,
      ready,
      bootstrapError,
      validationInFlight,
    });
    if (decision.action !== 'schedule') return;

    sessionWatchdogTimerRef.current = setTimeout(() => {
      sessionWatchdogTimerRef.current = null;
      const currentDecision = recoveryPolicyRef.current.observeWatchdog({
        isSignedIn: isSignedInRef.current,
        ready: readyRef.current,
        bootstrapError: bootstrapErrorRef.current,
        validationInFlight: validationInFlightRef.current != null,
      });
      if (
        currentDecision.action !== 'schedule' ||
        currentDecision.attemptIndex !== decision.attemptIndex ||
        !recoveryPolicyRef.current.recordWatchdogAttempt(decision.attemptIndex)
      ) {
        return;
      }

      clearValidationRetryTimers();
      sessionEpochRef.current += 1;
      try {
        stopClerkSupabaseBridge();
      } catch {}
      configuredRef.current = false;
      invalidSessionInFlightRef.current = false;
      setBridgeReady(false);
      log.warn(
        `[EnhancedSessionProvider] Session watchdog bootstrap ${decision.attemptNumber}/${SESSION_WATCHDOG_MAX_ATTEMPTS}`,
      );
      validateAuthIfNeeded(true).catch(log.error);
    }, decision.delayMs);

    return clearSessionWatchdogTimer;
  }, [
    bootstrapError,
    clearSessionWatchdogTimer,
    clearValidationRetryTimers,
    isSignedIn,
    ready,
    validateAuthIfNeeded,
    validationInFlight,
  ]);

  const refresh = useCallback(async () => {
    const expectedSessionEpoch = sessionEpochRef.current;
    const isRefreshCurrent = () =>
      expectedSessionEpoch === sessionEpochRef.current &&
      decideValidationLoop(isSignedInRef.current).shouldRun &&
      !invalidSessionInFlightRef.current;
    log.debug('[EnhancedSessionProvider] Manual refresh requested');
    if (!isRefreshCurrent()) {
      clearValidationRetryTimers();
      return;
    }
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
      if (!isRefreshCurrent()) return;
      if (!configuredRef.current) {
        throw new Error('Supabase bridge did not reconnect');
      }

      const { user: me } = await getUserLike();
      if (!isRefreshCurrent()) return;
      const ents = await fetchUserEntitlements().catch(async () => loadCachedEntitlements());
      if (!isRefreshCurrent()) return;

      // Update persisted state
      await authPersistence.current.saveAuthState({
        isAuthenticated: true,
        userId: me?.id || null,
        email: me?.email || null,
      });
      if (!isRefreshCurrent()) return;

      setUser(me);
      setEntitlements(ents);
      await persistEntitlements(ents);
      if (!isRefreshCurrent()) return;
      if (configuredRef.current) {
        setBridgeReady(true);
        setSessionMode('live');
        setUsingCachedSession(false);
      }
      setBootstrapError(null);
      setLastReadyAt(Date.now());
    } catch (error) {
      if (!isRefreshCurrent()) return;
      log.error('[EnhancedSessionProvider] Refresh failed:', error);
      // TRANSIENT failure (getUserLike/entitlements timeout, token-rotation race,
      // network flake): do NOT demote a LIVE bridge. Demoting here bounced a healthy
      // signed-in session to the reconnect screen and made "Try again" loop. Each tap
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
