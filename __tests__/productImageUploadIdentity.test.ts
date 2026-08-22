import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildProductImageObjectPath } from '../src/lib/productImageUploadIdentity.ts';

test('product image paths use the canonical app-user UUID folder', () => {
  assert.equal(
    buildProductImageObjectPath(
      '003204d6-4da7-4666-9470-2c55b8d4d1df',
      'photo:one',
      123,
    ),
    '003204d6-4da7-4666-9470-2c55b8d4d1df/photo_one-123.jpg',
  );
});

test('the upload resolver uses the me-view app user instead of raw Clerk JWT sub', () => {
  const source = readFileSync(
    '/Users/dosagie/Documents/CodeProjects/sssync_mobile_test/src/utils/uploadProductImage.ts',
    'utf8',
  );
  assert.match(source, /getUserLike/);
  assert.doesNotMatch(source, /readJwtSubject/);
});
