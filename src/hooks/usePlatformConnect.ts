// usePlatformConnect — a small, self-contained wrapper around the platform
// OAuth + "start scan" flow, so screens outside ProfileScreen (e.g. the
// onboarding "Connect your accounts" step) can connect a platform and kick off
// the background inventory pull / draft-mapping build without dragging in
// ProfileScreen's state. Mirrors the URL + callback patterns ProfileScreen uses.

import { useCallback } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../lib/supabase';
import { getPlatform } from '../config/platforms';
import { apiJson, ApiError } from '../lib/apiClient';
import {
  CONNECT_FALLBACK_COPY,
  connectErrorCopy,
  isConnectErrorCode,
  type ConnectErrorCode,
} from '../lib/connectErrorCopy';

export type ConnectablePlatform = 'shopify' | 'square' | 'clover' | 'ebay' | 'facebook';

export interface ConnectResult {
  /** true when the platform was connected (a PlatformConnection now exists). */
  success: boolean;
  /** present for platforms that return it on the deep-link callback (Square/Clover). */
  connectionId?: string;
  /** user backed out of the browser sheet — not an error worth surfacing loudly. */
  cancelled?: boolean;
  errorCode?: ConnectErrorCode;
  errorMessage?: string;
}

export interface ConnectOptions {
  /** Required for Shopify's store-specific Admin OAuth authorization URL. */
  shopifyShop?: string;
}

interface ConnectIntentResponse {
  url: string;
  expiresIn: number;
}

const parseCallback = (url: string): {
  status: string | null;
  connectionId?: string;
  code?: string;
  message?: string;
} => {
  // Strip any hash fragment (e.g. "#_=_") before reading query params.
  const noHash = url.split('#')[0];
  const query = noHash.split('?')[1] || '';
  const params = new URLSearchParams(query);
  return {
    status: params.get('status'),
    connectionId: params.get('connectionId') || undefined,
    code: params.get('code') || undefined,
    message: params.get('message') || undefined,
  };
};

let activePlatformAuthSessions = 0;
let platformCallbackClaimedUntil = 0;

/** App.tsx uses this to leave an in-flight auth-session callback to its owner. */
export function isPlatformAuthCallbackClaimed(): boolean {
  return activePlatformAuthSessions > 0 || Date.now() < platformCallbackClaimedUntil;
}

export function usePlatformConnect(_opts: { orgId?: string | null } = {}) {
  // Redundant, bounded kick. OAuth callbacks already autoqueue supported
  // providers server-side, so this result is reconciliation evidence only.
  const startScan = useCallback(async (connectionId: string): Promise<boolean> => {
    try {
      await apiJson(`/api/sync/connections/${encodeURIComponent(connectionId)}/start-scan`, {
        method: 'POST',
        timeoutMs: 18000,
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  const connect = useCallback(
    async (platform: ConnectablePlatform, options: ConnectOptions = {}): Promise<ConnectResult> => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error || !user) {
        return { success: false, errorMessage: 'Could not identify your account. Please try again.' };
      }

      // Connect flow is described per-platform in the registry (redirect
      // scheme and extra params) — no platform-specific branching here.
      const def = getPlatform(platform)?.connect;
      if (!def) {
        return { success: false, errorMessage: 'This platform can’t be connected yet.' };
      }

      if (platform === 'shopify' && !options.shopifyShop) {
        return { success: false, errorMessage: 'Choose your Shopify store first.' };
      }

      // 'bare' platforms (Shopify, Facebook) reuse a single callback; 'tagged'
      // OAuth platforms carry the platform key on the deep link.
      const finalRedirectUri =
        def.redirectStyle === 'bare'
          ? 'anorhaapp://auth-callback'
          : `anorhaapp://auth/callback?platform=${platform}`;

      let url: string;
      try {
        const intent = await apiJson<ConnectIntentResponse>(
          `/api/auth/${platform}/connect-intent`,
          {
            method: 'POST',
            body: {
              finalRedirectUri,
              ...(def.extraParams || {}),
              ...(platform === 'shopify' && options.shopifyShop
                ? { shop: options.shopifyShop }
                : {}),
            },
          },
        );

        if (!intent.url || typeof intent.url !== 'string') {
          return {
            success: false,
            errorMessage: 'Could not securely start the connection. Please try again.',
          };
        }
        url = intent.url;
      } catch (error) {
        return {
          success: false,
          errorMessage:
            error instanceof ApiError && error.status === 401
              ? 'Your session expired. Please sign in again.'
              : 'Could not securely start the connection. Please try again.',
        };
      }

      let result: WebBrowser.WebBrowserAuthSessionResult;
      activePlatformAuthSessions += 1;
      try {
        result = await WebBrowser.openAuthSessionAsync(url, finalRedirectUri, { showInRecents: true });
      } catch {
        return { success: false, errorMessage: 'Could not open the connection window.' };
      } finally {
        activePlatformAuthSessions = Math.max(0, activePlatformAuthSessions - 1);
        platformCallbackClaimedUntil = Date.now() + 5000;
      }

      if (result.type === 'cancel' || result.type === 'dismiss') {
        return { success: false, cancelled: true };
      }

      if (result.type === 'success' && result.url) {
        const { status, connectionId, code, message } = parseCallback(result.url);
        const callbackError = connectErrorCopy({ code, message });
        const knownCode = isConnectErrorCode(code) ? code : undefined;

        if (callbackError.kind === 'success_already') {
          return { success: true, connectionId };
        }
        if (callbackError.kind === 'cancelled') {
          return { success: false, cancelled: true };
        }
        if (status === 'error' || knownCode) {
          return {
            success: false,
            errorCode: knownCode,
            errorMessage: callbackError.message,
          };
        }
        // Require an affirmative signal — an explicit success status OR a
        // connectionId. A callback with neither (malformed/stale/replayed deep
        // link) is NOT a real connection, so don't report success.
        if (status !== 'success' && !connectionId) {
          return { success: false, errorMessage: CONNECT_FALLBACK_COPY };
        }
        return { success: true, connectionId };
      }

      return { success: false, errorMessage: CONNECT_FALLBACK_COPY };
    },
    [],
  );

  return { connect, startScan };
}
