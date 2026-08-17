import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORG_RESOLVE_GRACE_MS,
  isSetupUnknown,
  resolveOrgState,
} from '../src/lib/orgResolution.ts';

test('an org that loaded is resolved', () => {
  assert.equal(resolveOrgState(true, false), 'resolved');
  assert.equal(resolveOrgState(true, true), 'resolved');
});

test('no org while loading is pending', () => {
  assert.equal(resolveOrgState(false, true), 'pending');
});

test('no org and no longer loading is none, never pending', () => {
  // The founder's case: the membership row lost its race with onboarding, so
  // the workspace list is legitimately empty. This must be an answer.
  assert.equal(resolveOrgState(false, false), 'none');
});

test('setup is unknown only while pending or counting', () => {
  assert.equal(isSetupUnknown('pending', false), true);
  assert.equal(isSetupUnknown('resolved', true), true);
  assert.equal(isSetupUnknown('resolved', false), false);
});

test('no workspace is a known state, so Home stops spinning', () => {
  assert.equal(isSetupUnknown('none', false), false);
});

test('the pending deadline clears the upstream boot gates', () => {
  // bootGate's BRIDGE_BOOT_GRACE_MS is 12s and org loading cannot start before
  // the bridge, so the deadline has to sit past it or it would fire on a boot
  // that was merely slow.
  assert.ok(ORG_RESOLVE_GRACE_MS > 12_000);
});
