import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizeTagList,
  mergeTagIntoList,
} = require('../src/screens/inventory/bulkInventoryActions.ts');

test('normalizeTagList handles arrays, comma strings, empty values, and unknown input', () => {
  assert.deepEqual(normalizeTagList([' sale ', '', 42]), ['sale', '42']);
  assert.deepEqual(normalizeTagList('sale, clearance, ,featured'), ['sale', 'clearance', 'featured']);
  assert.deepEqual(normalizeTagList(null), []);
});

test('mergeTagIntoList appends trimmed tags without duplicating existing tags', () => {
  assert.deepEqual(mergeTagIntoList(['sale'], 'clearance'), ['sale', 'clearance']);
  assert.deepEqual(mergeTagIntoList('sale, clearance', ' sale '), ['sale', 'clearance']);
  assert.deepEqual(mergeTagIntoList(['sale'], '   '), ['sale']);
});
