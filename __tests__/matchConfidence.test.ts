import assert from 'node:assert/strict';
import test from 'node:test';

import { getMatchConfidenceLabel } from '../src/screens/AddProduct/matchConfidence.ts';

test('match confidence labels describe matching', () => {
  assert.equal(getMatchConfidenceLabel('high'), 'High match');
  assert.equal(getMatchConfidenceLabel('medium'), 'Medium match');
  assert.equal(getMatchConfidenceLabel('low'), 'Low match');
});

test('low fallback confidence is unverified', () => {
  assert.equal(getMatchConfidenceLabel('low', 'fallback'), 'Unverified');
});

test('fallback only overrides a low confidence label', () => {
  assert.equal(getMatchConfidenceLabel('high', 'fallback'), 'High match');
});
