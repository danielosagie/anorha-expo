import test from 'node:test';
import assert from 'node:assert/strict';
import { findResumableCsvImports } from '../src/lib/resumableImports.ts';

test('unresolved CSV work exposes its pending count and latest import id', () => {
  const resumable = findResumableCsvImports({
    connections: [{
      connectionId: 'csv-1',
      platformName: 'CSV',
      platformType: 'csv',
      state: 'needs-attention',
      needsAttention: 492,
    }],
    recentImports: [{
      importId: 'import-1',
      connectionId: 'csv-1',
      source: 'csv_upload',
      status: 'in_progress',
      itemsTotal: 500,
      itemsCommitted: 8,
      itemsFailed: 0,
      createdAt: '2026-08-06T13:17:00.000Z',
      completedAt: null,
    }],
  });

  assert.deepEqual(resumable, [{
    connectionId: 'csv-1',
    importId: 'import-1',
    pendingItems: 492,
    status: 'in_progress',
  }]);
});

test('finished import count includes only rows the reopened queue can show', () => {
  const resumable = findResumableCsvImports({
    connections: [{
      connectionId: 'csv-1',
      platformName: 'CSV',
      platformType: 'csv',
      state: 'needs-attention',
      needsAttention: 5,
    }],
    recentImports: [{
      importId: 'import-1',
      connectionId: 'csv-1',
      source: 'csv_upload',
      status: 'failed',
      itemsTotal: 500,
      itemsCommitted: 469,
      itemsFailed: 5,
      createdAt: '2026-08-06T13:17:00.000Z',
      completedAt: '2026-08-06T13:40:00.000Z',
    }],
  });

  assert.equal(resumable[0]?.pendingItems, 5);
});
