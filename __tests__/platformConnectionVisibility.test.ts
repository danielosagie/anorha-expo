import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isVisiblePlatformConnection,
  isListedPlatformConnection,
  isDisconnectedPlatformConnection,
  isImportingConnectionStatus,
  isUnhealthyPlatformConnection,
} from '../src/lib/platformConnectionVisibility.ts';

// ── isVisiblePlatformConnection — "usable for work" ─────────────────────────

test('active enabled connection is visible', () => {
  assert.equal(isVisiblePlatformConnection({ IsEnabled: true, Status: 'active' }), true);
});

test('soft-disconnected connection (IsEnabled=false + inactive) is NOT visible', () => {
  assert.equal(isVisiblePlatformConnection({ IsEnabled: false, Status: 'inactive' }), false);
});

test('inactive status alone hides the connection even when IsEnabled is true', () => {
  // Belt and braces: the backend pairs them, but either signal means dead.
  assert.equal(isVisiblePlatformConnection({ IsEnabled: true, Status: 'inactive' }), false);
});

test('IsEnabled=false alone hides the connection regardless of status', () => {
  assert.equal(isVisiblePlatformConnection({ IsEnabled: false, Status: 'active' }), false);
});

test('error connection is not usable for work', () => {
  assert.equal(isVisiblePlatformConnection({ IsEnabled: true, Status: 'error' }), false);
});

test('review connection is repairable and remains usable because attention is non-blocking', () => {
  const connection = { IsEnabled: true, Status: 'review' };

  assert.equal(isVisiblePlatformConnection(connection), true);
  assert.equal(isListedPlatformConnection(connection), true);
  assert.equal(isUnhealthyPlatformConnection(connection), false);
});

test('needs-attention SyncState is non-blocking but explicit reauth is unhealthy', () => {
  assert.equal(isVisiblePlatformConnection({ IsEnabled: true, Status: 'active', SyncState: 'needs-attention' }), true);
  assert.equal(isUnhealthyPlatformConnection({ IsEnabled: true, Status: 'active', SyncState: 'needs-attention' }), false);
  assert.equal(isUnhealthyPlatformConnection({ IsEnabled: true, Status: 'active', NeedsReauth: true }), true);
});

test('mid-import statuses are visible', () => {
  for (const Status of ['pending', 'scanning', 'syncing', 'reconciling', 'ready_to_sync']) {
    assert.equal(isVisiblePlatformConnection({ IsEnabled: true, Status }), true, Status);
  }
});

test('status matching is case- and whitespace-insensitive', () => {
  assert.equal(isVisiblePlatformConnection({ IsEnabled: true, Status: ' INACTIVE ' }), false);
});

test('missing fields default to visible (a bare row is not assumed dead)', () => {
  assert.equal(isVisiblePlatformConnection({}), true);
});

// ── isListedPlatformConnection — "shown in the Connections list" ────────────

test('soft-disconnected rows are not listed', () => {
  assert.equal(isListedPlatformConnection({ IsEnabled: false, Status: 'inactive' }), false);
});

test('active, review, error, and scanning rows are listed', () => {
  for (const Status of ['active', 'review', 'error', 'scanning']) {
    assert.equal(isListedPlatformConnection({ IsEnabled: true, Status }), true, Status);
  }
});

test('a hypothetical deleted status is never listed (tripwire)', () => {
  assert.equal(isListedPlatformConnection({ IsEnabled: false, Status: 'deleted' }), false);
});

// ── isDisconnectedPlatformConnection — drives the Disconnected row state ────

test('disconnected detection: either disabled flag or dead status counts', () => {
  assert.equal(isDisconnectedPlatformConnection({ IsEnabled: false, Status: 'inactive' }), true);
  assert.equal(isDisconnectedPlatformConnection({ IsEnabled: false, Status: 'active' }), true);
  assert.equal(isDisconnectedPlatformConnection({ IsEnabled: true, Status: 'inactive' }), true);
  assert.equal(isDisconnectedPlatformConnection({ IsEnabled: true, Status: 'active' }), false);
  assert.equal(isDisconnectedPlatformConnection({ IsEnabled: true, Status: 'error' }), false);
});

// ── isImportingConnectionStatus — keeps the 20s poll honest ─────────────────

test('every in-flight import status keeps the poll alive', () => {
  for (const s of [
    'queued',
    'pending',
    'in_progress',
    'processing',
    'scanning',
    'syncing',
    'reconciling',
    'ready_to_sync',
    'importing',
    'running',
  ]) {
    assert.equal(isImportingConnectionStatus(s), true, s);
  }
});

test('settled statuses do not keep the poll alive', () => {
  for (const s of ['active', 'review', 'error', 'inactive', '', undefined, null]) {
    assert.equal(isImportingConnectionStatus(s as any), false, String(s));
  }
});
