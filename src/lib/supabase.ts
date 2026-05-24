import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../config/env';

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

let currentSupabaseJwt: string | null = null;
let refreshIntervalHandle: ReturnType<typeof setInterval> | null = null;
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
      console.warn('[supabase.ts] Supabase JWT listener failed:', error);
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
async function supabaseFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers || {});
  if (currentSupabaseJwt) {
    headers.set('Authorization', `Bearer ${currentSupabaseJwt}`);
  }

  const doFetch = () => realFetch(input as any, { ...init, headers });

  let res = await doFetch();
  if (res.status !== 401) return res;

  // Attempt on-demand refresh once if we hit 401
  console.warn('[supabase.ts] Received 401 from Supabase API, attempting token refresh...');
  const refreshed = await refreshSupabaseToken();
  if (!refreshed) return res;

  headers.set('Authorization', `Bearer ${currentSupabaseJwt}`);
  res = await doFetch();
  return res;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  // We are not using GoTrue; we keep storage to avoid breaking other code paths
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
  global: {
    fetch: supabaseFetch,
  },
});

// Expose current Supabase JWT for backend API calls (SupabaseAuthGuard expects this)
export function getCurrentSupabaseJwt(): string | null {
  return currentSupabaseJwt;
}

async function refreshSupabaseToken(): Promise<boolean> {
  // If an exchange is already in progress, wait for it instead of starting another
  if (exchangeInProgress) {
    console.log('[supabase.ts] Exchange already in progress, waiting...');
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

export async function ensureSupabaseJwt(): Promise<string | null> {
  const current = getSupabaseJwtState();
  if (current.state === 'ready') return current.token;

  if (exchangeInProgress) {
    console.log('[supabase.ts] ensureSupabaseJwt: waiting for in-progress exchange...');
    await exchangeInProgress;
    return getSupabaseJwtState().token;
  }

  const ok = await refreshSupabaseToken();
  return ok ? getSupabaseJwtState().token : null;
}

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
    console.log('[supabase.ts] exchangeClerkForSupabase start. hasClerkToken =', hasClerk);
    if (!clerkToken) {
      currentSupabaseJwt = null;
      lastExchangeOutcome = 'clerk_token_missing';
      emitSupabaseJwtState();
      return false;
    }
    const base = apiBaseUrl.endsWith('/api') ? apiBaseUrl : `${apiBaseUrl}/api`;
    const url = `${base}/auth/exchange`;
    console.log('[supabase.ts] Exchanging Clerk token for Supabase JWT at', url);
    console.log('[supabase.ts] EXCHANGE URL =', url);
    const resp = await realFetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${clerkToken}` },
    });
    console.log('[supabase.ts] Exchange response status:', resp.status, resp.ok);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '<no body>');
      console.log('[supabase.ts] Exchange error body:', text);
      currentSupabaseJwt = null;
      lastExchangeOutcome = 'exchange_failed';
      emitSupabaseJwtState();
      return false;
    }
    const body = await resp.json();
    console.log('[supabase.ts] Exchange body:', body);
    currentSupabaseJwt = body.supabase_token as string;
    if (currentSupabaseJwt) {
      lastExchangeOutcome = 'success';
      console.log('[supabase.ts] Supabase JWT set, length:', currentSupabaseJwt.length);
      try {
        // Ensure Realtime uses the latest JWT for RLS-enabled channels
        (supabase as any)?.realtime?.setAuth?.(currentSupabaseJwt);
      } catch (e) {
        console.warn('[supabase.ts] Failed to set Realtime auth token:', e);
      }
    } else {
      lastExchangeOutcome = 'exchange_failed';
      console.log('[supabase.ts] No supabase_token in response');
    }
    emitSupabaseJwtState();
    console.log('[supabase.ts] received supabase_token length =', currentSupabaseJwt ? currentSupabaseJwt.length : 0);
    return !!currentSupabaseJwt;
  } catch (e) {
    console.error('[supabase.ts] exchangeClerkForSupabase error:', e);
    currentSupabaseJwt = null;
    lastExchangeOutcome = 'exchange_failed';
    emitSupabaseJwtState();
    return false;
  }
}

export async function configureClerkSupabaseBridge(options: {
  getClerkToken: () => Promise<string | null>;
  autoRefreshMinutes?: number;
}) {
  getClerkTokenFn = options.getClerkToken;
  lastExchangeOutcome = 'idle';
  console.log('[supabase.ts] configureClerkSupabaseBridge called. autoRefreshMinutes =', options.autoRefreshMinutes);
  const ok = await refreshSupabaseToken();
  if (!ok) throw new Error('Failed to exchange Clerk token for Supabase JWT');

  // Start background refresh slightly before expiry
  const mins = options.autoRefreshMinutes ?? 30; // Extended from 9 to 30 minutes
  if (refreshIntervalHandle) clearInterval(refreshIntervalHandle);
  refreshIntervalHandle = setInterval(() => {
    console.log(`[supabase.ts] Background token refresh triggered (${mins}min interval)`);
    refreshSupabaseToken().catch((e) => {
      console.error('[supabase.ts] Background token refresh failed:', e);
    });
  }, mins * 60 * 1000);
}

export function stopClerkSupabaseBridge() {
  if (refreshIntervalHandle) clearInterval(refreshIntervalHandle);
  refreshIntervalHandle = null;
  currentSupabaseJwt = null;
  getClerkTokenFn = null;
  lastExchangeOutcome = 'idle';
  emitSupabaseJwtState();
}

// Compatibility shim: replace supabase.auth.getUser() with a view-based lookup
// so existing screens can continue to call supabase.auth.getUser().
// We return the same shape: { data: { user }, error }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(supabase as any).auth.getUser = async () => {
  const { data, error } = await supabase.from('me').select('Id, Email').maybeSingle();
  if (error || !data) {
    return { data: { user: null }, error };
  }
  return { data: { user: { id: data.Id, email: data.Email } }, error: null };
};

// Optional explicit helper if you want to import directly
export async function getUserLike() {
  const { data, error } = await supabase.from('me').select('Id, Email').maybeSingle();
  if (error || !data) return { user: null };
  return { user: { id: data.Id, email: data.Email } };
}
