export const CONNECT_ERROR_CODES = [
  'state_expired',
  'state_used',
  'state_invalid',
  'provider_denied',
  'exchange_failed',
  'server_error',
] as const;

export type ConnectErrorCode = (typeof CONNECT_ERROR_CODES)[number];

export type ConnectErrorResolution =
  | { kind: 'error'; message: string }
  | { kind: 'success_already' }
  | { kind: 'cancelled' };

const EXPIRED_COPY = 'That sign-in expired. Try again.';
const FALLBACK_COPY = "Connection didn't complete. Try again.";

function normalized(value?: string | null): string {
  return String(value || '').trim().toLowerCase();
}

export function isConnectErrorCode(value?: string | null): value is ConnectErrorCode {
  return (CONNECT_ERROR_CODES as readonly string[]).includes(normalized(value));
}

/**
 * Turns both the callback's machine code and today's legacy message into one
 * seller-safe outcome. Raw provider/backend copy must never cross this seam.
 */
export function connectErrorCopy({
  code,
  message,
}: {
  code?: string | null;
  message?: string | null;
} = {}): ConnectErrorResolution {
  const normalizedCode = normalized(code);
  const normalizedMessage = normalized(message).replace(/[\s-]+/g, '_');

  if (normalizedCode) {
    if (normalizedCode === 'state_used') return { kind: 'success_already' };
    if (normalizedCode === 'provider_denied') return { kind: 'cancelled' };
    if (normalizedCode === 'state_expired' || normalizedCode === 'state_invalid') {
      return { kind: 'error', message: EXPIRED_COPY };
    }
    if (normalizedCode === 'exchange_failed' || normalizedCode === 'server_error') {
      return { kind: 'error', message: FALLBACK_COPY };
    }
  }

  if (normalizedMessage.includes('state_used')) return { kind: 'success_already' };

  if (
    normalizedMessage.includes('provider_denied')
    || normalizedMessage.includes('access_denied')
    || /(^|_)(user_)?(denied|cancelled|canceled)(_|$)/.test(normalizedMessage)
  ) {
    return { kind: 'cancelled' };
  }

  if (
    normalizedMessage.includes('state_expired')
    || normalizedMessage.includes('invalid_state_parameter')
    || normalizedMessage.includes('state_not_found_or_expired')
  ) {
    return { kind: 'error', message: EXPIRED_COPY };
  }

  return { kind: 'error', message: FALLBACK_COPY };
}

export const CONNECT_EXPIRED_COPY = EXPIRED_COPY;
export const CONNECT_FALLBACK_COPY = FALLBACK_COPY;
