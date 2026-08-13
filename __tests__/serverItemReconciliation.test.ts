import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileMutationSuccess,
  requireServerItem,
} from '../src/features/products/serverItemReconciliation.ts';

test('PUT success replaces local canonical fields from response.item and preserves explicit null', () => {
  const local = { Title: 'Local title', Description: 'Stale description', Price: 14, localOnly: true };
  const response = { item: { Id: 'variant-1', Title: 'Server title', Description: null, Price: 15 } };

  const reconciled = reconcileMutationSuccess(local, response);

  assert.equal(reconciled.Title, 'Server title');
  assert.equal(reconciled.Description, null);
  assert.equal(reconciled.Price, 15);
  assert.equal(reconciled.localOnly, true);
});

test('publish success uses response.item and a submitted request is never a success fallback', () => {
  const submittedRequest = { Title: 'Submitted title', Description: 'Submitted description' };
  const local = { Title: 'Before publish', Description: 'Before publish' };
  const response = { item: { Title: 'Stored title', Description: null } };

  const reconciled = reconcileMutationSuccess(local, response);

  assert.notEqual(reconciled.Title, submittedRequest.Title);
  assert.equal(reconciled.Title, 'Stored title');
  assert.equal(reconciled.Description, null);
  assert.throws(
    () => requireServerItem({ message: 'ok' }),
    /missing item/,
    'a successful response without item must fail instead of applying the submitted request',
  );
});
