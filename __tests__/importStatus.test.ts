import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import type { AttentionReason, SyncItem } from '../src/types/syncItem.ts';
import { resetOwnerScopedImportState } from '../src/lib/connectionImportPresentation.ts';

const stubs = new Map<string, string>([
  ['react', 'export const useCallback = () => {}; export const useEffect = () => {}; export const useMemo = () => {}; export const useRef = () => {}; export const useState = () => {}; export const useSyncExternalStore = () => {};'],
  ['@react-navigation/native', 'export const useFocusEffect = () => {};'],
  ['@clerk/expo', 'export const useUser = () => ({ user: null });'],
  ['../lib/supabase', 'export const ensureSupabaseJwt = async () => null;'],
  ['../lib/apiClient', 'export const apiFetch = async () => { throw new Error("unused"); };'],
  ['../utils/logger', 'export const createLogger = () => ({ debug() {} });'],
  ['../context/PlatformConnectionsContext', 'export const usePlatformConnections = () => ({ connections: [], liveConnections: [], progressByConnectionId: {} });'],
  ['../context/OrgContext', 'export const useOrg = () => ({ currentOrg: null });'],
  ['./useOptimizerQueues', 'export const useOptimizerQueues = () => ({});'],
  ['../lib/platformConnectStatus', 'export const isVisiblePlatformConnection = () => true; export const isImportingConnectionStatus = () => false;'],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = stubs.get(specifier);
    if (stub) {
      return {
        url: `data:text/javascript,${encodeURIComponent(stub)}`,
        shortCircuit: true,
      };
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (typeof specifier === 'string' && specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const {
  parseInboxSummaryPayload,
  preserveImportEvidenceObservedAt,
  reconcileInboxAttention,
} = await import('../src/hooks/useImportStatus.ts');

function syncItem(platformId: string, attention: AttentionReason): SyncItem {
  return {
    platformId,
    sku: null,
    barcode: null,
    title: platformId,
    price: null,
    imageUrl: null,
    parentId: null,
    direction: 'pull',
    version: 1,
    attention,
    resolution: { kind: 'create' },
  };
}

function summary() {
  return {
    totalNeedsAttention: 9,
    byReason: {},
    connections: [
      {
        connectionId: 'zero',
        platformType: 'square',
        displayName: 'Square',
        state: 'live' as const,
        needsAttention: 0,
        attentionCount: 0,
        jobId: null,
        phase: null,
        itemsSoFar: 0,
        itemsTotal: 0,
        startedAt: null,
        observedAt: 1,
      },
      {
        connectionId: 'claimed',
        platformType: 'shopify',
        displayName: 'Shopify',
        state: 'needs-attention' as const,
        needsAttention: 9,
        attentionCount: 9,
        jobId: null,
        phase: null,
        itemsSoFar: 0,
        itemsTotal: 0,
        startedAt: null,
        observedAt: 1,
      },
    ],
    recentImports: [],
  };
}

test('resolution fan-out skips connections whose server attention count is zero', async () => {
  const fetched: string[] = [];
  const result = await reconcileInboxAttention(summary(), async (connectionId) => {
    fetched.push(connectionId);
    return [
      syncItem('question', 'weak_match'),
      syncItem('excluded', 'field_conflict'),
    ];
  });

  assert.deepEqual(fetched, ['claimed']);
  assert.deepEqual(result.connections.map((connection) => connection.needsAttention), [0, 1]);
  assert.equal(result.totalNeedsAttention, 1);
});

test('one failed resolution uses only that connection server count', async () => {
  const aggregate = summary();
  aggregate.connections.push({
    connectionId: 'healthy',
    platformType: 'ebay',
    displayName: 'eBay',
    state: 'needs-attention',
    needsAttention: 4,
    attentionCount: 4,
    jobId: null,
    phase: null,
    itemsSoFar: 0,
    itemsTotal: 0,
    startedAt: null,
    observedAt: 1,
  });

  const result = await reconcileInboxAttention(aggregate, async (connectionId) => {
    if (connectionId === 'claimed') throw new Error('temporary failure');
    return [syncItem('authoritative', 'multiple_candidates')];
  });

  assert.deepEqual(result.connections.map((connection) => connection.needsAttention), [0, 9, 1]);
  assert.equal(result.totalNeedsAttention, 10);
});

test('truth: switching account owner resets the shared inbox snapshot', () => {
  type Store = { ownerKey: string; count: number; error: string | null };
  const accountA: Store = { ownerKey: 'user-a:org-a', count: 7, error: null };
  const switched = resetOwnerScopedImportState<Store>(
    accountA,
    'user-b:org-b',
    (ownerKey) => ({ ownerKey, count: 0, error: null }),
  );

  assert.equal(switched.ownerKey, 'user-b:org-b', `expected ownerKey=user-b:org-b, got ${switched.ownerKey}`);
  assert.equal(switched.count, 0, `expected count=0 after account switch, got ${switched.count}`);
  assert.notEqual(switched, accountA, 'expected a new empty snapshot after account switch');
});

test('shared contract parses durable summary progress without manufacturing receipt fields', () => {
  const parsed = parseInboxSummaryPayload({
    totalNeedsAttention: 2,
    byReason: { weak_match: 2 },
    connections: [{
      connectionId: 'square',
      platformType: 'square',
      displayName: 'Square',
      state: 'syncing',
      needsAttention: 2,
      attentionCount: 2,
      itemsSoFar: 14,
      itemsTotal: 20,
      phase: 'committing',
      startedAt: '2026-08-16T12:00:00.000Z',
      jobId: 'job-1',
    }],
    recentImports: [{
      importId: 'import-1',
      connectionId: 'square',
      source: 'platform_scan',
      status: 'in_progress',
      itemsTotal: 20,
      itemsCommitted: 6,
      itemsFailed: 0,
      createdAt: '2026-08-16T12:00:00.000Z',
      completedAt: null,
      jobId: 'receipt-job-1',
      phase: 'staging',
    }],
  }, 123_000);

  assert.equal(parsed?.connections[0]?.observedAt, 123_000, `expected observedAt=123000, got ${parsed?.connections[0]?.observedAt}`);
  assert.equal(parsed?.connections[0]?.itemsSoFar, 14, `expected itemsSoFar=14, got ${parsed?.connections[0]?.itemsSoFar}`);
  assert.equal(parsed?.connections[0]?.itemsTotal, 20, `expected itemsTotal=20, got ${parsed?.connections[0]?.itemsTotal}`);
  assert.equal(parsed?.connections[0]?.phase, 'committing', `expected phase=committing, got ${parsed?.connections[0]?.phase}`);
  assert.equal(parsed?.connections[0]?.startedAt, '2026-08-16T12:00:00.000Z');
  assert.equal(parsed?.connections[0]?.jobId, 'job-1');
  assert.equal(parsed?.recentImports[0]?.itemsCommitted, 6);
  assert.equal(parsed?.recentImports[0]?.jobId, 'receipt-job-1');
  assert.equal(parsed?.recentImports[0]?.phase, 'staging');
});

function serverSummaryConnection(overrides: Record<string, unknown> = {}) {
  return {
    connectionId: 'square',
    platformType: 'square',
    displayName: 'Square',
    state: 'syncing',
    needsAttention: 0,
    attentionCount: 0,
    jobId: 'job-1',
    phase: 'matching',
    itemsSoFar: 4,
    itemsTotal: 10,
    startedAt: '2026-08-16T12:00:00.000Z',
    ...overrides,
  };
}

function serverSummaryPayload(connection: Record<string, unknown>) {
  return {
    totalNeedsAttention: 0,
    byReason: {},
    connections: [connection],
    recentImports: [],
  };
}

test('unchanged server evidence keeps its original observed time', () => {
  const payload = serverSummaryPayload(serverSummaryConnection());
  const first = parseInboxSummaryPayload(payload, 1_000)!;
  const repeated = parseInboxSummaryPayload(payload, 21_000)!;

  const preserved = preserveImportEvidenceObservedAt(first, repeated);
  assert.equal(preserved.connections[0]?.observedAt, 1_000);
});

test('changed server evidence receives the new observed time', () => {
  const first = parseInboxSummaryPayload(
    serverSummaryPayload(serverSummaryConnection()),
    1_000,
  )!;
  const changed = parseInboxSummaryPayload(
    serverSummaryPayload(serverSummaryConnection({ phase: 'committing', itemsSoFar: 5 })),
    21_000,
  )!;

  const preserved = preserveImportEvidenceObservedAt(first, changed);
  assert.equal(preserved.connections[0]?.observedAt, 21_000);
});
