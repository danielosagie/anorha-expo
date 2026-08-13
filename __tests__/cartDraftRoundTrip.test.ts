import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasReviewableGenerateResult,
  hydrateCartStateFromDraft,
  recoverHydratedCartState,
  serializeCartStateToDraft,
} from '../src/features/cart/cartDraftPersistence.ts';

test('backend draft round-trip restores stable IDs, durable result, and canonical review state', async () => {
  const initial: any = {
    entries: {
      'cart-item-1': {
        kind: 'single',
        id: 'cart-item-1',
        photos: [{ id: 'photo-1', uri: 'https://images.test/item.jpg', isCover: true }],
        title: 'Local title',
        quantity: 1,
        status: 'ready_to_list',
        generateJobId: 'generate-job-1',
        generateMatchJobId: 'match-job-1',
        productId: 'product-1',
        variantId: 'variant-1',
        generateResult: {
          productIndex: 0,
          productId: 'product-1',
          variantId: 'variant-1',
          platforms: { shopify: { title: 'Generated title' } },
          draftReady: true,
        },
        createdAt: 1,
        updatedAt: 2,
      },
    },
    order: ['cart-item-1'],
    activeItemId: 'cart-item-1',
    processedItemIds: ['cart-item-1'],
    itemStageById: { 'cart-item-1': 'generated' },
    savedForLaterIds: [],
  };

  const draft = serializeCartStateToDraft(initial);
  assert.equal(draft.scannedItems.length, 1);
  assert.equal(draft.scannedItems[0].generateJobId, 'generate-job-1');
  assert.equal(draft.scannedItems[0].generateMatchJobId, 'match-job-1');
  assert.equal(draft.scannedItems[0].productId, 'product-1');
  assert.equal(draft.scannedItems[0].variantId, 'variant-1');
  assert.equal(Object.hasOwn(draft.scannedItems[0], 'generateResult'), false);

  const hydrated = hydrateCartStateFromDraft(draft, 10);
  const hydratedItem: any = hydrated.entries['cart-item-1'];
  assert.equal(hydratedItem.status, 'ready_to_list');
  assert.equal(hydratedItem.generateJobId, 'generate-job-1');
  assert.equal(hydratedItem.generateResult, undefined);

  const calls: string[] = [];
  const recovered = await recoverHydratedCartState(hydrated, {
    fetchGenerateStatus: async (jobId) => {
      calls.push(`status:${jobId}`);
      return {
        status: 'completed',
        results: [{
          productIndex: 0,
          productId: 'product-1',
          variantId: 'variant-1',
          platforms: { shopify: { title: 'Generated title' } },
          draftReady: true,
        }],
      };
    },
    fetchCanonicalItem: async (variantId) => {
      calls.push(`item:${variantId}`);
      return {
        Id: 'variant-1',
        ProductId: 'product-1',
        Title: 'Canonical title',
        Description: null,
        Price: 14,
      };
    },
  }, 20);

  const item: any = recovered.entries['cart-item-1'];
  assert.deepEqual(calls, ['status:generate-job-1', 'item:variant-1']);
  assert.equal(item.productId, 'product-1');
  assert.equal(item.variantId, 'variant-1');
  assert.equal(item.title, 'Canonical title');
  assert.equal(item.canonicalItem.Description, null);
  assert.equal(item.pricing.recommended, 14);
  assert.equal(item.status, 'ready_to_list');
  assert.equal(hasReviewableGenerateResult(item), true, 'GenerateDetails must not render its No results state');
});
