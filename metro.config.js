const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Watchman is failing on this machine's global state dir, so force Metro to use
// the node-based crawler instead of crashing during startup.
config.resolver.useWatchman = false;

// Fix react-async-hook: package.json "module" points to react-async-hook.esm.js at root, but file is in dist/
const defaultResolver = require('metro-resolver').resolve;
config.resolver.resolveRequest = (context, moduleName, platform) => {
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
