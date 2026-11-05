import globals from 'globals'
import pluginJs from '@eslint/js'
import eslintPluginUnicorn from 'eslint-plugin-unicorn'

/** @type {import('eslint').Linter.Config[]} */
export default [
  { ignores: ['client/**', '.dev/**', 'coverage/**', 'logs/**'] },
  { languageOptions: { globals: globals.nodeBuiltin } },
  pluginJs.configs.recommended,
  eslintPluginUnicorn.configs.recommended,
  {
    rules: {
      'unicorn/better-regex': 'warn',
      // Preserve conventional JSDoc used by the project and editor tooling.
      'unicorn/no-asterisk-prefix-in-documentation-comments': 'off',
      'unicorn/single-line-block-comment-style': 'off',
    },
  },
  {
    files: ['test/**/*.js'],
    // Socket test doubles use methods with the same receiver behavior as ws.
    rules: { 'unicorn/no-this-outside-of-class': 'off' },
  },
]
