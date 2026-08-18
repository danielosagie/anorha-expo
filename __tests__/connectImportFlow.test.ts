import assert from 'node:assert/strict';
import test from 'node:test';

import { decideConnectImportPhase } from '../src/lib/connectImportFlow.ts';

function expectPhase(
  input: Parameters<typeof decideConnectImportPhase>[0],
  expected: ReturnType<typeof decideConnectImportPhase>,
) {
  const actual = decideConnectImportPhase(input);
  assert.equal(actual, expected, `expected phase ${expected}, got ${actual}`);
}

test('OAuth success advances immediately with or without a connection id', () => {
  expectPhase({ oauthSucceeded: true, connectionId: 'connection-1' }, 'importing');
  expectPhase({ oauthSucceeded: true }, 'importing');
});

test('an absent scan result remains unknown instead of confirming or failing the import', () => {
  expectPhase({ oauthSucceeded: true, startScanResult: undefined, graceExpired: true }, 'importing');
});

test('a failed redundant scan kick fails only after the grace window without evidence', () => {
  expectPhase({ oauthSucceeded: true, startScanResult: false, graceExpired: false }, 'importing');
  expectPhase({ oauthSucceeded: true, startScanResult: false, graceExpired: true }, 'importFailed');
});

test('shared-store evidence keeps importing even when the redundant kick failed', () => {
  expectPhase({
    oauthSucceeded: true,
    startScanResult: false,
    graceExpired: true,
    hasImportEvidence: true,
  }, 'importing');
});

test('terminal shared-store runs advance to done or failed', () => {
  expectPhase({ oauthSucceeded: true, terminalRunStatus: 'completed' }, 'done');
  expectPhase({ oauthSucceeded: true, terminalRunStatus: 'failed' }, 'importFailed');
  expectPhase({ oauthSucceeded: true, terminalRunStatus: 'error' }, 'importFailed');
});

test('an unsuccessful OAuth result stays on consent', () => {
  expectPhase({ oauthSucceeded: false, connectionId: 'connection-1' }, 'consent');
});
