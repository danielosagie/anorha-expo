/**
 * useComputerJobStatus: realtime per-variant computer-mediated dispatch status and the
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
 * DEGRADE: a bootstrap or subscription failure is exposed separately from the
 * first load. Callers show a quiet unknown state and never treat it as proof
 * that the seller's computer is offline. Nothing throws.
 *
 * PHONE-OWNED THRESHOLDS (per backend note browserJobs.ts:269-272): the phone
 * owns PRESENCE_TTL_MS and the nextEligibleAt-vs-now comparison.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConvexReactClient } from 'convex/react';
import { useBrowserJobsConvexContext } from '../providers/BrowserJobsConvexProvider';
import {
  browserJobsApi,
  BrowserJobDoc,
  WorkerPresenceDoc,
} from '../convex/browserJobsApi';
import { getBrowserJobCopy } from '../lib/browserJobCodes';
import { computerJobMatchesPlatform, isComputerJob } from '../lib/computerJobs';

// Consumer heartbeats about every 25s; wait for two missed beats before flipping offline.
const PRESENCE_TTL_MS = 60_000;
// Local re-tick so the row flips offline without a new Convex push (presence
// stops streaming when the laptop dies).
const TICK_MS = 15_000;
const WATCH_RETRY_MS = [1_000, 2_000, 5_000, 10_000, 15_000] as const;

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
const GREEN = '#93C822';
const AMBER = '#BA7517'; // "needs a check" / "couldn't post"
const AMBER_GENTLE = '#FF9500'; // "will post when your computer's on"
const QUIET_TEXT = '#71717A';
const QUIET_DOT = '#9CA3AF';

/**
 * Map one job + the computer-online signal to the dot+label vocabulary.
 * Order matters: paused/failed before terminal/in-flight states.
 */
