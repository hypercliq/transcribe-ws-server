import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import WebSocket from 'ws'

process.env.AWS_REGION = 'eu-west-1'
process.env.PORT = '3000'
process.env.API_TOKENS = '["private-test-token"]'
const { createTranscriptionServer } = await import('../app.js')

const config = {
  server: {
    maxConnections: 2,
    transcribeTimeoutMs: 1000,
    maxAudioMessageBytes: 32,
    maxBufferedAudioBytes: 64,
  },
  logging: { transcripts: false },
}

const launch = async (t, client, overrides = {}) => {
  const logs = []
  const logger = Object.fromEntries(
    ['info', 'warn', 'error', 'debug'].map((level) => [
      level,
      (...entries) => {
        logs.push(entries)
      },
    ]),
  )
  logger.child = (context) => {
    logs.push(context)
    return logger
  }
  const app = createTranscriptionServer({
    transcribeClient: client,
    config: { ...config, ...overrides },
    logger,
  })
  t.after(() => app.shutdown({ graceMs: 20 }))
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  const address = `ws://127.0.0.1:${app.server.address().port}`
  const connect = async (query = '?token=private-test-token', options) => {
    const ws = new WebSocket(address + '/' + query, options)
    t.after(() => ws.terminate())
    await once(ws, 'open')
    return ws
  }
  return { ...app, address, connect, logs }
}

const abortableClient = (onStart = () => {}) => ({
  send: (_command, { abortSignal }) =>
    new Promise((_, reject) => {
      onStart(abortSignal)
      abortSignal.addEventListener(
        'abort',
        () => reject(new Error('aborted')),
        { once: true },
      )
    }),
})

test('real WebSocket streams audio through end-of-stream and returns final results without logging content', async (t) => {
  const chunks = []
  const client = {
    async send(command) {
      return {
        TranscriptResultStream: (async function* () {
          for await (const event of command.input.AudioStream)
            chunks.push(event.AudioEvent.AudioChunk)
          yield {
            TranscriptEvent: {
              Transcript: {
                Results: [
                  {
                    IsPartial: true,
                    Alternatives: [{ Transcript: 'private spoken content' }],
                  },
                  {
                    IsPartial: false,
                    Alternatives: [{ Transcript: 'private spoken content' }],
                  },
                ],
              },
            },
          }
        })(),
      }
    },
  }
  const app = await launch(t, client)
  const ws = await app.connect(
    '?token=private-test-token&sendPartials=false&language=en-GB',
  )
  const results = []
  ws.on('message', (message) => {
    results.push(JSON.parse(message))
  })
  const closed = once(ws, 'close')
  ws.send(Buffer.from([1, 2]))
  ws.send('END_OF_STREAM')
  const [code] = await closed
  assert.equal(code, 1000)
  assert.deepEqual(chunks, [Buffer.from([1, 2]), Buffer.alloc(0)])
  assert.deepEqual(results, [{ transcript: 'private spoken content' }])
  const logs = JSON.stringify(app.logs)
  assert.ok(!logs.includes('private-test-token'))
  assert.ok(!logs.includes('private spoken content'))
  assert.ok(logs.includes('tokenFingerprint'))
  assert.ok(logs.includes('sessionId'))
  assert.ok(logs.includes('en-GB'))
  assert.ok(logs.includes('sampleRate'))
})

test('invalid authorization never calls AWS and does not disclose configured tokens', async (t) => {
  let calls = 0
  const app = await launch(t, {
    send() {
      calls++
      throw new Error('must not call AWS')
    },
  })
  const ws = await app.connect('?token=wrong')
  const [code] = await once(ws, 'close')
  assert.equal(code, 1008)
  assert.equal(calls, 0)
  assert.ok(!JSON.stringify(app.logs).includes('private-test-token'))
})

test('shutdown aborts active AWS requests, closes clients and stops listening', async (t) => {
  let signal
  const app = await launch(
    t,
    abortableClient((value) => {
      signal = value
    }),
  )
  const ws = await app.connect()
  const closed = once(ws, 'close')
  const shutdown = app.shutdown({ graceMs: 20 })
  assert.equal(app.shutdown(), shutdown)
  assert.equal(signal.aborted, true)
  const [code] = await closed
  assert.equal(code, 1001)
  await shutdown
  assert.equal(app.server.listening, false)
  assert.equal(app.wss.clients.size, 0)
})

test('shutdown terminates a peer that never replies to the closing handshake', async (t) => {
  const app = await launch(t, abortableClient())
  const ws = await app.connect()
  ws._receiver.removeAllListeners('conclude')
  await app.shutdown({ graceMs: 20 })
  assert.equal(app.wss.clients.size, 0)
})

test('oversized audio messages are rejected by the real WebSocket boundary', async (t) => {
  let signal
  const app = await launch(
    t,
    abortableClient((value) => {
      signal = value
    }),
  )
  const ws = await app.connect()
  const closed = once(ws, 'close')
  ws.send(Buffer.alloc(33))
  const [code] = await closed
  assert.equal(code, 1009)
  assert.equal(signal.aborted, true)
})

test('startup timeout aborts AWS and closes with a server error', async (t) => {
  let signal
  const app = await launch(
    t,
    abortableClient((value) => {
      signal = value
    }),
    { server: { ...config.server, transcribeTimeoutMs: 20 } },
  )
  const ws = await app.connect()
  const closed = once(ws, 'close')
  const [code] = await closed
  assert.equal(code, 1011)
  assert.equal(signal.aborted, true)
})

test('malformed upgrade URLs are rejected without logging the raw token', async (t) => {
  const { createConnection } = await import('node:net')
  const app = await launch(t, {
    send() {
      throw new Error('must not call AWS')
    },
  })
  const address = app.server.address()
  const socket = createConnection({ host: '127.0.0.1', port: address.port })
  t.after(() => socket.destroy())
  await once(socket, 'connect')
  const ended = once(socket, 'end')
  socket.write(
    [
      'GET //[?token=private-test-token HTTP/1.1',
      'Host: localhost',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ].join('\r\n'),
  )
  // A raw peer does not acknowledge close frames; finish its closing handshake.
  socket.on('data', () => socket.end())
  await ended
  const logs = JSON.stringify(app.logs, (_key, value) => {
    return value instanceof Error
      ? { ...value, message: value.message, stack: value.stack }
      : value
  })
  assert.ok(!logs.includes('private-test-token'), logs)
  assert.ok(logs.includes('Invalid request URL'))
})

test('unexpected generator cleanup failures are logged without rejecting the connection handler', async (t) => {
  const app = await launch(t, {
    async send(command) {
      // Fault injection: the current generator does not reject return() on overflow.
      command.input.AudioStream.return = async () => {
        throw new Error('Synthetic cleanup failure')
      }
      return { TranscriptResultStream: (async function* () {})() }
    },
  })
  const handler = app.wss.listeners('connection')[0]
  app.wss.off('connection', handler)
  // Observe the handler promise explicitly: EventEmitter normally ignores it.
  const completion = new Promise((resolve) => {
    app.wss.once('connection', async (ws, request) => {
      try {
        await handler(ws, request)
        resolve({})
      } catch (error) {
        resolve({ error })
      }
    })
  })
  const ws = await app.connect()
  const closed = once(ws, 'close')
  const result = await completion
  assert.equal(result.error, undefined)
  const [code] = await closed
  assert.equal(code, 1000)
  assert.ok(JSON.stringify(app.logs).includes('Audio stream cleanup failed'))
})
