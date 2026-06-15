import React, { useEffect } from 'react';
import { setPostHogInstance } from '../lib/analytics';
import { getSessionId } from '../lib/mobileFlowLogger';
import { createLogger } from '../utils/logger';
const log = createLogger('PostHogProvider');


/**
 * Fail-open analytics wrapper.
 *
 * posthog-react-native previously crashed during *module* initialization in
 * this runtime, which prevented AppRegistry from registering the app at all.
 * Fix: never import posthog at module scope. Lazily require it inside an
 * effect, construct it with the crash-prone native-lifecycle / file-persistence
 * paths disabled, and fall back to a no-op if anything throws so startup and
 * offline flows are never blocked.
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
          // Avoid the native-lifecycle + file-persistence paths that crash
          // on init in this runtime.
          persistence: 'memory',
          captureNativeAppLifecycleEvents: false,
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
        });
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

export function PostHogIdentify() {
  return null;
}
