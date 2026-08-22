export type PublishOutcomeStatus =
  | 'pending'
  | 'success'
  | 'failed'
  | 'confirmation_unknown';

export interface PublishOutcome {
  status: PublishOutcomeStatus;
  error?: string;
}

export type PublishOutcomeMap = Record<string, PublishOutcome>;

export interface PublishResultLike {
  platform?: unknown;
  success?: unknown;
  error?: unknown;
}

const platformKey = (value: unknown): string => String(value || '').trim().toLowerCase();

export function initializePublishOutcomes(platforms: readonly string[]): PublishOutcomeMap {
  return Object.fromEntries(
    Array.from(new Set(platforms.map(platformKey).filter(Boolean)))
      .map((platform) => [platform, { status: 'pending' as const }]),
  );
}

/**
 * Completes every requested platform from an explicit result. Missing or
 * ambiguous results are unknown, never inferred successes from the HTTP code.
 */
export function reconcilePublishOutcomes(
  requestedPlatforms: readonly string[],
  results: readonly PublishResultLike[] | null | undefined,
): PublishOutcomeMap {
  const byPlatform = new Map<string, PublishResultLike>();
  for (const result of results || []) {
    const platform = platformKey(result?.platform);
    if (platform) byPlatform.set(platform, result);
  }

  const outcomes = initializePublishOutcomes(requestedPlatforms);
  for (const platform of Object.keys(outcomes)) {
    const result = byPlatform.get(platform);
    if (!result || (result.success !== true && result.success !== false)) {
      outcomes[platform] = { status: 'confirmation_unknown' };
    } else if (result.success === true) {
      outcomes[platform] = { status: 'success' };
    } else {
      const error = typeof result.error === 'string' && result.error.trim()
        ? result.error.trim()
        : undefined;
      outcomes[platform] = { status: 'failed', ...(error ? { error } : {}) };
    }
  }
  return outcomes;
}

export function countProvenPublishSuccesses(
  platforms: readonly string[],
  outcomes: PublishOutcomeMap,
): number {
  return platforms.filter((platform) => outcomes[platformKey(platform)]?.status === 'success').length;
}

export interface PublishOutcomeClaim {
  label: string;
  tone: 'success' | 'warning' | 'neutral';
  action: 'retry' | 'recheck' | null;
  canClaimLive: boolean;
}

export function publishOutcomeClaim(
  outcome: PublishOutcome | undefined,
  platformLabel: string,
): PublishOutcomeClaim {
  if (outcome?.status === 'success') {
    return { label: 'Live', tone: 'success', action: null, canClaimLive: true };
  }
  if (outcome?.status === 'failed') {
    return { label: 'Didn’t publish', tone: 'warning', action: 'retry', canClaimLive: false };
  }
  if (outcome?.status === 'confirmation_unknown') {
    return {
      label: `Couldn't confirm - check ${platformLabel}`,
      tone: 'neutral',
      action: 'recheck',
      canClaimLive: false,
    };
  }
  return { label: 'Checking', tone: 'neutral', action: null, canClaimLive: false };
}

export type PublishStartDecision = 'publishing' | 'error';

export function decidePublishStart(hasPayload: boolean): PublishStartDecision {
  return hasPayload ? 'publishing' : 'error';
}
