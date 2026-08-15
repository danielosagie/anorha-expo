import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectionImportPresentationsById,
  listSellingPlatformConnections,
} from '../src/lib/connectionImportPresentation.ts';
import { PLATFORM_TYPES } from '../src/lib/platforms.ts';

const rows = [
  { Id: 'shopify-live', PlatformType: 'shopify', Status: 'active', IsEnabled: true },
  { Id: 'csv-old', PlatformType: 'csv', Status: 'inactive', IsEnabled: false },
  { Id: 'csv-new', PlatformType: 'csv_import', Status: 'active', IsEnabled: true },
  { Id: 'ebay-importing', PlatformType: 'ebay', Status: 'pending', IsEnabled: false },
  { Id: 'square-disconnected', PlatformType: 'square', Status: 'disconnected', IsEnabled: false },
  { Id: 'square-inactive', PlatformType: 'square', Status: 'inactive', IsEnabled: false },
  { Id: 'clover-revoked', PlatformType: 'clover', Status: 'revoked', IsEnabled: true },
  { Id: 'facebook-reauth', PlatformType: 'facebook', Status: 'active', IsEnabled: true, NeedsReauth: true },
  { Id: 'shopify-review', PlatformType: 'shopify', Status: 'review', IsEnabled: true },
] as const;

test('selling-platform list filters csv and disconnected rows but keeps repairable rows', () => {
  const listed = listSellingPlatformConnections(rows);

  assert.deepEqual(listed.map((row) => row.Id), [
    'shopify-live',
    'ebay-importing',
    'clover-revoked',
    'facebook-reauth',
    'shopify-review',
  ]);
});

test('review connections stay visible for repair', () => {
  const listed = listSellingPlatformConnections(rows);

  assert.equal(listed.some((row) => row.Id === 'shopify-review'), true);
});

test('a stale active run cannot put a disconnected row back in the list', () => {
  const presentationByConnectionId = connectionImportPresentationsById({
    connections: rows,
    recentImports: [{
      connectionId: 'square-disconnected',
      status: 'in_progress',
      createdAt: '2026-08-13T12:00:00.000Z',
      completedAt: null,
    }],
  });
  const listed = listSellingPlatformConnections(rows);

  assert.equal(presentationByConnectionId.get('square-disconnected')?.kind, 'disconnected');
  assert.equal(listed.some((row) => row.Id === 'square-disconnected'), false);
});

test('inactive and disconnected connections both produce no rendered row', () => {
  const listed = listSellingPlatformConnections(rows);

  assert.equal(listed.some((row) => row.Id === 'square-inactive'), false);
  assert.equal(listed.some((row) => row.Id === 'square-disconnected'), false);
});

test('the platform registry excludes Slack and Gmail', () => {
  const registry = new Set<string>(PLATFORM_TYPES);

  assert.equal(registry.has('slack'), false);
  assert.equal(registry.has('gmail'), false);
});
