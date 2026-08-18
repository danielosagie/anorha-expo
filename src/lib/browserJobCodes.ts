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
  | 'EXECUTION_FAILED';

export const BROWSER_JOB_COPY: Record<BrowserJobCode, string> = {
  TTL_EXPIRED: 'Posting window ended',
  AUTH_REQUIRED: 'Sign in on your computer',
  CAPTCHA: 'Facebook needs a check',
  PHANTOM_CREATE: "Couldn't confirm the post",
  WORKER_LOST: 'Computer connection lost',
  VELOCITY_PAUSED: 'Posting paused briefly',
  SIGNED_OUT: 'Sign in on your computer',
  FACEBOOK_CHECKPOINT: 'Facebook needs a check on your computer',
  EXECUTION_FAILED: "Couldn't post",
};

export const DEFAULT_BROWSER_JOB_COPY = 'Needs a check';

/** Return seller-safe copy without ever exposing an internal error message. */
export function getBrowserJobCopy(code: unknown): string {
  if (typeof code !== 'string') return DEFAULT_BROWSER_JOB_COPY;
  return BROWSER_JOB_COPY[code as BrowserJobCode] ?? DEFAULT_BROWSER_JOB_COPY;
}
