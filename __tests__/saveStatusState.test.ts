import assert from 'node:assert/strict';
import test from 'node:test';

import {
  initialSaveStatusState,
  saveStatusReducer,
  type SaveStatusState,
} from '../src/context/saveStatusState.ts';

const NOW = 1_755_000_000_000;

function run(events: Parameters<typeof saveStatusReducer>[1][]): SaveStatusState {
  return events.reduce(saveStatusReducer, initialSaveStatusState);
}

test('idle is the resting state and renders nothing', () => {
  assert.equal(initialSaveStatusState.status, 'idle');
  assert.equal(initialSaveStatusState.pending, 0);
});

test('a save in flight reads as saving', () => {
  const state = run([{ type: 'start' }]);
  assert.equal(state.status, 'saving');
  assert.equal(state.pending, 1);
});

test('a landed save reads as saved and records when', () => {
  const state = run([{ type: 'start' }, { type: 'settle', ok: true, now: NOW }]);
  assert.deepEqual(state, { status: 'saved', pending: 0, settledAt: NOW });
});

test('a failed save falls back to idle, never to saved', () => {
  const state = run([{ type: 'start' }, { type: 'settle', ok: false, now: NOW }]);
  assert.deepEqual(state, { status: 'idle', pending: 0, settledAt: 0 });
});

test('overlapping saves stay on saving until the last one lands', () => {
  const one = run([{ type: 'start' }, { type: 'start' }, { type: 'settle', ok: true, now: NOW }]);
  assert.equal(one.status, 'saving');
  assert.equal(one.pending, 1);

  const two = saveStatusReducer(one, { type: 'settle', ok: true, now: NOW + 10 });
  assert.deepEqual(two, { status: 'saved', pending: 0, settledAt: NOW + 10 });
});

test('one failure among overlapping saves does not claim saved', () => {
  const state = run([
    { type: 'start' },
    { type: 'start' },
    { type: 'settle', ok: true, now: NOW },
    { type: 'settle', ok: false, now: NOW + 10 },
  ]);
  assert.equal(state.status, 'idle');
});

test('a new save supersedes the saved tag still on screen', () => {
  const saved = run([{ type: 'start' }, { type: 'settle', ok: true, now: NOW }]);
  const again = saveStatusReducer(saved, { type: 'start' });
  assert.deepEqual(again, { status: 'saving', pending: 1, settledAt: 0 });
});

test('a stray settle cannot push pending negative or strand the tag', () => {
  const stray = saveStatusReducer(initialSaveStatusState, { type: 'settle', ok: true, now: NOW });
  assert.equal(stray, initialSaveStatusState, 'no-op settle returns the same reference');

  const state = run([
    { type: 'start' },
    { type: 'settle', ok: true, now: NOW },
    { type: 'settle', ok: true, now: NOW + 10 },
    { type: 'start' },
  ]);
  assert.equal(state.pending, 1, 'pending never went below zero');
});

test('clear only retires a saved tag, and leaves saving alone', () => {
  const saved = run([{ type: 'start' }, { type: 'settle', ok: true, now: NOW }]);
  assert.deepEqual(saveStatusReducer(saved, { type: 'clear' }), initialSaveStatusState);

  const saving = run([{ type: 'start' }]);
  assert.equal(saveStatusReducer(saving, { type: 'clear' }), saving, 'same reference, no churn');
});

test('reset wipes an in-flight save and is a no-op when already idle', () => {
  const saving = run([{ type: 'start' }, { type: 'start' }]);
  assert.deepEqual(saveStatusReducer(saving, { type: 'reset' }), initialSaveStatusState);
  assert.equal(
    saveStatusReducer(initialSaveStatusState, { type: 'reset' }),
    initialSaveStatusState,
    'same reference so useSyncExternalStore does not loop',
  );
});
