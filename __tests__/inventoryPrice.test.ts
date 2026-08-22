import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatInventoryListPrice,
  formatProductDetailPrice,
} from '../src/lib/inventoryPrice.ts';

for (const [value, expected] of [[null, '—'], [0, '$0.00'], [12, '$12.00']] as const) {
  test(`list price preserves ${String(value)} as ${expected}`, () => {
    assert.equal(formatInventoryListPrice({ price: value }), expected);
  });

  test(`detail price preserves ${String(value)} as ${expected}`, () => {
    assert.equal(formatProductDetailPrice(value), expected);
  });
}
