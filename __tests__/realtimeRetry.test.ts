import assert from 'node:assert/strict';
import test from 'node:test';

import {
  nextRealtimeRetry,
  PLATFORM_CONNECTION_REALTIME_MAX_RETRIES,
  realtimeRetryDelayMs,
} from '../src/lib/realtimeRetry.ts';

test('realtime retries use capped exponential backoff', () => {
  assert.equal(PLATFORM_CONNECTION_REALTIME_MAX_RETRIES, 3);
  assert.deepEqual(nextRealtimeRetry(0), { terminal: false, attempt: 1, delayMs: 1000 });
  assert.deepEqual(nextRealtimeRetry(1), { terminal: false, attempt: 2, delayMs: 2000 });
  assert.deepEqual(nextRealtimeRetry(2), { terminal: false, attempt: 3, delayMs: 4000 });
  assert.deepEqual(nextRealtimeRetry(3), { terminal: true });
  assert.equal(realtimeRetryDelayMs(10), 10_000);
});
