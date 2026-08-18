import test from 'node:test';
import assert from 'node:assert/strict';
import { greetingForClock } from '../src/lib/sproutHomeTime.ts';

test('greeting recomputes across an hour boundary with an injected clock', () => {
  let current = new Date(2026, 7, 18, 4, 59);
  const clock = () => current;

  assert.equal(greetingForClock(clock), 'Late night');
  current = new Date(2026, 7, 18, 5, 0);
  assert.equal(greetingForClock(clock), 'Good morning');
});
