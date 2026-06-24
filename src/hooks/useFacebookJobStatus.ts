/**
 * useFacebookJobStatus — realtime per-variant Facebook dispatch status + the
 * computer-online signal, derived from the BACKEND browserJobs Convex
 * deployment (the 2nd client, see BrowserJobsConvexProvider).
 *
 * BINDING NOTE: we deliberately subscribe via `client.watchQuery(...)` directly
 * rather than `convex/react`'s useQuery. useQuery binds to the NEAREST
 * ConvexProvider, and the app's chat screens rely on the OUTER agent-chat
 * provider — using the client explicitly here means we never hijack chat reads
 * no matter where this hook mounts. The client + userId come from
 * useBrowserJobsConvexContext.
 *
 * DEGRADE: when client/userId is null (route 401/503, signed-out, offline cold
 * start) every selector returns a quiet/empty result and computerOnline=false.
 * Nothing throws.
 *
 * PHONE-OWNED THRESHOLDS (per backend note browserJobs.ts:269-272): the phone
 * owns PRESENCE_TTL_MS and the nextEligibleAt-vs-now comparison.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConvexReactClient } from 'convex/react';
import { useBrowserJobsConvexContext } from '../providers/BrowserJobsConvexProvider';
import {
  browserJobsApi,
  BrowserJobDoc,
  WorkerPresenceDoc,
} from '../convex/browserJobsApi';

// Consumer heartbeats ~25s; 60s = 2 missed beats of slack before we flip offline.
const PRESENCE_TTL_MS = 60_000;
// Local re-tick so the row flips offline without a new Convex push (presence
// stops streaming when the laptop dies).
const TICK_MS = 15_000;

export type DispatchTone = 'good' | 'problem' | 'quiet';

export interface VariantDispatchStatus {
  label: string;
  /** Text color for the label. */
  color: string;
  /** Small status dot color. */
  dotColor: string;
  tone: DispatchTone;
  /** Optional sub-label (e.g. the safety-pacing reassurance). */
  subtext?: string;
  /** Present when the row should open a live listing on tap. */
  listingUrl?: string | null;
  /** True when the row should offer a Retry affordance. */
  canRetry?: boolean;
  /** True when tapping should open the "Link your computer" help sheet. */
  opensComputerSheet?: boolean;
}

// Color vocabulary (matches ProductDetail alDot/alStatusText + the connection row).
const GREEN = '#16A34A';
const AMBER = '#BA7517'; // "needs a check" / "couldn't post"
const AMBER_GENTLE = '#FF9500'; // "will post when your computer's on"
const QUIET_TEXT = '#71717A';
const QUIET_DOT = '#9CA3AF';

function isFacebook(job: BrowserJobDoc): boolean {
  return (job.platform || '').toLowerCase() === 'facebook';
}

/**
 * Map one job + the computer-online signal to the dot+label vocabulary.
 * Order matters: paused/failed before terminal/in-flight states.
 */
function mapJob(job: BrowserJobDoc, computerOnline: boolean): VariantDispatchStatus {
  const status = (job.status || '').toLowerCase();
  const paused = !!job.paused || !!job.pausedReason;
  const failed = status === 'failed' || !!job.deadLetteredAt;

  // 1. Paused / breaker tripped. NEVER surface pausedReason (machine code).
  if (paused) {
    return {
      label: 'Needs a check',
      color: AMBER,
      dotColor: AMBER,
      tone: 'problem',
      opensComputerSheet: true,
    };
  }

  // 2. Failed / dead-lettered → amber "Couldn't post" + Retry (never red).
  if (failed) {
    return {
      label: "Couldn't post",
      color: AMBER,
      dotColor: AMBER,
      tone: 'problem',
      canRetry: true,
    };
  }

  // 3. Completed → Live (green). Tap opens the listing when present.
  if (status === 'completed') {
    return {
      label: 'Live',
      color: GREEN,
      dotColor: GREEN,
      tone: 'good',
      listingUrl: job.listingUrl ?? null,
    };
  }

  // 4. Processing → quiet "Posting…" (no spinner-as-alarm).
  if (status === 'processing') {
    return { label: 'Posting…', color: QUIET_TEXT, dotColor: QUIET_DOT, tone: 'quiet' };
  }

  // 5. Pending — split on whether the computer is on.
  if (status === 'pending') {
    if (!computerOnline) {
      return {
        label: "Will post when your computer's on",
        color: AMBER_GENTLE,
        dotColor: AMBER_GENTLE,
        tone: 'problem',
        opensComputerSheet: true,
      };
    }
    // Queued / posting soon — quiet; queuePosition/nextEligibleAt only change the
    // quiet label, never escalate color.
    const eligibleNow =
      !job.nextEligibleAt || job.nextEligibleAt <= Date.now();
    return {
      label: eligibleNow ? 'Posting soon' : 'Queued',
      color: QUIET_TEXT,
      dotColor: QUIET_DOT,
      tone: 'quiet',
      subtext: 'posting a few at a time to keep your account safe',
    };
  }

  // Fallback (queued or unknown) → quiet.
  return { label: 'Queued', color: QUIET_TEXT, dotColor: QUIET_DOT, tone: 'quiet' };
}

