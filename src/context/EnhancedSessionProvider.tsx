import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SessionContext, SessionContextType, SessionUser } from './SessionContext';
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
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [lastReadyAt, setLastReadyAt] = useState<number | null>(null);
  
  const configuredRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const authPersistence = useRef(AuthPersistence.getInstance());
  const appStateManager = useRef(AppStateManager.getInstance());
  const processPersistence = useRef(ProcessPersistence.getInstance());

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

  // Enhanced token validation with 30-minute intervals and auto-retry
  const validateAuthIfNeeded = useCallback(async (force: boolean = false, retryCount: number = 0): Promise<void> => {
    const shouldValidate = force || authPersistence.current.shouldValidateAuth();
    
    if (!shouldValidate) {
      console.log('[EnhancedSessionProvider] Skipping auth validation (within 30-min window)');
      return;
    }

    console.log('[EnhancedSessionProvider] Performing auth validation, attempt:', retryCount + 1);
    
    try {
      const token = await getClerkToken();
      
      if (token && !configuredRef.current) {
        console.log('[EnhancedSessionProvider] Configuring Supabase bridge...');
        
        // Extended to 30 minutes instead of 9
        await configureClerkSupabaseBridge({ getClerkToken, autoRefreshMinutes: 30 });
        configuredRef.current = true;
        
        console.log('[EnhancedSessionProvider] Bridge configured. Loading user data...');
        const { user: me } = await getUserLike();
        const ents = await fetchUserEntitlements().catch(async (error) => {
          console.warn('[EnhancedSessionProvider] Falling back to cached entitlements:', error);
          return loadCachedEntitlements();
        });
        
        // Save auth state for persistence
        await authPersistence.current.saveAuthState({
          isAuthenticated: true,
          userId: me?.id || null,
          email: me?.email || null,
          tokenExpiry: Date.now() + (30 * 60 * 1000), // 30 minutes from now
        });
        
        setUser(me);
        setEntitlements(ents);
        await persistEntitlements(ents);
        
        // Initialize process persistence system
        if (me?.id) {
          await processPersistence.current.initialize(me.id);
          console.log('[EnhancedSessionProvider] Process persistence initialized');
        }
        
        setReady(true);
        setUsingCachedSession(false);
        setBootstrapError(null);
        setLastReadyAt(Date.now());
        
        console.log('[EnhancedSessionProvider] Session ready for user:', me?.id);
      } else if (!token && configuredRef.current) {
        console.log('[EnhancedSessionProvider] Token cleared, cleaning up...');
        try { 
          stopClerkSupabaseBridge(); 
          await authPersistence.current.clearAuthData();
        } catch {}
        
        configuredRef.current = false;
        setReady(false);
        setUser(null);
        setEntitlements(null);
        setUsingCachedSession(false);
        setBootstrapError(null);
        setLastReadyAt(null);
      }
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
        const persistedState = await authPersistence.current.getAuthState();
        const cachedEntitlements = await loadCachedEntitlements();

        if (persistedState?.isAuthenticated && persistedState.userId) {
          configuredRef.current = false;
          setUser((currentUser) => currentUser ?? {
            id: persistedState.userId,
            email: persistedState.email || '',
          });
          setEntitlements((currentEntitlements) => currentEntitlements ?? cachedEntitlements);
          setReady(true);
          setUsingCachedSession(true);
          setBootstrapError('Live services are unavailable right now. Continuing with cached account data.');
          return;
        }

        await authPersistence.current.clearAuthData();
        configuredRef.current = false;
        setReady(false);
        setUser(null);
        setEntitlements(null);
        setUsingCachedSession(false);
        setBootstrapError('Unable to restore your session right now.');
        setLastReadyAt(null);
      }
    }
  }, [getClerkToken, loadCachedEntitlements, persistEntitlements]);

  // Initialize session from persisted state
  const initializeFromPersistedState = useCallback(async (): Promise<void> => {
    console.log('[EnhancedSessionProvider] Checking persisted auth state...');
    
    const persistedState = await authPersistence.current.getAuthState();
    const cachedEntitlements = await loadCachedEntitlements();
    
    if (persistedState?.isAuthenticated && persistedState.userId) {
      console.log('[EnhancedSessionProvider] Found valid persisted state for user:', persistedState.userId);
      
      // Set user immediately from cache for better UX
      setUser({
        id: persistedState.userId,
        email: persistedState.email || '',
      });
      setUsingCachedSession(true);
      setBootstrapError('Restoring your workspace from cached session data.');
      setLastReadyAt(persistedState.lastAuthCheck || null);
      
      if (cachedEntitlements) {
        setEntitlements(cachedEntitlements);
      }
      
      setReady(true);
      
      // Validate auth in background (non-blocking)
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

  const refresh = async () => {
    console.log('[EnhancedSessionProvider] Manual refresh requested');
    try {
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
      setUsingCachedSession(false);
      setBootstrapError(null);
      setLastReadyAt(Date.now());
    } catch (error) {
      console.error('[EnhancedSessionProvider] Refresh failed:', error);
      // Don't clear state on refresh failures - might be network issue
      setUsingCachedSession(true);
      setBootstrapError('Refresh failed. Cached account data is still available.');
    }
  }, [loadCachedEntitlements, persistEntitlements]);

  const value: SessionContextType = useMemo(() => ({ 
    ready: ready && !initializing, 
    user, 
    entitlements, 
    bootstrapState: !ready || initializing ? 'initializing' : (usingCachedSession || !!bootstrapError ? 'degraded' : 'ready'),
    usingCachedSession,
    bootstrapError,
    lastReadyAt,
    refresh 
  }), [ready, initializing, user, entitlements, usingCachedSession, bootstrapError, lastReadyAt, refresh]);

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
};
