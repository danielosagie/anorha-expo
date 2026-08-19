import test from 'node:test';
import assert from 'node:assert/strict';
import { createConcurrencyLimiter, mapWithConcurrency } from '../src/utils/mapWithConcurrency.ts';

test('mapWithConcurrency preserves input order while limiting active tasks to three', async () => {
  let active = 0;
  let maximumActive = 0;

  const actual = await mapWithConcurrency([35, 5, 25, 10, 20, 15], 3, async (delayMs, index) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    active -= 1;
    return `item-${index}`;
  });

  const expected = ['item-0', 'item-1', 'item-2', 'item-3', 'item-4', 'item-5'];
  assert.deepEqual(actual, expected, `expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`);
  assert.equal(maximumActive, 3, `expected maximum active tasks 3, actual ${maximumActive}`);
});

test('createConcurrencyLimiter releases a slot after a task rejects', async () => {
  const runWithLimit = createConcurrencyLimiter(1);
  const events: string[] = [];

  const failed = runWithLimit(async () => {
    events.push('first-start');
    throw new Error('expected failure');
  });
  const succeeded = runWithLimit(async () => {
    events.push('second-start');
    return 'second-result';
  });

  await assert.rejects(failed, /expected failure/);
  const actual = await succeeded;
  const expectedEvents = ['first-start', 'second-start'];
  assert.equal(actual, 'second-result', `expected second-result, actual ${actual}`);
  assert.deepEqual(events, expectedEvents, `expected ${JSON.stringify(expectedEvents)}, actual ${JSON.stringify(events)}`);
});

test('createConcurrencyLimiter rejects invalid limits', () => {
  assert.throws(
    () => createConcurrencyLimiter(0),
    /positive integer/,
    'expected limit 0 to throw a positive-integer error, actual no error',
  );
});
