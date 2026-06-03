import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SessionContext, SessionContextType, SessionUser } from './SessionContext';
import { supabase, configureClerkSupabaseBridge, getUserLike, stopClerkSupabaseBridge } from '../lib/supabase';
import { fetchUserEntitlements, UserEntitlements } from '../utils/entitlements';

export const SessionProvider: React.FC<{ children: React.ReactNode; getClerkToken: () => Promise<string | null> }> = ({ children, getClerkToken }) => {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SessionUser>(null);
  const [entitlements, setEntitlements] = useState<UserEntitlements | null>(null);
  const configuredRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    console.log('[SessionProvider] boot start');

    const checkTokenAndConfigure = async () => {
      const token = await getClerkToken();
      if (cancelled) return;
      if (token && !configuredRef.current) {
        console.log('[SessionProvider] configuring Supabase bridge...');
        try {
          await configureClerkSupabaseBridge({ getClerkToken });
          configuredRef.current = true;
          console.log('[SessionProvider] bridge configured. Loading me and entitlements...');
          const { user: me } = await getUserLike();
          if (!cancelled) setUser(me);
          const ents = await fetchUserEntitlements();
          if (!cancelled) setEntitlements(ents);
          if (!cancelled) setReady(true);
          console.log('[SessionProvider] ready = true');
        } catch (e) {
          console.error('[SessionProvider] configureClerkSupabaseBridge failed:', e);
          configuredRef.current = false;
          if (!cancelled) setReady(false);
        }
      } else if (!token && configuredRef.current) {
        console.log('[SessionProvider] Clerk token cleared, stopping bridge.');
        try { stopClerkSupabaseBridge(); } catch {}
        configuredRef.current = false;
        if (!cancelled) {
          setReady(false);
          setUser(null);
          setEntitlements(null);
        }
      }
    };

    // Immediate check, then poll for changes (covers login/logout within same mount)
    checkTokenAndConfigure();
    timerRef.current = setInterval(checkTokenAndConfigure, 2000);

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [getClerkToken]);

  const refresh = async () => {
    const { user: me } = await getUserLike();
    setUser(me);
    const ents = await fetchUserEntitlements();
    setEntitlements(ents);
  };

  const value: SessionContextType = useMemo(() => ({
    ready,
    bridgeReady: ready,
    user,
    entitlements,
    bootstrapState: ready ? 'ready' : 'initializing',
    usingCachedSession: false,
    sessionMode: ready ? 'live' : 'cached',
    bootstrapError: null,
    lastReadyAt: ready ? Date.now() : null,
    refresh,
  }), [ready, user, entitlements]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};
