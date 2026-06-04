import * as Crypto from 'expo-crypto';
import { ensureSupabaseJwt, forceRefreshSupabaseJwt, getApiBaseUrl } from './supabase';

/**
 * Single API access layer for the backend.
 *
 * Replaces the pattern copy-pasted across ~40 screens:
 *
 *   const token = await ensureSupabaseJwt();
 *   const base = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app';
 *   const res = await fetch(`${base}/api/foo`, { headers: { Authorization: `Bearer ${token}` } });
 *
 * with:
 *
 *   const data = await apiJson('/api/foo');                       // GET + parsed JSON, throws on !ok
 *   await apiJson('/api/foo', { method: 'POST', body: {...} });   // mutation w/ auto idempotency key
 *   const res  = await apiFetch('/api/foo');                      // when you need the raw Response
 *
 * Benefits over the old pattern: one base-URL resolver, consistent auth header, a single
 * 401-refresh-and-retry (raw fetches had none, so they silently failed on an expired JWT),
 * and an Idempotency-Key on mutations so safe retries don't double-apply server-side.
 */

export class ApiError extends Error {
  status: number;
  body?: any;
  constructor(status: number, message: string, body?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  /** Object bodies are JSON-stringified automatically; strings/FormData are passed through. */
  body?: any;
  /** Attach the Supabase JWT (default: true). Set false for unauthenticated endpoints. */
  auth?: boolean;
  /**
   * Idempotency-Key for safe mutation retries. Auto-generated for non-GET/HEAD requests.
   * Pass an explicit value to dedupe across attempts, or `false` to omit.
   */
  idempotencyKey?: string | false;
}

const ABSOLUTE_URL = /^https?:\/\//i;

function buildUrl(path: string): string {
  if (ABSOLUTE_URL.test(path)) return path;
  const base = getApiBaseUrl();
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
}

function newIdempotencyKey(): string {
  try {
    return Crypto.randomUUID();
  } catch {
    // Fallback if randomUUID is unavailable for any reason.
    return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/**
 * Authenticated fetch against the API. Returns the raw `Response` (drop-in for `fetch`).
 * Retries once on a 401 after forcing a token refresh.
 */
export async function apiFetch(path: string, options: ApiFetchOptions = {}): Promise<Response> {
  const { auth = true, idempotencyKey, body, headers, method, ...rest } = options;
  const url = buildUrl(path);
  const verb = (method || 'GET').toUpperCase();
  const isMutation = verb !== 'GET' && verb !== 'HEAD';

  // Compute the idempotency key ONCE so it is stable across the 401 retry.
  const idemKey =
    isMutation && idempotencyKey !== false ? (idempotencyKey || newIdempotencyKey()) : undefined;

  const serializedBody =
    body === undefined || typeof body === 'string' || body instanceof FormData
      ? body
      : JSON.stringify(body);

  const buildHeaders = async (): Promise<Headers> => {
    const h = new Headers(headers as HeadersInit | undefined);
    if (serializedBody !== undefined && !(body instanceof FormData) && !h.has('Content-Type')) {
      h.set('Content-Type', 'application/json');
    }
    if (auth) {
      const token = await ensureSupabaseJwt();
      if (token) h.set('Authorization', `Bearer ${token}`);
    }
    if (idemKey && !h.has('Idempotency-Key')) h.set('Idempotency-Key', idemKey);
    return h;
  };

  const doFetch = async () =>
    fetch(url, { ...rest, method: verb, headers: await buildHeaders(), body: serializedBody as any });

  let res = await doFetch();
  if (res.status === 401 && auth) {
    const refreshed = await forceRefreshSupabaseJwt();
    if (refreshed) res = await doFetch();
  }
  return res;
}

/**
 * Authenticated fetch that parses JSON and throws an `ApiError` on a non-2xx response.
 */
export async function apiJson<T = any>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const res = await apiFetch(path, options);
  const text = await res.text();
  let data: any = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && (data.message || data.error)) ||
      `Request failed (${res.status})`;
    throw new ApiError(res.status, typeof message === 'string' ? message : `Request failed (${res.status})`, data);
  }
  return data as T;
}