function mapJob(
  job: BrowserJobDoc,
  presence: { computerOnline: boolean; loaded: boolean; unavailable: boolean },
): VariantDispatchStatus {
  const status = (job.status || '').toLowerCase();
  const paused = !!job.paused || !!job.pausedReason;
  const failed = status === 'failed' || !!job.deadLetteredAt;

  // 1. Paused. Translate the typed machine code through the seller-safe map.
  if (paused) {
    return {
      label: getBrowserJobCopy(job.pausedReason, job.platform),
      color: AMBER,
      dotColor: AMBER,
      tone: 'problem',
      opensComputerSheet: true,
    };
  }

  // 2. Failed / dead-lettered. The free-text errorMessage is never rendered.
  if (failed) {
    return {
      label: getBrowserJobCopy(job.errorCode, job.platform),
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
    if (presence.unavailable) {
      return {
        label: "Can't check now",
        color: QUIET_TEXT,
        dotColor: QUIET_DOT,
        tone: 'quiet',
      };
    }
    if (!presence.loaded) {
      return { label: 'Checking', color: QUIET_TEXT, dotColor: QUIET_DOT, tone: 'quiet' };
    }
    if (!presence.computerOnline) {
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

interface WatchedQueryResult<T> {
  value: T | undefined;
  unavailable: boolean;
}

/** Subscribe to a single arg-scoped query on the explicit browserJobs client. */
function useWatchedQuery<T>(
  client: ConvexReactClient | null,
  fnName: any,
  args: Record<string, unknown> | 'skip',
  refreshKey: number = 0,
): WatchedQueryResult<T> {
  const [value, setValue] = useState<T | undefined>(undefined);
  const [unavailable, setUnavailable] = useState(false);
  // Stabilize args by value so we don't resubscribe every render.
  const argsKey = args === 'skip' ? 'skip' : JSON.stringify(args);
  const lastKey = useRef<string>('');

  useEffect(() => {
    if (!client || args === 'skip') {
      setValue(undefined);
      setUnavailable(false);
      return;
    }
    if (lastKey.current !== argsKey) {
      lastKey.current = argsKey;
      setValue(undefined);
      setUnavailable(false);
    }

    let stopped = false;
    let retryAttempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | undefined;

    const clearWatch = () => {
      if (unsubscribe) unsubscribe();
      unsubscribe = undefined;
    };

    const subscribe = () => {
      if (stopped) return;
      clearWatch();
      let watch: any;
      try {
        watch = client.watchQuery(fnName, args as any);
      } catch {
        scheduleRetry();
        return;
      }

      const read = (): boolean => {
        try {
          const next = watch.localQueryResult();
          if (next !== undefined) {
            setValue(next as T);
            setUnavailable(false);
            retryAttempt = 0;
          }
          return true;
        } catch {
          scheduleRetry();
          return false;
        }
      };

      // Seed with any local result, then stream updates. A thrown read is a real
      // unavailable state, not an endless loading state.
      if (!read()) return;
      try {
        unsubscribe = watch.onUpdate(() => { read(); });
      } catch {
        scheduleRetry();
      }
    };

    const scheduleRetry = () => {
      if (stopped || retryTimer) return;
      clearWatch();
      setUnavailable(true);
      const delay = WATCH_RETRY_MS[Math.min(retryAttempt, WATCH_RETRY_MS.length - 1)];
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        subscribe();
      }, delay);
    };

    subscribe();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      clearWatch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, argsKey, refreshKey]);

  return { value, unavailable };
}

/** One linked computer, derived from a worker-presence heartbeat. */
export interface ConnectedComputer {
  /** Stable presence id per worker (unique by user+worker). */
  id: string;
  workerId?: string;
  /** True when the last heartbeat is within PRESENCE_TTL_MS. */
  online: boolean;
  /** Epoch ms of the last heartbeat (0 if never seen). */
  lastSeenAt: number;
}

export interface ComputerJobStatus {
  /** True when at least one worker has beaten within PRESENCE_TTL_MS. */
  computerOnline: boolean;
  /** True when any computer-mediated job is paused or dead-lettered. */
  computerNeedsCheck: boolean;
  /** The linked computers (worker presence), newest heartbeat first. */
  computers: ConnectedComputer[];
  /** Per-variant selector, optionally scoped to one registry platform. */
  statusForVariant: (
    variantId?: string | null,
    platform?: string | null,
  ) => VariantDispatchStatus | null;
  /** True when the 2nd Convex client is unavailable (degraded / OAuth-only). */
  degraded: boolean;
  /** True when the jobs subscription failed and is retrying. */
  jobsUnavailable: boolean;
  /** True when the presence subscription failed and is retrying. */
  presenceUnavailable: boolean;
  /** True once the first jobs result lands. */
  jobsLoaded: boolean;
  /** False while the first presence result is still in flight — callers must
   *  not read computerOnline=false as "offline" until this flips true. */
  presenceLoaded: boolean;
  /** Reopen the presence subscription after a device-side mutation. */
  refreshPresence: () => void;
}

export function useComputerJobStatus(enabled: boolean = true): ComputerJobStatus {
  const {
    client,
    userId,
    loading: bootstrapLoading,
    degraded,
  } = useBrowserJobsConvexContext();

  const [presenceRefreshKey, setPresenceRefreshKey] = useState(0);
  const refreshPresence = useCallback(() => {
    setPresenceRefreshKey((key) => key + 1);
  }, []);

  const jobsQuery = useWatchedQuery<BrowserJobDoc[]>(
    client,
    browserJobsApi.browserJobs.getForUser,
    enabled && userId ? { userId } : 'skip',
  );
  const presenceQuery = useWatchedQuery<WorkerPresenceDoc[]>(
    client,
    browserJobsApi.workerPresence.getForUser,
    enabled && userId ? { userId } : 'skip',
    presenceRefreshKey,
  );
  const jobs = jobsQuery.value;
  const presence = presenceQuery.value;
  const jobsUnavailable = enabled && (degraded || jobsQuery.unavailable);
  const presenceUnavailable = enabled && (degraded || presenceQuery.unavailable);
  const jobsLoaded = !enabled || jobs !== undefined || (!client && !bootstrapLoading && !degraded);
  const presenceLoaded = !enabled || presence !== undefined || (!client && !bootstrapLoading && !degraded);

  // Local tick so presence-staleness flips offline without a Convex push.
  const [tick, forceTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => forceTick((n) => n + 1), TICK_MS);
    return () => clearInterval(t);
  }, [enabled]);

  const computerOnline = useMemo(() => {
    if (!presence || presence.length === 0) return false;
    const now = Date.now();
    // Do not filter presence.platform. One worker serves every marketplace, and
    // the presence row carries no marketplace identity.
    return presence.some((d) => now - (d.lastSeenAt || 0) < PRESENCE_TTL_MS);
    // `tick` forces a recompute against a fresh Date.now() every TICK_MS, so a
    // gone-stale heartbeat flips offline even with no new presence push.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presence, tick]);

  // The connected computers — one row per worker (presence is unique per worker),
  // newest heartbeat first. `tick` keeps `online` fresh as heartbeats go stale.
  const computers = useMemo<ConnectedComputer[]>(() => {
    if (!presence || presence.length === 0) return [];
    const now = Date.now();
    return [...presence]
      .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0))
      .map((d) => ({
        id: d._id,
        workerId: d.workerId,
        online: now - (d.lastSeenAt || 0) < PRESENCE_TTL_MS,
        lastSeenAt: d.lastSeenAt || 0,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presence, tick]);

  const computerJobs = useMemo(
    () => (jobs || []).filter(isComputerJob),
    [jobs],
  );

  const computerNeedsCheck = useMemo(
    () => computerJobs.some((job) => !!job.paused || !!job.pausedReason || !!job.deadLetteredAt),
    [computerJobs],
  );

  const statusForVariant = useMemo(() => {
    return (variantId?: string | null, platform?: string | null): VariantDispatchStatus | null => {
      if (!variantId) return null;
      if (jobsUnavailable) {
        return {
          label: "Can't check now",
          color: QUIET_TEXT,
          dotColor: QUIET_DOT,
          tone: 'quiet',
        };
      }
      // Most-recent matching job for this variant (getForUser returns desc by recency).
      const job = computerJobs.find((candidate) => (
        candidate.variantId === variantId
        && computerJobMatchesPlatform(candidate, platform)
      ));
      if (!job) return null;
      return mapJob(job, {
        computerOnline,
        loaded: presenceLoaded,
        unavailable: presenceUnavailable,
      });
    };
  }, [computerJobs, computerOnline, jobsUnavailable, presenceLoaded, presenceUnavailable]);

  return {
    computerOnline,
    computerNeedsCheck,
    computers,
    statusForVariant,
    degraded,
    jobsUnavailable,
    presenceUnavailable,
    jobsLoaded,
    // useWatchedQuery yields undefined until the first result lands — that's
    // "loading", not "no computers". (In degraded mode it never loads; treat
    // as loaded so callers fall back to their degraded handling.)
    presenceLoaded,
    refreshPresence,
  };
}
