import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSER_JOB_COPY,
  DEFAULT_BROWSER_JOB_COPY,
  getBrowserJobCopy,
} from '../src/lib/browserJobCodes.ts';

test('browser job codes resolve to seller-safe copy with one generic fallback', () => {
  assert.deepEqual(BROWSER_JOB_COPY, {
    TTL_EXPIRED: 'Posting window ended',
    AUTH_REQUIRED: 'Sign in on your computer',
    CAPTCHA: 'Facebook needs a check',
    PHANTOM_CREATE: "Couldn't confirm the post",
    WORKER_LOST: 'Computer connection lost',
    VELOCITY_PAUSED: 'Posting paused briefly',
    SIGNED_OUT: 'Sign in on your computer',
    FACEBOOK_CHECKPOINT: 'Facebook needs a check on your computer',
    EXECUTION_FAILED: "Couldn't post",
  });
  assert.equal(getBrowserJobCopy(undefined), DEFAULT_BROWSER_JOB_COPY);
  assert.equal(getBrowserJobCopy('UNRECOGNIZED_INTERNAL_DETAIL'), DEFAULT_BROWSER_JOB_COPY);
});
