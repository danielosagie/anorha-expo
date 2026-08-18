import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isErrorShapedInsight,
  resolveInsightSnapshot,
  sanitizePersistedInsightSnapshot,
  shouldPersistInsightSnapshot,
  type InsightCacheSnapshotLike,
} from '../src/lib/orgInsightCache.ts';

const realInsight = {
  topDIN: { category: 'Inventory', headline: 'Three listings need attention' },
  bottomDIN: { title: 'Inventory', description: 'Review the listings.' },
};

const errorInsight = {
  topDIN: { category: 'Error', headline: 'Unable to load insights' },
  bottomDIN: { title: 'Error', description: 'Please try refreshing in a moment.' },
};

const snapshot = (
  insight: unknown,
  generatedAt: string,
  contentHash: string,
): InsightCacheSnapshotLike => ({
  insight,
  recommendationId: contentHash,
  contentHash,
  generatedAt,
  nextRefreshAt: null,
});

test('error-shaped insight is never persisted and never beats a real cache snapshot', () => {
  const cached = snapshot(realInsight, '2026-08-17T09:00:00.000Z', 'real');
  const fallback = snapshot(errorInsight, '2026-08-18T09:00:00.000Z', 'error');

  assert.equal(isErrorShapedInsight(errorInsight), true);
  assert.equal(shouldPersistInsightSnapshot(fallback), false);
  assert.strictEqual(resolveInsightSnapshot(cached, fallback), cached);
  assert.equal(resolveInsightSnapshot(null, fallback), null);
});

test('isErrorFallback payload markers are rejected', () => {
  const flagged = snapshot({ ...realInsight, isErrorFallback: true }, '2026-08-18T09:00:00.000Z', 'flagged');

  assert.equal(isErrorShapedInsight({ isErrorFallback: true, insight: realInsight }), true);
  assert.equal(shouldPersistInsightSnapshot(flagged), false);
});

test('poisoned persisted snapshot is dropped during hydration', () => {
  const poisoned = snapshot(errorInsight, '2026-08-18T09:00:00.000Z', 'error');

  assert.equal(sanitizePersistedInsightSnapshot(poisoned), null);
  assert.equal(sanitizePersistedInsightSnapshot({ ...poisoned, isErrorFallback: true }), null);
});

test('stale real insight replaces an error-shaped current display despite its older timestamp', () => {
  const poisoned = snapshot(errorInsight, '2026-08-18T09:00:00.000Z', 'error');
  const staleLastGood = snapshot(realInsight, '2026-08-17T09:00:00.000Z', 'real');

  assert.strictEqual(resolveInsightSnapshot(poisoned, staleLastGood, true), staleLastGood);
});
