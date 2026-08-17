import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRIDGE_BOOT_GRACE_MS,
  BridgeBootGate,
  decideBridgeFailure,
  settleWithin,
} from '../src/lib/bootGate.ts';

const T0 = Date.parse('2026-08-17T04:00:00.000Z');

test('healthy bridge configures to ready without showing reconnect', () => {
  const gate = new BridgeBootGate();

  assert.equal(gate.observe({ isSignedIn: true, bridgeReady: false, now: T0 }).surface, 'connecting');
  assert.equal(gate.observe({ isSignedIn: true, bridgeReady: true, now: T0 + 500 }).surface, 'ready');
  assert.equal(gate.observe({ isSignedIn: true, bridgeReady: true, now: T0 + 60_000 }).surface, 'ready');
});

test('one transient token failure stays quiet and preserves a live bridge', () => {
  assert.equal(
    decideBridgeFailure({ kind: 'token_unavailable', retryCount: 0, bridgeWasReady: true }),
    'quiet_retry',
  );

  const gate = new BridgeBootGate();
  assert.equal(gate.observe({ isSignedIn: true, bridgeReady: false, now: T0 }).surface, 'connecting');
  assert.equal(
    gate.observe({ isSignedIn: true, bridgeReady: false, now: T0 + BRIDGE_BOOT_GRACE_MS - 1 }).surface,
    'connecting',
  );
});

test('permanent configuration failure degrades and reaches reconnect', () => {
  assert.equal(
    decideBridgeFailure({ kind: 'configuration_failed', retryCount: 2, bridgeWasReady: false }),
    'degrade',
  );

  const gate = new BridgeBootGate();
  gate.observe({ isSignedIn: true, bridgeReady: false, now: T0 });
  assert.equal(
    gate.observe({ isSignedIn: true, bridgeReady: false, now: T0 + BRIDGE_BOOT_GRACE_MS }).surface,
    'reconnect',
  );
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
