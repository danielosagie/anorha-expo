import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImportFrontDoorRows, importFrontDoorAction } from '../src/lib/importFrontDoor.ts';

test('front door rows account for every item in the Square receipt', () => {
  const rows = buildImportFrontDoorRows({
    autoLinked: 16,
    autoCreated: 3,
    skipped: 8,
    needsAttention: 3,
  });

  assert.deepEqual(rows.map(({ label, count }) => [label, count]), [
    ['Linked', 16],
    ['Added', 3],
    ['Skipped', 8],
    ['NEEDS A LOOK', 3],
  ]);
  assert.equal(rows.reduce((total, row) => total + row.count, 0), 30);
});

test('zero skipped and needs-look buckets stay hidden', () => {
  const rows = buildImportFrontDoorRows({
    autoLinked: 16,
    autoCreated: 3,
    skipped: 0,
    needsAttention: 0,
  });

  assert.deepEqual(rows.map((row) => row.label), ['Linked', 'Added']);
});

test('zero questions produces Done with no Later action', () => {
  assert.deepEqual(importFrontDoorAction(0), {
    label: 'Done',
    opensQuestions: false,
    showLater: false,
  });
});

test('owed questions keep the questions and Later actions', () => {
  assert.deepEqual(importFrontDoorAction(2), {
    label: '2 more questions',
    opensQuestions: true,
    showLater: true,
  });
});
