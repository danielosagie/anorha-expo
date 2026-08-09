import React, { useContext, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AnalyticsEvents, capture, group, identify, reset, setPostHogInstance } from '../lib/analytics';
import { getSessionId } from '../lib/mobileFlowLogger';
import { SessionContext } from '../context/SessionContext';
import { OrgContext } from '../context/OrgContext';
import { createLogger } from '../utils/logger';
const log = createLogger('PostHogProvider');

/**
 * Fail-open analytics wrapper.
 *
 * posthog-react-native previously crashed during *module* initialization in
 * this runtime, which prevented AppRegistry from registering the app at all.
 * Fix: never import posthog at module scope. Lazily require it inside an
 * effect and fall back to a no-op if anything throws, so startup and offline
 * flows are never blocked.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let client: any = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PostHog } = require('posthog-react-native');
      const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;
      const host =
        process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

      if (apiKey && PostHog) {
        client = new PostHog(apiKey, {
          host,
          disableGeoip: true,
          // Persist the pending-event queue so events captured offline, or
          // between flushes, survive an app kill. We hand posthog an explicit
          // AsyncStorage adapter instead of letting persistence:'file'
          // auto-discover expo-file-system, which is the path that crashed here.
          persistence: 'file',
          customStorage: {
            getItem: (key: string) => AsyncStorage.getItem(key),
            setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
          },
          // Native lifecycle capture is the other historically crash-prone path.
          // We emit app_opened ourselves below instead.
          captureAppLifecycleEvents: false,
        });

        const sessionId = getSessionId();
        setPostHogInstance({
          capture: (event, properties) =>
            client?.capture?.(event, {
              ...(properties || {}),
              ...(sessionId ? { $session_id: sessionId } : {}),
            }),
          identify: (id, traits) => client?.identify?.(id, traits),
          group: (type, key, traits) => client?.group?.(type, key, traits),
          reset: () => client?.reset?.(),
        });

        capture(AnalyticsEvents.APP_OPENED);
      }
    } catch (e) {
      log.warn('[PostHog] init failed, analytics disabled:', e);
      setPostHogInstance(null);
    }

    return () => {
      try {
        client?.flush?.();
      } catch {
        /* no-op */
      }
    };
  }, []);

  return <>{children}</>;
}

/**
 * Binds the analytics identity to the signed-in user and their active org.
 *
 * distinctId is `session.user.id`, which is the Supabase Users.Id served by the
 * `me` view. The backend captures under the same id, so a funnel can cross the
 * app/server boundary as one person. Do not switch this to the Clerk user id
 * without changing the backend in the same commit.
 *
 * Must be mounted INSIDE OrgProvider so it can read the active org.
 */
export function PostHogIdentify() {
  const session = useContext(SessionContext);
  const { currentOrg } = useContext(OrgContext);

  const userId = session?.user?.id ?? null;
  const email = session?.user?.email ?? null;
  const orgId = currentOrg?.id ?? null;

  const identifiedRef = useRef<string | null>(null);
  const groupedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) {
      // Signed out: drop the identity so the next person on this device does
      // not inherit the previous one's distinct id.
      if (identifiedRef.current) {
        reset();
        identifiedRef.current = null;
        groupedRef.current = null;
      }
      return;
    }

    if (identifiedRef.current !== userId) {
      identify(userId, { ...(email ? { email } : {}) });
      identifiedRef.current = userId;
      // A new person invalidates the previous group binding.
      groupedRef.current = null;
    }
  }, [userId, email]);

  useEffect(() => {
    if (!userId || !orgId) return;
    if (groupedRef.current === orgId) return;
    group(orgId, { ...(currentOrg?.name ? { name: currentOrg.name } : {}) });
    groupedRef.current = orgId;
  }, [userId, orgId, currentOrg?.name]);

  return null;
}
