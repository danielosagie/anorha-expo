// usePlatformConnect — a small, self-contained wrapper around the platform
// OAuth + "start scan" flow, so screens outside the settings stack (e.g. the
// onboarding "Connect your accounts" step) can connect a platform and kick off
// the background inventory pull / draft-mapping build without dragging in
// screen-local state. Mirrors the shared URL + callback patterns.

import { useCallback } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import { API_BASE_URL } from '../config/env';
import { getPlatform } from '../config/platforms';

export type ConnectablePlatform = 'shopify' | 'square' | 'clover' | 'ebay' | 'facebook';

export interface ConnectResult {
  /** true when the platform was connected (a PlatformConnection now exists). */
  success: boolean;
  /** present for platforms that return it on the deep-link callback (Square/Clover). */
  connectionId?: string;
  /** user backed out of the browser sheet — not an error worth surfacing loudly. */
  cancelled?: boolean;
  errorMessage?: string;
}

const parseCallback = (url: string): { status: string | null; connectionId?: string; message?: string } => {
  // Strip any hash fragment (e.g. "#_=_") before reading query params.
  const noHash = url.split('#')[0];
  const query = noHash.split('?')[1] || '';
  const params = new URLSearchParams(query);
  return {
    status: params.get('status'),
    connectionId: params.get('connectionId') || undefined,
    message: params.get('message') || undefined,
  };
};

export function usePlatformConnect(opts: { orgId?: string | null } = {}) {
  const { orgId } = opts;

  // Sync locations (best effort) then start the inventory scan. Fire-and-forget:
  // by the time the user lands in the app, the scan + draft mappings are underway.
  const startScan = useCallback(async (connectionId: string) => {
    try {
      const token = await ensureSupabaseJwt();
      if (!token) return;
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      await fetch(`${API_BASE_URL}/api/pools/locations/sync/${connectionId}`, {
        method: 'POST',
        headers,
      }).catch(() => {});
      await fetch(`${API_BASE_URL}/api/sync/connections/${connectionId}/start-scan`, {
        method: 'POST',
        headers,
      });
    } catch {
      // Non-fatal — the user can trigger a scan later from Connections.
    }
  }, []);

  const connect = useCallback(
    async (platform: ConnectablePlatform): Promise<ConnectResult> => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error || !user) {
        return { success: false, errorMessage: 'Could not identify your account. Please try again.' };
      }

      // Connect flow is described per-platform in the registry (loginPath,
      // redirect scheme, extra params) — no platform-specific branching here.
      const def = getPlatform(platform)?.connect;
      if (!def) {
        return { success: false, errorMessage: 'This platform can’t be connected yet.' };
      }

      const orgParam = orgId ? `&orgId=${orgId}` : '';
      // 'bare' platforms (Shopify, Facebook) reuse a single callback; 'tagged'
      // OAuth platforms carry the platform key on the deep link.
      const finalRedirectUri =
        def.redirectStyle === 'bare'
          ? 'anorhaapp://auth-callback'
          : `anorhaapp://auth/callback?platform=${platform}`;

      const base = `${API_BASE_URL}${def.loginPath}`;

      const extraParams = def.extraParams
        ? Object.entries(def.extraParams)
            .map(([k, v]) => `&${k}=${encodeURIComponent(v)}`)
            .join('')
        : '';

      const url = `${base}?userId=${user.id}&finalRedirectUri=${encodeURIComponent(
        finalRedirectUri,
      )}${orgParam}${extraParams}`;

      let result: WebBrowser.WebBrowserAuthSessionResult;
      try {
        result = await WebBrowser.openAuthSessionAsync(url, finalRedirectUri, { showInRecents: true });
      } catch (e) {
        return { success: false, errorMessage: 'Could not open the connection window.' };
      }

      if (result.type === 'cancel' || result.type === 'dismiss') {
        return { success: false, cancelled: true };
      }

      if (result.type === 'success' && result.url) {
        const { status, connectionId, message } = parseCallback(result.url);
        if (status === 'error') {
          return { success: false, errorMessage: message || 'Connection failed. Please try again.' };
        }
        // Require an affirmative signal — an explicit success status OR a
        // connectionId. A callback with neither (malformed/stale/replayed deep
        // link) is NOT a real connection, so don't report success.
        if (status !== 'success' && !connectionId) {
          return { success: false, errorMessage: 'The connection did not complete. Please try again.' };
        }
        if (connectionId) {
          void startScan(connectionId);
        }
        return { success: true, connectionId };
      }

      return { success: false, errorMessage: 'The connection did not complete. Please try again.' };
    },
    [orgId, startScan],
  );

  return { connect, startScan };
}
