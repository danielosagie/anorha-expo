import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parsePlatformConnectionsCache,
  platformConnectionsCacheKey,
  serializePlatformConnectionsCache,
} from '../src/lib/platformConnectionsCache.ts';

const row = {
  Id: 'connection-1',
  UserId: 'internal-user',
  PlatformType: 'shopify',
  DisplayName: 'shop',
  Status: 'active',
  IsEnabled: true,
  CreatedAt: '2026-01-01T00:00:00.000Z',
  UpdatedAt: '2026-01-01T00:00:00.000Z',
};

test('connection cache hydrates only for its Clerk owner', () => {
  const raw = serializePlatformConnectionsCache('owner-a', [row], 123);
  assert.deepEqual(parsePlatformConnectionsCache(raw, 'owner-a'), [row]);
  assert.equal(parsePlatformConnectionsCache(raw, 'owner-b'), null);
});

test('connection cache storage is partitioned by owner', () => {
  assert.notEqual(platformConnectionsCacheKey('owner-a'), platformConnectionsCacheKey('owner-b'));
});

test('connection cache rejects malformed payloads', () => {
  assert.equal(parsePlatformConnectionsCache('{broken', 'owner-a'), null);
  assert.equal(parsePlatformConnectionsCache(JSON.stringify({ ownerId: 'owner-a' }), 'owner-a'), null);
});
