import { ensureSupabaseJwt } from './supabase';

// Preserve the precedence both callers used (SSSYNC-specific var wins).
const BASE_URL =
  process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL ||
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  'https://api.sssync.app';

export interface GenerateJobStatus {
  status: string;
  currentStage?: string;
  progress?: number;
  [key: string]: any;
}

/**
 * Single source for the generate-job status endpoint.
 *
 * Both the app-wide `JobsContext` poller and the per-modal `useJobsState` poller
 * call this so the URL + auth live in one place (and the raw `fetch` stays inside
 * `src/lib` per the lint guardrail).
 *
 * NOTE: the two callers still run independent poll loops, so an open ItemJobsModal
 * double-polls the same jobs. Collapsing them to one loop requires reconciling the
 * two job-state models — that's the "jobs as one domain" work (V2 plan Track C).
 */
export async function fetchGenerateJobStatus(jobId: string): Promise<GenerateJobStatus | null> {
  const token = await ensureSupabaseJwt();
  if (!token) return null;
  const res = await fetch(`${BASE_URL}/api/products/generate/jobs/${jobId}/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as GenerateJobStatus;
}
