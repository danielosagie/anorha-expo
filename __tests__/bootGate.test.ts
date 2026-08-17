import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKEND_REACHABILITY_TIMEOUT_MS,
  BRIDGE_BOOT_GRACE_MS,
  BridgeBootGate,
  TOKEN_FULL_BACKOFF_ELAPSED_MS,
  TOKEN_RETRY_BASE_MS,
  TOKEN_RETRY_CAP_MS,
  TOKEN_UNAVAILABLE_RETRY_LIMIT,
  decideBridgeFailure,
  decideValidationLoop,
  settleWithin,
  tokenRetryDelayMs,
} from '../src/lib/bootGate.ts';

const T0 = Date.parse('2026-08-17T04:00:00.000Z');

test('healthy bridge configures to ready without showing reconnect', () => {
  const gate = new BridgeBootGate();

  assert.equal(gate.observe({ isSignedIn: true, bridgeReady: false, now: T0 }).surface, 'connecting');
  assert.equal(gate.observe({ isSignedIn: true, bridgeReady: true, now: T0 + 500 }).surface, 'ready');
  assert.equal(gate.observe({ isSignedIn: true, bridgeReady: true, now: T0 + 60_000 }).surface, 'ready');
});

test('signed-out validation never runs or schedules and clears retry timers', () => {
  assert.deepEqual(decideValidationLoop(false), {
    shouldRun: false,
    shouldScheduleRetry: false,
    shouldClearRetryTimers: true,
  });
  assert.equal(
    decideBridgeFailure({
      kind: 'token_unavailable',
      retryCount: 0,
      bridgeWasReady: false,
      isSignedIn: false,
      backendReachability: 'reachable',
    }),
    'signed_out',
  );
});

test('transient null tokens recover to a ready bridge without sign-out', () => {
  const tokens = [null, null, 'recovered-token'];
  let bridgeReady = false;
  let signOutRequested = false;

  tokens.forEach((token, retryCount) => {
    if (token) {
      bridgeReady = true;
      return;
    }
    const decision = decideBridgeFailure({
      kind: 'token_unavailable',
      retryCount,
      bridgeWasReady: false,
      isSignedIn: true,
    });
    assert.equal(decision, 'quiet_retry');
    signOutRequested ||= decision === 'invalid_session';
  });

  assert.equal(bridgeReady, true);
  assert.equal(signOutRequested, false);

  const gate = new BridgeBootGate();
  assert.equal(gate.observe({ isSignedIn: true, bridgeReady: false, now: T0 }).surface, 'connecting');
  assert.equal(
    gate.observe({ isSignedIn: true, bridgeReady: false, now: T0 + BRIDGE_BOOT_GRACE_MS - 1 }).surface,
    'connecting',
  );
});

test('permanent configuration failure degrades and reaches reconnect', () => {
  assert.equal(
    decideBridgeFailure({
      kind: 'configuration_failed',
      retryCount: 2,
      bridgeWasReady: false,
      isSignedIn: true,
    }),
    'degrade',
  );

  const gate = new BridgeBootGate();
  gate.observe({ isSignedIn: true, bridgeReady: false, now: T0 });
  assert.equal(
    gate.observe({ isSignedIn: true, bridgeReady: false, now: T0 + BRIDGE_BOOT_GRACE_MS }).surface,
    'reconnect',
  );
});

test('zombie session escalates after the full backoff when the backend is reachable', () => {
  const delays = Array.from(
    { length: TOKEN_UNAVAILABLE_RETRY_LIMIT },
    (_value, retryCount) => tokenRetryDelayMs(retryCount),
  );
  assert.deepEqual(delays, [
    TOKEN_RETRY_BASE_MS,
    TOKEN_RETRY_BASE_MS * 2,
    TOKEN_RETRY_BASE_MS * 4,
    TOKEN_RETRY_CAP_MS,
  ]);
  assert.equal(delays.reduce((sum, delayMs) => sum + delayMs, 0), TOKEN_FULL_BACKOFF_ELAPSED_MS);
  assert.equal(
    TOKEN_FULL_BACKOFF_ELAPSED_MS + BACKEND_REACHABILITY_TIMEOUT_MS,
    BRIDGE_BOOT_GRACE_MS - TOKEN_RETRY_BASE_MS,
  );

  for (let retryCount = 0; retryCount < TOKEN_UNAVAILABLE_RETRY_LIMIT; retryCount += 1) {
    assert.equal(
      decideBridgeFailure({
        kind: 'token_unavailable',
        retryCount,
        bridgeWasReady: false,
        isSignedIn: true,
        backendReachability: 'reachable',
      }),
      'quiet_retry',
    );
  }

  assert.equal(
    decideBridgeFailure({
      kind: 'token_unavailable',
      retryCount: TOKEN_UNAVAILABLE_RETRY_LIMIT,
      bridgeWasReady: false,
      isSignedIn: true,
      backendReachability: 'reachable',
    }),
    'invalid_session',
  );
});

