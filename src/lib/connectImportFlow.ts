export type ConnectImportPhaseDecision = 'consent' | 'importing' | 'importFailed' | 'done';

const SUCCESS_STATUSES = new Set(['complete', 'completed', 'success', 'succeeded']);

function normalizedStatus(value?: string | null): string {
  return String(value || '').trim().toLowerCase();
}

/**
 * Pure phase decision for the OAuth callback and its later shared-store
 * reconciliation. An absent start-scan result is unknown, never confirmation.
 */
export function decideConnectImportPhase({
  oauthSucceeded,
  connectionId: _connectionId,
  startScanResult,
  hasImportEvidence = false,
  graceExpired = false,
  terminalRunStatus,
}: {
  oauthSucceeded: boolean;
  connectionId?: string;
  startScanResult?: boolean;
  hasImportEvidence?: boolean;
  graceExpired?: boolean;
  terminalRunStatus?: string | null;
}): ConnectImportPhaseDecision {
  if (!oauthSucceeded) return 'consent';

  const terminal = normalizedStatus(terminalRunStatus);
  if (terminal === 'error' || terminal.includes('fail')) return 'importFailed';
  if (SUCCESS_STATUSES.has(terminal)) return 'done';

  if (hasImportEvidence) return 'importing';
  if (startScanResult === false && graceExpired) return 'importFailed';

  return 'importing';
}
