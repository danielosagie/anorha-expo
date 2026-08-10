// Tests for the client-side pool quantity fold (src/lib/partnerInventory.ts),
// which must match the backend's canonical fold (sssync-bknd
// src/canonical-data/inventory.service.ts): replicated ('shared'/'aggregate')
// pools take MAX — their level rows are projections of one physical stock —
// and only 'independent' pools sum.
//   node --test __tests__/poolInventoryFold.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPoolModeIndex,
  foldPoolQuantities,
  isIndependentPoolMode,
  sumPooledLevelQuantities,
} from '../src/lib/partnerInventory.ts';

test('isIndependentPoolMode: only independent is independent; missing defaults to shared', () => {
  assert.equal(isIndependentPoolMode('independent'), true);
  assert.equal(isIndependentPoolMode('shared'), false);
  assert.equal(isIndependentPoolMode('aggregate'), false);
  assert.equal(isIndependentPoolMode(undefined), false);
  assert.equal(isIndependentPoolMode(null), false);
});

test('foldPoolQuantities: replicated pools take max (the 3-location x10 pool reads 10, not 30)', () => {
  assert.equal(foldPoolQuantities([10, 10, 10], 'shared'), 10);
  assert.equal(foldPoolQuantities([10, 10, 10], 'aggregate'), 10);
  assert.equal(foldPoolQuantities([10, 10, 10], undefined), 10);
  // Mid-flight replication disagreement: report the max, not a stray 0.
  assert.equal(foldPoolQuantities([10, 0, 7], 'shared'), 10);
});

test('foldPoolQuantities: independent (split) pools sum', () => {
  assert.equal(foldPoolQuantities([3, 4, 5], 'independent'), 12);
});

test('foldPoolQuantities: empty and junk inputs', () => {
  assert.equal(foldPoolQuantities([], 'shared'), 0);
  assert.equal(foldPoolQuantities([NaN as any, '2' as any], 'independent'), 2);
});

test('buildPoolModeIndex: maps pool id to mode, defaulting to shared', () => {
  const index = buildPoolModeIndex([
    { id: 'p1', inventoryMode: 'independent' },
    { id: 'p2' },
    { name: 'no-id-row' },
    null,
  ]);
  assert.deepEqual(index, { p1: 'independent', p2: 'shared' });
});

test('sumPooledLevelQuantities: folds per pool by mode, then sums distinct pools', () => {
  const modes = { rep: 'shared', split: 'independent' };
  const levels = [
    // Replicated pool: same stock written to 3 locations.
    { PoolId: 'rep', Quantity: 10 },
    { PoolId: 'rep', Quantity: 10 },
    { PoolId: 'rep', Quantity: 10 },
    // Split pool: genuinely distinct per-location stock.
    { PoolId: 'split', Quantity: 2 },
    { PoolId: 'split', Quantity: 3 },
  ];
  assert.equal(sumPooledLevelQuantities(levels, modes), 15); // 10 + 5
});

test('sumPooledLevelQuantities: unknown pools default to replicated (max)', () => {
  const levels = [
    { PoolId: 'mystery', Quantity: 8 },
    { PoolId: 'mystery', Quantity: 8 },
  ];
  assert.equal(sumPooledLevelQuantities(levels, {}), 8);
});

test('sumPooledLevelQuantities: pool-less rows sum as singletons', () => {
  const levels = [
    { PoolId: null, Quantity: 4 },
    { Quantity: 6 },
    { PoolId: 'rep', Quantity: 10 },
    { PoolId: 'rep', Quantity: 10 },
  ];
  assert.equal(sumPooledLevelQuantities(levels, {}), 20); // 4 + 6 + 10
});

test('sumPooledLevelQuantities: empty input', () => {
  assert.equal(sumPooledLevelQuantities([], {}), 0);
});
