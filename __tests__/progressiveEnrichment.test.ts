import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyProgressiveEnrichment,
  enrichmentLabel,
} from '../src/features/generation/progressiveEnrichment.ts';

test('late taxonomy and shipping defaults fill an untouched draft', () => {
  const baseline = { shopify: { title: 'Anker cable' }, ebay: { title: 'Anker cable' } };
  const next = applyProgressiveEnrichment(baseline, structuredClone(baseline), {
    status: 'completed',
    taxonomy: {
      shopify: { categoryId: '123', path: 'Electronics > Cables', confidence: 0.92, source: 'catalog' },
    },
    shipping: {
      estimate: { estimatedWeight: { value: 0.3, unit: 'lb' }, shippingTier: 'small' },
      platformOptions: {
        ebay: [{ id: 'policy-1', name: 'Standard', deliveryMethod: 'shipping', scope: 'listing_profile', source: 'connected_platform' }],
      },
      platformDefaults: {
        ebay: { deliveryMethod: 'shipping', fulfillmentPolicyId: 'policy-1', currency: 'USD', scope: 'listing_profile', source: 'connected_platform' },
      },
    },
  });

  assert.equal(next.shopify.productCategoryId, '123');
  assert.equal(next.shopify.categoryPath, 'Electronics > Cables');
  assert.equal(next.ebay.fulfillmentPolicyId, 'policy-1');
  assert.equal(next.ebay.shippingOptions[0].name, 'Standard');
  assert.equal(next.ebay.shippingCurrency, 'USD');
  assert.equal(next.ebay.shippingScope, 'listing_profile');
  assert.deepEqual(next.shopify.estimatedWeight, { value: 0.3, unit: 'lb' });
});

test('late enrichment never overwrites a locally edited taxonomy group', () => {
  const baseline = { ebay: { title: 'Cable', categoryId: undefined, categoryPath: undefined } };
  const current = { ebay: { title: 'Cable', categoryId: 'mine', categoryPath: 'My category' } };
  const next = applyProgressiveEnrichment(baseline, current, {
    status: 'completed',
    taxonomy: { ebay: { categoryId: 'server', path: 'Server category', confidence: 0.99 } },
  });

  assert.equal(next.ebay.categoryId, 'mine');
  assert.equal(next.ebay.categoryPath, 'My category');
  assert.equal(next.ebay.taxonomyConfidence, undefined);
});

test('late enrichment never mixes server policy into locally edited shipping', () => {
  const baseline = { ebay: { deliveryMethod: 'shipping', shippingCost: '' } };
  const current = { ebay: { deliveryMethod: 'both', shippingCost: '4.99' } };
  const next = applyProgressiveEnrichment(baseline, current, {
    status: 'completed',
    shipping: {
      platformDefaults: {
        ebay: {
          deliveryMethod: 'shipping',
          shippingCost: 9.99,
          fulfillmentPolicyId: 'server-policy',
          source: 'connected_platform',
        },
      },
    },
  });

  assert.equal(next.ebay.deliveryMethod, 'both');
  assert.equal(next.ebay.shippingCost, '4.99');
  assert.equal(next.ebay.fulfillmentPolicyId, undefined);
});

test('only pending enrichment exposes a non-blocking label', () => {
  assert.equal(enrichmentLabel('pending'), 'Draft ready · Finishing category & shipping…');
  assert.equal(enrichmentLabel('partial'), null);
  assert.equal(enrichmentLabel('failed'), null);
  assert.equal(enrichmentLabel('completed'), null);
  assert.equal(enrichmentLabel(undefined), null);
});
