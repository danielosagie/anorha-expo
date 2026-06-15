/**
 * Async job lifecycle status — shared by the match / generate / manifest /
 * receipt pollers so the terminal-state check is defined ONCE instead of being
 * re-typed (`=== 'completed' || === 'failed'`) at every poll site.
 */
export type JobStatus =
  | 'queued'
  | 'pending'
  | 'processing'
  | 'running'
  | 'completed'
  | 'failed';

/**
 * Statuses that mean "stop polling". Intentionally the two the whole codebase
 * already converges on; pass a custom `isTerminal` to a poller if a flow needs
 * to also stop on e.g. `cancelled`.
 */
export const TERMINAL_JOB_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed']);

export function isTerminalJobStatus(status?: string | null): boolean {
  return TERMINAL_JOB_STATUSES.has((status ?? '').toLowerCase());
}

export function isJobSuccess(status?: string | null): boolean {
  return (status ?? '').toLowerCase() === 'completed';
}
