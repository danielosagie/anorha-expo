/**
 * Typed-by-string function references for the BACKEND's browserJobs Convex
 * deployment (a DIFFERENT deployment than the app's EXPO_PUBLIC_CONVEX_URL
 * agent-chat one). We deliberately do NOT import that deployment's generated
 * `api` — its `_generated/api` lives in sssync-bknd and would couple this app's
 * build to the backend's codegen. Instead we name the public, arg-scoped queries
 * by their string path via `anyApi`, which matches the wire contract exactly.
 *
 * Contract (verified against sssync-bknd/convex):
 *   - workerPresence:getForUser({ userId }) → presence docs
 *       { userId, orgId, workerId, platform?, lastSeenAt, updatedAt }
 *   - browserJobs:getForUser({ userId }) → projected jobs
 *       { _id, type, platform, operation, status, paused, pausedReason,
 *         queuePosition, nextEligibleAt, productId, variantId, listingId,
 *         listingUrl, attemptCount, maxAttempts, nextRetryAt, deadLetteredAt,
 *         updatedAt }
 *
 * Both are PUBLIC + arg-scoped (no auth token), same posture as
 * browserJobs:getRetryable. If the backend ever renames a function, the call
 * fails silently (empty data) — keep the names HERE in one place so a rename is
 * a one-line edit and callers stay decoupled.
 */
import { anyApi } from 'convex/server';

/** The two public queries, addressed by string path. */
export const browserJobsApi = anyApi;

// Re-export the exact function names as constants so a backend rename is a
// single-edit blast radius and grep finds every consumer.
export const FN_WORKER_PRESENCE_GET_FOR_USER = 'workerPresence:getForUser';
export const FN_BROWSER_JOBS_GET_FOR_USER = 'browserJobs:getForUser';

/** Shape of a presence doc returned by workerPresence:getForUser. */
export interface WorkerPresenceDoc {
  _id: string;
  userId: string;
  orgId?: string;
  workerId?: string;
  /** Optional; a missing platform is treated as a generic worker. */
  platform?: string;
  lastSeenAt: number;
  updatedAt?: number;
}

/** Shape of a projected job returned by browserJobs:getForUser. */
export interface BrowserJobDoc {
  _id: string;
  type?: string;
  platform?: string;
  operation?: string;
  status: string;
  paused?: boolean;
  pausedReason?: string;
  queuePosition?: number;
  nextEligibleAt?: number;
  productId?: string | null;
  variantId?: string | null;
  listingId?: string | null;
  listingUrl?: string | null;
  attemptCount?: number;
  maxAttempts?: number;
  nextRetryAt?: number;
  deadLetteredAt?: number;
  updatedAt?: number;
}
