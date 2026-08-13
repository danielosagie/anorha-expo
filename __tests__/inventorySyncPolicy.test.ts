import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COLLECTION_PAGE_SIZES,
  PRODUCT_VARIANT_LIST_SELECT,
  createCollectionPageAccumulator,
  normalizePersistedCollection,
  utf8ByteLength,
} from '../src/lib/pagedCollectionSync.ts';

test('all five inventory collections have bounded request sizes', () => {
  assert.deepEqual(COLLECTION_PAGE_SIZES, {
    ProductVariants: 250,
    PlatformProductMappings: 500,
    ProductImages: 500,
    InventoryLevels: 500,
    MarketplaceListings: 250,
  });
});

test('variant list projection excludes Description but retains title and tags', () => {
  assert.match(PRODUCT_VARIANT_LIST_SELECT, /Products\(Title, Tags\)/);
  assert.doesNotMatch(PRODUCT_VARIANT_LIST_SELECT, /Description/);
});

test('paged collection assigns full pages then replaces with the completed cycle', () => {
  const pages = createCollectionPageAccumulator<{ Id: string; value: number }>(2);
  assert.deepEqual(pages.beginPage(), { offset: 0 });
  assert.deepEqual(pages.acceptPage(0, [
    { Id: 'a', value: 1 },
    { Id: 'b', value: 2 },
  ]), {
    hasMore: true,
    loadedRows: 2,
    mode: 'assign',
    rows: [
      { Id: 'a', value: 1 },
      { Id: 'b', value: 2 },
    ],
  });

  assert.deepEqual(pages.beginPage(), { offset: 2 });
  assert.deepEqual(pages.acceptPage(2, [{ Id: 'c', value: 3 }]), {
    hasMore: false,
    loadedRows: 3,
    mode: 'set',
    rows: [
      { Id: 'a', value: 1 },
      { Id: 'b', value: 2 },
      { Id: 'c', value: 3 },
    ],
  });
});

test('legacy undefined-key cache is repaired from the row Id', () => {
  assert.deepEqual(normalizePersistedCollection({
    undefined: { Id: 'variant-1', value: 1 },
  }), {
    'variant-1': { Id: 'variant-1', value: 1 },
  });
});

test('UTF-8 payload measurement counts multibyte text', () => {
  assert.equal(utf8ByteLength('plain'), 5);
  assert.equal(utf8ByteLength('café'), 5);
});
