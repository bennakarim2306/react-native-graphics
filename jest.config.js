const rnBase = {
  preset: '@react-native/jest-preset',
  testEnvironment: '@shopify/react-native-skia/jestEnv.js',
  // Reanimated's resolver (which wraps Worklets') picks their Jest-compatible implementations.
  resolver: 'react-native-reanimated/jest/resolver.js',
  roots: ['<rootDir>/src'],
  setupFiles: ['@shopify/react-native-skia/jestSetup.js', '<rootDir>/jest.setup.rn.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native|@shopify/react-native-skia|react-native-reanimated|react-native-worklets)/)',
  ],
};

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      // Platform-independent engine code. Plain Node, no React Native.
      displayName: 'core',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['<rootDir>/src/{runtime,particles,effects}/**/*.test.ts', '<rootDir>/src/index.test.ts'],
    },
    {
      // Skia renderer against real Skia (CanvasKit, CPU raster) in Node. Skia's Jest setup
      // backs the `@shopify/react-native-skia` API with CanvasKit, so drawing is real.
      ...rnBase,
      displayName: 'renderer',
      testMatch: ['<rootDir>/src/renderer/**/*.test.ts'],
    },
    {
      // React Native integration with the RN Jest preset.
      ...rnBase,
      displayName: 'react-native',
      testMatch: ['<rootDir>/src/react-native/**/*.test.tsx'],
    },
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}', '!src/**/*.d.ts'],
};
