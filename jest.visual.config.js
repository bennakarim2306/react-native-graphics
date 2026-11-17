/**
 * Visual capture harness (not part of `npm test`): renders the scenes in scripts/visual with
 * real Skia (CanvasKit, CPU raster) and writes PNGs. Run: npm run visual
 * Output directory: VISUAL_OUT (default visual-out/).
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: '@react-native/jest-preset',
  testEnvironment: '@shopify/react-native-skia/jestEnv.js',
  resolver: 'react-native-reanimated/jest/resolver.js',
  rootDir: '.',
  roots: ['<rootDir>/scripts/visual'],
  testMatch: ['**/*.visual.ts'],
  setupFiles: ['@shopify/react-native-skia/jestSetup.js', '<rootDir>/jest.setup.rn.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.canvaskit.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native|@shopify/react-native-skia|react-native-reanimated|react-native-worklets)/)',
  ],
  testTimeout: 600000,
};
