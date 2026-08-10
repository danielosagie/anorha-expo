import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import type { AttentionReason, CanonicalRef, SyncItem } from '../src/types/syncItem.ts';

// questionQueue.ts is app source, so its relative imports are extensionless
// (Metro resolves them). Node's type stripping does not, so retry failed
// relative resolutions with a .ts extension before importing the real module:
// these tests must exercise the REAL count/merge helpers, not a stub.
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
  buildQuestionCards,
  candidateUpdatedLabel,
  mergeCandidateDetails,
  remainingItemCount,
} = await import('../src/components/import/questionQueue.ts');

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
    version: 3,
    attention,
    resolution: { kind: 'create' },
    ...overrides,
  };
}

// ---- remainingItemCount: the one number every surface shares (run 8 P2-3) ----

test('remainingItemCount counts ITEMS, not cards, across grouped and single cards', () => {
  const cards = buildQuestionCards([
    // One duplicate_target card holding four items (the Gift Card group).
    syncItem('dup-1', 'duplicate_target', { groupId: 'gift-cards' }),
    syncItem('dup-2', 'duplicate_target', { groupId: 'gift-cards' }),
    syncItem('dup-3', 'duplicate_target', { groupId: 'gift-cards' }),
    syncItem('dup-4', 'duplicate_target', { groupId: 'gift-cards' }),
    // Five single-item cards.
    syncItem('which-1', 'multiple_candidates'),
    syncItem('which-2', 'multiple_candidates'),
    syncItem('bundle-1', 'bundle'),
    syncItem('bundle-2', 'bundle'),
    syncItem('pair-1', 'weak_match'),
  ]);
  // Run 8 saw exactly this shape: 6 cards, but "9 left" in the deck header.
  assert.equal(cards.length, 6);
  assert.equal(remainingItemCount(cards), 9);
});

test('remainingItemCount drops settled items, so answering a 4-item merge card moves 9 to 5', () => {
  const cards = buildQuestionCards([
    syncItem('dup-1', 'duplicate_target', { groupId: 'gift-cards' }),
    syncItem('dup-2', 'duplicate_target', { groupId: 'gift-cards' }),
    syncItem('dup-3', 'duplicate_target', { groupId: 'gift-cards' }),
    syncItem('dup-4', 'duplicate_target', { groupId: 'gift-cards' }),
    syncItem('which-1', 'multiple_candidates'),
    syncItem('which-2', 'multiple_candidates'),
    syncItem('bundle-1', 'bundle'),
    syncItem('bundle-2', 'bundle'),
    syncItem('pair-1', 'weak_match'),
  ]);
  const settled = new Set(['dup-1', 'dup-2', 'dup-3', 'dup-4']);
  assert.equal(remainingItemCount(cards, settled), 5);
});

test('remainingItemCount is 0 for no cards and ignores settled ids it never held', () => {
  assert.equal(remainingItemCount([]), 0);
  const cards = buildQuestionCards([syncItem('pair-1', 'weak_match')]);
  assert.equal(remainingItemCount(cards, new Set(['someone-else'])), 1);
});

// ---- mergeCandidateDetails: hydration must never null out payload identity ----

const payloadCandidate: CanonicalRef = {
  id: 'cat-1',
  sku: 'SHOPIFY-1',
  title: 'Draft Snowboard',
  price: '600.00',
  imageUrl: 'https://cdn/payload.jpg',
};

test('mergeCandidateDetails keeps payload fields when hydration returns nulls', () => {
  const hydrated: CanonicalRef = {
    id: 'cat-1',
    sku: null,
    title: null,
    price: null,
    imageUrl: null,
    sourcePlatform: 'shopify',
    updatedAt: null,
  };
  assert.deepEqual(mergeCandidateDetails(payloadCandidate, hydrated), {
    id: 'cat-1',
    sku: 'SHOPIFY-1',
    title: 'Draft Snowboard',
    price: '600.00',
    imageUrl: 'https://cdn/payload.jpg',
    sourcePlatform: 'shopify',
    updatedAt: null,
  });
});

test('mergeCandidateDetails prefers hydrated fields when they exist', () => {
  const hydrated: CanonicalRef = {
    id: 'cat-1',
    sku: 'SHOPIFY-2',
    title: 'Draft Snowboard (2024)',
    price: 625,
    imageUrl: 'https://cdn/db.jpg',
    sourcePlatform: 'ebay',
    updatedAt: '2026-06-12T10:00:00Z',
  };
  assert.deepEqual(mergeCandidateDetails(payloadCandidate, hydrated), hydrated);
});

test('mergeCandidateDetails passes the payload through when there is no hydration row', () => {
  assert.equal(mergeCandidateDetails(payloadCandidate, undefined), payloadCandidate);
  assert.equal(mergeCandidateDetails(payloadCandidate, null), payloadCandidate);
});

// ---- candidateUpdatedLabel: the tellable-apart date row ----

test('candidateUpdatedLabel drops the year inside the current year, keeps it otherwise', () => {
  const now = new Date('2026-08-09T12:00:00Z');
  assert.equal(candidateUpdatedLabel('2026-06-12T10:00:00Z', now), 'Updated Jun 12');
  assert.equal(candidateUpdatedLabel('2025-11-30T10:00:00Z', now), 'Updated Nov 30, 2025');
});

test('candidateUpdatedLabel is empty for missing or unparseable stamps', () => {
  assert.equal(candidateUpdatedLabel(null), '');
  assert.equal(candidateUpdatedLabel(undefined), '');
  assert.equal(candidateUpdatedLabel('not-a-date'), '');
});
