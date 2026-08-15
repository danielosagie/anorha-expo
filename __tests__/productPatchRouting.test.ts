import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isProductEditorFieldEditable,
  pickEditableProductPatch,
} from '../src/lib/productPatchContract.ts';

test('editor editability is derived from the vendored manifest', () => {
  assert.equal(isProductEditorFieldEditable('title'), true);
  assert.equal(isProductEditorFieldEditable('condition'), true);
  assert.equal(isProductEditorFieldEditable('photos'), true);
  assert.equal(isProductEditorFieldEditable('platformListingId'), false);
});

test('mobile product patch picker sends only contract fields', () => {
  const patch = pickEditableProductPatch(
    { Title: 'Canonical title', Brand: 'Acme', SeoTitle: 'Search title' },
    { Price: 19.5, Condition: 'new' },
  );

  assert.deepEqual(patch.parent, {
    Title: 'Canonical title',
    Brand: 'Acme',
    SeoTitle: 'Search title',
  });
  assert.deepEqual(patch.variant, { Price: 19.5, Condition: 'new' });
  assert.deepEqual(patch.flat, {
    Title: 'Canonical title',
    Brand: 'Acme',
    SeoTitle: 'Search title',
    Price: 19.5,
    Condition: 'new',
  });
});
