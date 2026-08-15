/**
 * How to read the backend's answer to a per-platform override PUT.
 *
 * Leaf module (no imports) so the three server shapes can be locked by node --test
 * without dragging the network client in.
 *
 * Since backend Assurance Rewrite 3 the status code carries the push state, and a
 * non-2xx no longer implies the override was discarded:
 *
 *   200 { success:true, overrides, pushed:true, syncStatus? }
 *       Stored AND confirmed on the platform by read-back.
 *   202 { success:false, overrides, pushed:false, syncStatus:'Pending', error }
 *       Stored; the push is real work awaiting worker confirmation (Facebook browser
 *       jobs). `success:false` here means "not yet confirmed", NOT "not saved" — do
 *       not read `success` to decide whether the write landed.
 *   502 { message, reason, overrides, syncStatus:'Error' }
 *       Stored, but the platform push failed. The reason is also persisted server-side
 *       as PlatformProductMappings.SyncErrorMessage, which the Active Channels dot
 *       already renders, so a refresh surfaces it without a new UI surface.
 *   other non-2xx (400/403/404) { statusCode, message, error }
 *       Rejected BEFORE the write. Nothing was stored.
 *
 * The presence of an `overrides` object in the body is the signal that the write landed.
 */

export interface PlatformOptionsResponse {
  success?: boolean;
  overrides?: Record<string, unknown>;
  pushed?: boolean;
  syncStatus?: string;
  error?: string;
  /** 502 only: why the platform push failed. */
  reason?: string;
  /** Nest error envelope; string, or string[] for validation errors. */
  message?: string | string[];
}

/**
 * What actually happened to a per-platform override write.
 *
 * `confirmed`, `pending`, and `push_failed` all mean the override IS stored; only
 * `not_saved` means the edit must be retried. Requeueing a stored override would
 * re-PUT it forever, so callers must branch on this, never on `ok` alone.
 */
export type PlatformOverrideOutcome =
  /** 200: stored and confirmed live on the platform. */
  | 'confirmed'
  /** 202: stored; platform push is pending worker confirmation. */
  | 'pending'
  /** Stored, but the platform push failed. The override is safe; the channel is not synced. */
  | 'push_failed'
  /** Rejected before the write. Nothing was stored; the edit still needs saving. */
  | 'not_saved';

/**
 * Decide the outcome of an override PUT from its status and body alone. Pure, so the
 * three server shapes can be locked by tests without a network.
 */
export function classifyPlatformOverrideResponse(
  status: number,
  body: PlatformOptionsResponse | null,
): PlatformOverrideOutcome {
  if (status === 202) return 'pending';
  if (status >= 200 && status < 300) {
    // Defensive against a backend still on the pre-Rewrite-3 contract, which answered
    // 200 with pushed:false to mean "stored, push failed". Treat that honestly rather
    // than reporting it as confirmed during a staged rollout.
    return body?.pushed === false ? 'push_failed' : 'confirmed';
  }
  // A non-2xx that still echoes the stored overrides means the write landed and only
  // the push failed. Without that echo, nothing was written.
  return body?.overrides && typeof body.overrides === 'object' ? 'push_failed' : 'not_saved';
}

/** First usable string among the server's several reason-carrying keys. */
export function readPlatformOverrideReason(body: PlatformOptionsResponse | null): string | null {
  if (!body) return null;
  // `reason` is the 502's dedicated field. `message` carries the specific text on a
  // Nest validation error (whose `error` is only the generic status name), and `error`
  // carries the push reason on a 202. That ordering is why this is not a simple ??.
  const candidates: Array<string | string[] | undefined> = [body.reason, body.message, body.error];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const joined = candidate.filter((part) => typeof part === 'string' && part.trim()).join('; ');
      if (joined) return joined;
      continue;
    }
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}
