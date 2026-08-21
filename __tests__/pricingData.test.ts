import assert from 'node:assert/strict';
import test from 'node:test';

import { hasUsablePricingData, usablePrice } from '../src/components/pricing/pricingData.ts';

test('absent and zero-only pricing are empty', () => {
  assert.equal(hasUsablePricingData(), false);
  assert.equal(hasUsablePricingData({}), false);
  assert.equal(hasUsablePricingData({ low: 0, high: 0, median: 0 }), false);
  assert.equal(hasUsablePricingData({ low: 12 }), false);
  assert.equal(hasUsablePricingData({ livePricing: { high: 18 } }), false);
  assert.equal(hasUsablePricingData({ samples: [{ price: 0 }, {}] }), false);
  assert.equal(hasUsablePricingData({ livePricing: { low: 0, median: null, high: 0 } }), false);
});

test('positive direct, live, and sample prices are usable', () => {
  assert.equal(hasUsablePricingData({ low: 12, high: 18 }), true);
  assert.equal(hasUsablePricingData({ livePricing: { median: 15 } }), true);
  assert.equal(hasUsablePricingData({ samples: [{ price: 9 }] }), true);
});

test('usablePrice rejects non-positive and invalid values', () => {
  assert.equal(usablePrice(0), undefined);
  assert.equal(usablePrice(-1), undefined);
  assert.equal(usablePrice(Number.NaN), undefined);
  assert.equal(usablePrice(0.5), 0.5);
});
