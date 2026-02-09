import React, { useEffect, useRef, useContext } from 'react';
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-react-native';
import { capture, setPostHogInstance, AnalyticsEvents } from '../lib/analytics';
import { SessionContext } from '../context/SessionContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

/**
 * Wraps children with PostHogProvider when EXPO_PUBLIC_POSTHOG_KEY is set.
 * No-ops when key is missing (e.g. dev without analytics).
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  if (!POSTHOG_KEY) {
    return <>{children}</>;
  }

  return (
    <PHProvider apiKey={POSTHOG_KEY} options={{ host: POSTHOG_HOST }}>
      <PostHogInit>{children}</PostHogInit>
    </PHProvider>
  );
}

/**
 * Sets the PostHog instance on the analytics module and captures app_opened.
 * User identification happens in PostHogIdentify (must be inside SessionProvider).
 */
function PostHogInit({ children }: { children: React.ReactNode }) {
  const posthog = usePostHog();
  const appOpenedRef = useRef(false);

  useEffect(() => {
    if (posthog) {
      setPostHogInstance(posthog);
      return () => setPostHogInstance(null);
    }
  }, [posthog]);

  useEffect(() => {
    if (!posthog || appOpenedRef.current) return;
    appOpenedRef.current = true;
    AsyncStorage.getItem('alreadyLaunched').then((alreadyLaunched) => {
      capture(AnalyticsEvents.APP_OPENED, {
        is_first_launch: alreadyLaunched === null,
      });
    });
  }, [posthog]);

  return <>{children}</>;
}

/**
 * Call this from inside SessionProvider to identify the user.
 * Renders nothing.
 */
export function PostHogIdentify() {
  const posthog = usePostHog();
  const sessionValue = useContext(SessionContext);
  const identifiedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!posthog || !sessionValue?.ready || !sessionValue?.user?.id) return;
    const userId = sessionValue.user.id;
    if (identifiedRef.current === userId) return;
    identifiedRef.current = userId;
    posthog.identify(userId);
  }, [posthog, sessionValue?.ready, sessionValue?.user?.id]);

  return null;
}
