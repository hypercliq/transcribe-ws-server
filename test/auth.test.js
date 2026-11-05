import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const environment = {
  ...process.env,
  AWS_REGION: 'eu-west-1',
  PORT: '3000',
  API_TOKENS: '["private-test-token"]',
}

const run = (code, overrides = {}) =>
  spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...environment, ...overrides },
    encoding: 'utf8',
  })

test('an empty API token list fails at startup', () => {
  const result = run("await import('./config/index.js')", { API_TOKENS: '[]' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Config validation error/)
})

test('authorization accepts configured tokens and rejects others without logging secrets', () => {
  const result = run(`
    import assert from 'node:assert/strict'
    import { validateQueryParameters } from './utils/validate-query.js'
    const logs = []
    const logger = { warn: (message) => logs.push(message), info: (message) => logs.push(message) }
    for (const [token, expected] of [['private-test-token', true], ['wrong', false], ['', false]]) {
      assert.equal(validateQueryParameters(new URL('http://localhost/?token=' + token), logger).isValid, expected)
    }
    assert.ok(!JSON.stringify(logs).includes('private'))
  `)
  assert.equal(result.status, 0, result.stderr)
})
