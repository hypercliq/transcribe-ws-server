/**
 * Creates an asynchronous generator that yields audio chunks received from the client.
 * Ends the generator when an end-of-stream message is received.
 * @param {WebSocket} ws - The WebSocket connection.
 * @param {Logger} clientLogger - Logger instance for the client.
 * @returns {AsyncGenerator} - Yields audio chunks.
 */
export const createAudioStream = async function* (ws, clientLogger) {
  const messageQueue = []
  let isClosed = false
  let resolvePromise
  let isResolving = false
  let endStreamReceived = false

  ws.binaryType = 'arraybuffer'

  const waitForMessage = () => {
    if (isResolving) return
    isResolving = true
    return new Promise((resolve) => {
      resolvePromise = resolve
    })
  }

  const messageHandler = (message) => {
    try {
      if (message instanceof ArrayBuffer) {
        clientLogger.debug(
          `Received audio chunk of size: ${message.byteLength} bytes`,
        )
        messageQueue.push(Buffer.from(message))
        if (resolvePromise) {
          resolvePromise()
          resolvePromise = undefined
        }
      } else {
        clientLogger.debug('Received end-of-stream message from client.')
        endStreamReceived = true
        if (resolvePromise) {
          resolvePromise()
          resolvePromise = undefined
        }
      }
    } catch (error) {
      clientLogger.error(`Error processing message: ${error.message}`, {
        stack: error.stack,
      })
    }
  }

  const closeHandler = () => {
    isClosed = true
    clientLogger.debug('WebSocket connection closed.')
    if (resolvePromise) {
      resolvePromise = undefined
    }
  }

  ws.on('message', messageHandler)
  ws.on('close', closeHandler)

  try {
    while (true) {
      while (messageQueue.length > 0) {
        const chunk = messageQueue.shift()
        yield { AudioEvent: { AudioChunk: chunk } }
      }

      if (endStreamReceived) {
        clientLogger.debug('End of audio stream detected.')
        yield { AudioEvent: { AudioChunk: Buffer.alloc(0) } } // send empty buffer to signal end of stream
        break // Exit the generator
      }

      if (isClosed) {
        clientLogger.warn(
          'WebSocket connection closed before end-of-stream message.',
        )
        break
      }

      await waitForMessage()
      isResolving = false
    }
  } catch (error) {
    clientLogger.error(`Error in audio stream: ${error.message}`, {
      stack: error.stack,
    })
  } finally {
    // Clean up event listeners
    ws.off('message', messageHandler)
    ws.off('close', closeHandler)
    clientLogger.debug('Audio stream closed and cleaned up')
  }
}
