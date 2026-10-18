import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.output/**', '.wxt/**', 'node_modules/**', 'public/**', 'data/raw/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**', 'entrypoints/**'],
    rules: {
      // Guardrail: this extension must never make network calls.
      'no-restricted-globals': ['error', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'],
      'no-restricted-properties': ['error', { object: 'navigator', property: 'sendBeacon' }],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
);
