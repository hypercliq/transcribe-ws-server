import assert from 'node:assert/strict'
import test from 'node:test'
import { handleTranscriptionStream } from '../handlers/transcription-handler.js'

const events = async function* () {
  yield {
    TranscriptEvent: {
      Transcript: {
        Results: [
          {
            IsPartial: true,
            Alternatives: [{ Transcript: 'private partial speech' }],
          },
          {
            IsPartial: false,
            Alternatives: [{ Transcript: 'private final speech' }],
          },
        ],
      },
    },
  }
}

const fixture = () => {
  const logs = []
  const messages = []
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...entries) => logs.push(entries),
    ]),
  )
  const ws = {
    OPEN: 1,
    readyState: 1,
    send: (message) => messages.push(JSON.parse(message)),
    close() {
      this.readyState = 3
    },
  }
  return { logger, ws, logs, messages }
}

test('transcript logging can be enabled explicitly for debugging', async () => {
  const { logger, ws, logs, messages } = fixture()
  await handleTranscriptionStream(events(), ws, logger, true, true)
  assert.deepEqual(messages, [
    { partialTranscript: 'private partial speech' },
    { transcript: 'private final speech' },
  ])
  assert.ok(JSON.stringify(logs).includes('private partial speech'))
  assert.ok(JSON.stringify(logs).includes('private final speech'))
})

test('late transcript events do not send to a disconnected socket', async () => {
  const { logger, ws, messages } = fixture()
  ws.readyState = 3
  await handleTranscriptionStream(events(), ws, logger, true)
  assert.deepEqual(messages, [])
})
