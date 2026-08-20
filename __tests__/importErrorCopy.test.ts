import assert from 'node:assert/strict';
import test from 'node:test';

import { importActionErrorCopy } from '../src/lib/importErrorCopy.ts';

test('import action errors preserve actionable causes', () => {
  assert.equal(
    importActionErrorCopy(new Error('This item changed before your choice was saved.')),
    'This item changed. Review it again.',
  );
  assert.equal(importActionErrorCopy(new Error('Resolve failed: 401')), 'Session expired. Reopen the app.');
  assert.equal(importActionErrorCopy(new Error('Request timed out')), 'No connection. Try again.');
  assert.equal(importActionErrorCopy(new Error('Network request failed')), 'No connection. Try again.');
  assert.equal(importActionErrorCopy(new Error('Resolve failed: 500')), 'That answer did not save. Try again.');
});
