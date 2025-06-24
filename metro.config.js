const { getDefaultConfig } = require('expo/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

defaultConfig.resolver.sourceExts = [
  ...defaultConfig.resolver.sourceExts,
  'mjs',
  'svg',
];

defaultConfig.resolver.unstable_conditionNames = ['require', 'default', 'browser'];

// Make sure these asset extensions are included
defaultConfig.resolver.assetExts = [
  ...defaultConfig.resolver.assetExts.filter((ext) => ext !== 'svg'),
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ttf', 'otf', 'webp'
];

// Add this transformer configuration for SVG files
defaultConfig.transformer = {
  ...defaultConfig.transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer'),
};

module.exports = defaultConfig;

