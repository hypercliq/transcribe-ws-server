/**
 * Buffer audio as soon as a client connects, including during AWS startup.
 * Bound the queue and release pending consumers on close, error or cancellation.
 */
export const createAudioStream = (
  ws,
  clientLogger,
  { signal, maxBufferedBytes = 4 * 1024 * 1024, maxBufferedChunks = 4096 } = {},
) => {
  const messageQueue = []
  let bufferedBytes = 0
  let isClosed = false
  let isEnded = false
  let failure
  let wake

  ws.binaryType = 'arraybuffer'

  const notify = () => {
    wake?.()
    wake = undefined
  }

  const dispose = (error) => {
    if (isClosed) return
    isClosed = true
    failure = error
    messageQueue.length = 0
    bufferedBytes = 0
    ws.off('message', onMessage)
    ws.off('close', onClose)
    ws.off('error', onError)
    signal?.removeEventListener('abort', onAbort)
    notify()
  }

  const onClose = () => dispose()
  const onError = (error) => dispose(error)
  const onAbort = () => dispose()

  const onMessage = (message, isBinary) => {
    if (isClosed || isEnded) return
    if (isBinary ?? message instanceof ArrayBuffer) {
      const chunk = Buffer.from(message)
      if (chunk.length === 0) return
      if (
        bufferedBytes + chunk.length > maxBufferedBytes ||
        messageQueue.length >= maxBufferedChunks
      ) {
        dispose(new Error('Audio buffer limit exceeded'))
        ws.close(1009, 'Audio buffer limit exceeded')
        return
      }
      messageQueue.push(chunk)
      bufferedBytes += chunk.length
    } else if (message.toString() === 'END_OF_STREAM') {
      isEnded = true
    } else {
      clientLogger.warn('Received unknown control message')
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ error: 'Unknown control message' }))
      }
    }
    notify()
  }

  ws.on('message', onMessage)
  ws.on('close', onClose)
  ws.on('error', onError)
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted || ws.readyState !== ws.OPEN) dispose()

  const stream = (async function* () {
    try {
      while (!isClosed) {
        if (messageQueue.length > 0) {
          const chunk = messageQueue.shift()
          bufferedBytes -= chunk.length
          yield { AudioEvent: { AudioChunk: chunk } }
        } else if (isEnded) {
          yield { AudioEvent: { AudioChunk: Buffer.alloc(0) } }
          return
        } else {
          const pending = Promise.withResolvers()
          wake = pending.resolve
          await pending.promise
        }
      }
      if (failure) throw failure
    } finally {
      dispose()
    }
  })()

  return Object.assign(stream, { dispose })
}
