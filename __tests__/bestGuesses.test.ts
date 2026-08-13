import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import type { AttentionReason, CanonicalRef, SyncItem } from '../src/types/syncItem.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (typeof specifier === 'string' && specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const {
  advanceHandoffStreak,
  buildHandoffOffer,
  buildV7QuestionCards,
  buildV7ReviewSections,
  conflictSourceOfTruth,
  deriveV7AttentionCounts,
  fieldConflictDecision,
  remainingItemCount,
  V7_REVIEW_SECTION_ACTIONS,
  V7_REVIEW_SECTION_LABELS,
} = await import('../src/components/import/questionQueue.ts');

function candidate(id: string): CanonicalRef {
  return { id, sku: null, title: `Catalog ${id}` };
}

function syncItem(
  platformId: string,
  attention: AttentionReason,
  overrides: Partial<SyncItem> = {},
): SyncItem {
  return {
    platformId,
    sku: null,
    barcode: null,
    title: platformId,
    price: null,
    imageUrl: null,
    parentId: null,
    direction: 'pull',
    version: 4,
    attention,
    resolution: { kind: 'create' },
    ...overrides,
  };
}

test('V7 queue emits a pair for a weak match', () => {
  const cards = buildV7QuestionCards([
    syncItem('pair-1', 'weak_match', { candidates: [candidate('cat-1')] }),
  ]);
  assert.deepEqual(cards.map((card) => card.kind), ['pair']);
});

test('V7 queue emits which-one for multiple candidates', () => {
  const cards = buildV7QuestionCards([
    syncItem('which-1', 'multiple_candidates', {
      candidates: [candidate('cat-1'), candidate('cat-2')],
    }),
  ]);
  assert.deepEqual(cards.map((card) => card.kind), ['which_one']);
});

test('field conflicts and failed commits never enter the V7 question payload', () => {
  const cards = buildV7QuestionCards([
    syncItem('field-1', 'field_conflict', { candidates: [candidate('cat-1')] }),
    syncItem('failed-1', 'commit_failed'),
  ]);
  assert.deepEqual(cards, []);
});

test('badge derivation excludes field conflicts and equals the V7 card item count', () => {
  const payload = [
    syncItem('field-1', 'field_conflict', { candidates: [candidate('cat-1')] }),
    syncItem('pair-1', 'weak_match', { candidates: [candidate('cat-2')] }),
    syncItem('which-1', 'multiple_candidates', {
      candidates: [candidate('cat-3'), candidate('cat-4')],
    }),
    syncItem('failed-1', 'commit_failed'),
  ];
  const cards = buildV7QuestionCards(payload);
  const cardItemCount = remainingItemCount(cards);
  const attention = deriveV7AttentionCounts([
    { connectionId: 'square', platformName: 'Square', items: payload },
    {
      connectionId: 'ebay',
      platformName: 'eBay',
      items: [syncItem('field-only', 'field_conflict', { candidates: [candidate('cat-5')] })],
    },
  ]);

  assert.equal(cardItemCount, 2);
  assert.equal(attention.count, cards.length);
  assert.equal(attention.count, cardItemCount);
  assert.deepEqual(attention.byConnection, [
    { connectionId: 'square', platformName: 'Square', count: cardItemCount },
  ]);
});

test('legacy group and title surfaces never enter the V7 question payload', () => {
  const cards = buildV7QuestionCards([
    syncItem('group-1', 'look_alike_group', { groupId: 'group' }),
    syncItem('bundle-1', 'bundle', { groupId: 'bundle' }),
    syncItem('title-1', 'title_quality'),
  ]);
  assert.deepEqual(cards, []);
});

test('platform product rules keep the incoming field value', () => {
  const item = syncItem('field-1', 'field_conflict', {
    candidates: [candidate('cat-1')],
    fieldConflicts: [{ field: 'price', incomingValue: 3, canonicalValue: 20.99 }],
  });
  const result = fieldConflictDecision(item, { productDetailsSoT: 'PLATFORM' });
  assert.equal(result.choice, 'link');
  assert.equal(result.canonicalId, 'cat-1');
  assert.equal(result.valueOverride, false);
});

