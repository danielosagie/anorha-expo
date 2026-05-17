import * as Sentry from '@sentry/react-native';

/**
 * Parse a fetch Response body without throwing. A non-JSON body (HTML error
 * page, empty 502, truncated payload) is a common white-screen cause when
 * code does `await res.json()` before checking `res.ok`. Returns null on
 * failure and leaves a breadcrumb so the failure is observable.
 */
export async function safeJson<T = any>(response: Response): Promise<T | null> {
  try {
    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch (e: any) {
    try {
      Sentry.addBreadcrumb({
        category: 'http',
        level: 'warning',
        message: `safeJson: non-JSON response (${response?.status})`,
        data: { url: (response as any)?.url, status: response?.status },
      });
    } catch {
      /* no-op */
    }
    console.warn('[safeJson] Failed to parse response body:', e?.message);
    return null;
  }
}

/** Synchronous string variant for non-Response payloads. */
export function safeJsonParse<T = any>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (e: any) {
    console.warn('[safeJsonParse] Failed to parse JSON string:', e?.message);
    return null;
  }
}
