import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyPlatformOverrideResponse,
  readPlatformOverrideReason,
} from '../src/lib/platformOverrideOutcome.ts';

// The three shapes the backend actually returns since Assurance Rewrite 3
// (products-platform-options.controller.ts). Kept verbatim so a contract change
// upstream fails here instead of silently changing what the seller is told.

const CONFIRMED_200 = {
  success: true,
  overrides: { title: 'eBay title', description: null, price: 42 },
  pushed: true,
  syncStatus: 'Success',
};

const PENDING_202 = {
  success: false,
  overrides: { title: 'eBay title', description: null, price: 42 },
  pushed: false,
  syncStatus: 'Pending',
  error: 'Push is pending worker confirmation.',
};

const PUSH_FAILED_502 = {
  message: 'Platform override was stored, but the platform push failed.',
  reason: 'eBay rejected the listing revision: Item condition is required.',
  overrides: { title: 'eBay title', description: null, price: 42 },
  syncStatus: 'Error',
};

const NOT_SAVED_400 = {
  statusCode: 400,
  message: 'overrides must include at least one of: title, description, price.',
  error: 'Bad Request',
};

const NOT_SAVED_404 = {
  statusCode: 404,
  message: 'No ebay listing is mapped for variant v1 on connection c1.',
  error: 'Not Found',
};

test('200 with a confirmed push is the only confirmed outcome', () => {
  assert.equal(classifyPlatformOverrideResponse(200, CONFIRMED_200), 'confirmed');
});

test('202 is pending, and its success:false never reads as not saved', () => {
  assert.equal(classifyPlatformOverrideResponse(202, PENDING_202), 'pending');
  // The trap: 202 carries success:false to mean "not yet confirmed".
  assert.equal(PENDING_202.success, false);
});

test('502 means the override is stored and only the push failed', () => {
  assert.equal(classifyPlatformOverrideResponse(502, PUSH_FAILED_502), 'push_failed');
});

test('a non-2xx rejected before the write is not saved', () => {
  assert.equal(classifyPlatformOverrideResponse(400, NOT_SAVED_400), 'not_saved');
  assert.equal(classifyPlatformOverrideResponse(404, NOT_SAVED_404), 'not_saved');
  assert.equal(classifyPlatformOverrideResponse(403, null), 'not_saved');
});

test('only not_saved requires the edit to be retried', () => {
  const stored = (status: number, body: any) =>
    classifyPlatformOverrideResponse(status, body) !== 'not_saved';

  assert.equal(stored(200, CONFIRMED_200), true);
  assert.equal(stored(202, PENDING_202), true);
  assert.equal(stored(502, PUSH_FAILED_502), true);
  assert.equal(stored(400, NOT_SAVED_400), false);
});

test('a pre-Rewrite-3 backend answering 200 with pushed:false is not called confirmed', () => {
  const legacy = { success: true, overrides: {}, pushed: false, error: 'Push failed' };
  assert.equal(classifyPlatformOverrideResponse(200, legacy), 'push_failed');
});

test('an unparseable body on a 2xx is still confirmed, and on a non-2xx is not saved', () => {
  assert.equal(classifyPlatformOverrideResponse(200, null), 'confirmed');
  assert.equal(classifyPlatformOverrideResponse(502, null), 'not_saved');
});

test('a non-2xx echoing overrides is stored even without a reason', () => {
  assert.equal(
    classifyPlatformOverrideResponse(502, { overrides: { title: 'x' } } as any),
    'push_failed',
  );
});

test('the 502 platform reason wins over its generic message', () => {
  assert.equal(
    readPlatformOverrideReason(PUSH_FAILED_502 as any),
    'eBay rejected the listing revision: Item condition is required.',
  );
});

test('the 202 pending reason comes from error, which is the only text it carries', () => {
  assert.equal(
    readPlatformOverrideReason(PENDING_202 as any),
    'Push is pending worker confirmation.',
  );
});

test('a rejection reports its specific message, not the generic status name', () => {
  assert.equal(
    readPlatformOverrideReason(NOT_SAVED_400 as any),
    'overrides must include at least one of: title, description, price.',
  );
  assert.notEqual(readPlatformOverrideReason(NOT_SAVED_400 as any), 'Bad Request');
});

test('an array validation message is joined, and empty text yields null', () => {
  assert.equal(
    readPlatformOverrideReason({ message: ['title too long', 'price must be positive'] } as any),
    'title too long; price must be positive',
  );
  assert.equal(readPlatformOverrideReason({ reason: '   ', error: '' } as any), null);
  assert.equal(readPlatformOverrideReason(null), null);
});
