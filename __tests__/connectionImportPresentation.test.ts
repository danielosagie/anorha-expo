import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectionImportPresentationsById,
  deriveConnectionImportPresentation,
  latestImportsByConnection,
  type RecentImportOutcome,
} from '../src/lib/connectionImportPresentation.ts';

function importRun(
  status: string,
  createdAt: string,
  completedAt: string | null = createdAt,
): RecentImportOutcome {
  return { connectionId: 'square', status, createdAt, completedAt };
}

test('latest import is selected by time even when the payload is unsorted', () => {
  const failed = importRun('failed', '2026-08-09T12:00:00.000Z');
  const completed = importRun('complete', '2026-08-13T12:00:00.000Z');

  const latest = latestImportsByConnection([completed, failed]).get('square');

  assert.equal(latest, completed);
});

test('an error connection stays unhealthy despite a newer completed import', () => {
  const failed = importRun('failed', '2026-08-09T12:00:00.000Z');
  const completed = importRun('complete', '2026-08-13T12:00:00.000Z');
  const latest = latestImportsByConnection([failed, completed]).get('square');

  const presentation = deriveConnectionImportPresentation({
    enabled: true,
    connectionStatus: 'error',
    aggregateState: 'live',
    latestImport: latest,
  });

  assert.equal(presentation.kind, 'review');
  assert.equal(presentation.label, 'Needs attention');
  assert.equal(presentation.occurredAt, null);
});

test('a review connection stays unhealthy despite a newer completed import', () => {
  const failureReason = 'Shopify did not grant: read_locations. Reconnect and approve all permissions.';
  const presentations = connectionImportPresentationsById({
    connections: [{
      Id: 'square',
      IsEnabled: true,
      Status: 'review',
      SyncState: 'needs-attention',
      NeedsReauth: true,
      RecommendedAction: 'reconnect',
      FailureReason: failureReason,
    }],
    aggregateConnections: [{ connectionId: 'square', state: 'live' }],
    recentImports: [importRun('complete', '2026-08-13T12:00:00.000Z')],
  });

  const presentation = presentations.get('square');
  assert.equal(presentation?.kind, 'review');
  assert.equal(presentation?.label, 'Needs attention');
  assert.notEqual(presentation?.kind, 'synced');
  assert.equal(presentation?.failureReason, failureReason);
});

test('a null FailureReason adds no row detail', () => {
  const presentations = connectionImportPresentationsById({
    connections: [{
      Id: 'square',
      IsEnabled: true,
      Status: 'review',
      SyncState: 'needs-attention',
      RecommendedAction: 'reconnect',
      FailureReason: null,
    }],
  });

  assert.equal(presentations.get('square')?.failureReason, null);
});

test('a reconnect recommendation is treated as unhealthy', () => {
  const presentation = deriveConnectionImportPresentation({
    enabled: true,
    connectionStatus: 'active',
    recommendedAction: 'reconnect',
    latestImport: importRun('complete', '2026-08-13T12:00:00.000Z'),
  });

  assert.equal(presentation.kind, 'review');
  assert.equal(presentation.label, 'Needs attention');
});

test('a needs_reauth connection stays unhealthy despite a newer completed import', () => {
  const presentation = deriveConnectionImportPresentation({
    enabled: true,
    connectionStatus: 'needs_reauth',
    aggregateState: 'live',
    latestImport: importRun('complete', '2026-08-13T12:00:00.000Z'),
  });

  assert.equal(presentation.kind, 'review');
  assert.equal(presentation.label, 'Needs attention');
  assert.equal(presentation.importInProgress, false);
});

test('a failure after a success remains the latest visible outcome', () => {
  const completed = importRun('complete', '2026-08-09T12:00:00.000Z');
  const failed = importRun('failed', '2026-08-13T12:00:00.000Z');
  const latest = latestImportsByConnection([completed, failed]).get('square');

  const presentation = deriveConnectionImportPresentation({
    enabled: true,
    connectionStatus: 'active',
    aggregateState: 'error',
    latestImport: latest,
    latestSuccessfulImport: completed,
  });

  assert.equal(presentation.kind, 'failed');
  assert.equal(presentation.label, 'Import failed');
  assert.equal(presentation.occurredAt, failed.completedAt);
});