test('Anorha product rules keep the catalog field value', () => {
  const item = syncItem('field-2', 'field_conflict', {
    candidates: [candidate('cat-2')],
    fieldConflicts: [{ field: 'price', incomingValue: 3, canonicalValue: 20.99 }],
  });
  assert.equal(fieldConflictDecision(item, { productDetailsSoT: 'ANORHA' }).valueOverride, true);
});

test('stock conflicts use inventory source of truth', () => {
  const item = syncItem('field-3', 'field_conflict', {
    candidates: [candidate('cat-3')],
    fieldConflicts: [{ field: 'stock', incomingValue: 2, canonicalValue: 8 }],
  });
  assert.equal(conflictSourceOfTruth(item, {
    productDetailsSoT: 'PLATFORM',
    inventorySoT: 'ANORHA',
  }), 'ANORHA');
});

test('legacy platform source of truth is still honored', () => {
  const item = syncItem('field-4', 'field_conflict');
  assert.equal(conflictSourceOfTruth(item, { sourceOfTruth: 'platform' }), 'PLATFORM');
});

test('missing sync rules default to keeping yours', () => {
  const item = syncItem('field-5', 'field_conflict');
  assert.equal(conflictSourceOfTruth(item, null), 'ANORHA');
});

test('a conflict without a candidate safely becomes a new item', () => {
  const item = syncItem('field-6', 'field_conflict');
  const result = fieldConflictDecision(item, { productDetailsSoT: 'ANORHA' });
  assert.equal(result.choice, 'create');
  assert.equal(result.outcome, 'added');
});

test('auto-resolved conflicts move from NEEDS A LOOK to LINKED with the standard action', () => {
  const item = syncItem('field-ledger', 'field_conflict', {
    candidates: [candidate('cat-ledger')],
  });
  const ledgerEntry = {
    platformId: item.platformId,
    item,
    outcome: 'linked' as const,
    decisionLabel: 'Kept your details',
    valueOverride: true,
    updatedAt: 1,
  };

  const pending = buildV7ReviewSections([item], [ledgerEntry]);
  assert.deepEqual(pending.needs.map((entry) => entry.platformId), ['field-ledger']);
  assert.deepEqual(pending.linked, []);

  const settled = buildV7ReviewSections([], [ledgerEntry]);
  assert.deepEqual(settled.linked.map((entry) => entry.platformId), ['field-ledger']);
  assert.deepEqual(Object.values(V7_REVIEW_SECTION_LABELS), [
    'NEEDS A LOOK',
    'LINKED',
    'ADDED',
    'SKIPPED',
  ]);
  assert.equal(V7_REVIEW_SECTION_ACTIONS.linked, 'Undo');
});

test('three yes answers offer one bulk V7 handoff for the remaining pairs', () => {
  const cards = ['a', 'b', 'c', 'd', 'e'].map((id, index) => buildV7QuestionCards([
    syncItem(`pair-${id}`, 'weak_match', {
      imageUrl: `https://example.com/${id}.jpg`,
      version: index + 1,
      candidates: [candidate(`cat-${id}`)],
    }),
  ])[0]);
  let streak = null;
  for (const card of cards.slice(0, 3)) {
    streak = advanceHandoffStreak(streak, card, 'primary', card.items[0].imageUrl);
  }
  const offer = buildHandoffOffer(streak, cards.slice(3));
  assert.ok(offer);
  assert.deepEqual(offer.thumbnails, [
    'https://example.com/a.jpg',
    'https://example.com/b.jpg',
    'https://example.com/c.jpg',
  ]);
  assert.deepEqual(offer.decisions.map((decision) => [decision.platformId, decision.choice, decision.canonicalId]), [
    ['pair-d', 'link', 'cat-d'],
    ['pair-e', 'link', 'cat-e'],
  ]);
});
