/**
 * useBrowserJobsConvex — bootstraps a SECOND Convex client pointed at the
 * BACKEND's browserJobs deployment (distinct from the app's agent-chat
 * EXPO_PUBLIC_CONVEX_URL).
 *
 * URL SOURCE: the browserJobs convexURL is NOT in any EXPO_PUBLIC_* env. The
 * authoritative source is the same backend route the desktop consumer uses —
 * GET /api/agent/browser-jobs/bootstrap → { success, bootstrap: { convexURL,
 * userId, syncBaseURL } }. One round-trip gives us BOTH the URL and the exact
 * userId the public queries expect (bootstrap.userId === Supabase user id ===
 * SessionContext.user.id).
 *
 * DEGRADE, NEVER CRASH: if the route 401s / 503s / returns an empty URL, we
 * return { client: null, userId: null }. Callers branch to the OAuth-only path.
 *
 * The client is a process-wide singleton keyed by URL (mirrors
 * src/providers/ConvexProvider.tsx) so we never spin up more than one socket.
 */
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ConvexReactClient } from 'convex/react';
import { api } from '../lib/apiClient';
import { createLogger } from '../utils/logger';

const log = createLogger('useBrowserJobsConvex');

const BOOTSTRAP_PATH = '/api/agent/browser-jobs/bootstrap';
const STORAGE_KEY = '@anorha/browserJobs_bootstrap';

interface BrowserJobsBootstrap {
  convexURL: string;
  userId: string;
}

interface BootstrapResponse {
  success?: boolean;
  bootstrap?: Partial<BrowserJobsBootstrap>;
}

// Module-level memo so a remount reuses the resolved bootstrap immediately.
let memoBootstrap: BrowserJobsBootstrap | null = null;

// Lazily-built singleton client, keyed by URL. A URL change (rare) rebuilds it.
let clientUrl: string | null = null;
let clientInstance: ConvexReactClient | null = null;

function getClientFor(url: string | null): ConvexReactClient | null {
  if (!url) return null;
  if (clientInstance && clientUrl === url) return clientInstance;
  try {
    clientInstance = new ConvexReactClient(url);
    clientUrl = url;
    return clientInstance;
  } catch (e) {
    log.warn('Failed to construct browserJobs Convex client', e);
    return null;
  }
}

export interface BrowserJobsConvexValue {
  client: ConvexReactClient | null;
  userId: string | null;
}

/**
 * Resolves the browserJobs bootstrap and returns a (possibly null) client +
 * userId. `signedIn` gates the network call — when false we never hit the route.
 * `fallbackUserId` (SessionContext.user.id) is used only if the route gave us a
 * cached URL but no userId (best-effort).
 */
export function useBrowserJobsConvex(
  signedIn: boolean,
  fallbackUserId?: string | null,
): BrowserJobsConvexValue {
  const [bootstrap, setBootstrap] = useState<BrowserJobsBootstrap | null>(memoBootstrap);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;

    const resolve = async () => {
      // 1. Warm from AsyncStorage so a cold/offline start has a last-known URL.
      if (!memoBootstrap) {
        try {
          const cached = await AsyncStorage.getItem(STORAGE_KEY);
          if (cached && !cancelled) {
            const parsed = JSON.parse(cached) as BrowserJobsBootstrap;
            if (parsed?.convexURL) {
              memoBootstrap = parsed;
              setBootstrap(parsed);
            }
          }
        } catch {
          /* ignore cache read errors */
        }
      }

      // 2. Authoritative fetch (reuses api client → attaches the Supabase JWT).
      try {
        const res = await api.get<BootstrapResponse>(BOOTSTRAP_PATH);
        const convexURL = res?.bootstrap?.convexURL?.trim() || '';
        const userId = res?.bootstrap?.userId || fallbackUserId || '';
        if (cancelled) return;
        if (convexURL && userId) {
          const next: BrowserJobsBootstrap = { convexURL, userId };
          memoBootstrap = next;
          setBootstrap(next);
          AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        }
      } catch (e) {
        // 401 (session not ready) / 503 (CONVEX_URL unset) → degrade. Keep any
        // cached bootstrap; callers fall back to OAuth-only state if null.
        log.debug('browserJobs bootstrap unavailable — degrading to OAuth-only', e);
      }
    };

    resolve();
    return () => {
      cancelled = true;
    };
  }, [signedIn, fallbackUserId]);

  // When signed out, present a degraded value but keep any singleton alive.
  if (!signedIn) {
    return { client: null, userId: null };
  }

  const url = bootstrap?.convexURL ?? null;
  return {
    client: getClientFor(url),
    userId: bootstrap?.userId ?? fallbackUserId ?? null,
  };
}
