import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../config/env';
import { createLogger } from '../utils/logger';
const log = createLogger('supabase');


// After running `npm run db:types` (full generated schema), type the client:
//   import type { Database } from '../types/database.types';
//   export const supabase = createClient<Database>(...)
// Deferred until the generated file covers ALL tables — otherwise queries to
// not-yet-listed tables fail to type-check.

// Require environment variables - fail fast if missing
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  const missing = [];
  if (!supabaseUrl) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!supabaseAnonKey) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  throw new Error(
    `Missing required Supabase environment variables: ${missing.join(', ')}. ` +
    'Please configure these in your .env.local file or EAS environment variables.'
  );
}

// Resolved once in src/config/env.ts (SSSYNC-specific → generic → prod default).
const apiBaseUrl = API_BASE_URL;

/**
 * Canonical API origin (no trailing slash, no `/api` suffix). Single source of truth for
 * the base URL — replaces the `process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app'`
 * fallback that was copy-pasted across ~40 screens. Endpoint paths (e.g. `/api/...`) are
 * appended by the caller / apiClient.
 */
export function getApiBaseUrl(): string {
  return apiBaseUrl.replace(/\/+$/, '').replace(/\/api$/, '');
}

/**
 * Track A (v2): when EXPO_PUBLIC_CLERK_NATIVE_AUTH=true, Supabase trusts Clerk's session
 * token DIRECTLY (Supabase third-party auth) and the /api/auth/exchange mint bridge is
 * bypassed — supabase-js attaches the Clerk token to REST + Realtime via its `accessToken`
 * callback, and the backend's SupabaseAuthGuard PATH 3 already accepts raw Clerk tokens.
 *
 * Default OFF. Flip only AFTER: (1) adding Clerk as a Supabase third-party auth provider,
 * (2) enabling the Clerk→Supabase integration (adds the `role: authenticated` claim), and
 * (3) applying the app_user_id() RLS migration. See sssync-bknd docs/CLERK_NATIVE_AUTH.md.
 */
const CLERK_NATIVE_AUTH = process.env.EXPO_PUBLIC_CLERK_NATIVE_AUTH === 'true';


let currentSupabaseJwt: string | null = null;
let refreshTimerHandle: ReturnType<typeof setTimeout> | null = null;
// The backend mints SHORT-LIVED Supabase JWTs (currently ~600s). We must refresh
// based on the token's actual lifetime, not a fixed interval — a previous hardcoded
// 30-min interval left the JWT expired for ~20 of every 30 minutes (Realtime + raw
// fetch calls silently 401'd). `expires_in` from /auth/exchange drives the schedule.
let lastExpiresInSeconds: number | null = null;
const FALLBACK_REFRESH_SECONDS = 8 * 60; // only used if the backend omits expires_in
const REFRESH_LEAD_SECONDS = 60; // refresh this many seconds before expiry
let getClerkTokenFn: (() => Promise<string | null>) | null = null;
// Promise lock to prevent race conditions when multiple components call ensureSupabaseJwt concurrently
let exchangeInProgress: Promise<boolean> | null = null;
let lastExchangeOutcome: 'idle' | 'success' | 'exchange_failed' | 'clerk_token_missing' = 'idle';

export type SupabaseJwtAcquisitionState =
  | 'ready'
  | 'exchange_in_progress'
  | 'bridge_unconfigured'
  | 'exchange_failed'
  | 'clerk_token_missing';

export interface SupabaseJwtStatus {
  token: string | null;
  state: SupabaseJwtAcquisitionState;
}

type SupabaseJwtListener = (status: SupabaseJwtStatus) => void;

const supabaseJwtListeners = new Set<SupabaseJwtListener>();

function computeSupabaseJwtState(): SupabaseJwtAcquisitionState {
  if (currentSupabaseJwt) return 'ready';
  if (exchangeInProgress) return 'exchange_in_progress';
  if (!getClerkTokenFn) return 'bridge_unconfigured';
  if (lastExchangeOutcome === 'clerk_token_missing') return 'clerk_token_missing';
  if (lastExchangeOutcome === 'exchange_failed') return 'exchange_failed';
  return 'bridge_unconfigured';
}

