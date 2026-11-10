import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['index.html', 'vendor/**', 'node_modules/**', 'tests/golden/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-implicit-globals': 'error',
      'no-eval': 'error',
    },
  },
  { files: ['src/ui/**'], languageOptions: { globals: globals.browser } },
  { files: ['src/render/canvas.js'], languageOptions: { globals: globals.browser } },
  { files: ['scripts/**', 'tests/**', 'tests-ui/**', 'eslint.config.js'], languageOptions: { globals: { ...globals.node, document: 'readonly', localStorage: 'readonly' } } },
];
