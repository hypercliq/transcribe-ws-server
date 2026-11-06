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

test('invalid API_TOKENS produce actionable startup errors without exposing tokens', () => {
  const marker = 'private-token-must-not-appear'
  const cases = [
    [`["${marker}"`, /API_TOKENS.*must be valid JSON/],
    ['[]', /API_TOKENS.*must be a non-empty JSON array/],
    [
      JSON.stringify({ token: marker }),
      /API_TOKENS.*must be a non-empty JSON array/,
    ],
    [
      JSON.stringify([marker, '']),
      /API_TOKENS.*entries must be non-empty strings/,
    ],
  ]
  for (const [tokens, message] of cases) {
    const result = run("await import('./config/index.js')", {
      API_TOKENS: tokens,
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Config validation error/)
    assert.match(result.stderr, message)
    assert.ok(!(result.stdout + result.stderr).includes(marker))
  }
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
