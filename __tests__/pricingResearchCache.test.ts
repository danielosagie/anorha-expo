// Pure tests for the in-memory pricing-research cache. Runnable with Node's
// native TS type-stripping (Node >= 22.18):
//   node --test __tests__/pricingResearchCache.test.ts

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  pricingCacheKey,
  getFreshPricing,
  putPricing,
  clearPricingCache,
  PRICING_RESEARCH_TTL_MS,
} from '../src/lib/pricingResearchCache.ts';

beforeEach(() => clearPricingCache());

test('key is case-insensitive', () => {
  const a = pricingCacheKey({ title: 'Levi 501 Jeans', categoryId: '11483', condition: 'used' });
  const b = pricingCacheKey({ title: 'LEVI 501 JEANS', categoryId: '11483', condition: 'USED' });
  assert.equal(a, b);
  assert.equal(a, 'levi 501 jeans|11483|used');
});

test('leading whitespace on the title never splits the cache', () => {
  assert.equal(
    pricingCacheKey({ title: '  Levi 501 Jeans', categoryId: '11483' }),
    pricingCacheKey({ title: 'Levi 501 Jeans', categoryId: '11483' }),
  );
});

test('identity fields separate entries: same title, different category or condition', () => {
  const base = pricingCacheKey({ title: 'Plush toy' });
  const withCat = pricingCacheKey({ title: 'Plush toy', categoryId: '220' });
  const withCond = pricingCacheKey({ title: 'Plush toy', condition: 'new' });
  assert.notEqual(base, withCat);
  assert.notEqual(base, withCond);
  assert.notEqual(withCat, withCond);
});

test('missing optional fields key the same as empty ones', () => {
  assert.equal(
    pricingCacheKey({ title: 'Mug' }),
    pricingCacheKey({ title: 'Mug', categoryId: undefined, condition: undefined }),
  );
});

test('fresh entry is served back', () => {
  const key = pricingCacheKey({ title: 'Camera' });
  const data = { low: 40, median: 55, high: 80 };
  putPricing(key, data, 1_000);
  assert.equal(getFreshPricing(key, 1_000 + 60_000), data);
});

test('miss on unknown key', () => {
  assert.equal(getFreshPricing('nope'), null);
});

test('entry exactly at the staleness window is stale', () => {
  const key = pricingCacheKey({ title: 'Camera' });
  putPricing(key, { low: 40 }, 0);
  assert.notEqual(getFreshPricing(key, PRICING_RESEARCH_TTL_MS - 1), null);
  assert.equal(getFreshPricing(key, PRICING_RESEARCH_TTL_MS), null);
});

test('stale entry is evicted on read (no zombie hit with an earlier clock)', () => {
  const key = pricingCacheKey({ title: 'Camera' });
  putPricing(key, { low: 40 }, 0);
  assert.equal(getFreshPricing(key, PRICING_RESEARCH_TTL_MS + 1), null);
  // Even a subsequent read inside the window sees nothing — the entry is gone.
  assert.equal(getFreshPricing(key, 10), null);
});

test('put overwrites: a forced refresh replaces the previous result and its clock', () => {
  const key = pricingCacheKey({ title: 'Camera' });
  putPricing(key, { low: 40 }, 0);
  putPricing(key, { low: 45 }, 5_000);
  const hit = getFreshPricing<{ low: number }>(key, 6_000);
  assert.equal(hit?.low, 45);
  // Freshness is measured from the refresh, not the original write.
  assert.notEqual(getFreshPricing(key, PRICING_RESEARCH_TTL_MS + 4_999), null);
});

test('custom ttl override is honored', () => {
  const key = pricingCacheKey({ title: 'Camera' });
  putPricing(key, { low: 40 }, 0);
  assert.equal(getFreshPricing(key, 31, 30), null);
  putPricing(key, { low: 40 }, 100);
  assert.notEqual(getFreshPricing(key, 129, 30), null);
});
