import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

const stubs = new Map<string, string>([
  ['react', 'export const useCallback = () => {}; export const useEffect = () => {}; export const useRef = () => {}; export const useState = () => {};'],
  ['@react-navigation/native', 'export const useIsFocused = () => true;'],
  ['../lib/apiClient', 'export const apiFetch = async () => { throw new Error("unused"); };'],
  ['../utils/logger', 'export const createLogger = () => ({ debug() {} });'],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = stubs.get(specifier);
    if (stub) return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
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
  parseImportJobProgress,
  resolveImportJobId,
} = await import('../src/hooks/useImportJobProgress.ts');

test('job polling resumes from the summary job id after local state is lost', () => {
  assert.equal(resolveImportJobId(undefined, 'summary-job-1'), 'summary-job-1');
  assert.equal(resolveImportJobId('live-job-2', 'summary-job-1'), 'live-job-2');
});

test('job progress treats inactive incomplete work as failed', () => {
  assert.equal(parseImportJobProgress({ isActive: false, isCompleted: false })?.state, 'failed');
});

test('job progress parses active counts and terminal completion', () => {
  assert.deepEqual(parseImportJobProgress({
    isActive: true,
    processed: 7,
    total: 12,
    phase: 'committing',
  }), {
    state: 'active',
    processed: 7,
    total: 12,
    itemsSoFar: 7,
    phase: 'committing',
    description: null,
  });
  assert.equal(parseImportJobProgress({ isCompleted: true })?.state, 'completed');
});
