import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const configUrl = new URL('../config/index.js', import.meta.url).href
const requiredEnvironment = {
  AWS_REGION: 'eu-west-1',
  PORT: '3000',
  API_TOKENS: '["environment-test-token"]',
}

const runConfig = (t, { file, environment = {}, directory = false } = {}) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'transcribe-config-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  if (file !== undefined) writeFileSync(path.join(cwd, '.env'), file)
  if (directory) mkdirSync(path.join(cwd, '.env'))
  const childEnvironment = { ...process.env }
  for (const key of [
    'AWS_REGION',
    'PORT',
    'API_TOKENS',
    'NODE_ENV',
    'LOG_LEVEL',
    'LOG_FILE',
    'LOG_TRANSCRIPTS',
  ]) {
    delete childEnvironment[key]
  }
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    const { default: config } = await import(${JSON.stringify(configUrl)})
    process.stdout.write(JSON.stringify(config))
  `,
    ],
    {
      cwd,
      env: { ...childEnvironment, ...environment },
      encoding: 'utf8',
      timeout: 5000,
    },
  )
}

test('configuration works without .env when environment variables are supplied', (t) => {
  const result = runConfig(t, { environment: requiredEnvironment })
  assert.equal(result.status, 0, result.stderr)
  const config = JSON.parse(result.stdout)
  assert.equal(config.aws.region, 'eu-west-1')
  assert.equal(config.server.port, 3000)
  assert.deepEqual(config.auth.apiTokens, ['environment-test-token'])
  assert.equal(config.logging.transcripts, false)
})

test('configuration reads quoted token arrays, comments and booleans from .env', (t) => {
  const result = runConfig(t, {
    file: `
    AWS_REGION=eu-central-1
    PORT=3456 # comment after value
    API_TOKENS='["first-file-token", "second-file-token"]'
    NODE_ENV=production
    LOG_TRANSCRIPTS=true
  `,
  })
  assert.equal(result.status, 0, result.stderr)
  const config = JSON.parse(result.stdout)
  assert.equal(config.aws.region, 'eu-central-1')
  assert.equal(config.server.port, 3456)
  assert.deepEqual(config.auth.apiTokens, [
    'first-file-token',
    'second-file-token',
  ])
  assert.equal(config.environment, 'production')
  assert.equal(config.logging.transcripts, true)
})

test('existing environment variables take precedence over .env values', (t) => {
  const result = runConfig(t, {
    file: `AWS_REGION=eu-central-1\nPORT=3456\nAPI_TOKENS='["file-token"]'\nLOG_TRANSCRIPTS=true\n`,
    environment: { ...requiredEnvironment, LOG_TRANSCRIPTS: 'false' },
  })
  assert.equal(result.status, 0, result.stderr)
  const config = JSON.parse(result.stdout)
  assert.equal(config.aws.region, 'eu-west-1')
  assert.equal(config.server.port, 3000)
  assert.deepEqual(config.auth.apiTokens, ['environment-test-token'])
  assert.equal(config.logging.transcripts, false)
})

test('an existing .env that cannot be read fails instead of being ignored', (t) => {
  const result = runConfig(t, {
    directory: true,
    environment: requiredEnvironment,
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /\.env/)
  assert.equal(result.stdout, '')
})
