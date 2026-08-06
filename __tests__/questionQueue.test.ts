import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLookAlikeGroupDecisions } from '../src/lib/groupResolution.ts';
import {
  advanceAnswerStreak,
  selectHandoffCards,
} from '../src/lib/handoffStreak.ts';
import {
  bulkResolutionSummary,
  bulkResolutionNotice,
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
  assert.equal(
    bulkResolutionNotice(bulkResolutionSummary(results)),
    '1 saved · 2 need a look',
  );
});

test('group count and save notice use the same per-item bulk results', () => {
  const items = Array.from({ length: 19 }, (_, index) => syncItem(`group-${index}`, index + 1));
  const results = items.map((item, index) => index < 14
    ? { platformId: item.platformId, status: 'ok' as const, version: (item.version ?? 0) + 1 }
    : { platformId: item.platformId, status: 'error' as const, message: 'commit failed' });
  const summary = bulkResolutionSummary(results);
  const remaining = reconcileNeedsAttentionAfterBulk(items, results);

  assert.deepEqual(summary, { saved: 14, conflicts: 0, errors: 5 });
  assert.equal(items.length - remaining.length, summary.saved);
  assert.equal(remaining.length, 5);
  assert.equal(bulkResolutionNotice(summary), '14 saved · 5 need a look');
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

test('three same-answer group cards offer a handoff for the remaining reason class', () => {
  const cards = ['group-a', 'group-b', 'group-c', 'group-d'].map((groupId, groupIndex) => ({
    reason: 'look_alike_group',
    kind: 'look_alike_group',
    id: groupId,
    items: [
      { ...syncItem(`${groupId}-1`, groupIndex * 2 + 1), groupId },
      { ...syncItem(`${groupId}-2`, groupIndex * 2 + 2), groupId },
    ],
  }));
  let streak = null;
  for (const card of cards.slice(0, 3)) {
    streak = advanceAnswerStreak(streak, card, 'secondary', null, true);
  }

  const offer = selectHandoffCards(streak, cards.slice(3), () => true);
  assert.ok(offer);
  assert.equal(offer.reason, 'look_alike_group');
  assert.equal(offer.answer, 'secondary');
  const decisions = offer.cards.flatMap((card) => buildLookAlikeGroupDecisions(card.items, card.id, offer.answer));
  assert.deepEqual(offer.cards.flatMap((card) => card.items).map((item) => item.platformId), ['group-d-1', 'group-d-2']);
  assert.deepEqual(decisions.map((decision) => [decision.platformId, decision.version]), [
    ['group-d-1', 7],
    ['group-d-2', 8],
  ]);
  assert.ok(decisions.every((decision) => decision.platformId && decision.version !== 0));
});

test('a mixed group answer resets the reason-plus-answer streak and does not offer a handoff', () => {
  const cards = ['group-a', 'group-b', 'group-c', 'group-d'].map((id) => ({
    reason: 'look_alike_group',
    kind: 'look_alike_group',
    id,
  }));
  let streak = advanceAnswerStreak(null, cards[0], 'secondary', null, true);
  streak = advanceAnswerStreak(streak, cards[1], 'primary', null, true);
  streak = advanceAnswerStreak(streak, cards[2], 'secondary', null, true);

  assert.equal(streak?.count, 1);
  assert.equal(selectHandoffCards(streak, cards.slice(3), () => true), null);
});

test('a look-alike streak never includes bundle or other reason classes in its handoff', () => {
  const lookAlikeCards = ['a', 'b', 'c', 'd'].map((id) => ({
    id: `look:${id}`,
    reason: 'look_alike_group',
    kind: 'look_alike_group',
  }));
  const bundleCard = {
    id: 'bundle:set-1',
    reason: 'bundle',
    kind: 'bundle',
  };
  const conflictCard = {
    id: 'field:conflict-1',
    reason: 'field_conflict',
    kind: 'pair',
  };

  let streak = null;
  for (const card of lookAlikeCards.slice(0, 3)) {
    streak = advanceAnswerStreak(streak, card, 'secondary', null, true);
  }

  const offer = selectHandoffCards(
    streak,
    [bundleCard, conflictCard, lookAlikeCards[3]],
    () => true,
  );
  assert.ok(offer);
  assert.equal(offer.reason, 'look_alike_group');
  assert.deepEqual(offer.cards.map((card) => card.id), ['look:d']);
  assert.ok(offer.cards.every((card) => card.reason === 'look_alike_group'));
});

test('bundle cards can earn their own bundle-only handoff', () => {
  const cards = ['a', 'b', 'c', 'd'].map((id) => ({
    id: `bundle:${id}`,
    reason: 'bundle',
    kind: 'bundle',
  }));

  let streak = null;
  for (const card of cards.slice(0, 3)) {
    streak = advanceAnswerStreak(streak, card, 'primary', null, true);
  }

  const offer = selectHandoffCards(streak, cards.slice(3), () => true);
  assert.ok(offer);
  assert.equal(offer.reason, 'bundle');
  assert.equal(offer.answer, 'primary');
  assert.deepEqual(offer.cards.map((card) => card.id), ['bundle:d']);
});