/** Subscribe to a single arg-scoped query on the explicit browserJobs client. */
function useWatchedQuery<T>(
  client: ConvexReactClient | null,
  fnName: any,
  args: Record<string, unknown> | 'skip',
): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  // Stabilize args by value so we don't resubscribe every render.
  const argsKey = args === 'skip' ? 'skip' : JSON.stringify(args);
  const lastKey = useRef<string>('');

  useEffect(() => {
    if (!client || args === 'skip') {
      setValue(undefined);
      return;
    }
    lastKey.current = argsKey;
    let watch;
    try {
      watch = client.watchQuery(fnName, args as any);
    } catch {
      setValue(undefined);
      return;
    }
    // Seed with any local result, then stream updates.
    try {
      const local = watch.localQueryResult();
      if (local !== undefined) setValue(local as T);
    } catch {
      /* no local result yet */
    }
    const unsubscribe = watch.onUpdate(() => {
      try {
        setValue(watch!.localQueryResult() as T);
      } catch {
        /* transient error during update */
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, argsKey]);

  return value;
}

export interface FacebookJobStatus {
  /** True when at least one worker has beaten within PRESENCE_TTL_MS. */
  computerOnline: boolean;
  /** True when ANY FB job is paused or dead-lettered (drives the connection row). */
  fbNeedsCheck: boolean;
  /** Per-variant dot+label selector. Returns null when there's no FB job. */
  statusForVariant: (variantId?: string | null) => VariantDispatchStatus | null;
  /** True when the 2nd Convex client is unavailable (degraded / OAuth-only). */
  degraded: boolean;
}

export function useFacebookJobStatus(): FacebookJobStatus {
  const { client, userId } = useBrowserJobsConvexContext();

  const jobs = useWatchedQuery<BrowserJobDoc[]>(
    client,
    browserJobsApi.browserJobs.getForUser,
    userId ? { userId } : 'skip',
  );
  const presence = useWatchedQuery<WorkerPresenceDoc[]>(
    client,
    browserJobsApi.workerPresence.getForUser,
    userId ? { userId } : 'skip',
  );

  // Local tick so presence-staleness flips offline without a Convex push.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), TICK_MS);
    return () => clearInterval(t);
  }, []);

  const computerOnline = useMemo(() => {
    if (!presence || presence.length === 0) return false;
    const now = Date.now();
    // A heartbeat with a missing platform is a generic worker = online for all;
    // also count an explicit facebook worker.
    return presence.some((d) => {
      const fresh = now - (d.lastSeenAt || 0) < PRESENCE_TTL_MS;
      const platformOk = !d.platform || d.platform.toLowerCase() === 'facebook';
      return fresh && platformOk;
    });
    // forceTick re-runs this via re-render; presence is the real dep.
  }, [presence]);

  const fbJobs = useMemo(
    () => (jobs || []).filter(isFacebook),
    [jobs],
  );

  const fbNeedsCheck = useMemo(
    () => fbJobs.some((j) => !!j.paused || !!j.pausedReason || !!j.deadLetteredAt),
    [fbJobs],
  );

  const statusForVariant = useMemo(() => {
    return (variantId?: string | null): VariantDispatchStatus | null => {
      if (!variantId) return null;
      // Most-recent FB job for this variant (getForUser returns desc by recency).
      const job = fbJobs.find((j) => j.variantId === variantId);
      if (!job) return null;
      return mapJob(job, computerOnline);
    };
  }, [fbJobs, computerOnline]);

  return {
    computerOnline,
    fbNeedsCheck,
    statusForVariant,
    degraded: !client || !userId,
  };
}
