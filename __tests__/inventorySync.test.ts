import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildInventoryQuantityUpdate,
  mergeInventoryLevelsByNewest,
  stripInventoryFromPlatformData,
} from '../src/lib/inventorySync.ts';

test('mergeInventoryLevelsByNewest selects the newest version of each row', () => {
  const legend = {
    sharedNewer: { Id: 'sharedNewer', Quantity: 8, UpdatedAt: '2026-08-14T12:00:00.000Z' },
    sharedOlder: { Id: 'sharedOlder', Quantity: 2, UpdatedAt: '2026-08-14T10:00:00.000Z' },
    tied: { Id: 'tied', Quantity: 7, UpdatedAt: '2026-08-14T11:00:00.000Z' },
    legendOnly: { Id: 'legendOnly', Quantity: 4, UpdatedAt: '2026-08-14T09:00:00.000Z' },
  };
  const direct = {
    sharedNewer: { Id: 'sharedNewer', Quantity: 1, UpdatedAt: '2026-08-14T11:00:00.000Z' },
    sharedOlder: { Id: 'sharedOlder', Quantity: 9, UpdatedAt: '2026-08-14T13:00:00.000Z' },
    tied: { Id: 'tied', Quantity: 3, UpdatedAt: '2026-08-14T11:00:00.000Z' },
    directOnly: { Id: 'directOnly', Quantity: 6, UpdatedAt: '2026-08-14T09:30:00.000Z' },
  };

  const merged = mergeInventoryLevelsByNewest(legend, direct);

  assert.equal(merged.sharedNewer.Quantity, 8);
  assert.equal(merged.sharedOlder.Quantity, 9);
  assert.equal(merged.tied.Quantity, 7);
  assert.equal(merged.legendOnly.Quantity, 4);
  assert.equal(merged.directOnly.Quantity, 6);
});

test('mergeInventoryLevelsByNewest deterministically prefers Legend when timestamps tie or cannot be parsed', () => {
  const merged = mergeInventoryLevelsByNewest(
    {
      tied: { Quantity: 7, UpdatedAt: '2026-08-14T11:00:00.000Z' },
      missing: { Quantity: 8 },
      invalid: { Quantity: 9, UpdatedAt: 'not-a-date' },
    },
    {
      tied: { Quantity: 1, UpdatedAt: '2026-08-14T11:00:00.000Z' },
      missing: { Quantity: 2, UpdatedAt: null },
      invalid: { Quantity: 3, UpdatedAt: 'also-not-a-date' },
    },
  );

  assert.equal(merged.tied.Quantity, 7);
  assert.equal(merged.missing.Quantity, 8);
  assert.equal(merged.invalid.Quantity, 9);
});

test('stripInventoryFromPlatformData keeps mixed product edits while removing generic inventory writes', () => {
  const source = {
    shopify: {
      title: 'Updated title',
      locationQuantities: { location1: 4 },
      variants: [{
        id: 'variant1',
        price: 12,
        inventoryByLocation: { location1: { quantity: 4 } },
      }],
    },
  };

  assert.deepEqual(stripInventoryFromPlatformData(source), {
    shopify: {
      title: 'Updated title',
      variants: [{ id: 'variant1', price: 12 }],
    },
  });
  assert.deepEqual(source.shopify.locationQuantities, { location1: 4 });
  assert.deepEqual(source.shopify.variants[0].inventoryByLocation, { location1: { quantity: 4 } });
});

test('buildInventoryQuantityUpdate resolves base inventory to the canonical variant and raw location', () => {
  assert.deepEqual(
    buildInventoryQuantityUpdate({
      editorVariantId: '_base',
      canonicalVariantId: 'variant-canonical',
      activeTab: 'all',
      platformVariants: [],
      location: {
        id: 'square:connection-1:ui-location',
        locationId: 'platform-location-9',
        connectionId: 'connection-1',
      },
      quantity: 12,
    }),
    {
      variantId: 'variant-canonical',
      platformConnectionId: 'connection-1',
      platformLocationId: 'platform-location-9',
      quantity: 12,
    },
  );
});

test('buildInventoryQuantityUpdate resolves an all-tab option key to the stored variant ID', () => {
  assert.deepEqual(
    buildInventoryQuantityUpdate({
      editorVariantId: 'Color:Blue/Size:M',
      canonicalVariantId: 'unused-base',
      activeTab: 'all',
      platformVariants: [
        { id: 'variant-blue-medium', optionValues: { Size: 'M', Color: 'Blue' } },
      ],
      location: {
        id: 'ebay:connection-2:warehouse',
        locationId: 'warehouse',
        connectionId: 'connection-2',
      },
      quantity: 5,
    }),
    {
      variantId: 'variant-blue-medium',
      platformConnectionId: 'connection-2',
      platformLocationId: 'warehouse',
      quantity: 5,
    },
  );
});

test('buildInventoryQuantityUpdate refuses a target without a real connection', () => {
  assert.equal(
    buildInventoryQuantityUpdate({
      editorVariantId: '_base',
      canonicalVariantId: 'variant-canonical',
      activeTab: 'square',
      platformVariants: [],
      location: { id: 'default' },
      quantity: 1,
    }),
    null,
  );
});

test('buildInventoryQuantityUpdate refuses an editor-only location id', () => {
  assert.equal(
    buildInventoryQuantityUpdate({
      editorVariantId: '_base',
      canonicalVariantId: 'variant-canonical',
      activeTab: 'square',
      platformVariants: [],
      location: { id: 'square::connection-1::virtual-default', connectionId: 'connection-1' },
      quantity: 1,
    }),
    null,
  );
});
