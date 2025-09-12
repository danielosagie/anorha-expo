import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { SessionContext, SessionContextType, SessionUser } from './SessionContext';
import { supabase, configureClerkSupabaseBridge, getUserLike, stopClerkSupabaseBridge } from '../lib/supabase';
import { fetchUserEntitlements, UserEntitlements } from '../utils/entitlements';
import { AuthPersistence } from '../utils/AuthPersistence';
import { AppStateManager } from '../utils/AppStateManager';
import { ProcessPersistence } from '../utils/ProcessPersistence';

interface EnhancedSessionProviderProps {
  children: React.ReactNode;
  getClerkToken: () => Promise<string | null>;
}

export const EnhancedSessionProvider: React.FC<EnhancedSessionProviderProps> = ({ 
  children, 
  getClerkToken 
}) => {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SessionUser>(null);
  const [entitlements, setEntitlements] = useState<UserEntitlements | null>(null);
  const [initializing, setInitializing] = useState(true);
  
  const configuredRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const authPersistence = useRef(AuthPersistence.getInstance());
  const appStateManager = useRef(AppStateManager.getInstance());
  const processPersistence = useRef(ProcessPersistence.getInstance());

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
        const ents = await fetchUserEntitlements();
        
        // Save auth state for persistence
        await authPersistence.current.saveAuthState({
          isAuthenticated: true,
          userId: me?.id || null,
          email: me?.email || null,
          tokenExpiry: Date.now() + (30 * 60 * 1000), // 30 minutes from now
        });
        
        setUser(me);
        setEntitlements(ents);
        
        // Initialize process persistence system
        if (me?.id) {
          await processPersistence.current.initialize(me.id);
          console.log('[EnhancedSessionProvider] Process persistence initialized');
        }
        
        setReady(true);
        
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
        console.error('[EnhancedSessionProvider] Max retries reached, giving up');
        await authPersistence.current.clearAuthData();
        configuredRef.current = false;
        setReady(false);
        setUser(null);
        setEntitlements(null);
      }
    }
  }, [getClerkToken]);

  // Initialize session from persisted state
  const initializeFromPersistedState = useCallback(async (): Promise<void> => {
    console.log('[EnhancedSessionProvider] Checking persisted auth state...');
    
    const persistedState = await authPersistence.current.getAuthState();
    
    if (persistedState?.isAuthenticated && persistedState.userId) {
      console.log('[EnhancedSessionProvider] Found valid persisted state for user:', persistedState.userId);
      
      // Set user immediately from cache for better UX
      setUser({
        id: persistedState.userId,
        email: persistedState.email || '',
      });
      
      // Try to get fresh entitlements
      try {
        const ents = await fetchUserEntitlements();
        setEntitlements(ents);
      } catch (e) {
        console.warn('[EnhancedSessionProvider] Could not fetch entitlements from cache:', e);
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
  }, [validateAuthIfNeeded]);

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
      const ents = await fetchUserEntitlements();
      
      // Update persisted state
      await authPersistence.current.saveAuthState({
        isAuthenticated: true,
        userId: me?.id || null,
        email: me?.email || null,
      });
      
      setUser(me);
      setEntitlements(ents);
    } catch (error) {
      console.error('[EnhancedSessionProvider] Refresh failed:', error);
      // Don't clear state on refresh failures - might be network issue
    }
  };

  const value: SessionContextType = useMemo(() => ({ 
    ready: ready && !initializing, 
    user, 
    entitlements, 
    refresh 
  }), [ready, initializing, user, entitlements]);

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
};
