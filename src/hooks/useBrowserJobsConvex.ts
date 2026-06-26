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
import { useEffect, useMemo, useState } from 'react';
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
    // URL changed (or first build): tear down any prior socket so we keep exactly
    // one open connection. Fire-and-forget — getClientFor is sync (runs in a memo).
    if (clientInstance) {
      clientInstance.close().catch((err) => log.warn('Failed to close stale browserJobs Convex client', err));
      clientInstance = null;
      clientUrl = null;
    }
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

  // Clear the cross-user module cache on sign-out so the next user can never
  // inherit the previous user's bootstrap (it is user-scoped data).
  useEffect(() => {
    if (signedIn) return;
    memoBootstrap = null;
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    setBootstrap(null);
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;

    const resolve = async () => {
      // Drop a module memo that belongs to a DIFFERENT user before warming.
      if (memoBootstrap && fallbackUserId && memoBootstrap.userId !== fallbackUserId) {
        memoBootstrap = null;
        setBootstrap(null);
      }
      // 1. Warm from AsyncStorage so a cold/offline start has a last-known URL —
      //    but only accept it when it belongs to the current user.
      if (!memoBootstrap) {
        try {
          const cached = await AsyncStorage.getItem(STORAGE_KEY);
          if (cached && !cancelled) {
            const parsed = JSON.parse(cached) as BrowserJobsBootstrap;
            if (parsed?.convexURL && (!fallbackUserId || parsed.userId === fallbackUserId)) {
              memoBootstrap = parsed;
              setBootstrap(parsed);
            } else if (parsed && fallbackUserId && parsed.userId !== fallbackUserId) {
              AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
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

  // Only trust a bootstrap that belongs to the current user; otherwise fall back
  // to the session user id. Build the client in a memo (keyed by url) so it isn't
  // constructed during every render, and stabilize the returned object reference
  // so context consumers don't re-render needlessly. When signed out we keep the
  // singleton socket alive (url=null returns the cached client untouched).
  const resolvedUserId =
    bootstrap?.userId && (!fallbackUserId || bootstrap.userId === fallbackUserId)
      ? bootstrap.userId
      : fallbackUserId ?? null;
  const url = signedIn && resolvedUserId ? (bootstrap?.convexURL ?? null) : null;
  const client = useMemo(() => getClientFor(url), [url]);

  return useMemo(
    () => (signedIn ? { client, userId: resolvedUserId } : { client: null, userId: null }),
    [signedIn, client, resolvedUserId],
  );
}
