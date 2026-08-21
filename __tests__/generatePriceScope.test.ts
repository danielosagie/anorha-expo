import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_CHANNELS_SCOPE,
  BASE_PRICE_TARGET,
  copyVariantPriceToAll,
  createScopedPriceBook,
  getScopedPrice,
  priceText,
  setScopedPrice,
} from '../src/features/generation/generatePriceScope.ts';
import {
  formatStoredPricingSummary,
  normalizeStoredPricingResearch,
  selectStoredPricingResearch,
} from '../src/lib/storedPricingResearch.ts';

test('an edited channel keeps its explicit price when All channels changes', () => {
  const initial = createScopedPriceBook({ [BASE_PRICE_TARGET]: '15' });
  const withEbayPrice = setScopedPrice(initial, 'ebay', BASE_PRICE_TARGET, '18');
  const afterAllChange = setScopedPrice(withEbayPrice, ALL_CHANNELS_SCOPE, BASE_PRICE_TARGET, '21');

  assert.equal(getScopedPrice(afterAllChange, 'ebay', BASE_PRICE_TARGET), '18');
});

test('an unedited channel follows the latest All channels price', () => {
  const initial = createScopedPriceBook({ [BASE_PRICE_TARGET]: '15' });
  const afterAllChange = setScopedPrice(initial, ALL_CHANNELS_SCOPE, BASE_PRICE_TARGET, '21');

  assert.equal(getScopedPrice(afterAllChange, 'etsy', BASE_PRICE_TARGET), '21');
});

test('copy to all applies one variant price across the selected channel set', () => {
  const targets = ['variant:small', 'variant:medium', 'variant:large'];
  const initial = createScopedPriceBook({
    [targets[0]]: '14',
    [targets[1]]: '16',
    [targets[2]]: '18',
  });
  const withEditedSmall = setScopedPrice(initial, 'ebay', targets[0], '22');
  const copied = copyVariantPriceToAll(withEditedSmall, 'ebay', targets[0], targets);

  assert.deepEqual(
    targets.map((target) => getScopedPrice(copied, 'ebay', target)),
    ['22', '22', '22'],
  );
  assert.deepEqual(
    targets.map((target) => getScopedPrice(copied, ALL_CHANNELS_SCOPE, target)),
    ['14', '16', '18'],
  );
});

test('stored sold research produces the one-line comps summary', () => {
  assert.equal(
    formatStoredPricingSummary({ average: 19, median: 15 }),
    'Sold avg $19 · median $15',
  );
});

test('missing or unearned research produces no comps line', () => {
  assert.equal(formatStoredPricingSummary(null), null);
  assert.equal(formatStoredPricingSummary({ average: 0, median: 0 }), null);
  assert.equal(priceText(0), '');
});

test('the research section maps a stored sold snapshot without inventing values', () => {
  const research = normalizeStoredPricingResearch({
    low: 18,
    median: 24,
    high: 31,
    recommended: 26,
    sampleCount: 4,
    capturedAt: '2026-08-20T12:00:00.000Z',
    compKind: 'exact',
    samples: [
      { title: 'Sold one', price: 20, source: 'eBay', url: 'https://example.com/1' },
      { title: 'Sold two', price: 28, source: 'eBay', imageUrl: 'https://example.com/2.jpg' },
      { title: 'Bad zero', price: 0 },
    ],
  });

  assert.deepEqual(research, {
    low: 18,
    median: 24,
    high: 31,
    recommended: 26,
    average: 24,
    sampleCount: 4,
    cachedAt: '2026-08-20T12:00:00.000Z',
    isSimilar: false,
    samples: [
      {
        title: 'Sold one',
        price: 20,
        marketplace: 'eBay',
        condition: undefined,
        imageUrl: undefined,
        url: 'https://example.com/1',
        estimatedDaysToSell: undefined,
      },
      {
        title: 'Sold two',
        price: 28,
        marketplace: 'eBay',
        condition: undefined,
        imageUrl: 'https://example.com/2.jpg',
        url: undefined,
        estimatedDaysToSell: undefined,
      },
    ],
  });
});

test('the research section derives honest sold metrics from valid comps', () => {
  const research = normalizeStoredPricingResearch({
    samples: [{ price: '12.50' }, { price: 17.5 }, { price: 25 }],
  });

  assert.equal(research?.low, 12.5);
  assert.equal(research?.high, 25);
  assert.equal(research?.median, 17.5);
  assert.equal(research?.average, 55 / 3);
  assert.equal(research?.recommended, 17.5);
});

test('the research section maps missing and zero-only evidence to empty', () => {
  assert.equal(normalizeStoredPricingResearch(undefined), null);
  assert.equal(normalizeStoredPricingResearch({
    low: 0,
    median: 0,
    high: 0,
    recommended: 0,
    sampleCount: 0,
    samples: [{ title: 'Invalid', price: 0 }],
  }), null);
});

test('the research section finds the snapshot persisted in generated platform content', () => {
  const snapshot = {
    low: 10,
    median: 15,
    high: 20,
    samples: [{ title: 'Sold comp', price: 15 }],
  };

  assert.equal(selectStoredPricingResearch([
    { title: 'Generated title', aiPricingResearch: snapshot },
  ]), snapshot);
});
