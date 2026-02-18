import React, { useEffect, useRef, useContext } from 'react';
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-react-native';
import Constants from 'expo-constants';
import { capture, setPostHogInstance, AnalyticsEvents } from '../lib/analytics';
import { SessionContext } from '../context/SessionContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY?.trim();
const POSTHOG_HOST = (process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com').trim();

// Expo Go uses a different runtime; outbound fetch to PostHog often fails with "Network error" there.
// Disable PostHog in Expo Go so we don't spam errors. It works in dev builds and production.
const isExpoGo =
  Constants.appOwnership === 'expo' ||
  Constants.executionEnvironment === 'storeClient';

if (POSTHOG_KEY && !isExpoGo) {
  console.log('[PostHogProvider] Initializing with Host:', POSTHOG_HOST, 'Key Length:', POSTHOG_KEY?.length);
} else if (POSTHOG_KEY && isExpoGo) {
  console.log('[PostHogProvider] Expo Go detected — PostHog disabled (use a dev/production build to test analytics).');
}

/**
 * Wraps children with PostHogProvider when EXPO_PUBLIC_POSTHOG_KEY is set.
 * No-ops when key is missing or when running in Expo Go (avoids flush network errors there).
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  if (!POSTHOG_KEY) {
    return <>{children}</>;
  }

  return (
    <PHProvider
      apiKey={POSTHOG_KEY}
      options={{
        host: POSTHOG_HOST,
        // Disable in Expo Go so we never attempt flush (avoids "Network error while fetching PostHog")
        disabled: isExpoGo,
        requestTimeout: 30000,
        fetchRetryCount: 4,
        fetchRetryDelay: 2000,
      }}
    >
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
      setPostHogInstance(posthog as any);
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
