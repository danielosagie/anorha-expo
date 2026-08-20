import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldOpenImportQuestionQueue } from '../src/lib/connectionImportRoute.ts';

test('a bare review presentation with no attention skips the question queue', () => {
  const latchedReview = {
    kind: 'review' as const,
    importInProgress: false,
    attentionCount: 0,
  };

  assert.equal(shouldOpenImportQuestionQueue(latchedReview), false);
});

test('live import progress opens the question queue even before attention exists', () => {
  assert.equal(shouldOpenImportQuestionQueue({
    importInProgress: true,
    attentionCount: 0,
  }), true);
});

test('positive attention opens the question queue after import progress ends', () => {
  assert.equal(shouldOpenImportQuestionQueue({
    importInProgress: false,
    attentionCount: 2,
  }), true);
});

test('a healthy connection with no live queue signal skips the question queue', () => {
  assert.equal(shouldOpenImportQuestionQueue({
    importInProgress: false,
    attentionCount: null,
  }), false);
});
