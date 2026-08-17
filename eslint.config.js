import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  { ignores: ['dist', '.data'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { document: 'readonly', window: 'readonly', fetch: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: { ...reactHooks.configs.recommended.rules, 'react-hooks/set-state-in-effect': 'off' },
  },
  {
    files: ['*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest', sourceType: 'module',
      globals: { process: 'readonly', Buffer: 'readonly', URL: 'readonly', console: 'readonly' },
    },
  },
]
