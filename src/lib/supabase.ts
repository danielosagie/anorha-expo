import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

// Prefer SSSYNC-specific base if present; fall back to generic API base; default to production API
const apiBaseCandidate = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app';
const apiBaseUrl = apiBaseCandidate;
console.log('[supabase.ts] EXPO_PUBLIC_SSSYNC_API_BASE_URL =', process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL);
console.log('[supabase.ts] EXPO_PUBLIC_API_BASE_URL =', process.env.EXPO_PUBLIC_API_BASE_URL);
console.log('[supabase.ts] Computed apiBaseUrl candidate =', apiBaseUrl);

let currentSupabaseJwt: string | null = null;
let refreshIntervalHandle: ReturnType<typeof setInterval> | null = null;
let getClerkTokenFn: (() => Promise<string | null>) | null = null;
// Promise lock to prevent race conditions when multiple components call ensureSupabaseJwt concurrently
let exchangeInProgress: Promise<boolean> | null = null;

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
  });
  
  return exchangeInProgress;
}

export async function ensureSupabaseJwt(): Promise<string | null> {
  // Fast path: return cached token if available
  if (currentSupabaseJwt) return currentSupabaseJwt;
  
  // If exchange is in progress, wait for it
  if (exchangeInProgress) {
    console.log('[supabase.ts] ensureSupabaseJwt: waiting for in-progress exchange...');
    await exchangeInProgress;
    return currentSupabaseJwt;
  }
  
  // Start new exchange
  const ok = await refreshSupabaseToken();
  return ok ? currentSupabaseJwt : null;
}

async function exchangeClerkForSupabase(): Promise<boolean> {
  if (!getClerkTokenFn) return false;
  try {
    const clerkToken = await getClerkTokenFn();
    const hasClerk = !!clerkToken;
    console.log('[supabase.ts] exchangeClerkForSupabase start. hasClerkToken =', hasClerk);
    if (!clerkToken) return false;
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
      return false;
    }
    const body = await resp.json();
    console.log('[supabase.ts] Exchange body:', body);
    currentSupabaseJwt = body.supabase_token as string;
    if (currentSupabaseJwt) {
      console.log('[supabase.ts] Supabase JWT set, length:', currentSupabaseJwt.length);
    } else {
      console.log('[supabase.ts] No supabase_token in response');
    }
    console.log('[supabase.ts] received supabase_token length =', currentSupabaseJwt ? currentSupabaseJwt.length : 0);
    return !!currentSupabaseJwt;
  } catch (e) {
    console.error('[supabase.ts] exchangeClerkForSupabase error:', e);
    return false;
  }
}

export async function configureClerkSupabaseBridge(options: {
  getClerkToken: () => Promise<string | null>;
  autoRefreshMinutes?: number;
}) {
  getClerkTokenFn = options.getClerkToken;
  console.log('[supabase.ts] configureClerkSupabaseBridge called. autoRefreshMinutes =', options.autoRefreshMinutes);
  const ok = await exchangeClerkForSupabase();
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
}

// Compatibility shim: replace supabase.auth.getUser() with a view-based lookup
// so existing screens can continue to call supabase.auth.getUser().
// We return the same shape: { data: { user }, error }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(supabase as any).auth.getUser = async () => {
  const { data, error } = await supabase.from('me').select('*').maybeSingle();
  if (error || !data) {
    return { data: { user: null }, error };
  }
  return { data: { user: { id: data.Id, email: data.Email } }, error: null };
};

// Optional explicit helper if you want to import directly
export async function getUserLike() {
  const { data, error } = await supabase.from('me').select('*').maybeSingle();
  if (error || !data) return { user: null };
  return { user: { id: data.Id, email: data.Email } };
}