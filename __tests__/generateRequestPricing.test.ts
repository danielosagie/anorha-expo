import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGenerateProduct } from '../src/features/generation/generateRequest.ts';

test('visible candidate price becomes the typed identity-scoped pricing snapshot', () => {
  const product = buildGenerateProduct({
    productIndex: 0,
    productId: 'client-item-1',
    identityTitle: 'Anker PowerLine USB-C Cable',
    candidate: {
      title: 'Anker PowerLine USB-C Cable',
      price: 14,
      source: 'ebay',
      link: 'https://example.test/anker-cable',
    },
    sellerConfirmed: true,
    photos: [{ url: 'https://images.test/cable.jpg', isCover: true }],
    quantity: 1,
  });

  assert.equal(product.pricingSnapshot?.recommended, 14);
  assert.equal(product.pricingSnapshot?.identityCanonicalKey, product.itemIdentity.canonicalKey);
  assert.equal(product.pricingSnapshot?.low, 14);
  assert.equal(product.pricingSnapshot?.median, 14);
  assert.equal(product.pricingSnapshot?.high, 14);
  assert.equal(Object.hasOwn(product, 'selectedMatches'), false);
});