function emitSupabaseJwtState() {
  const snapshot = getSupabaseJwtState();
  supabaseJwtListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      log.warn('[supabase.ts] Supabase JWT listener failed:', error);
    }
  });
}

export function getSupabaseJwtState(): SupabaseJwtStatus {
  return {
    token: currentSupabaseJwt,
    state: computeSupabaseJwtState(),
  };
}

export function subscribeToSupabaseJwtState(listener: SupabaseJwtListener): () => void {
  supabaseJwtListeners.add(listener);
  listener(getSupabaseJwtState());
  return () => {
    supabaseJwtListeners.delete(listener);
  };
}

export function isSupabaseBridgeWarmingUp(state: SupabaseJwtAcquisitionState): boolean {
  return state === 'exchange_in_progress';
}

export function isSupabaseBridgeUnavailableState(state: SupabaseJwtAcquisitionState): boolean {
  return state === 'exchange_failed' || state === 'bridge_unconfigured' || state === 'clerk_token_missing';
}

// Custom fetch for Supabase client to inject Authorization and handle 401 refresh
const realFetch = globalThis.fetch.bind(globalThis);
/**
 * @deprecated MINT-BRIDGE FALLBACK — only attached to the Supabase client when
 * EXPO_PUBLIC_CLERK_NATIVE_AUTH=false. Native Clerk auth (live since 2026-06-15) uses
 * supabase-js's `accessToken` callback instead — no custom fetch, no 401-retry. Kept as
 * the flip-back fallback; remove after the native soak. See docs/CLERK_NATIVE_AUTH.md.
 */
async function supabaseFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers || {});
  if (currentSupabaseJwt) {
    headers.set('Authorization', `Bearer ${currentSupabaseJwt}`);
  }

  const doFetch = () => realFetch(input as any, { ...init, headers });

  let res = await doFetch();
  if (res.status !== 401) return res;

  // Attempt on-demand refresh once if we hit 401
  log.warn('[supabase.ts] Received 401 from Supabase API, attempting token refresh...');
  const refreshed = await refreshSupabaseToken();
  if (!refreshed) return res;

  headers.set('Authorization', `Bearer ${currentSupabaseJwt}`);
  res = await doFetch();
  return res;
}

// We are not using GoTrue; we keep storage to avoid breaking other code paths
const baseAuthOptions = {
  storage: AsyncStorage,
  autoRefreshToken: false,
  persistSession: false,
  detectSessionInUrl: false,
} as const;

export const supabase = CLERK_NATIVE_AUTH
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: baseAuthOptions,
      // Native third-party auth: supabase-js pulls the Clerk token on demand for both
      // REST and Realtime — no mint, no custom fetch, no refresh timer.
      accessToken: async () => (getClerkTokenFn ? await getClerkTokenFn() : null),
    })
  : createClient(supabaseUrl, supabaseAnonKey, {
      auth: baseAuthOptions,
      global: {
        fetch: supabaseFetch,
      },
    });

// Expose current Supabase JWT for backend API calls (SupabaseAuthGuard expects this)
export function getCurrentSupabaseJwt(): string | null {
  return currentSupabaseJwt;
}

/**
 * @deprecated MINT-BRIDGE FALLBACK — drives the Clerk→Supabase token exchange. Bypassed
 * under native auth (EXPO_PUBLIC_CLERK_NATIVE_AUTH=true). Remove after the native soak.
 */
async function refreshSupabaseToken(): Promise<boolean> {
  // If an exchange is already in progress, wait for it instead of starting another
  if (exchangeInProgress) {
    log.debug('[supabase.ts] Exchange already in progress, waiting...');
    return exchangeInProgress;
  }
  
  // Start exchange and store the promise so concurrent calls can wait
  exchangeInProgress = exchangeClerkForSupabase().finally(() => {
    exchangeInProgress = null;
    emitSupabaseJwtState();
  });
  emitSupabaseJwtState();
  
  return exchangeInProgress;
}

