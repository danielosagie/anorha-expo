import { useCallback, useEffect, useState } from 'react';
import { trpc } from '../lib/trpc';

/**
 * Track C (v2) — unified jobs read hooks.
 *
 * Thin, typed entry point over the backend `trpc.jobs.*` API (the unified `jobs` view).
 * This is the single surface the per-type job hooks (useImportProgress, useJobsState, …)
 * migrate onto over time — they're left untouched for now so this is purely additive.
 */
type JobsListInput = Parameters<typeof trpc.jobs.list.query>[0];
type Job = Awaited<ReturnType<typeof trpc.jobs.get.query>>;

export function useJobs(input?: JobsListInput) {
  const [data, setData] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const key = JSON.stringify(input ?? null);
  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await trpc.jobs.list.query(input);
      setData(rows);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}

export function useJob(id: string | null | undefined) {
  const [data, setData] = useState<Job | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    if (!id) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const row = await trpc.jobs.get.query({ id });
      setData(row);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
