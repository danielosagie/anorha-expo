import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectionRowModel,
  type ConnectionRowAction,
} from '../src/lib/connectionRowModel.ts';
import type {
  ConnectionImportKind,
  ConnectionImportPresentation,
} from '../src/lib/connectionImportPresentation.ts';

const KINDS: ConnectionImportKind[] = [
  'disconnected',
  'synced',
  'review',
  'failed',
  'scanning',
  'importing',
  'checking',
];

const STATUS_BY_KIND: Record<ConnectionImportKind, { label: string; color: string }> = {
  disconnected: { label: 'Disconnected', color: '#71717A' },
  synced: { label: 'Synced', color: '#93C822' },
  review: { label: 'Needs review', color: '#A2611A' },
  failed: { label: 'Import failed', color: '#DC2626' },
  scanning: { label: 'Importing', color: '#A2611A' },
  importing: { label: 'Importing', color: '#A2611A' },
  checking: { label: 'Checking', color: '#71717A' },
};

type ActionInputs = Pick<
  ConnectionImportPresentation,
  'requiresReconnect' | 'canRetryImport' | 'attentionCount'
>;

const ACTION_INPUTS: Array<{
  name: string;
  inputs: ActionInputs;
  expectedByKind: Partial<Record<ConnectionImportKind, ConnectionRowAction>>;
}> = [
  {
    name: 'no action signal',
    inputs: { requiresReconnect: false, canRetryImport: false, attentionCount: 0 },
    expectedByKind: { review: 'Review' },
  },
  {
    name: 'attention',
    inputs: { requiresReconnect: false, canRetryImport: false, attentionCount: 2 },
    expectedByKind: { synced: 'Review', review: 'Review' },
  },
  {
    name: 'retryable',
    inputs: { requiresReconnect: false, canRetryImport: true, attentionCount: 0 },
    expectedByKind: { review: 'Review', failed: 'Retry' },
  },
  {
    name: 'retryable with attention',
    inputs: { requiresReconnect: false, canRetryImport: true, attentionCount: 2 },
    expectedByKind: { synced: 'Review', review: 'Review', failed: 'Retry' },
  },
  {
    name: 'reconnect',
    inputs: { requiresReconnect: true, canRetryImport: false, attentionCount: 0 },
    expectedByKind: Object.fromEntries(KINDS.map((kind) => [kind, 'Reconnect'])),
  },
  {
    name: 'reconnect with every lower-priority signal',
    inputs: { requiresReconnect: true, canRetryImport: true, attentionCount: 2 },
    expectedByKind: Object.fromEntries(KINDS.map((kind) => [kind, 'Reconnect'])),
  },
];

test('every presentation kind maps to the one approved short status', () => {
  for (const kind of KINDS) {
    const model = connectionRowModel({
      kind,
      requiresReconnect: false,
      canRetryImport: false,
      attentionCount: 0,
    });

    assert.deepEqual(model.status, STATUS_BY_KIND[kind], kind);
  }
});

test('every presentation kind x action-signal combination has exactly one trailing element', () => {
  for (const { name, inputs, expectedByKind } of ACTION_INPUTS) {
    for (const kind of KINDS) {
      const model = connectionRowModel({ kind, ...inputs });
      const expectedAction = expectedByKind[kind];

      assert.deepEqual(
        model.trailing,
        expectedAction
          ? { type: 'action', label: expectedAction }
          : { type: 'chevron' },
        `${kind} / ${name}`,
      );
      assert.deepEqual(Object.keys(model.status).sort(), ['color', 'label']);
      assert.equal(
        Object.keys(model.trailing).length,
        model.trailing.type === 'action' ? 2 : 1,
        `${kind} / ${name} exposes one trailing element`,
      );
    }
  }
});

test('reconnect replaces the kind status and wins action precedence', () => {
  for (const kind of KINDS) {
    const model = connectionRowModel({
      kind,
      requiresReconnect: true,
      canRetryImport: true,
      attentionCount: 3,
    });

    assert.deepEqual(model, {
      status: { label: 'Reconnect needed', color: '#DC2626' },
      trailing: { type: 'action', label: 'Reconnect' },
    });
  }
});

test('healthy attention is one Review action with no count in the row model', () => {
  const model = connectionRowModel({
    kind: 'synced',
    requiresReconnect: false,
    canRetryImport: false,
    attentionCount: 12,
  });

  assert.deepEqual(model, {
    status: { label: 'Synced', color: '#93C822' },
    trailing: { type: 'action', label: 'Review' },
  });
  assert.equal(JSON.stringify(model).includes('12'), false);
});
