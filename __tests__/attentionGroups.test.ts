// Pure-helper tests for the SyncInbox "grouped issues" layer. Runnable with
// Node's native TS type-stripping (Node >= 22.18):
//   node --test __tests__/attentionGroups.test.ts
// This directory is excluded from tsconfig, so these tests never gate `tsc`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupItems, itemsForGroup, reasonKeyOf, REASON_LABELS } from '../src/components/import/attentionGroups.ts';
import type { SyncItem, AttentionReason } from '../src/types/syncItem.ts';

// Minimal SyncItem factory — only the fields the grouping helpers read matter.
function item(platformId: string, attention?: AttentionReason): SyncItem {
  return {
    platformId,
    sku: null,
    barcode: null,
    title: platformId,
    price: null,
    imageUrl: null,
    parentId: null,
    direction: 'pull',
    resolution: { kind: 'create' },
    attention,
  };
}

test('reasonKeyOf falls back to "other" when there is no attention reason', () => {
  assert.equal(reasonKeyOf(item('a')), 'other');
  assert.equal(reasonKeyOf(item('b', 'weak_match')), 'weak_match');
});

test('groupItems buckets by reason and drops empty buckets', () => {
  const groups = groupItems([
    item('a', 'weak_match'),
    item('b', 'weak_match'),
    item('c', 'bundle'),
    item('d'), // → other
  ]);
  const byKey = Object.fromEntries(groups.map((g) => [g.key, g.items.length]));
  assert.deepEqual(byKey, { weak_match: 2, bundle: 1, other: 1 });
  // No empty buckets for reasons that never appeared.
  assert.equal(groups.find((g) => g.key === 'duplicate_target'), undefined);
});

test('groupItems orders by count desc with a stable tiebreak', () => {
  const groups = groupItems([
    item('a', 'bundle'),
    item('b', 'weak_match'),
    item('c', 'weak_match'),
    item('d', 'multiple_candidates'),
    item('e', 'multiple_candidates'),
  ]);
  // weak_match(2) and multiple_candidates(2) tie on count; multiple_candidates
  // wins the tiebreak (earlier in TIE_ORDER); bundle(1) sinks last.
  assert.deepEqual(
    groups.map((g) => g.key),
    ['multiple_candidates', 'weak_match', 'bundle'],
  );
});

test('groupItems labels each group from REASON_LABELS', () => {
  const [g] = groupItems([item('a', 'look_alike_group')]);
  assert.equal(g.label, REASON_LABELS.look_alike_group);
  assert.equal(g.label, 'Look-alikes');
});

test('itemsForGroup returns exactly one bucket, including "other"', () => {
  const items = [item('a', 'stale_link'), item('b'), item('c', 'stale_link')];
  assert.deepEqual(
    itemsForGroup(items, 'stale_link').map((i) => i.platformId),
    ['a', 'c'],
  );
  assert.deepEqual(
    itemsForGroup(items, 'other').map((i) => i.platformId),
    ['b'],
  );
});

test('groupItems on an empty queue yields no groups', () => {
  assert.deepEqual(groupItems([]), []);
});
