import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_WATCHDOG_DELAYS_MS,
  SESSION_WATCHDOG_MAX_ATTEMPTS,
  SessionRecoveryPolicy,
} from '../src/lib/sessionRecovery.ts';

test('warm sign-in after manual sign-out re-bootstraps and clears stranded markers', () => {
  const policy = new SessionRecoveryPolicy();

  assert.deepEqual(policy.observeSignIn(true), { action: 'none' });
  assert.deepEqual(policy.observeSignIn(false), {
    action: 'reset',
    clearPersistedAuth: false,
    initializing: false,
    configured: false,
    ready: false,
    bridgeReady: false,
    sessionMode: 'cached',
    usingCachedSession: false,
    user: null,
    entitlements: null,
    bootstrapError: null,
    lastReadyAt: null,
    invalidSessionInFlight: false,
  });
  assert.deepEqual(policy.observeSignIn(true), {
    action: 'bootstrap',
    forceValidation: true,
    initializing: true,
    configured: false,
    ready: false,
    bridgeReady: false,
    sessionMode: 'cached',
    usingCachedSession: false,
    user: null,
    entitlements: null,
    bootstrapError: null,
    lastReadyAt: null,
    invalidSessionInFlight: false,
  });
});

test('every signed-out observation resets provider markers without another persisted-auth wipe', () => {
  const policy = new SessionRecoveryPolicy();

  for (let observation = 0; observation < 3; observation += 1) {
    const plan = policy.observeSignIn(false);
    assert.equal(plan.action, 'reset');
    if (plan.action !== 'reset') continue;
    assert.equal(plan.clearPersistedAuth, false);
    assert.equal(plan.configured, false);
    assert.equal(plan.initializing, false);
    assert.equal(plan.ready, false);
    assert.equal(plan.bridgeReady, false);
    assert.equal(plan.sessionMode, 'cached');
    assert.equal(plan.usingCachedSession, false);
    assert.equal(plan.user, null);
    assert.equal(plan.entitlements, null);
    assert.equal(plan.bootstrapError, null);
    assert.equal(plan.lastReadyAt, null);
    assert.equal(plan.invalidSessionInFlight, false);
  }
});

test('stranded-session watchdog fires with bounded backoff and stops at its cap', () => {
  const policy = new SessionRecoveryPolicy();

  SESSION_WATCHDOG_DELAYS_MS.forEach((delayMs, attemptIndex) => {
    const decision = policy.observeWatchdog({
      isSignedIn: true,
      ready: false,
      bootstrapError: 'Unable to restore your session right now.',
      validationInFlight: false,
    });
    assert.deepEqual(decision, {
      action: 'schedule',
      attemptIndex,
      attemptNumber: attemptIndex + 1,
      delayMs,
    });
    assert.equal(policy.recordWatchdogAttempt(attemptIndex), true);
  });

  assert.equal(SESSION_WATCHDOG_MAX_ATTEMPTS, 3);
  assert.deepEqual(policy.observeWatchdog({
    isSignedIn: true,
    ready: false,
    bootstrapError: 'Unable to restore your session right now.',
    validationInFlight: false,
  }), { action: 'exhausted' });
});

test('watchdog does not fire while validation is in flight or after recovery', () => {
  const policy = new SessionRecoveryPolicy();

  assert.deepEqual(policy.observeWatchdog({
    isSignedIn: true,
    ready: false,
    bootstrapError: 'Unable to restore your session right now.',
    validationInFlight: true,
  }), { action: 'waiting' });
  assert.deepEqual(policy.observeWatchdog({
    isSignedIn: true,
    ready: true,
    bootstrapError: null,
    validationInFlight: false,
  }), { action: 'inactive' });
});

test('signed-out state never schedules a watchdog retry loop', () => {
  const policy = new SessionRecoveryPolicy();

  for (let observation = 0; observation < 10; observation += 1) {
    assert.deepEqual(policy.observeWatchdog({
      isSignedIn: false,
      ready: false,
      bootstrapError: 'Unable to restore your session right now.',
      validationInFlight: false,
    }), { action: 'inactive' });
  }
});
