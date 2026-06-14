/**
 * Single HTTP client for the sssync backend.
 *
 * Two layers over one base-URL resolver and one auth path:
 *   - api.get/post/...  + apiRequest → typed helpers; throw ApiError on non-2xx.
 *   - apiFetch / apiJson            → lower-level fetch with a single 401-refresh
 *                                      retry and an auto Idempotency-Key on mutations.
 *   - parseOrWarn                   → advisory zod contract check (never throws).
 *
 * Base URL comes from getApiBaseUrl(); the Supabase JWT is attached via
 * ensureSupabaseJwt() (opt out with `auth: false`).
 */
import { z } from 'zod';
import * as Crypto from 'expo-crypto';
import { ensureSupabaseJwt, forceRefreshSupabaseJwt, getApiBaseUrl } from './supabase';

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

export type QueryValue = string | number | boolean | null | undefined;

const ABSOLUTE_URL = /^https?:\/\//i;

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const base = ABSOLUTE_URL.test(path)
    ? path
    : `${getApiBaseUrl()}${path.startsWith('/') ? '' : '/'}${path}`;

  if (!query) return base;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.append(key, String(value));
  }
  const qs = params.toString();
  if (!qs) return base;
  return `${base}${base.includes('?') ? '&' : '?'}${qs}`;
}

function parseBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function newIdempotencyKey(): string {
  try {
    return Crypto.randomUUID();
  } catch {
    // Fallback if randomUUID is unavailable for any reason.
    return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

// ───────────────────────── Typed helpers (api.*) ─────────────────────────

export interface ApiRequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  /** Request body. Plain objects are JSON-stringified; strings are sent as-is. */
  body?: unknown;
  /** Attach the Supabase JWT. Default true; set false for public endpoints. */
  auth?: boolean;
  /** Query params appended to the URL (undefined/null values are dropped). */
  query?: Record<string, QueryValue>;
}

async function request<T>(
  method: string,
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { auth = true, body, query, headers, ...rest } = options;

  const hasBody = body !== undefined && body !== null;
  const finalHeaders = new Headers(headers as HeadersInit | undefined);
  if (hasBody && !finalHeaders.has('Content-Type')) {
    finalHeaders.set('Content-Type', 'application/json');
  }
  if (auth) {
    const token = await ensureSupabaseJwt();
    if (token) finalHeaders.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(buildUrl(path, query), {
    ...rest,
    method,
    headers: finalHeaders,
    body: hasBody ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });

  const data = parseBody(await response.text());

  if (!response.ok) {
    const message =
      (data && typeof data === 'object' && 'message' in data &&
      typeof (data as { message?: unknown }).message === 'string'
        ? (data as { message: string }).message
        : undefined) ||
      response.statusText ||
      `Request failed with status ${response.status}`;
    throw new ApiError(response.status, message, data);
  }

  return data as T;
}

export const api = {
  get: <T = unknown>(path: string, options?: ApiRequestOptions) =>
    request<T>('GET', path, options),
  post: <T = unknown>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    request<T>('POST', path, { ...options, body }),
  put: <T = unknown>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    request<T>('PUT', path, { ...options, body }),
  patch: <T = unknown>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    request<T>('PATCH', path, { ...options, body }),
  delete: <T = unknown>(path: string, options?: ApiRequestOptions) =>
    request<T>('DELETE', path, options),
};

/** Lower-level escape hatch when you need full control over method/options. */
export { request as apiRequest };

// ──────────────────── Raw fetch layer (apiFetch / apiJson) ───────────────

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

// ───────────────────────── Contract validation ───────────────────────────

/**
 * Advisory contract validation for API responses. Never throws and never strips:
 * the original payload is returned untouched (typed), and any mismatch against the
 * shared contract (src/contracts) is logged as drift telemetry. Use at the seam:
 *
 *   const status = parseOrWarn(zMatchJobStatus, await api.get(`/api/products/match/jobs/${id}/status`), 'match job status');
 */
export function parseOrWarn<S extends z.ZodType>(schema: S, data: unknown, label: string): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join(' · ');
    console.warn(`[contract] ${label} drifted from contract — ${issues}`);
  }
  return data as z.infer<S>;
}
