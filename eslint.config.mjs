import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['lib/', 'coverage/', 'node_modules/', 'example/'] },
  js.configs.recommended,
  {
    files: ['*.config.js', 'jest.setup.*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // Architecture boundary: the engine model (runtime, animation math, scene, engine, particles,
    // sprites, effect descriptions) must stay platform-independent. Only src/renderer/**
    // and src/react-native/** may touch React, React Native, Reanimated/Worklets or Skia.
    files: [
      'src/runtime/**/*.ts',
      'src/animation/**/*.ts',
      'src/scene/**/*.ts',
      'src/engine/**/*.ts',
      'src/particles/**/*.ts',
      'src/sprites/**/*.ts',
      'src/graphics/**/*.ts',
      'src/assets/**/*.ts',
      'src/effects/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-native',
                'react-native-*',
                '@shopify/*',
                '**/renderer/**',
                '**/react-native/**',
              ],
              message:
                'Engine modules must not depend on React, React Native, Skia, Reanimated or host/renderer adapters.',
            },
          ],
        },
      ],
    },
  },
);