test('a current aggregate scan wins over a historical completed import', () => {
  const presentation = deriveConnectionImportPresentation({
    enabled: true,
    connectionStatus: 'active',
    aggregateState: 'scanning',
    latestImport: importRun('complete', '2026-08-09T12:00:00.000Z'),
  });

  assert.equal(presentation.kind, 'scanning');
  assert.equal(presentation.importInProgress, true);
});

test('a finished run never renders as scanning even when its status was not finalized', () => {
  const presentation = deriveConnectionImportPresentation({
    enabled: true,
    connectionStatus: 'active',
    latestImport: importRun(
      'scanning',
      '2026-08-16T12:00:00.000Z',
      '2026-08-16T12:01:00.000Z',
    ),
    now: Date.parse('2026-08-16T12:01:30.000Z'),
  });

  assert.equal(presentation.kind, 'synced');
  assert.equal(presentation.label, 'Synced');
  assert.equal(presentation.importInProgress, false);
});

test('run history can bridge polling briefly but cannot stay active past realtime retention', () => {
  const presentation = deriveConnectionImportPresentation({
    enabled: true,
    connectionStatus: 'active',
    latestImport: importRun('processing', '2026-08-16T12:00:00.000Z', null),
    now: Date.parse('2026-08-16T12:02:01.000Z'),
  });

  assert.equal(presentation.kind, 'synced');
  assert.equal(presentation.importInProgress, false);
});

test('a failure older than a successful sync is secondary and keeps its retry path', () => {
  const presentations = connectionImportPresentationsById({
    connections: [{
      Id: 'square',
      IsEnabled: true,
      Status: 'active',
      LastSyncSuccessAt: '2026-08-13T12:00:00.000Z',
      UpdatedAt: '2026-08-13T12:00:00.000Z',
    }],
    recentImports: [
      importRun('failed', '2026-08-09T12:00:00.000Z'),
      importRun('complete', '2026-08-13T12:00:00.000Z'),
    ],
  });

  const presentation = presentations.get('square');
  assert.equal(presentation?.kind, 'synced');
  assert.equal(presentation?.label, 'Synced');
  assert.deepEqual(presentation?.secondaryFailure, {
    label: 'Import failed',
    occurredAt: '2026-08-09T12:00:00.000Z',
  });
  assert.equal(presentation?.canRetryImport, true);
});

test('an import failure without a retry affordance is not the primary state', () => {
  const presentation = deriveConnectionImportPresentation({
    enabled: true,
    connectionStatus: 'active',
    latestImport: importRun('failed', '2026-08-09T12:00:00.000Z'),
    canRetryImport: false,
  });

  assert.equal(presentation.kind, 'synced');
  assert.equal(presentation.secondaryFailure, null);
  assert.equal(presentation.canRetryImport, false);
});

test('connection health and stale import history never alias to the same failure kind', () => {
  const oldFailure = importRun('failed', '2026-08-09T12:00:00.000Z');
  const unhealthyPoll = deriveConnectionImportPresentation({
    enabled: true,
    connectionStatus: 'review',
    syncState: 'needs-attention',
    latestImport: oldFailure,
    lastSyncSuccessAt: '2026-08-13T12:00:00.000Z',
  });
  const healthyPoll = deriveConnectionImportPresentation({
    enabled: true,
    connectionStatus: 'active',
    latestImport: oldFailure,
    lastSyncSuccessAt: '2026-08-13T12:00:00.000Z',
  });

  assert.equal(unhealthyPoll.kind, 'review');
  assert.equal(unhealthyPoll.label, 'Needs attention');
  assert.equal(healthyPoll.kind, 'synced');
  assert.equal(healthyPoll.label, 'Synced');
  assert.equal(healthyPoll.secondaryFailure?.label, 'Import failed');
});

test('an active run cannot revive a disconnected connection', () => {
  const presentation = deriveConnectionImportPresentation({
    enabled: false,
    connectionStatus: 'disconnected',
    latestImport: importRun('processing', '2026-08-13T12:00:00.000Z', null),
  });

  assert.equal(presentation.kind, 'disconnected');
  assert.equal(presentation.label, 'Disconnected');
  assert.equal(presentation.importInProgress, false);
});

test('a raw pending first-import status is importing before the run map arrives', () => {
  const presentation = deriveConnectionImportPresentation({
    enabled: false,
    connectionStatus: 'pending',
  });

  assert.equal(presentation.kind, 'scanning');
  assert.equal(presentation.importInProgress, true);
});