test('ambiguous reachability never invalidates the stored session', () => {
  const missingEvidence = decideBridgeFailure({
    kind: 'token_unavailable',
    retryCount: TOKEN_UNAVAILABLE_RETRY_LIMIT,
    bridgeWasReady: false,
    isSignedIn: true,
  });
  const failedProbe = decideBridgeFailure({
    kind: 'token_unavailable',
    retryCount: TOKEN_UNAVAILABLE_RETRY_LIMIT,
    bridgeWasReady: false,
    isSignedIn: true,
    backendReachability: 'ambiguous',
  });

  assert.equal(missingEvidence, 'quiet_retry');
  assert.equal(failedProbe, 'quiet_retry');
});

test('Try again converges when a second exhausted cycle proves backend reachability', () => {
  const classifyExhaustedCycle = (backendReachability: 'reachable' | 'ambiguous') =>
    decideBridgeFailure({
      kind: 'token_unavailable',
      retryCount: TOKEN_UNAVAILABLE_RETRY_LIMIT,
      bridgeWasReady: false,
      isSignedIn: true,
      backendReachability,
    });

  // The first ambiguous cycle keeps the session while the boot gate reaches reconnect.
  assert.equal(classifyExhaustedCycle('ambiguous'), 'quiet_retry');
  // SessionReconnectScreen starts the same retry path. A second zero-token cycle
  // with a backend 200 must use the invalid-session teardown instead of looping.
  assert.equal(classifyExhaustedCycle('reachable'), 'invalid_session');
});

test('grace deadline survives repeated component remounts and never fires early', () => {
  const processStore = new BridgeBootGate();
  const firstMount = processStore.observe({ isSignedIn: true, bridgeReady: false, now: T0 });

  // Each read represents a newly mounted component using the same process-level store.
  const secondMount = processStore.observe({ isSignedIn: true, bridgeReady: false, now: T0 + 4_000 });
  const thirdMount = processStore.observe({ isSignedIn: true, bridgeReady: false, now: T0 + 8_000 });
  const fourthMount = processStore.observe({
    isSignedIn: true,
    bridgeReady: false,
    now: T0 + BRIDGE_BOOT_GRACE_MS - 1,
  });

  assert.equal(firstMount.deadlineAt, T0 + BRIDGE_BOOT_GRACE_MS);
  assert.equal(secondMount.deadlineAt, firstMount.deadlineAt);
  assert.equal(thirdMount.deadlineAt, firstMount.deadlineAt);
  assert.equal(fourthMount.surface, 'connecting');
  assert.equal(
    processStore.observe({ isSignedIn: true, bridgeReady: false, now: T0 + BRIDGE_BOOT_GRACE_MS }).surface,
    'reconnect',
  );
});

test('ready-false-ready flap never resets to a new connecting window', () => {
  const gate = new BridgeBootGate();
  const initial = gate.observe({ isSignedIn: true, bridgeReady: false, now: T0 });

  assert.equal(gate.observe({ isSignedIn: true, bridgeReady: true, now: T0 + 1_000 }).surface, 'ready');
  const firstDrop = gate.observe({ isSignedIn: true, bridgeReady: false, now: T0 + 2_000 });
  assert.equal(firstDrop.surface, 'reconnect');
  assert.equal(firstDrop.deadlineAt, initial.deadlineAt);

  assert.equal(gate.observe({ isSignedIn: true, bridgeReady: true, now: T0 + 3_000 }).surface, 'ready');
  const secondDrop = gate.observe({ isSignedIn: true, bridgeReady: false, now: T0 + 4_000 });
  assert.equal(secondDrop.surface, 'reconnect');
  assert.equal(secondDrop.deadlineAt, initial.deadlineAt);
});

test('an unbounded bridge promise is converted into a logged/retryable rejection', async () => {
  await assert.rejects(
    settleWithin(new Promise<never>(() => {}), 5, 'bridge timed out'),
    /bridge timed out/,
  );
});
