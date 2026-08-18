import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_SHELF_STATUS_FILTER,
  executeShelfFallback,
  shelfItemMatchesStatus,
  type ShelfLoadSnapshot,
} from '../src/lib/shelfLoadPolicy.ts';

const emptyCompletedSync: ShelfLoadSnapshot = {
  legendCount: 0,
  directCount: 0,
  syncPhase: 'complete',
  orgHasDataSignal: true,
  fallbackAttempted: false,
  fallbackFailed: false,
};

test('sync-empty with an org data signal triggers exactly one direct fetch per load cycle', async () => {
  let fetchCount = 0;
  const fetchDirect = async () => {
    fetchCount += 1;
    return [{ Id: 'variant-1' }];
  };

  const first = await executeShelfFallback(emptyCompletedSync, fetchDirect);
  assert.equal(first.attempted, true);
  assert.equal(first.action, 'serve-direct');
  assert.equal(first.rows?.length, 1);

  const second = await executeShelfFallback({
    ...emptyCompletedSync,
    directCount: first.rows?.length ?? 0,
    fallbackAttempted: true,
  }, fetchDirect);
  assert.equal(second.attempted, false);
  assert.equal(second.action, 'serve-direct');
  assert.equal(fetchCount, 1);
});

test('fallback failure surfaces shelfLoadError instead of an empty catalog', async () => {
  const failure = await executeShelfFallback(emptyCompletedSync, async () => {
    throw new Error('network unavailable');
  });

  assert.equal(failure.action, 'show-error');
  assert.equal(failure.shelfLoadError, true);
  assert.equal(failure.rows, null);
});

test('populated Legend sync never triggers a direct fetch', async () => {
  let fetchCount = 0;
  const result = await executeShelfFallback({
    ...emptyCompletedSync,
    legendCount: 8,
  }, async () => {
    fetchCount += 1;
    return [];
  });

  assert.equal(result.action, 'serve-legend');
  assert.equal(result.attempted, false);
  assert.equal(fetchCount, 0);
});

test('the default shelf includes unpublished API-created items', () => {
  assert.equal(DEFAULT_SHELF_STATUS_FILTER, 'all');
  assert.equal(shelfItemMatchesStatus(DEFAULT_SHELF_STATUS_FILTER, false, false), true);
  assert.equal(shelfItemMatchesStatus('active', false, false), false);
});
