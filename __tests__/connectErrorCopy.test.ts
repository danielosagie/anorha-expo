import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONNECT_EXPIRED_COPY,
  CONNECT_FALLBACK_COPY,
  connectErrorCopy,
} from '../src/lib/connectErrorCopy.ts';

function expectResolution(
  input: Parameters<typeof connectErrorCopy>[0],
  expected: ReturnType<typeof connectErrorCopy>,
) {
  const actual = connectErrorCopy(input);
  assert.deepEqual(
    actual,
    expected,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

test('maps every machine callback code to seller-safe behavior', () => {
  expectResolution({ code: 'state_expired' }, { kind: 'error', message: CONNECT_EXPIRED_COPY });
  expectResolution({ code: 'state_invalid' }, { kind: 'error', message: CONNECT_EXPIRED_COPY });
  expectResolution({ code: 'state_used' }, { kind: 'success_already' });
  expectResolution({ code: 'provider_denied' }, { kind: 'cancelled' });
  expectResolution({ code: 'exchange_failed' }, { kind: 'error', message: CONNECT_FALLBACK_COPY });
  expectResolution({ code: 'server_error' }, { kind: 'error', message: CONNECT_FALLBACK_COPY });
  expectResolution(
    { code: 'state_expired', message: 'Provider denied access' },
    { kind: 'error', message: CONNECT_EXPIRED_COPY },
  );
});

test('sniffs legacy expired-state messages without leaking backend copy', () => {
  expectResolution(
    { message: 'Invalid state parameter: State not found or expired' },
    { kind: 'error', message: CONNECT_EXPIRED_COPY },
  );
  expectResolution(
    { message: 'State not found or expired' },
    { kind: 'error', message: CONNECT_EXPIRED_COPY },
  );
  expectResolution(
    { message: 'state_expired' },
    { kind: 'error', message: CONNECT_EXPIRED_COPY },
  );
});

test('sniffs legacy replay and provider-cancel messages as quiet outcomes', () => {
  expectResolution({ message: 'state_used' }, { kind: 'success_already' });
  expectResolution({ message: 'access_denied' }, { kind: 'cancelled' });
  expectResolution({ message: 'User cancelled authorization' }, { kind: 'cancelled' });
  expectResolution({ message: 'Provider denied access' }, { kind: 'cancelled' });
});

test('uses one generic fallback for unknown or absent details', () => {
  expectResolution(
    { message: 'OAuth exchange exploded with internal trace 123' },
    { kind: 'error', message: CONNECT_FALLBACK_COPY },
  );
  expectResolution({}, { kind: 'error', message: CONNECT_FALLBACK_COPY });
});
