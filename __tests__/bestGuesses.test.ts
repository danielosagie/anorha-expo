import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import type { AttentionReason, CanonicalRef, SyncItem } from '../src/types/syncItem.ts';

// questionQueue.ts is app source, so its relative imports are extensionless
// (Metro resolves them). Node's type stripping does not, so retry failed
// relative resolutions with a .ts extension before importing the real module:
// these tests must exercise the REAL decisionsForCard chain, not a stub.
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
  bestGuessFooterLabel,
  buildQuestionCards,
  decisionsForCard,
  selectBestGuessCards,
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

test('a recommended pair with a candidate is a link guess with the deck\'s exact decisions', () => {
  const item = syncItem('pair-1', 'weak_match', {
    recommended: 'primary',
    candidates: [candidate('cat-1')],
    version: 7,
  });
  const cards = buildQuestionCards([item]);
  const guesses = selectBestGuessCards(cards);

  assert.equal(guesses.length, 1);
  assert.equal(guesses[0].action, 'link');
  assert.deepEqual(guesses[0].decisions, decisionsForCard(guesses[0].card, 'primary'));
  assert.deepEqual(guesses[0].decisions, [{
    platformId: 'pair-1',
    choice: 'link',
    canonicalId: 'cat-1',
    valueOverride: undefined,
    version: 7,
    outcome: 'linked',
  }]);
});

test('a recommended pair with no candidate is an add-as-new guess', () => {
  const item = syncItem('pair-2', 'weak_match', { recommended: 'primary' });
  const guesses = selectBestGuessCards(buildQuestionCards([item]));

  assert.equal(guesses.length, 1);
  assert.equal(guesses[0].action, 'add');
  assert.equal(guesses[0].decisions[0].choice, 'create');
  assert.equal(guesses[0].decisions[0].outcome, 'added');
});

test('items the server did not recommend are never guessed', () => {
  const items = [
    syncItem('meh', 'weak_match', { candidates: [candidate('cat-1')] }),
    syncItem('second', 'weak_match', { recommended: 'secondary', candidates: [candidate('cat-1')] }),
  ];
  assert.deepEqual(selectBestGuessCards(buildQuestionCards(items)), []);
});

test('kinds that need human input never qualify, even when recommended', () => {
  const items = [
    syncItem('which', 'multiple_candidates', {
      recommended: 'primary',
      candidates: [candidate('cat-1'), candidate('cat-2')],
    }),
    syncItem('bundle', 'bundle', { recommended: 'primary', groupId: 'set-1' }),
    syncItem('title', 'title_quality', { recommended: 'primary' }),
    syncItem('failed', 'commit_failed', { recommended: 'primary' }),
  ];
  assert.deepEqual(selectBestGuessCards(buildQuestionCards(items)), []);
});

test('a recommended look-alike group is one add guess covering every member', () => {
  const items = [
    syncItem('size-s', 'look_alike_group', { recommended: 'primary', groupId: 'tee', version: 2 }),
    syncItem('size-m', 'look_alike_group', { recommended: 'primary', groupId: 'tee', version: 5 }),
  ];
  const guesses = selectBestGuessCards(buildQuestionCards(items));

  assert.equal(guesses.length, 1);
  assert.equal(guesses[0].action, 'add');
  assert.equal(guesses[0].card.kind, 'look_alike_group');
  assert.deepEqual(guesses[0].decisions.map((entry) => [entry.platformId, entry.version]), [
    ['size-s', 2],
    ['size-m', 5],
  ]);
  assert.ok(guesses[0].decisions.every((entry) =>
    entry.choice === 'create'
    && typeof entry.valueOverride === 'object'
    && entry.valueOverride !== null
    && (entry.valueOverride as { groupMode?: string }).groupMode === 'combine'));
});

test('a recommended duplicate-target group with candidates everywhere is a link guess', () => {
  const items = [
    syncItem('dupe-a', 'duplicate_target', {
      recommended: 'primary',
      groupId: 'dupes',
      candidates: [candidate('cat-9')],
    }),
    syncItem('dupe-b', 'duplicate_target', {
      recommended: 'primary',
      groupId: 'dupes',
      candidates: [candidate('cat-9')],
    }),
  ];
  const guesses = selectBestGuessCards(buildQuestionCards(items));

  assert.equal(guesses.length, 1);
  assert.equal(guesses[0].action, 'link');
  assert.ok(guesses[0].decisions.every((entry) => entry.choice === 'link' && entry.canonicalId === 'cat-9'));
});

test('a card whose primary decisions mix link and add stays in the deck', () => {
  const items = [
    syncItem('dupe-a', 'duplicate_target', {
      recommended: 'primary',
      groupId: 'dupes',
      candidates: [candidate('cat-9')],
    }),
    // No candidate: its primary decision falls back to create, mixed outcomes.
    syncItem('dupe-b', 'duplicate_target', { recommended: 'primary', groupId: 'dupes' }),
  ];
  assert.deepEqual(selectBestGuessCards(buildQuestionCards(items)), []);
});

test('best-guess selection only reads the recommendation from the card\'s first item', () => {
  const items = [
    syncItem('size-s', 'look_alike_group', { groupId: 'tee' }),
    syncItem('size-m', 'look_alike_group', { recommended: 'primary', groupId: 'tee' }),
  ];
  assert.deepEqual(selectBestGuessCards(buildQuestionCards(items)), []);
});

test('mixed classes select only the guessable cards, in card order', () => {
  const items = [
    syncItem('pair-1', 'weak_match', { recommended: 'primary', candidates: [candidate('cat-1')] }),
    syncItem('which', 'multiple_candidates', {
      recommended: 'primary',
      candidates: [candidate('cat-1'), candidate('cat-2')],
    }),
    syncItem('pair-2', 'stale_link', {
      recommended: 'primary',
      resolution: { kind: 'link', canonical: candidate('cat-3'), confidence: 0.9, via: 'sku' },
    }),
  ];
  const guesses = selectBestGuessCards(buildQuestionCards(items));

  assert.deepEqual(
    guesses.map((guess) => [guess.card.items[0].platformId, guess.action]),
    [['pair-1', 'link'], ['pair-2', 'link']],
  );
});

test('the commit_failed batch card in the deck is a retry, never a guess', () => {
  // Main batches commit_failed rows into ONE card that rides mainCards last,
  // so selection sees it alongside real questions and must skip it by kind.
  const items = [
    syncItem('pair-1', 'weak_match', { recommended: 'primary', candidates: [candidate('cat-1')] }),
    syncItem('failed-1', 'commit_failed', { recommended: 'primary' }),
    syncItem('failed-2', 'commit_failed', { recommended: 'primary' }),
  ];
  const guesses = selectBestGuessCards(buildQuestionCards(items));

  assert.deepEqual(
    guesses.map((guess) => [guess.card.items[0].platformId, guess.action]),
    [['pair-1', 'link']],
  );
});

test('the footer names only the sections that have checked rows', () => {
  assert.equal(bestGuessFooterLabel(2, 2), '2 link · 2 add as new');
  assert.equal(bestGuessFooterLabel(3, 0), '3 link');
  assert.equal(bestGuessFooterLabel(0, 1), '1 add as new');
  assert.equal(bestGuessFooterLabel(0, 0), '');
});
