import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProductBulkArchiveActions,
  getProductBulkActionFailures,
} from '../src/lib/productBulkActions.ts';

test('bulk delete preserves the mobile soft-archive action contract', () => {
  assert.deepEqual(buildProductBulkArchiveActions(['v1', 'v2'], 'delete'), [
    { itemId: 'v1', actionType: 'delete', changes: [] },
    { itemId: 'v2', actionType: 'delete', changes: [] },
  ]);
});

test('bulk action receipts expose rejected and missing items as failures', () => {
  assert.deepEqual(getProductBulkActionFailures(['v1', 'v2', 'v3'], {
    status: 'completed',
    total: 3,
    successful: 1,
    failed: 2,
    results: [
      { itemId: 'v1', success: true },
      { itemId: 'v2', success: false, error: 'Access denied' },
    ],
  }), [
    { itemId: 'v2', success: false, error: 'Access denied' },
    {
      itemId: 'v3',
      success: false,
      error: 'Server did not return a successful receipt for this item',
    },
  ]);
});
