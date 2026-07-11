import { useCallback, useMemo, useRef, useState } from 'react';
import { ensureSupabaseJwt, supabase } from '../lib/supabase';
import { API_BASE_URL } from '../config/env';
import { OPTIMIZER_THRESHOLDS } from './useOptimizerQueues';
import { createLogger } from '../utils/logger';

const log = createLogger('useBatchGenerate');

// ── Real bulk AI content generation for the optimizer's "Batch Magic" step ──
//
// There is exactly ONE generation path that is real end-to-end in the current
// backend: POST /api/products/regenerate/submit (RegenerateJobProcessor →
// AiGenerationService). That job GENERATES title/description but does NOT write
// them to ProductVariants — it only stores results on the job + emits a socket
// event. So this hook does the persistence itself, writing the generated fields
// straight to ProductVariants (the same table/columns OptimizerReviewView writes
// and useOptimizerQueues reads), which is what makes the queue actually shrink.
//
// (The /backfill/* "bulk_ai_backfill" path is scaffolding — hardcoded template
//  strings, AI call commented out, never writes ProductVariants.Title — so it is
//  deliberately NOT used here.)

export type BatchItemStatus = 'idle' | 'queued' | 'generating' | 'done' | 'failed';
export type BatchPhase = 'idle' | 'running' | 'settled';

export interface BatchGenerateInput {
  /** ProductVariants.Id — the optimizer queue's item id. */
  variantId: string;
  /** Image URLs for AI context (the generator works from images when there's no scraped source). */
  imageUrls?: string[];
  /** Current values, so we can tell whether generation actually closes the gap. */
  existingTitle?: string;
  existingDescription?: string;
}

// The backend throttles regenerate/status to 3 req/min (@Throttle limit:3,
// ttl:60000). Poll slower than 20s so one job's polling can never trip the 429
// limiter. Regenerate jobs take minutes, so a ~25s cadence costs nothing.
const POLL_INTERVAL_MS = 25_000;
// Stop waiting (mark still-pending items failed/retryable) after this long.
const MAX_WAIT_MS = 20 * 60_000;
// Canonical target platform: title/description are platform-agnostic, and
// 'shopify' yields a full long-form title+description we map onto the canonical
// ProductVariants fields.
const TARGET_PLATFORM = 'shopify';

const titleOk = (t?: string | null) =>
  (t || '').trim().length >= OPTIMIZER_THRESHOLDS.minTitleLength;
const descOk = (d?: string | null) =>
  (d || '').length >= OPTIMIZER_THRESHOLDS.minDescriptionLength;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface GeneratedContent {
  title?: string;
  description?: string;
}

/** Pull the first usable {title, description} out of a result's per-platform map. */
function extractContent(result: any): GeneratedContent {
  const platforms = result?.platforms;
  if (!platforms || typeof platforms !== 'object') return {};
  for (const value of Object.values(platforms)) {
    if (!value || typeof value !== 'object') continue;
    if ((value as any).error) continue;
    const title = typeof (value as any).title === 'string' ? (value as any).title.trim() : '';
    const description =
      typeof (value as any).description === 'string' ? (value as any).description.trim() : '';
    if (title || description) return { title, description };
  }
  return {};
}

export interface UseBatchGenerateResult {
  phase: BatchPhase;
  /** Per-variant status, keyed by variantId. Cumulative across retries. */
  statuses: Record<string, BatchItemStatus>;
  doneIds: string[];
  failedIds: string[];
  /** Items whose job has completed this run (for the "X of N" footer). */
  progressCount: number;
  totalCount: number;
  errorSummary: string | null;
  /** Submit + generate + persist for these items. Safe to call again with only failed items. */
  run: (items: BatchGenerateInput[]) => Promise<void>;
  reset: () => void;
}

