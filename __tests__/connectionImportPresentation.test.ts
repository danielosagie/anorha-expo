import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_IMPORT_EVIDENCE_TTL_MS,
  connectionImportPresentationsById,
  connectionImportPhaseLabel,
  deriveConnectionImportPresentation,
  latestImportsByConnection,
  type RecentImportOutcome,
} from '../src/lib/connectionImportPresentation.ts';

type PresentationExpectation = Partial<ReturnType<typeof deriveConnectionImportPresentation>>;

function expectPresentation(
  input: Parameters<typeof deriveConnectionImportPresentation>[0],
  expected: PresentationExpectation,
) {
  const actual = deriveConnectionImportPresentation(input);
  for (const [field, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[field as keyof typeof actual];
    assert.deepEqual(
      actualValue,
      expectedValue,
      `expected ${field}=${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`,
    );
  }
  return actual;
}

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

test('truth: terminal error with no newer success or activity is blocking red', () => {
  expectPresentation({
    enabled: true,
    connectionStatus: 'error',
    connectionUpdatedAt: '2026-08-13T12:00:00.000Z',
    now: Date.parse('2026-08-13T12:01:00.000Z'),
  }, {
    kind: 'failed',
    label: 'Import failed',
    color: '#DC2626',
    blocking: true,
    importInProgress: false,
  });
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

test('truth: explicit reauth stays blocking red even during active progress', () => {
  const now = Date.parse('2026-08-16T12:01:00.000Z');
  expectPresentation({
    enabled: true,
    needsReauth: true,
    connectionStatus: 'review',
    progressStatus: 'syncing',
    progressReceivedAt: now - 1_000,
    now,
  }, {
    kind: 'review',
    label: 'Needs attention',
    color: '#DC2626',
    blocking: true,
    importInProgress: false,
  });
});

test('truth: review plus attention only is non-blocking amber and reviewable', () => {
  expectPresentation({
    enabled: true,
    connectionStatus: 'review',
    aggregateState: 'needs-attention',
    aggregateAttentionCount: 3,
  }, {
    kind: 'review',
    label: 'Needs review',
    color: '#A2611A',
    blocking: false,
    canRetryImport: true,
    attentionCount: 3,
    attentionColor: '#A2611A',
  });
});

test('truth: review is suppressed by fresh active import evidence', () => {
  const now = Date.parse('2026-08-16T12:05:00.000Z');
  expectPresentation({
    enabled: true,
    connectionStatus: 'review',
    aggregateState: 'syncing',
    aggregateObservedAt: now - 20_000,
    now,
  }, {
    kind: 'importing',
    label: 'Importing',
    color: '#A2611A',
    blocking: false,
    importInProgress: true,
  });
});

test('truth: transient needs-attention SyncState is suppressed mid-import', () => {
  const now = Date.parse('2026-08-16T12:05:00.000Z');
  expectPresentation({
    enabled: true,
    connectionStatus: 'active',
    syncState: 'needs-attention',
    recommendedAction: 'reconnect',
    progressStatus: 'scanning',
    progressReceivedAt: now - 1_000,
    now,
  }, {
    kind: 'scanning',
    label: 'Finding items',
    color: '#A2611A',
    blocking: false,
    importInProgress: true,
  });
});

test('truth: partial success is synced with a separate amber attention badge', () => {
  const presentation = connectionImportPresentationsById({
    connections: [{ Id: 'square', IsEnabled: true, Status: 'active' }],
    aggregateConnections: [{
      connectionId: 'square',
      state: 'active',
      needsAttention: 4,
      observedAt: Date.parse('2026-08-16T12:05:00.000Z'),
    }],
  }).get('square');

  assert.equal(presentation?.kind, 'synced', `expected kind=synced, got ${presentation?.kind}`);
  assert.equal(presentation?.color, '#93C822', `expected color=#93C822, got ${presentation?.color}`);
  assert.equal(presentation?.attentionCount, 4, `expected attentionCount=4, got ${presentation?.attentionCount}`);
  assert.equal(presentation?.attentionColor, '#A2611A', `expected attentionColor=#A2611A, got ${presentation?.attentionColor}`);
  assert.notEqual(presentation?.color, '#DC2626', `expected non-red primary color, got ${presentation?.color}`);
});

test('truth: recovery with cleared health fields is synced', () => {
  expectPresentation({
    enabled: true,
    connectionStatus: 'active',
    syncState: 'live',
    needsReauth: false,
    recommendedAction: null,
    failureReason: null,
  }, {
    kind: 'synced',
    label: 'Synced',
    color: '#93C822',
    blocking: false,
  });
});

test('truth: progress without progressReceivedAt is stale', () => {
  expectPresentation({
    enabled: true,
    connectionStatus: 'active',
    progressStatus: 'syncing',
    now: Date.parse('2026-08-16T12:05:00.000Z'),
  }, {
    kind: 'synced',
    importInProgress: false,
  });
});

test('truth: a 20-second aggregate refresh bridges an import past the two-minute TTL', () => {
  const startedAt = Date.parse('2026-08-16T12:00:00.000Z');
  const now = startedAt + ACTIVE_IMPORT_EVIDENCE_TTL_MS + 3 * 60_000;
  expectPresentation({
    enabled: true,
    connectionStatus: 'active',
    aggregateState: 'syncing',
    aggregateStartedAt: new Date(startedAt).toISOString(),
    aggregateObservedAt: now - 20_000,
    now,
  }, {
    kind: 'importing',
    importInProgress: true,
    startedAt: new Date(startedAt).toISOString(),
  });
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
  const now = Date.parse('2026-08-16T12:00:00.000Z');
  const presentation = deriveConnectionImportPresentation({
    enabled: true,
    connectionStatus: 'active',
    aggregateState: 'scanning',
    aggregateObservedAt: now,
    latestImport: importRun('complete', '2026-08-09T12:00:00.000Z'),
    now,
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

test('stale active run history becomes checking after realtime retention', () => {
  const presentation = deriveConnectionImportPresentation({
    enabled: true,
    connectionStatus: 'active',
    latestImport: importRun('processing', '2026-08-16T12:00:00.000Z', null),
    now: Date.parse('2026-08-16T12:02:01.000Z'),
  });

  assert.equal(presentation.kind, 'checking');
  assert.equal(presentation.label, 'Checking');
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

test('an import failure stays blocking even without a retry affordance', () => {
  const presentation = deriveConnectionImportPresentation({
    enabled: true,
    connectionStatus: 'active',
    latestImport: importRun('failed', '2026-08-09T12:00:00.000Z'),
    canRetryImport: false,
  });

  assert.equal(presentation.kind, 'failed');
  assert.equal(presentation.color, '#DC2626');
  assert.equal(presentation.blocking, true);
  assert.equal(presentation.secondaryFailure, null);
  assert.equal(presentation.canRetryImport, false);
});

test('non-auth review health and stale import history stay non-blocking', () => {
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
  assert.equal(unhealthyPoll.label, 'Needs review');
  assert.equal(unhealthyPoll.color, '#A2611A');
  assert.equal(unhealthyPoll.blocking, false);
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

test('a fresh pending first-import status is importing before the run map arrives', () => {
  const now = Date.parse('2026-08-16T12:00:00.000Z');
  const presentation = deriveConnectionImportPresentation({
    enabled: false,
    connectionStatus: 'pending',
    connectionUpdatedAt: new Date(now).toISOString(),
    now,
  });

  assert.equal(presentation.kind, 'scanning');
  assert.equal(presentation.label, 'Finding items');
  assert.equal(presentation.importInProgress, true);
});

test('stale connection and aggregate evidence resolve to checking', () => {
  const now = Date.parse('2026-08-16T12:05:00.000Z');
  const staleAt = now - ACTIVE_IMPORT_EVIDENCE_TTL_MS - 1;
  const presentation = deriveConnectionImportPresentation({
    enabled: true,
    connectionStatus: 'scanning',
    connectionUpdatedAt: new Date(staleAt).toISOString(),
    aggregateState: 'syncing',
    aggregateObservedAt: staleAt,
    now,
  });

  assert.equal(presentation.kind, 'checking');
  assert.equal(presentation.label, 'Checking');
  assert.equal(presentation.importInProgress, false);
});

test('phase labels distinguish pull, match, commit, and unknown', () => {
  assert.equal(connectionImportPhaseLabel('pull'), 'Finding items');
  assert.equal(connectionImportPhaseLabel('matching'), 'Matching');
  assert.equal(connectionImportPhaseLabel('committing'), 'Importing');
  assert.equal(connectionImportPhaseLabel('mystery'), 'Checking');
});

test('fresh progress phase takes precedence over a coarse connection status', () => {
  const now = Date.parse('2026-08-16T12:00:00.000Z');
  const presentation = deriveConnectionImportPresentation({
    enabled: true,
    connectionStatus: 'scanning',
    connectionUpdatedAt: new Date(now).toISOString(),
    progressStatus: 'syncing',
    progressPhase: 'matching',
    progressReceivedAt: now,
    now,
  });

  assert.equal(presentation.label, 'Matching');
  assert.equal(presentation.importInProgress, true);
});
