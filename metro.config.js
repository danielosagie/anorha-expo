const { getDefaultConfig } = require('expo/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

defaultConfig.resolver.sourceExts = [
  ...defaultConfig.resolver.sourceExts,
  'mjs',
];

defaultConfig.resolver.unstable_conditionNames = ['require', 'default', 'browser'];

// Make sure these asset extensions are included
defaultConfig.resolver.assetExts = [
  ...defaultConfig.resolver.assetExts,
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ttf', 'otf', 'svg', 'webp'
];

module.exports = defaultConfig;

