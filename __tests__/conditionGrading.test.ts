import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONDITION_GRADES,
  buildConditionDraftPatch,
  conditionGradeFromCommerceCondition,
  conditionGradeLabel,
  isPoweredEquipment,
} from '../src/lib/conditionGrading.ts';

test('condition grades map between chip values and commerce labels', () => {
  assert.deepEqual(
    CONDITION_GRADES.map(({ value, label }) => [value, label]),
    [
      ['new', 'New'],
      ['like_new', 'Like new'],
      ['good', 'Good'],
      ['fair', 'Fair'],
      ['parts', 'Parts'],
    ],
  );
  assert.equal(conditionGradeLabel('like_new'), 'Like new');
  assert.equal(conditionGradeFromCommerceCondition('Good, tested'), 'good');
  assert.equal(conditionGradeFromCommerceCondition('For Parts'), 'parts');
});

test('powered-category detection uses the approved product type and title keywords', () => {
  for (const productType of [
    'Medical equipment',
    'Consumer electronics',
    'Home appliances',
    'Power tools',
    'Audio equipment',
    'Computer accessories',
    'Mobile phones',
    'Digital cameras',
  ]) {
    assert.equal(isPoweredEquipment({ productType }), true, productType);
  }
  assert.equal(isPoweredEquipment({ title: 'Unlocked smartphone' }), true);
  assert.equal(isPoweredEquipment({ productType: 'Clothing', title: 'Linen shirt' }), false);
  assert.equal(isPoweredEquipment({ productType: 'Furniture', title: 'Wooden stool' }), false);
});

test('condition write payload keeps the canonical free-text condition and inspection state', () => {
  assert.deepEqual(
    buildConditionDraftPatch({ conditionGrade: 'good', testedStatus: 'tested' }),
    {
      conditionGrade: 'good',
      testedStatus: 'tested',
      condition: 'Good, tested',
    },
  );
  assert.deepEqual(
    buildConditionDraftPatch({ conditionGrade: 'fair', testedStatus: 'untested' }),
    {
      conditionGrade: 'fair',
      testedStatus: 'untested',
      condition: 'Fair, untested',
    },
  );
});
