import globals from 'globals'
import pluginJs from '@eslint/js'
import eslintPluginUnicorn from 'eslint-plugin-unicorn'

/** @type {import('eslint').Linter.Config[]} */
export default [
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  pluginJs.configs.recommended,
  eslintPluginUnicorn.configs['flat/recommended'],
  {
    rules: {
      'unicorn/better-regex': 'warn',
    },
  },
]
