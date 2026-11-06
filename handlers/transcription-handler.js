// handlers/transcriptionHandler.js
/**
 * Handles the transcription stream from AWS Transcribe and sends results to the client.
 * @param {AsyncIterable} transcriptStream - The transcription result stream.
 * @param {WebSocket} ws - The WebSocket connection.
 * @param {Logger} clientLogger - Logger instance for the client.
 * @param {boolean} shouldSendPartials - Whether to send partial transcripts.
 */
export const handleTranscriptionStream = async (
  transcriptStream,
  ws,
  clientLogger,
  shouldSendPartials,
  shouldLogTranscripts = false,
) => {
  try {
    for await (const event of transcriptStream) {
      await processTranscriptEvent(
        event,
        ws,
        clientLogger,
        shouldSendPartials,
        shouldLogTranscripts,
      )
    }

    if (ws.readyState === ws.OPEN) {
      clientLogger.info(
        'Transcription stream ended. Closing WebSocket connection with client.',
      )
      ws.close(1000, 'Transcription stream ended') // 1000: Normal closure
    }
  } catch (error) {
    handleTranscriptionError(error, ws, clientLogger)
  }
}

/**
 * Processes individual transcription events and sends them to the client.
 * @param {Object} event - The transcription event.
 * @param {WebSocket} ws - The WebSocket connection.
 * @param {object} clientLogger - Logger instance for the client.
 * @param {boolean} shouldSendPartials - Whether to send partial transcripts.
 */
const processTranscriptEvent = async (
  event,
  ws,
  clientLogger,
  shouldSendPartials,
  shouldLogTranscripts = false,
) => {
  const results = event.TranscriptEvent?.Transcript?.Results

  if (results) {
    for (const result of results) {
      if (ws.readyState !== ws.OPEN) return
      const transcript = result.Alternatives?.[0]?.Transcript

      if (transcript) {
        if (!result.IsPartial) {
          if (shouldLogTranscripts)
            clientLogger.info({ transcript }, 'Final transcript')
          ws.send(JSON.stringify({ transcript }))
        } else if (shouldSendPartials) {
          if (shouldLogTranscripts)
            clientLogger.debug(
              { partialTranscript: transcript },
              'Partial transcript',
            )
          ws.send(JSON.stringify({ partialTranscript: transcript }))
        } else {
          clientLogger.debug('Partial transcripts are disabled.')
        }
      } else {
        clientLogger.warn('Received result without transcript.')
      }
    }
  } else {
    clientLogger.error('Unexpected event structure.')
  }
}

/**
 * Handles errors that occur during transcription.
 * @param {Error} error - The error that occurred.
 * @param {WebSocket} ws - The WebSocket connection.
 * @param {object} clientLogger - Logger instance for the client.
 */
export const handleTranscriptionError = (error, ws, clientLogger) => {
  clientLogger.error({ err: error }, 'Error in transcription stream')
  if (ws.readyState !== ws.OPEN) {
    return
  }

  ws.send(JSON.stringify({ error: 'Error in transcription stream' }))
  ws.close(1011, 'Internal server error') // 1011: Internal Error
}
