import assert from 'node:assert/strict';
import test from 'node:test';

import { decideTopUpPoll } from '../src/lib/topUpPolling.ts';

test('confirms when RW10 top-up remaining increases', () => {
  assert.equal(
    decideTopUpPoll(
      { ai_topup_remaining_cents: 500, last_topup_at: '2026-08-19T12:00:00.000Z' },
      { ai_topup_remaining_cents: 3000, last_topup_at: '2026-08-19T12:00:00.000Z' },
    ),
    'confirmed',
  );
});

test('confirms when the fulfillment timestamp advances even if credits were used concurrently', () => {
  assert.equal(
    decideTopUpPoll(
      { ai_topup_remaining_cents: 500, last_topup_at: '2026-08-19T12:00:00.000Z' },
      { ai_topup_remaining_cents: 450, last_topup_at: '2026-08-19T12:01:00.000Z' },
    ),
    'confirmed',
  );
});

test('keeps polling while RW10 fields are present but unchanged', () => {
  assert.equal(
    decideTopUpPoll(
      { ai_topup_remaining_cents: 500, last_topup_at: '2026-08-19T12:00:00.000Z' },
      { ai_topup_remaining_cents: 500, last_topup_at: '2026-08-19T12:00:00.000Z' },
    ),
    'pending',
  );
});

test('uses ai_credits_cents when an old backend lacks all RW10 fields', () => {
  assert.equal(
    decideTopUpPoll({ ai_credits_cents: 2000 }, { ai_credits_cents: 4500 }),
    'confirmed',
  );
  assert.equal(
    decideTopUpPoll({ ai_credits_cents: 2000 }, { ai_credits_cents: 2000 }),
    'pending',
  );
});

test('fails closed for missing snapshots or summaries without a comparable balance', () => {
  assert.equal(decideTopUpPoll(null, { ai_credits_cents: 2500 }), 'failed');
  assert.equal(decideTopUpPoll({ ai_credits_cents: 2000 }, null), 'failed');
  assert.equal(decideTopUpPoll({}, {}), 'failed');
});

test('accepts numeric strings and a newly available RW10 balance', () => {
  assert.equal(
    decideTopUpPoll(
      { ai_credits_cents: '2000' },
      { ai_topup_remaining_cents: '2500', last_topup_at: '2026-08-19T12:01:00.000Z' },
    ),
    'confirmed',
  );
});
