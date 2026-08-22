const REVIEW_STATES = new Set(['review', 'needs-attention', 'needs_attention']);

export interface AttentionState {
  state: string;
  needsAttention: number;
  attentionVerified?: boolean;
}

/**
 * Applies an authoritative queue count to one aggregate connection. A verified
 * empty queue also retires the aggregate's stale review state; credential
 * health remains a separate connection-row concern.
 */
export function reconcileVerifiedAttentionCount<T extends AttentionState>(
  connection: T,
  verifiedCount: number,
): T & { attentionVerified: true } {
  const needsAttention = Number.isFinite(verifiedCount)
    ? Math.max(0, Math.floor(verifiedCount))
    : connection.needsAttention;
  const state = needsAttention === 0 && REVIEW_STATES.has(connection.state.trim().toLowerCase())
    ? 'active'
    : connection.state;

  return {
    ...connection,
    state,
    needsAttention,
    attentionVerified: true,
  };
}

export type ReviewQueueCompletion = 'receipt' | 'questions_remain' | 'could_not_verify';

/** The queue receipt is safe only after all three authoritative reads settle. */
export function decideReviewQueueCompletion({
  remainingQuestionCount,
  inboxSummaryRefreshed,
  connectionsRefreshed,
}: {
  remainingQuestionCount: number | null;
  inboxSummaryRefreshed: boolean;
  connectionsRefreshed: boolean;
}): ReviewQueueCompletion {
  if (remainingQuestionCount === null) return 'could_not_verify';
  if (remainingQuestionCount > 0) return 'questions_remain';
  return inboxSummaryRefreshed && connectionsRefreshed
    ? 'receipt'
    : 'could_not_verify';
}
