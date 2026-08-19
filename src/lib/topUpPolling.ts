export type TopUpPollVerdict = 'confirmed' | 'pending' | 'failed';

type SummaryRecord = Record<string, unknown>;

const TOP_UP_FIELDS = [
  'ai_topup_remaining_cents',
  'ai_topup_total_cents',
  'last_topup_cents',
  'last_topup_at',
] as const;

function isRecord(value: unknown): value is SummaryRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasTopUpFields(summary: SummaryRecord): boolean {
  return TOP_UP_FIELDS.some(field => Object.prototype.hasOwnProperty.call(summary, field));
}

/**
 * Compare a pre-checkout billing snapshot with one polling response.
 *
 * RW10 summaries are confirmed by a larger top-up balance or a newer fulfillment
 * timestamp. Older summaries fall back to the combined AI-credit balance. A response
 * that cannot be compared safely is failed so the UI can stop polling and be honest.
 */
export function decideTopUpPoll(
  snapshot: unknown,
  summary: unknown,
): TopUpPollVerdict {
  if (!isRecord(snapshot) || !isRecord(summary)) return 'failed';

  const previousRemaining = finiteNumber(snapshot.ai_topup_remaining_cents);
  const nextRemaining = finiteNumber(summary.ai_topup_remaining_cents);
  if (nextRemaining !== null && nextRemaining > (previousRemaining ?? 0)) {
    return 'confirmed';
  }

  const previousTopUpAt = timestamp(snapshot.last_topup_at);
  const nextTopUpAt = timestamp(summary.last_topup_at);
  if (nextTopUpAt !== null && (previousTopUpAt === null || nextTopUpAt > previousTopUpAt)) {
    return 'confirmed';
  }

  if (hasTopUpFields(summary)) return 'pending';

  const previousCredits = finiteNumber(snapshot.ai_credits_cents);
  const nextCredits = finiteNumber(summary.ai_credits_cents);
  if (previousCredits === null || nextCredits === null) return 'failed';

  return nextCredits > previousCredits ? 'confirmed' : 'pending';
}
