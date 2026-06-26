const path = require('path');
// Sentry's drop-in replacement for expo's getDefaultConfig. Adds Debug ID
// generation so uploaded source maps match the shipped bundle (required for
// readable JS stack traces in Sentry). Falls through to getDefaultConfig
// internally, so the resolver/transformer tweaks below behave identically.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getSentryExpoConfig(__dirname);

// Watchman is failing on this machine's global state dir, so force Metro to use
// the node-based crawler instead of crashing during startup.
config.resolver.useWatchman = false;

// Fix react-async-hook: package.json "module" points to react-async-hook.esm.js at root, but file is in dist/
const defaultResolver = require('metro-resolver').resolve;
// Web-only design-export build: stub native-only modules so real screens render in the browser.
const clerkWebMock = path.join(__dirname, 'mocks', 'clerkExpoMock.tsx');
const cameraWebMock = path.join(__dirname, 'mocks', 'expoCameraMock.tsx');
// context modules whose real providers use sockets/native/heavy network — aliased to passthrough mocks on web
const contextWebMocks = {
  PlatformConnectionsContext: path.join(__dirname, 'mocks', 'contexts', 'PlatformConnectionsContext.tsx'),
};
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName.startsWith('@clerk/expo')) {
    return { filePath: clerkWebMock, type: 'sourceFile' };
  }
  if (platform === 'web' && moduleName === 'expo-camera') {
    return { filePath: cameraWebMock, type: 'sourceFile' };
  }
  if (platform === 'web' && moduleName === 'expo-blur') {
    return { filePath: path.join(__dirname, 'mocks', 'expoBlurMock.tsx'), type: 'sourceFile' };
  }
  if (platform === 'web' && moduleName === '@native-springs/shaders') {
    return { filePath: path.join(__dirname, 'mocks', 'nativeSpringsShadersMock.tsx'), type: 'sourceFile' };
  }
  // Render modals inline (not viewport-fixed) so sheets stay inside their export tiles.
  if (platform === 'web' && /(^|\/)exports\/Modal$/.test(moduleName)) {
    return { filePath: path.join(__dirname, 'mocks', 'rnwModalMock.tsx'), type: 'sourceFile' };
  }
  if (platform === 'web') {
    for (const name of Object.keys(contextWebMocks)) {
      if (moduleName.endsWith('/context/' + name) || moduleName.endsWith('/' + name)) {
        return { filePath: contextWebMocks[name], type: 'sourceFile' };
      }
    }
  }
  if (moduleName === 'react-async-hook') {
    const pkgPath = path.join(__dirname, 'node_modules', 'react-async-hook', 'dist', 'react-async-hook.esm.js');
    return { filePath: pkgPath, type: 'sourceFile' };
  }
  return defaultResolver(context, moduleName, platform);
};

// Add SVG support
config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs', 'svg'];

config.resolver.unstable_conditionNames = ['require', 'default', 'browser'];

config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== 'svg');

// Add this transformer configuration for SVG files
config.transformer = {
  ...config.transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer/expo'),
};

module.exports = config;
