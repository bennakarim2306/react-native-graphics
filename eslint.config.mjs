import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['lib/', 'coverage/', 'node_modules/'] },
  js.configs.recommended,
  {
    files: ['*.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    files: ['src/**/*.ts'],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // Architecture boundary: the core engine must stay platform-independent.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-native', 'react-native-*', '@shopify/*', '*/react/*', '*/renderers/*'],
              message: 'src/core must not depend on React, React Native or renderer adapters.',
            },
          ],
        },
      ],
    },
  },
);
