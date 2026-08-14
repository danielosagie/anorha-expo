import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getToastDuration,
  initialToastState,
  normalizeToastTitle,
  toastReducer,
} from '../src/context/toastState.ts';

test('a new toast replaces the visible toast without a queue', () => {
  const first = toastReducer(initialToastState, {
    type: 'show',
    input: { title: 'First update', tone: 'neutral' },
    now: 100,
  });
  const second = toastReducer(first, {
    type: 'show',
    input: { title: 'Second update', tone: 'success' },
    now: 200,
  });

  assert.equal(second.current?.title, 'Second update');
  assert.equal(second.current?.id, 2);
  assert.equal(second.nextId, 3);
});

test('a stale dismiss cannot clear a replacement toast', () => {
  const first = toastReducer(initialToastState, {
    type: 'show',
    input: { title: 'First update', tone: 'neutral' },
    now: 100,
  });
  const second = toastReducer(first, {
    type: 'show',
    input: { title: 'Second update', tone: 'success' },
    now: 200,
  });
  const afterStaleDismiss = toastReducer(second, { type: 'dismiss', id: 1 });
  const afterCurrentDismiss = toastReducer(afterStaleDismiss, { type: 'dismiss', id: 2 });

  assert.equal(afterStaleDismiss.current?.id, 2);
  assert.equal(afterCurrentDismiss.current, null);
});

test('duration is three seconds without an action and five with one', () => {
  assert.equal(getToastDuration({}), 3000);
  assert.equal(getToastDuration({ action: { label: 'Undo', onPress: () => undefined } }), 5000);
});

test('titles are constrained to one to four words and reject non-string errors', () => {
  assert.equal(normalizeToastTitle('  Inventory   updated from external source  '), 'Inventory updated from external');
  assert.equal(normalizeToastTitle(''), 'Update');
  assert.equal(normalizeToastTitle(new Error('private server detail') as unknown as string), 'Something went wrong');
});
