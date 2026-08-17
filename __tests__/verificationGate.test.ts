import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveVerificationGate } from '../src/lib/verificationGate.ts';

test('verified session reaches the signed-in tree', () => {
  assert.equal(resolveVerificationGate({
    authLoaded: true,
    userLoaded: true,
    isSignedIn: true,
    primaryEmailVerificationStatus: 'verified',
  }).surface, 'signed_in');
});

test('authenticated but unverified session stays on verification', () => {
  assert.equal(resolveVerificationGate({
    authLoaded: true,
    userLoaded: true,
    isSignedIn: true,
    primaryEmailVerificationStatus: 'unverified',
  }).surface, 'verification_required');
});

test('cold-start persisted unverified session resumes verification without sign-up state', () => {
  assert.equal(resolveVerificationGate({
    authLoaded: true,
    userLoaded: true,
    isSignedIn: true,
    primaryEmailVerificationStatus: 'unverified',
  }).surface, 'verification_required');
});

test('signed-in session cannot reach the app while the Clerk user is loading', () => {
  assert.equal(resolveVerificationGate({
    authLoaded: true,
    userLoaded: false,
    isSignedIn: true,
    primaryEmailVerificationStatus: undefined,
  }).surface, 'loading');
});
