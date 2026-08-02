import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('@babel/core');
const extensions = (require as any).extensions as Record<
  string,
  (module: { _compile: (code: string, filename: string) => void; exports: unknown }, filename: string) => void
>;

// The production module imports the platform registry, which imports SVG assets.
// Compile TypeScript to CommonJS and replace SVG modules with inert components so
// Node's native test runner can exercise the pure derivation without React Native.
const compileTypeScript = (
  module: { _compile: (code: string, filename: string) => void },
  filename: string,
) => {
  const source = fs.readFileSync(filename, 'utf8');
  const result = transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    plugins: [
      ['@babel/plugin-transform-typescript', { allowDeclareFields: true }],
      '@babel/plugin-transform-modules-commonjs',
    ],
  });
  module._compile(result?.code || '', filename);
};

extensions['.ts'] = compileTypeScript;
extensions['.svg'] = (module) => {
  module.exports = function SvgStub() {
    return null;
  };
};

const { derivePlatformConnectStatus } = require('./platformConnectStatus.ts') as typeof import('./platformConnectStatus');

const facebookConnection = {
  Id: 'facebook-1',
  PlatformType: 'facebook',
  DisplayName: 'Facebook',
  Status: 'active',
  IsEnabled: true,
} as any;

test('Facebook setup state follows linked status, not online status', () => {
  const cases = [
    {
      name: 'never linked',
      presence: { hasLinkedComputer: false, computerOnline: false, presenceLoaded: true },
      expected: {
        uiState: 'needs-computer',
        isFullyConnected: false,
        offlineComputer: false,
        pendingSteps: ['linkComputer'],
      },
    },
    {
      name: 'linked and all offline',
      presence: { hasLinkedComputer: true, computerOnline: false, presenceLoaded: true },
      expected: {
        uiState: 'connected',
        isFullyConnected: true,
        offlineComputer: true,
        pendingSteps: [],
      },
    },
    {
      name: 'linked and online',
      presence: { hasLinkedComputer: true, computerOnline: true, presenceLoaded: true },
      expected: {
        uiState: 'connected',
        isFullyConnected: true,
        offlineComputer: false,
        pendingSteps: [],
      },
    },
    {
      name: 'still loading',
      presence: { hasLinkedComputer: false, computerOnline: false, presenceLoaded: false },
      expected: {
        uiState: 'checking',
        isFullyConnected: false,
        offlineComputer: false,
        pendingSteps: ['linkComputer'],
      },
    },
  ] as const;

  for (const scenario of cases) {
    const status = derivePlatformConnectStatus('facebook', [facebookConnection], scenario.presence);
    assert.deepEqual(
      {
        uiState: status.uiState,
        isFullyConnected: status.isFullyConnected,
        offlineComputer: status.offlineComputer,
        pendingSteps: status.pendingSteps,
      },
      scenario.expected,
      scenario.name,
    );
  }
});

test('Finish setup is impossible when a computer has been linked', () => {
  for (const computerOnline of [false, true]) {
    const status = derivePlatformConnectStatus('facebook', [facebookConnection], {
      hasLinkedComputer: true,
      computerOnline,
      presenceLoaded: true,
    });
    assert.notEqual(status.uiState, 'needs-computer');
  }
});