export function useBatchGenerate(): UseBatchGenerateResult {
  const [phase, setPhase] = useState<BatchPhase>('idle');
  const [statuses, setStatuses] = useState<Record<string, BatchItemStatus>>({});
  const [errorSummary, setErrorSummary] = useState<string | null>(null);
  const [progressCount, setProgressCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const runningRef = useRef(false);

  const setStatus = useCallback((ids: string[], status: BatchItemStatus) => {
    if (ids.length === 0) return;
    setStatuses((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = status;
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setPhase('idle');
    setStatuses({});
    setErrorSummary(null);
    setProgressCount(0);
    setTotalCount(0);
  }, []);

  const run = useCallback(
    async (items: BatchGenerateInput[]) => {
      if (runningRef.current || items.length === 0) return;
      runningRef.current = true;
      setErrorSummary(null);
      setPhase('running');
      setProgressCount(0);
      setTotalCount(items.length);

      const byVariant = new Map(items.map((it) => [it.variantId, it]));
      // Mark this run's items queued; leave any previously-done items untouched.
      setStatus(items.map((it) => it.variantId), 'queued');

      const markDone: string[] = [];
      const markFailed: string[] = [];

      try {
        const token = await ensureSupabaseJwt();
        if (!token) {
          setStatus(items.map((it) => it.variantId), 'failed');
          setErrorSummary('You’re signed out. Sign in again and retry.');
          setPhase('settled');
          return;
        }

        // regenerate/submit validates + needs the parent ProductId, which the
        // optimizer queue rows don't carry — resolve it in one query.
        const variantIds = items.map((it) => it.variantId);
        const { data: rows, error: rowErr } = await supabase
          .from('ProductVariants')
          .select('Id, ProductId')
          .in('Id', variantIds);
        if (rowErr) throw rowErr;
        const productIdByVariant = new Map<string, string>();
        for (const r of rows || []) {
          if ((r as any).Id && (r as any).ProductId) {
            productIdByVariant.set((r as any).Id, (r as any).ProductId);
          }
        }

        // Items we can't resolve a product for can't be submitted → fail early.
        const submittable = items.filter((it) => productIdByVariant.has(it.variantId));
        const unresolved = items.filter((it) => !productIdByVariant.has(it.variantId));
        for (const it of unresolved) markFailed.push(it.variantId);

        if (submittable.length === 0) {
          setStatus(markFailed, 'failed');
          setErrorSummary('Couldn’t match these items to a product record.');
          setPhase('settled');
          return;
        }

        const products = submittable.map((it, idx) => ({
          productIndex: idx,
          productId: productIdByVariant.get(it.variantId)!,
          variantId: it.variantId,
          regenerateType: 'entire_platform' as const,
          targetPlatform: TARGET_PLATFORM,
          imageUrls: it.imageUrls || [],
        }));

        // ONE batched submit for the whole selection — the endpoint loops the
        // products array, and batching keeps us under the 3-submits/min throttle.
        const submitRes = await fetch(`${API_BASE_URL}/api/products/regenerate/submit`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ products, options: { useExistingScrapedData: false } }),
        });

        if (!submitRes.ok) {
          const body = await submitRes.text().catch(() => '');
          log.error('[BatchGenerate] submit failed', submitRes.status, body);
          setStatus(items.map((it) => it.variantId), 'failed');
          setErrorSummary(
            submitRes.status === 429
              ? 'Too many generations right now. Wait a moment and retry.'
              : submitRes.status === 402 || submitRes.status === 403
                ? 'You’ve hit your AI generation limit for now.'
                : 'Couldn’t start generation. Please try again.',
          );
          setPhase('settled');
          return;
        }

        const submitJson = await submitRes.json().catch(() => ({}));
        const jobId: string | undefined = submitJson?.jobId;
        if (!jobId) {
          setStatus(items.map((it) => it.variantId), 'failed');
          setErrorSummary('Generation didn’t start. Please try again.');
          setPhase('settled');
          return;
        }

        setStatus(submittable.map((it) => it.variantId), 'generating');
        log.debug('[BatchGenerate] job started', jobId, 'items', submittable.length);

        // Poll the (throttled) status endpoint until the job settles or times out.
        const startedAt = Date.now();
        let finalJson: any = null;
        while (Date.now() - startedAt < MAX_WAIT_MS) {
          await delay(POLL_INTERVAL_MS);
          const pollToken = await ensureSupabaseJwt();
          if (!pollToken) continue;
          let statusRes: Response;
          try {
            statusRes = await fetch(
              `${API_BASE_URL}/api/products/regenerate/status/${jobId}`,
              { headers: { Authorization: `Bearer ${pollToken}` } },
            );
          } catch (e) {
            log.warn('[BatchGenerate] status poll network error', e);
            continue;
          }
          if (statusRes.status === 429) continue; // throttled — our cadence already backs off
          if (!statusRes.ok) continue; // e.g. status row not persisted yet
          const json = await statusRes.json().catch(() => null);
          if (!json) continue;
          if (typeof json?.progress?.completedProducts === 'number') {
            setProgressCount(json.progress.completedProducts);
          }
          if (json.status === 'completed' || json.status === 'failed' || json.status === 'cancelled') {
            finalJson = json;
            break;
          }
        }

        if (!finalJson || finalJson.status !== 'completed') {
          // Timed out or the whole job failed — every item this run is retryable.
          setStatus(items.map((it) => it.variantId), 'failed');
          setErrorSummary(
            finalJson?.status === 'failed'
              ? 'Generation failed on the server. You can retry.'
              : 'Generation is taking too long. You can retry the remaining items.',
          );
          setPhase('settled');
          return;
        }

        // Map results back to variants and persist the ones that closed the gap.
        const results: any[] = Array.isArray(finalJson.results) ? finalJson.results : [];
        const resultByVariant = new Map<string, any>();
        results.forEach((r, i) => {
          const vid = r?.variantId || products[i]?.variantId;
          if (vid) resultByVariant.set(vid, r);
        });

        for (const it of submittable) {
          const result = resultByVariant.get(it.variantId);
          const input = byVariant.get(it.variantId);
          if (!result || result.error) {
            markFailed.push(it.variantId);
            continue;
          }
          const gen = extractContent(result);
          const update: Record<string, string> = {};
          if (titleOk(gen.title)) update.Title = gen.title!.trim();
          if (descOk(gen.description)) update.Description = gen.description!.trim();

          // "Done" must mean the queue will actually shrink: title AND
          // description are adequate afterwards (generated or already-present).
          const finalTitleOk = titleOk(gen.title) || titleOk(input?.existingTitle);
          const finalDescOk = descOk(gen.description) || descOk(input?.existingDescription);

          if (Object.keys(update).length === 0) {
            markFailed.push(it.variantId);
            continue;
          }

          // Persist to ProductVariants — same table/columns useOptimizerQueues reads.
          const { error: upErr } = await supabase
            .from('ProductVariants')
            .update(update)
            .eq('Id', it.variantId);
          if (upErr) {
            log.error('[BatchGenerate] persist failed', it.variantId, upErr);
            markFailed.push(it.variantId);
            continue;
          }

          if (finalTitleOk && finalDescOk) markDone.push(it.variantId);
          else markFailed.push(it.variantId); // wrote a partial improvement, but gap remains
        }

        setStatus(markDone, 'done');
        setStatus(markFailed, 'failed');
        if (markFailed.length > 0) {
          setErrorSummary(
            markDone.length > 0
              ? `${markDone.length} generated, ${markFailed.length} need another try.`
              : 'The AI couldn’t produce full details for these. You can retry or fill them in.',
          );
        }
        setPhase('settled');
      } catch (err: any) {
        log.error('[BatchGenerate] run error', err);
        const failedNow = items.map((it) => it.variantId).filter((id) => !markDone.includes(id));
        setStatus(failedNow, 'failed');
        setErrorSummary('Something went wrong during generation. You can retry.');
        setPhase('settled');
      } finally {
        runningRef.current = false;
      }
    },
    [setStatus],
  );

  const { doneIds, failedIds } = useMemo(() => {
    const done: string[] = [];
    const failed: string[] = [];
    for (const [id, st] of Object.entries(statuses)) {
      if (st === 'done') done.push(id);
      else if (st === 'failed') failed.push(id);
    }
    return { doneIds: done, failedIds: failed };
  }, [statuses]);

  return {
    phase,
    statuses,
    doneIds,
    failedIds,
    progressCount,
    totalCount,
    errorSummary,
    run,
    reset,
  };
}
