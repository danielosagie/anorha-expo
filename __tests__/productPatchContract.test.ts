import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRODUCT_EDITABILITY_MANIFEST,
  PRODUCT_PARENT_PATCH_FIELDS,
  PRODUCT_PATCH_CONTRACT_VERSION,
  PRODUCT_VARIANT_PATCH_FIELDS,
  PRODUCT_VARIANT_TYPES,
} from '../src/contracts/product-patch.contract.ts';

test('vendored product patch contract has the locked backend shape', () => {
  assert.equal(PRODUCT_PATCH_CONTRACT_VERSION, 2);
  assert.deepEqual(PRODUCT_VARIANT_TYPES, ['flat', 'base', 'option']);
  assert.deepEqual(PRODUCT_PARENT_PATCH_FIELDS, [
    'Title',
    'Description',
    'Vendor',
    'ProductType',
    'Brand',
    'Tags',
    'CategoryHint',
    'SeoTitle',
    'SeoDescription',
  ]);
  assert.deepEqual(PRODUCT_VARIANT_PATCH_FIELDS, [
    'Sku',
    'Barcode',
    'Title',
    'Options',
    'VariantType',
    'Price',
    'CompareAtPrice',
    'Currency',
    'Weight',
    'WeightUnit',
    'Condition',
    'Mpn',
    'Gtin',
    'RequiresShipping',
    'IsTaxable',
    'TaxCode',
    'RecognitionStatus',
    'OriginPlatform',
  ]);

  for (const field of PRODUCT_PARENT_PATCH_FIELDS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(PRODUCT_EDITABILITY_MANIFEST.parent, field),
      `missing parent editability entry for ${field}`,
    );
  }
  for (const field of PRODUCT_VARIANT_PATCH_FIELDS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(PRODUCT_EDITABILITY_MANIFEST.variant, field),
      `missing variant editability entry for ${field}`,
    );
  }

  // Media is a set-command boundary, never a direct patch field. PrimaryImageUrl
  // left the variant patch in contract v2 and is now derived from the ordered list.
  assert.equal(PRODUCT_EDITABILITY_MANIFEST.media.ProductMedia.editability, 'set');
  assert.equal(PRODUCT_EDITABILITY_MANIFEST.media.ProductMedia.command, 'setProductMedia');
  assert.ok(!PRODUCT_VARIANT_PATCH_FIELDS.includes('PrimaryImageUrl' as never));
});
