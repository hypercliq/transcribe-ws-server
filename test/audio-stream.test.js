import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { createAudioStream } from '../utils/audio-stream.js'

const logger = { debug() {}, warn() {}, error() {} }
// ws uses EventEmitter; the test double must match that interface.
const socket = () =>
  // eslint-disable-next-line unicorn/prefer-event-target
  Object.assign(new EventEmitter(), {
    readyState: 1,
    OPEN: 1,
    send() {},
    close(code) {
      this.closeCode = code
    },
  })

const completes = async (promise) => {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('stream did not finish')),
          100,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

test('disconnect wakes a waiting audio stream and removes its listeners', async () => {
  const ws = socket()
  const stream = createAudioStream(ws, logger)
  const pending = stream.next()
  ws.emit('close')
  const result = await completes(pending)
  assert.equal(result.done, true)
  assert.equal(ws.listenerCount('message'), 0)
  assert.equal(ws.listenerCount('close'), 0)
})

test('audio arriving before consumption is retained and drained before END_OF_STREAM', async () => {
  const ws = socket()
  const stream = createAudioStream(ws, logger)
  ws.emit('message', new Uint8Array([1, 2]).buffer, true)
  ws.emit('message', Buffer.from('END_OF_STREAM'), false)
  ws.emit('message', new Uint8Array([99]).buffer, true)
  const first = await completes(stream.next())
  const end = await stream.next()
  const final = await stream.next()
  assert.deepEqual(first.value.AudioEvent.AudioChunk, Buffer.from([1, 2]))
  assert.equal(end.value.AudioEvent.AudioChunk.length, 0)
  assert.equal(final.done, true)
  assert.equal(ws.listenerCount('message'), 0)
})

test('queue overflow closes the socket and rejects the stream without retaining audio', async () => {
  const ws = socket()
  const stream = createAudioStream(ws, logger, { maxBufferedBytes: 3 })
  const pending = stream.next()
  ws.emit('message', new Uint8Array([1, 2]).buffer, true)
  ws.emit('message', new Uint8Array([3, 4]).buffer, true)
  await assert.rejects(completes(pending), /buffer limit/)
  assert.equal(ws.closeCode, 1009)
  assert.equal(ws.listenerCount('message'), 0)
})

test('abort releases a waiting consumer even when the socket does not close', async () => {
  const ws = socket()
  const controller = new AbortController()
  const stream = createAudioStream(ws, logger, { signal: controller.signal })
  const pending = stream.next()
  controller.abort()
  const result = await completes(pending)
  assert.equal(result.done, true)
  assert.equal(ws.listenerCount('message'), 0)
})

test('empty binary frames do not accumulate in the audio queue', async () => {
  const ws = socket()
  const stream = createAudioStream(ws, logger)
  ws.emit('message', new ArrayBuffer(0), true)
  ws.emit('message', new Uint8Array([7]).buffer, true)
  ws.emit('message', Buffer.from('END_OF_STREAM'), false)
  const first = await stream.next()
  assert.deepEqual(first.value.AudioEvent.AudioChunk, Buffer.from([7]))
  await stream.return()
})

test('tiny frames also obey the queue entry limit', async () => {
  const ws = socket()
  const stream = createAudioStream(ws, logger, { maxBufferedChunks: 2 })
  for (let index = 0; index < 3; index++) {
    ws.emit('message', new Uint8Array([1]).buffer, true)
  }
  await assert.rejects(stream.next(), /buffer limit/)
  assert.equal(ws.closeCode, 1009)
  assert.equal(ws.listenerCount('message'), 0)
})
