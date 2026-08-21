import { computerNeedsCheckCopy } from './computerPlatformCopy.ts';

/**
 * Keep this union aligned with sssync-bknd/convex/browserJobContract.ts.
 * The backend contract is the source of truth for these stable machine codes.
 */
export type BrowserJobCode =
  | 'TTL_EXPIRED'
  | 'AUTH_REQUIRED'
  | 'CAPTCHA'
  | 'PHANTOM_CREATE'
  | 'WORKER_LOST'
  | 'VELOCITY_PAUSED'
  | 'SIGNED_OUT'
  | 'FACEBOOK_CHECKPOINT'
  | 'AUTH_CHECKPOINT'
  | 'IDENTITY_PENDING'
  | 'EXECUTION_FAILED';

type BrowserJobCopy = string | ((platform?: string | null) => string);

export const BROWSER_JOB_COPY: Record<BrowserJobCode, BrowserJobCopy> = {
  TTL_EXPIRED: 'Posting window ended',
  AUTH_REQUIRED: 'Sign in on your computer',
  CAPTCHA: (platform) => computerNeedsCheckCopy(platform),
  PHANTOM_CREATE: "Couldn't confirm the post",
  WORKER_LOST: 'Computer connection lost',
  VELOCITY_PAUSED: 'Posting paused briefly',
  SIGNED_OUT: 'Sign in on your computer',
  FACEBOOK_CHECKPOINT: (platform) => computerNeedsCheckCopy(platform, true),
  AUTH_CHECKPOINT: (platform) => computerNeedsCheckCopy(platform, true),
  IDENTITY_PENDING: 'Confirming the post',
  EXECUTION_FAILED: "Couldn't post",
};

export const DEFAULT_BROWSER_JOB_COPY = 'Needs a check';

/** Return seller-safe copy without ever exposing an internal error message. */
export function getBrowserJobCopy(code: unknown, platform?: string | null): string {
  if (typeof code !== 'string') return DEFAULT_BROWSER_JOB_COPY;
  const copy = BROWSER_JOB_COPY[code as BrowserJobCode];
  return typeof copy === 'function' ? copy(platform) : copy ?? DEFAULT_BROWSER_JOB_COPY;
}