// Read a JWT's `exp` (ms). Returns null if it can't be parsed. RN/Hermes has atob;
// the try/catch falls back to "trust presence" so this never regresses behaviour.
function jwtExpiryMs(token: string | null): number | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob === 'function'
      ? atob(base64)
      : (globalThis as any).Buffer?.from(base64, 'base64').toString('binary');
    if (!json) return null;
    const payload = JSON.parse(json);
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * @deprecated Returns the raw JWT `sub` claim. That equals the internal Users.Id UUID ONLY
 * under the mint bridge. Under native Clerk auth (CLERK_NATIVE_AUTH) `sub` is the Clerk user
 * id (user_xxx), NOT Users.Id — so using it in a `UserId=eq.<id>` filter or query matches
 * zero rows. For the internal user UUID use `getUserLike()` (the `me` view), which is correct
 * in both auth modes. Kept only for backwards compatibility; has no in-app callers.
 */
export function getSupabaseUserId(): string | null {
  const token = currentSupabaseJwt;
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob === 'function'
      ? atob(base64)
      : (globalThis as any).Buffer?.from(base64, 'base64').toString('binary');
    if (!json) return null;
    const payload = JSON.parse(json);
    return typeof payload.sub === 'string' && payload.sub.trim().length > 0 ? payload.sub.trim() : null;
  } catch {
    return null;
  }
}

// Refresh ~1 min before the token actually expires so long requests (e.g. the
// import flow) never send a token that lapses mid-flight.
const TOKEN_REFRESH_BUFFER_MS = 60_000;
function isCurrentJwtFresh(): boolean {
  const expMs = jwtExpiryMs(currentSupabaseJwt);
  if (expMs == null) return !!currentSupabaseJwt; // no parseable exp → trust presence
  return expMs > Date.now() + TOKEN_REFRESH_BUFFER_MS;
}

export async function ensureSupabaseJwt(): Promise<string | null> {
  if (CLERK_NATIVE_AUTH) {
    // No mint: the Clerk token IS the token backend + Supabase accept. Clerk's SDK
    // returns a fresh (cached/auto-refreshed) token each call. Warm currentSupabaseJwt
    // so the synchronous getCurrentSupabaseJwt() stays best-effort current.
    const token = getClerkTokenFn ? await getClerkTokenFn() : null;
    currentSupabaseJwt = token;
    emitSupabaseJwtState();
    return token;
  }

  const current = getSupabaseJwtState();
  // Previously returned the cached token whenever one existed, even if it had
  // expired — that's what made the import flow 401 with "jwt expired". Now we also
  // require it to be fresh, and proactively re-exchange when it isn't.
  if (current.state === 'ready' && isCurrentJwtFresh()) return current.token;

  if (exchangeInProgress) {
    log.debug('[supabase.ts] ensureSupabaseJwt: waiting for in-progress exchange...');
    await exchangeInProgress;
    return getSupabaseJwtState().token;
  }

  const ok = await refreshSupabaseToken();
  return ok ? getSupabaseJwtState().token : null;
}

/**
 * @deprecated MINT-BRIDGE FALLBACK — POSTs the Clerk token to /api/auth/exchange to mint a
 * short-lived HS256 Supabase JWT. Not used under native auth (the Clerk session token is
 * sent to Supabase directly). Remove after the native soak.
 */
