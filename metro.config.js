const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Add SVG support
config.resolver.sourceExts = [
  ...config.resolver.sourceExts,
  'mjs',
  'svg',
];

config.resolver.unstable_conditionNames = ['require', 'default', 'browser'];

// Make sure these asset extensions are included
config.resolver.assetExts = [
  ...config.resolver.assetExts.filter((ext) => ext !== 'svg'),
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ttf', 'otf', 'webp'
];

// Add this transformer configuration for SVG files
config.transformer = {
  ...config.transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer'),
};

module.exports = config;

