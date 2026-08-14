import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectionImportPresentationsById,
  partitionSellingPlatformConnections,
} from '../src/lib/connectionImportPresentation.ts';

const rows = [
  { Id: 'shopify-live', PlatformType: 'shopify', Status: 'active', IsEnabled: true },
  { Id: 'csv-old', PlatformType: 'csv', Status: 'inactive', IsEnabled: false },
  { Id: 'csv-new', PlatformType: 'csv_import', Status: 'active', IsEnabled: true },
  { Id: 'ebay-importing', PlatformType: 'ebay', Status: 'pending', IsEnabled: false },
  { Id: 'square-disconnected', PlatformType: 'square', Status: 'disconnected', IsEnabled: false },
  { Id: 'clover-revoked', PlatformType: 'clover', Status: 'revoked', IsEnabled: true },
  { Id: 'facebook-reauth', PlatformType: 'facebook', Status: 'active', IsEnabled: true, NeedsReauth: true },
] as const;

test('selling-platform partition filters csv, keeps live/importing, and groups inactive rows', () => {
  const presentationByConnectionId = connectionImportPresentationsById({ connections: rows });
  const partition = partitionSellingPlatformConnections(rows, presentationByConnectionId);

  assert.deepEqual(partition.active.map((row) => row.Id), ['shopify-live', 'ebay-importing']);
  assert.deepEqual(partition.inactive.map((row) => row.Id), [
    'square-disconnected',
    'clover-revoked',
    'facebook-reauth',
  ]);
});

test('an active run keeps a stale disconnected row in the main group', () => {
  const presentationByConnectionId = connectionImportPresentationsById({
    connections: rows,
    recentImports: [{
      connectionId: 'square-disconnected',
      status: 'in_progress',
      createdAt: '2026-08-13T12:00:00.000Z',
      completedAt: null,
    }],
  });
  const partition = partitionSellingPlatformConnections(rows, presentationByConnectionId);

  assert.equal(partition.active.some((row) => row.Id === 'square-disconnected'), true);
  assert.equal(partition.inactive.some((row) => row.Id === 'square-disconnected'), false);
});
