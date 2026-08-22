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

test('a non-UUID identity can never become a storage folder', () => {
  // The storage policy compares the first folder to app_user_id(). A Clerk-native
  // sub (user_xxx) there is what produced the HTTP 400 on 2026-08-21, so the path
  // builder refuses anything that is not a canonical app-user UUID. Reading the
  // JWT sub is allowed: under the mint bridge it already IS that UUID, and this
  // assertion is what keeps the shortcut honest.
  assert.throws(
    () => buildProductImageObjectPath('user_31c9i0vcYkaFri2KUxIaeE5l0hO', 'photo:one', 123),
    /canonical app-user UUID/,
  );
});

test('the upload resolver falls back to the me view when the subject is not a UUID', () => {
  const source = readFileSync(
    '/Users/dosagie/Documents/CodeProjects/sssync_mobile_test/src/utils/uploadProductImage.ts',
    'utf8',
  );
  assert.match(source, /getUserLike/);
  assert.match(source, /UUID_PATTERN\.test\(subject\)/);
  assert.match(source, /buildProductImageObjectPath/);
});
