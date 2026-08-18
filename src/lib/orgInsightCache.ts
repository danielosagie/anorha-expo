export interface InsightCacheSnapshotLike {
  insight: unknown;
  recommendationId: string | null;
  contentHash: string;
  generatedAt: string | null;
  nextRefreshAt: string | null;
}

type InsightRecord = Record<string, unknown>;

const asRecord = (value: unknown): InsightRecord | null =>
  value !== null && typeof value === 'object' ? value as InsightRecord : null;

export function isErrorShapedInsight(value: unknown): boolean {
  const insight = asRecord(value);
  if (!insight) return false;
  if (insight.isErrorFallback === true) return true;

  const topDIN = asRecord(insight.topDIN);
  if (typeof topDIN?.category === 'string' && topDIN.category.trim().toLowerCase() === 'error') {
    return true;
  }

  return Array.isArray(insight.insights) && insight.insights.some(isErrorShapedInsight);
}

export function sanitizePersistedInsightSnapshot(
  value: unknown,
): (InsightRecord & { insight: unknown }) | null {
  const snapshot = asRecord(value);
  if (
    !snapshot ||
    !('insight' in snapshot) ||
    isErrorShapedInsight(snapshot) ||
    isErrorShapedInsight(snapshot.insight)
  ) {
    return null;
  }
  return snapshot as InsightRecord & { insight: unknown };
}

export function shouldPersistInsightSnapshot(
  snapshot: InsightCacheSnapshotLike | null,
): snapshot is InsightCacheSnapshotLike {
  return snapshot !== null && !isErrorShapedInsight(snapshot.insight);
}

export function resolveInsightSnapshot<TSnapshot extends InsightCacheSnapshotLike>(
  previous: TSnapshot | null,
  incoming: TSnapshot,
  incomingIsStale = false,
): TSnapshot | null {
  const previousIsError = previous !== null && isErrorShapedInsight(previous.insight);
  const incomingIsError = isErrorShapedInsight(incoming.insight);

  if (incomingIsStale && previousIsError && !incomingIsError) return incoming;
  if (incomingIsError) return previousIsError ? null : previous;
  if (!previous || previousIsError) return incoming;

  const previousTime = previous.generatedAt ? Date.parse(previous.generatedAt) : NaN;
  const incomingTime = incoming.generatedAt ? Date.parse(incoming.generatedAt) : NaN;
  if (Number.isFinite(previousTime) && Number.isFinite(incomingTime) && incomingTime < previousTime) {
    return previous;
  }

  const identityChanged =
    (incoming.recommendationId !== null && incoming.recommendationId !== previous.recommendationId) ||
    incoming.contentHash !== previous.contentHash ||
    (incoming.generatedAt !== null && incoming.generatedAt !== previous.generatedAt);

  if (identityChanged) return incoming;

  return {
    ...previous,
    generatedAt: incoming.generatedAt ?? previous.generatedAt,
    nextRefreshAt: incoming.nextRefreshAt ?? previous.nextRefreshAt,
  };
}
