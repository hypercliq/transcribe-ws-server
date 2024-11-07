// utils/audioStream.js

/**
 * Creates an asynchronous generator that yields audio chunks received from the client.
 * @param {WebSocket} ws - The WebSocket connection.
 * @param {Logger} clientLogger - Logger instance for the client.
 * @returns {AsyncGenerator} - Yields audio chunks.
 */
export const createAudioStream = async function* (ws, clientLogger) {
  const messageQueue = []
  let isClosed = false
  let resolvePromise
  let isResolving = false

  const waitForMessage = () => {
    if (isResolving) return
    isResolving = true
    return new Promise((resolve) => {
      resolvePromise = resolve
    })
  }

  const messageHandler = (message) => {
    try {
      if (Buffer.isBuffer(message)) {
        clientLogger.debug(
          `Received audio chunk of size: ${message.byteLength} bytes`,
        )
        messageQueue.push(message)
        if (resolvePromise) {
          resolvePromise()
          resolvePromise = undefined
        }
      } else {
        clientLogger.warn('Received non-buffer message; ignoring.')
      }
    } catch (error) {
      clientLogger.error(`Error processing message: ${error.message}`, {
        stack: error.stack,
      })
    }
  }

  const closeHandler = () => {
    isClosed = true
    if (resolvePromise) {
      resolvePromise()
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

      if (isClosed) {
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
