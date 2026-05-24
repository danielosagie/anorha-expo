/**
 * Single source of truth for runtime configuration.
 *
 * Resolve and validate environment variables here ONCE. Do not read
 * `process.env.EXPO_PUBLIC_*` for these values anywhere else — import from this
 * module so there is exactly one place that decides defaults and fails loudly
 * on misconfiguration. This is what replaces the ~30 scattered
 * `process.env... || 'https://api.sssync.app'` fallbacks across the app.
 */

const DEFAULT_API_BASE_URL = 'https://api.sssync.app';

const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * API host (no `/api` suffix, no trailing slash). Callers pass paths like
 * `/api/products/...`. Precedence matches the legacy resolution:
 * SSSYNC-specific → generic → production default.
 */
function resolveApiBaseUrl(): string {
  const raw =
    process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL ||
    process.env.EXPO_PUBLIC_API_BASE_URL ||
    '';

  if (!raw) {
    // Fail fast in development so misconfiguration is obvious, instead of
    // silently hitting production (the bug that bred the localhost fallbacks).
    if (isDev) {
      throw new Error(
        '[env] No API base URL configured. Set EXPO_PUBLIC_SSSYNC_API_BASE_URL ' +
          '(or EXPO_PUBLIC_API_BASE_URL) in your .env.local or EAS environment.',
      );
    }
    console.warn('[env] API base URL not set; using production default.');
    return DEFAULT_API_BASE_URL;
  }

  return stripTrailingSlashes(raw);
}

export const API_BASE_URL = resolveApiBaseUrl();

/** Grouped public config. Prefer the named exports for hot paths. */
export const ENV = {
  apiBaseUrl: API_BASE_URL,
  convexUrl: process.env.EXPO_PUBLIC_CONVEX_URL ?? '',
  clerkPublishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '',
  clerkJwtTemplate: process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE || 'supabase',
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  aiServerUrl: process.env.EXPO_PUBLIC_AI_SERVER_URL ?? '',
  isDev,
} as const;
