import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildShippingPlatformPatch,
  buildSizeWeightDraftPatch,
  formatSizeWeight,
  getShippingVerdict,
  normalizeLbOz,
} from '../src/lib/itemShipping.ts';

test('weight verdict keeps 50 lb shippable and flips above the boundary', () => {
  assert.equal(getShippingVerdict({ weight: 50, weightUnit: 'lb' }), 'ships_fine');
  assert.equal(getShippingVerdict({ weight: 50 + 1 / 16, weightUnit: 'lb' }), 'pickup_better');
});

test('longest-side verdict keeps 48 in shippable and flips above the boundary', () => {
  assert.equal(
    getShippingVerdict({ dimensions: { length: 48, width: 8, height: 6, unit: 'in' } }),
    'ships_fine',
  );
  assert.equal(
    getShippingVerdict({ dimensions: { length: 8, width: 48.01, height: 6, unit: 'in' } }),
    'pickup_better',
  );
});

test('length plus girth keeps 108 in shippable and flips above the boundary', () => {
  assert.equal(
    getShippingVerdict({ dimensions: { length: 40, width: 20, height: 14, unit: 'in' } }),
    'ships_fine',
  );
  assert.equal(
    getShippingVerdict({ dimensions: { length: 40, width: 20, height: 14.01, unit: 'in' } }),
    'pickup_better',
  );
});

test('verdict stays hidden until weight or a dimension is present', () => {
  assert.equal(getShippingVerdict({}), undefined);
  assert.equal(
    getShippingVerdict({ dimensions: { length: 12, unit: 'in' } }),
    'ships_fine',
  );
});

test('pounds and ounces normalize overflow into canonical pounds', () => {
  assert.deepEqual(normalizeLbOz('2', '20'), { pounds: 3, ounces: 4, totalPounds: 3.25 });
  assert.deepEqual(normalizeLbOz('', '8'), { pounds: 0, ounces: 8, totalPounds: 0.5 });
  assert.equal(normalizeLbOz('', ''), undefined);
});

test('cart draft and generated platform payloads keep their intended shapes', () => {
  const draftPatch = buildSizeWeightDraftPatch({
    pounds: '3',
    ounces: '4',
    length: '12',
    width: '8',
    height: '6',
  });
  assert.deepEqual(draftPatch, {
    weight: 3.25,
    weightUnit: 'lb',
    dimensions: { length: 12, width: 8, height: 6, unit: 'in' },
  });
  assert.deepEqual(buildShippingPlatformPatch(draftPatch), {
    weight: 3.25,
    weightUnit: 'lb',
    estimatedDimensions: { length: 12, width: 8, height: 6, unit: 'in' },
  });
  assert.equal(formatSizeWeight(draftPatch), '3 lb 4 oz, 12x8x6 in');
});

test('incomplete dimensions persist in the cart but do not enter the platform field', () => {
  const draftPatch = buildSizeWeightDraftPatch({ length: '12' });
  assert.deepEqual(draftPatch, {
    weight: undefined,
    weightUnit: undefined,
    dimensions: { length: 12, unit: 'in' },
  });
  assert.deepEqual(buildShippingPlatformPatch(draftPatch), {});
});
