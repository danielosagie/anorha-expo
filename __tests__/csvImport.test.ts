import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Match the repo convention (see liquidationConversationState.test.ts): pull the
// TypeScript source in through createRequire so this runs under `node --test`
// with type-stripping, no jest/transpile step. Only the PURE functions are
// exercised — pickAndParseCsv lazy-imports expo modules and is never touched, so
// requiring the module has no native side effects.
const require = createRequire(import.meta.url);
const { parseCsv, csvRowsToObjects, MAX_ROWS } = require('../src/utils/csvImport.ts');

test('parseCsv: simple headers and rows', () => {
  const { headers, rows } = parseCsv('name,sku,price\nShoe,ABC,10\nHat,DEF,5');
  assert.deepEqual(headers, ['name', 'sku', 'price']);
  assert.deepEqual(rows, [
    ['Shoe', 'ABC', '10'],
    ['Hat', 'DEF', '5'],
  ]);
});

test('parseCsv: quoted field containing a comma', () => {
  const { headers, rows } = parseCsv('title,desc\n"x,y",z');
  assert.deepEqual(headers, ['title', 'desc']);
  assert.deepEqual(rows, [['x,y', 'z']]);
});

test('parseCsv: embedded newline inside a quoted field', () => {
  const { rows } = parseCsv('name,note\n"a","line1\nline2"');
  assert.deepEqual(rows, [['a', 'line1\nline2']]);
});

test('parseCsv: escaped double quotes ("") become a literal quote', () => {
  const { rows } = parseCsv('q\n"she said ""hi"""');
  assert.deepEqual(rows, [['she said "hi"']]);
});

test('parseCsv: CRLF line endings', () => {
  const { headers, rows } = parseCsv('a,b\r\n1,2\r\n3,4\r\n');
  assert.deepEqual(headers, ['a', 'b']);
  assert.deepEqual(rows, [
    ['1', '2'],
    ['3', '4'],
  ]);
});

test('parseCsv: strips a leading UTF-8 BOM from the first header', () => {
  const { headers, rows } = parseCsv('﻿name,sku\nShoe,ABC');
  assert.deepEqual(headers, ['name', 'sku']);
  assert.deepEqual(rows, [['Shoe', 'ABC']]);
});

test('parseCsv: preserves trailing empty fields', () => {
  const { rows } = parseCsv('a,b,c\n1,2,\n,,');
  assert.deepEqual(rows, [
    ['1', '2', ''],
    ['', '', ''],
  ]);
});

test('parseCsv: skips fully-empty lines', () => {
  const { headers, rows } = parseCsv('a,b\n\n1,2\n\n\n3,4\n');
  assert.deepEqual(headers, ['a', 'b']);
  assert.deepEqual(rows, [
    ['1', '2'],
    ['3', '4'],
  ]);
});

test('parseCsv: lone CR (old-Mac) line endings', () => {
  const { headers, rows } = parseCsv('a,b\r1,2\r3,4');
  assert.deepEqual(headers, ['a', 'b']);
  assert.deepEqual(rows, [
    ['1', '2'],
    ['3', '4'],
  ]);
});

test('parseCsv: empty input yields empty headers and rows', () => {
  assert.deepEqual(parseCsv(''), { headers: [], rows: [] });
  assert.deepEqual(parseCsv('\n\n'), { headers: [], rows: [] });
  // @ts-expect-error — guard against null being passed at runtime
  assert.deepEqual(parseCsv(null), { headers: [], rows: [] });
});

test('parseCsv: throws a descriptive error past the row cap', () => {
  const oversized = 'h\n' + Array(MAX_ROWS + 1).fill('x').join('\n');
  assert.throws(() => parseCsv(oversized), /CSV too large/);
});

test('csvRowsToObjects: zips rows against headers', () => {
  const objs = csvRowsToObjects(
    ['name', 'sku', 'price'],
    [
      ['Shoe', 'ABC', '10'],
      ['Hat', 'DEF', '5'],
    ],
  );
  assert.deepEqual(objs, [
    { name: 'Shoe', sku: 'ABC', price: '10' },
    { name: 'Hat', sku: 'DEF', price: '5' },
  ]);
});

test('csvRowsToObjects: pads short (ragged) rows with empty strings', () => {
  const objs = csvRowsToObjects(['a', 'b', 'c'], [['1']]);
  assert.deepEqual(objs, [{ a: '1', b: '', c: '' }]);
});

test('csvRowsToObjects: ignores cells beyond the header count', () => {
  const objs = csvRowsToObjects(['a', 'b'], [['1', '2', '3', '4']]);
  assert.deepEqual(objs, [{ a: '1', b: '2' }]);
});

test('parseCsv + csvRowsToObjects: end-to-end on a quoted/CRLF file', () => {
  const csv = '﻿title,price,notes\r\n"Nike ""Air"", Max",149.99,"multi\nline"\r\n';
  const { headers, rows } = parseCsv(csv);
  const [obj] = csvRowsToObjects(headers, rows);
  assert.deepEqual(obj, {
    title: 'Nike "Air", Max',
    price: '149.99',
    notes: 'multi\nline',
  });
});