async function exchangeClerkForSupabase(): Promise<boolean> {
  if (!getClerkTokenFn) {
    currentSupabaseJwt = null;
    lastExchangeOutcome = 'idle';
    emitSupabaseJwtState();
    return false;
  }
  try {
    const clerkToken = await getClerkTokenFn();
    const hasClerk = !!clerkToken;
    log.debug('[supabase.ts] exchangeClerkForSupabase start. hasClerkToken =', hasClerk);
    if (!clerkToken) {
      currentSupabaseJwt = null;
      lastExchangeOutcome = 'clerk_token_missing';
      emitSupabaseJwtState();
      return false;
    }
    const base = apiBaseUrl.endsWith('/api') ? apiBaseUrl : `${apiBaseUrl}/api`;
    const url = `${base}/auth/exchange`;
    log.debug('[supabase.ts] Exchanging Clerk token for Supabase JWT at', url);
    log.debug('[supabase.ts] EXCHANGE URL =', url);
    const resp = await realFetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${clerkToken}` },
    });
    log.debug('[supabase.ts] Exchange response status:', resp.status, resp.ok);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '<no body>');
      log.debug('[supabase.ts] Exchange error body:', text);
      currentSupabaseJwt = null;
      lastExchangeOutcome = 'exchange_failed';
      emitSupabaseJwtState();
      return false;
    }
    const body = await resp.json();
    log.debug('[supabase.ts] Exchange body:', body);
    currentSupabaseJwt = body.supabase_token as string;
    lastExpiresInSeconds = typeof body.expires_in === 'number' && body.expires_in > 0
      ? body.expires_in
      : null;
    if (currentSupabaseJwt) {
      lastExchangeOutcome = 'success';
      log.debug('[supabase.ts] Supabase JWT set, length:', currentSupabaseJwt.length);
      try {
        // Ensure Realtime uses the latest JWT for RLS-enabled channels
        (supabase as any)?.realtime?.setAuth?.(currentSupabaseJwt);
      } catch (e) {
        log.warn('[supabase.ts] Failed to set Realtime auth token:', e);
      }
    } else {
      lastExchangeOutcome = 'exchange_failed';
      log.debug('[supabase.ts] No supabase_token in response');
    }
    emitSupabaseJwtState();
    log.debug('[supabase.ts] received supabase_token length =', currentSupabaseJwt ? currentSupabaseJwt.length : 0);
    return !!currentSupabaseJwt;
  } catch (e) {
    log.error('[supabase.ts] exchangeClerkForSupabase error:', e);
    currentSupabaseJwt = null;
    lastExchangeOutcome = 'exchange_failed';
    emitSupabaseJwtState();
    return false;
  }
}

function clearRefreshTimer() {
  if (refreshTimerHandle) {
    clearTimeout(refreshTimerHandle);
    refreshTimerHandle = null;
  }
}

// Self-rescheduling refresh keyed off the token's real lifetime. We refresh
// REFRESH_LEAD_SECONDS before `expires_in` elapses so the JWT (and Realtime auth)
// never goes stale mid-session.
/**
 * @deprecated MINT-BRIDGE FALLBACK — the minted-token refresh timer. Native auth has no
 * timer (supabase-js pulls a fresh Clerk token on demand). Remove after the native soak.
 */
function scheduleNextRefresh() {
  clearRefreshTimer();
  const lifetime = lastExpiresInSeconds && lastExpiresInSeconds > 0
    ? lastExpiresInSeconds
    : FALLBACK_REFRESH_SECONDS;
  const delaySeconds = Math.max(REFRESH_LEAD_SECONDS, lifetime - REFRESH_LEAD_SECONDS);
  refreshTimerHandle = setTimeout(() => {
    log.debug(`[supabase.ts] Scheduled token refresh (lifetime=${lifetime}s, delay=${delaySeconds}s)`);
    refreshSupabaseToken()
      .catch((e) => log.error('[supabase.ts] Scheduled token refresh failed:', e))
      .finally(() => scheduleNextRefresh());
  }, delaySeconds * 1000);
}

export async function configureClerkSupabaseBridge(options: {
  getClerkToken: () => Promise<string | null>;
  /** @deprecated Ignored — refresh cadence is derived from the token's `expires_in`. */
  autoRefreshMinutes?: number;
}) {
  getClerkTokenFn = options.getClerkToken;
  lastExchangeOutcome = 'idle';
  log.debug('[supabase.ts] configureClerkSupabaseBridge called.');

  if (CLERK_NATIVE_AUTH) {
    // Native third-party auth: no exchange, no refresh timer — supabase-js calls the
    // accessToken callback on demand. Just warm the token for sync getters/state.
    currentSupabaseJwt = await options.getClerkToken().catch(() => null);
    lastExchangeOutcome = currentSupabaseJwt ? 'success' : 'clerk_token_missing';
    // Push the token to Realtime too: supabase-js only fetches accessToken at CONNECT
    // time, so RLS channels otherwise hold the first token forever and silently 401
    // (dead live updates) once it rotates. setAuth re-auths all joined channels.
    if (currentSupabaseJwt) {
      try { (supabase as any)?.realtime?.setAuth?.(currentSupabaseJwt); } catch { /* realtime optional */ }
    }
    emitSupabaseJwtState();
    return;
  }

  const ok = await refreshSupabaseToken();
  if (!ok) throw new Error('Failed to exchange Clerk token for Supabase JWT');

  // Schedule the next refresh from the token's actual lifetime (NOT a fixed interval).
  scheduleNextRefresh();
}

/**
 * Force an immediate token re-exchange and realign the refresh timer.
 * Use on app foreground: background timers can be suspended by the OS, so the
 * scheduled refresh may not have fired and `currentSupabaseJwt` could be expired
 * even though state still reads 'ready'. No-op if the bridge isn't configured
 * (i.e. signed out).
 */
export async function forceRefreshSupabaseJwt(): Promise<boolean> {
  if (!getClerkTokenFn) return false;
  if (CLERK_NATIVE_AUTH) {
    // No timer to realign; re-warm the cached token AND re-auth Realtime — on
    // foreground the OS may have let the token the channels hold expire while
    // backgrounded, so without this live updates stay dead until a full reconnect.
    currentSupabaseJwt = await getClerkTokenFn().catch(() => null);
    if (currentSupabaseJwt) {
      try { (supabase as any)?.realtime?.setAuth?.(currentSupabaseJwt); } catch { /* realtime optional */ }
    }
    emitSupabaseJwtState();
    return !!currentSupabaseJwt;
  }
  const ok = await refreshSupabaseToken();
  scheduleNextRefresh();
  return ok;
}

export function stopClerkSupabaseBridge() {
  clearRefreshTimer();
  currentSupabaseJwt = null;
  lastExpiresInSeconds = null;
  getClerkTokenFn = null;
  lastExchangeOutcome = 'idle';
  emitSupabaseJwtState();
}

// Compatibility shim for supabase.auth.getUser()/getSession() (~38 + 4 call sites).
//
// In native (CLERK_NATIVE_AUTH) mode supabase-js sets `supabase.auth` to a Proxy whose
// get-trap THROWS on EVERY property access ("accessing supabase.auth.<x> is not
// possible"), so the old `auth.getUser = fn` assignment was a silent no-op. We replace
// the whole `auth` object with a Clerk-backed shim. In mint-bridge mode `supabase.auth`
// is the real GoTrue client, so we only override getUser. User identity comes from the
// `me` view in both modes; the session access_token is the current bridge/Clerk JWT.
async function meUser(): Promise<{ user: { id: string; email: string } | null; error: unknown }> {
  const { data, error } = await supabase.from('me').select('Id, Email').maybeSingle();
  if (error || !data) return { user: null, error: error ?? null };
  return { user: { id: data.Id, email: data.Email }, error: null };
}

const authGetUserShim = async () => {
  const { user, error } = await meUser();
  return { data: { user }, error };
};

const authGetSessionShim = async () => {
  const access_token = await ensureSupabaseJwt();
  return { data: { session: access_token ? { access_token } : null }, error: null };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAuthAny = supabase as any;
if (CLERK_NATIVE_AUTH) {
  // `supabase.auth` is a throw-on-access Proxy — replace it wholesale.
  supabaseAuthAny.auth = { getUser: authGetUserShim, getSession: authGetSessionShim };
} else {
  // Real GoTrue client — keep its methods, just override getUser to the me-view lookup.
  supabaseAuthAny.auth.getUser = authGetUserShim;
}

// Optional explicit helper if you want to import directly
export async function getUserLike() {
  const { user } = await meUser();
  return { user };
}
