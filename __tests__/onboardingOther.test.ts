import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OTHER_ID,
  resolveOtherList,
  resolveOtherValue,
  showsOtherField,
} from '../src/lib/onboardingOther.ts';

test('picking Other reveals the field, single-select', () => {
  assert.equal(showsOtherField('friend'), false);
  assert.equal(showsOtherField(''), false);
  assert.equal(showsOtherField(OTHER_ID), true);
});

test('picking Other reveals the field, multi-select', () => {
  assert.equal(showsOtherField([]), false);
  assert.equal(showsOtherField(['clothing', 'home']), false);
  assert.equal(showsOtherField(['clothing', OTHER_ID]), true);
});

test('typed text replaces the Other placeholder', () => {
  assert.equal(resolveOtherValue(OTHER_ID, 'Consultant'), 'Consultant');
  assert.equal(resolveOtherValue(OTHER_ID, '  Consultant  '), 'Consultant');
});

test('a blank Other keeps the choice instead of dropping it', () => {
  assert.equal(resolveOtherValue(OTHER_ID, ''), OTHER_ID);
  assert.equal(resolveOtherValue(OTHER_ID, '   '), OTHER_ID);
});

test('non-Other answers pass through untouched', () => {
  assert.equal(resolveOtherValue('retailer', 'ignored'), 'retailer');
  assert.deepEqual(
    resolveOtherList(['retailer', 'brand'], 'ignored'),
    ['retailer', 'brand'],
  );
});

test('multi-select resolves only the Other entry', () => {
  assert.deepEqual(
    resolveOtherList(['clothing', OTHER_ID], 'Auto parts'),
    ['clothing', 'Auto parts'],
  );
  assert.deepEqual(
    resolveOtherList(['clothing', OTHER_ID], ''),
    ['clothing', OTHER_ID],
  );
});
