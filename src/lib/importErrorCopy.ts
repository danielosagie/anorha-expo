export const DEFAULT_IMPORT_ACTION_ERROR = 'That answer did not save. Try again.';

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const status = Number((error as { status?: unknown }).status);
  return Number.isFinite(status) ? status : null;
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return '';
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
}

export function importActionErrorCopy(
  error: unknown,
  fallback = DEFAULT_IMPORT_ACTION_ERROR,
): string {
  const status = errorStatus(error);
  const message = errorMessage(error);
  const normalized = message.toLowerCase();

  if (status === 409 || normalized.includes('409') || normalized.includes('item changed')) {
    return 'This item changed. Review it again.';
  }
  if (status === 401 || /\b401\b/.test(normalized)) {
    return 'Session expired. Reopen the app.';
  }
  if (
    (error as { name?: unknown } | null)?.name === 'AbortError'
    || normalized.includes('timed out')
    || normalized.includes('timeout')
    || normalized.includes('network request failed')
    || normalized.includes('failed to fetch')
    || normalized.includes('no connection')
    || normalized.includes('offline')
  ) {
    return 'No connection. Try again.';
  }
  return fallback;
}
