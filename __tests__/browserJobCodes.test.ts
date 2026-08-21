import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSER_JOB_COPY,
  DEFAULT_BROWSER_JOB_COPY,
  getBrowserJobCopy,
} from '../src/lib/browserJobCodes.ts';

test('browser job codes resolve to seller-safe copy with one generic fallback', () => {
  assert.deepEqual(Object.keys(BROWSER_JOB_COPY), [
    'TTL_EXPIRED',
    'AUTH_REQUIRED',
    'CAPTCHA',
    'PHANTOM_CREATE',
    'WORKER_LOST',
    'VELOCITY_PAUSED',
    'SIGNED_OUT',
    'FACEBOOK_CHECKPOINT',
      'AUTH_CHECKPOINT',
      'IDENTITY_PENDING',
    'EXECUTION_FAILED',
  ]);
  assert.equal(getBrowserJobCopy('CAPTCHA', 'facebook'), 'Facebook needs a check');
  assert.equal(
    getBrowserJobCopy('FACEBOOK_CHECKPOINT', 'facebook'),
    'Facebook needs a check on your computer',
  );
  assert.equal(getBrowserJobCopy(undefined), DEFAULT_BROWSER_JOB_COPY);
  assert.equal(getBrowserJobCopy('UNRECOGNIZED_INTERNAL_DETAIL'), DEFAULT_BROWSER_JOB_COPY);
});
