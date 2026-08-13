import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import type { AttentionReason, SyncItem } from '../src/types/syncItem.ts';

const stubs = new Map<string, string>([
  ['react', 'export const useCallback = () => {}; export const useEffect = () => {}; export const useMemo = () => {}; export const useRef = () => {}; export const useState = () => {}; export const useSyncExternalStore = () => {};'],
  ['@react-navigation/native', 'export const useFocusEffect = () => {};'],
  ['../lib/supabase', 'export const ensureSupabaseJwt = async () => null;'],
  ['../lib/apiClient', 'export const apiFetch = async () => { throw new Error("unused"); };'],
  ['../utils/logger', 'export const createLogger = () => ({ debug() {} });'],
  ['../context/PlatformConnectionsContext', 'export const usePlatformConnections = () => ({ liveConnections: [] });'],
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

const { reconcileInboxAttention } = await import('../src/hooks/useImportStatus.ts');

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
      },
      {
        connectionId: 'claimed',
        platformType: 'shopify',
        displayName: 'Shopify',
        state: 'needs-attention' as const,
        needsAttention: 9,
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
  });

  const result = await reconcileInboxAttention(aggregate, async (connectionId) => {
    if (connectionId === 'claimed') throw new Error('temporary failure');
    return [syncItem('authoritative', 'multiple_candidates')];
  });

  assert.deepEqual(result.connections.map((connection) => connection.needsAttention), [0, 9, 1]);
  assert.equal(result.totalNeedsAttention, 10);
});
