/**
 * Single HTTP client for the sssync backend.
 *
 * Why this exists: API calls used to be ~50 hand-rolled `fetch` blocks, each
 * re-deriving the base URL, re-attaching the Supabase JWT, and swallowing
 * errors differently. This centralizes all of that:
 *   - base URL comes from `src/config/env.ts` (no per-call fallbacks)
 *   - the Supabase JWT is attached via `ensureSupabaseJwt()` (opt out with `auth: false`)
 *   - non-2xx responses throw a typed `ApiError` instead of returning null
 *
 * Generics are caller-supplied for now; Phase 3 will bind these to types
 * generated from the backend's OpenAPI spec.
 */
import { API_BASE_URL } from '../config/env';
import { ensureSupabaseJwt } from './supabase';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type QueryValue = string | number | boolean | null | undefined;

export interface ApiRequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  /** Request body. Plain objects are JSON-stringified; strings are sent as-is. */
  body?: unknown;
  /** Attach the Supabase JWT. Default true; set false for public endpoints. */
  auth?: boolean;
  /** Query params appended to the URL (undefined/null values are dropped). */
  query?: Record<string, QueryValue>;
}

function buildUrl(path: string, query?: ApiRequestOptions['query']): string {
  const base = path.startsWith('http')
    ? path
    : `${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;

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
