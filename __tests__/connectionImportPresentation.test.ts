import test from 'node:test';
import assert from 'node:assert/strict';
import {
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

test('a completed import wins over an older failure and stale connection error', () => {
  const failed = importRun('failed', '2026-08-09T12:00:00.000Z');
  const completed = importRun('complete', '2026-08-13T12:00:00.000Z');
  const latest = latestImportsByConnection([failed, completed]).get('square');

  const presentation = deriveConnectionImportPresentation({
    enabled: true,
    connectionStatus: 'error',
    aggregateState: 'live',
    latestImport: latest,
  });

  assert.equal(presentation.kind, 'synced');
  assert.equal(presentation.label, 'Synced');
  assert.equal(presentation.occurredAt, completed.completedAt);
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
