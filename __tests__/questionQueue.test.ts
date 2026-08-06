import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLookAlikeGroupDecisions } from '../src/lib/groupResolution.ts';
import {
  bulkResolutionSummary,
  chunkBulkResolveItems,
  reconcileNeedsAttentionAfterBulk,
  partitionSendableBulkItems,
} from '../src/lib/bulkResolution.ts';
import type { BulkResolveItem, SyncItem } from '../src/types/syncItem.ts';

function syncItem(platformId: string, version: number): SyncItem {
  return {
    platformId,
    sku: null,
    barcode: null,
    title: platformId,
    price: null,
    imageUrl: null,
    parentId: null,
    direction: 'pull',
    version,
    groupId: 'look-alikes-1',
    attention: 'look_alike_group',
    resolution: { kind: 'create' },
  };
}

test('group keep-separate payload uses member ids, create, and each current version', () => {
  const members = [syncItem('member-a', 7), syncItem('member-b', 19)];
  assert.deepEqual(buildLookAlikeGroupDecisions(
    members,
    'look_alike_group:look-alikes-1',
    'secondary',
  ), [
    {
      platformId: 'member-a',
      choice: 'create',
      canonicalId: undefined,
      valueOverride: { groupMode: 'separate', groupId: 'look-alikes-1' },
      version: 7,
      outcome: 'added',
    },
    {
      platformId: 'member-b',
      choice: 'create',
      canonicalId: undefined,
      valueOverride: { groupMode: 'separate', groupId: 'look-alikes-1' },
      version: 19,
      outcome: 'added',
    },
  ]);
});

test('a conflict stays in the queue with its refreshed version and is not saved', () => {
  const items = [syncItem('saved', 2), syncItem('conflict', 3), syncItem('error', 4)];
  const results = [
    { platformId: 'saved', status: 'ok' as const, version: 3 },
    { platformId: 'conflict', status: 'conflict' as const, version: 9 },
    { platformId: 'error', status: 'error' as const, message: 'failed' },
  ];

  const remaining = reconcileNeedsAttentionAfterBulk(items, results);
  assert.deepEqual(remaining.map((item) => [item.platformId, item.version]), [
    ['conflict', 9],
    ['error', 4],
  ]);
  assert.deepEqual(bulkResolutionSummary(results), { saved: 1, conflicts: 1, errors: 1 });
});

test('already-resolved items are settled and removed from the queue', () => {
  const items = [syncItem('settled', 5)];
  const results = [{ platformId: 'settled', status: 'alreadyResolved' as const, version: 6 }];
  assert.deepEqual(reconcileNeedsAttentionAfterBulk(items, results), []);
  assert.deepEqual(bulkResolutionSummary(results), { saved: 1, conflicts: 0, errors: 0 });
});

test('bulk requests are chunked at the 500-item endpoint limit', () => {
  const items: BulkResolveItem[] = Array.from({ length: 501 }, (_, index) => ({
    platformId: `member-${index}`,
    choice: 'create',
    version: index + 1,
  }));
  assert.deepEqual(chunkBulkResolveItems(items).map((chunk) => chunk.length), [500, 1]);
});

test('an item with no CAS token is never sent as a fabricated version 0', () => {
  const withVersion = { platformId: 'a', choice: 'create' as const, version: 3 };
  const without = { platformId: 'b', choice: 'create' as const };
  const { sendable, unsendable } = partitionSendableBulkItems([withVersion, without]);
  assert.deepEqual(sendable.map((i) => i.platformId), ['a']);
  assert.deepEqual(unsendable.map((i) => i.platformId), ['b']);
  // SyncItems.Version is NOT NULL DEFAULT 1, so a 0 could never match CAS.
  assert.ok(!sendable.some((i) => i.version === 0));
});
