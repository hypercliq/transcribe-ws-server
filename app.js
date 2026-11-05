import http from 'node:http'
import { randomUUID } from 'node:crypto'
import WebSocket, { WebSocketServer } from 'ws'
import { StartStreamTranscriptionCommand } from '@aws-sdk/client-transcribe-streaming'
import { validateQueryParameters } from './utils/validate-query.js'
import { handleTranscriptionStream } from './handlers/transcription-handler.js'
import { createAudioStream } from './utils/audio-stream.js'

export const createTranscriptionServer = ({
  transcribeClient,
  config,
  logger,
}) => {
  let stopping = false
  let shutdownPromise
  const sessions = new Map()
  const server = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(stopping ? 503 : 200, {
        'Content-Type': 'application/json',
      })
      response.end(JSON.stringify({ status: stopping ? 'stopping' : 'ok' }))
    } else {
      response.writeHead(404)
      response.end()
    }
  })
  const wss = new WebSocketServer({
    server,
    maxPayload: config.server.maxAudioMessageBytes,
  })

  wss.on('connection', async (ws, request) => {
    const clientLogger = logger.child({
      sessionId: randomUUID(),
      IP: request.socket.remoteAddress,
      forwardedFor: request.headers['x-forwarded-for'],
    })
    // Keep an error listener even on sockets rejected before session setup.
    ws.on('error', (error) =>
      clientLogger.error({ err: error }, 'WebSocket error'),
    )
    if (stopping || sessions.size >= config.server.maxConnections) {
      ws.close(1013, 'Server is busy')
      return
    }

    const abortController = new AbortController()
    sessions.set(ws, abortController)
    ws.once('close', (code) => {
      sessions.delete(ws)
      abortController.abort()
      clientLogger.info({ code }, 'Client disconnected')
    })
    ws.on('error', () => abortController.abort())
    clientLogger.info('New connection')

    let audioStream
    let timeout
    try {
      // The authority is irrelevant to query parsing; do not trust or log Host/URL.
      let url
      try {
        url = new URL(request.url, 'http://localhost')
      } catch {
        clientLogger.warn('Invalid request URL')
        ws.close(1008, 'Invalid request URL')
        return
      }
      const { isValid, value } = validateQueryParameters(url, clientLogger)
      if (!isValid) {
        ws.close(1008, 'Invalid query parameters')
        return
      }

      audioStream = createAudioStream(ws, clientLogger, {
        signal: abortController.signal,
        maxBufferedBytes: config.server.maxBufferedAudioBytes,
      })
      const command = new StartStreamTranscriptionCommand({
        LanguageCode: value.language,
        MediaEncoding: value.encoding,
        MediaSampleRateHertz: value.sampleRate,
        AudioStream: audioStream,
      })
      timeout = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ error: 'AWS Transcribe request timed out' }))
          ws.close(1011, 'AWS Transcribe request timed out')
        }
        abortController.abort()
      }, config.server.transcribeTimeoutMs)

      const response = await transcribeClient.send(command, {
        abortSignal: abortController.signal,
      })
      clearTimeout(timeout)
      clientLogger.info('Transcription started successfully')
      await handleTranscriptionStream(
        response.TranscriptResultStream,
        ws,
        clientLogger,
        value.sendPartials,
        config.logging.transcripts,
      )
    } catch (error) {
      if (!abortController.signal.aborted) {
        clientLogger.error({ err: error }, 'Error during transcription')
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ error: 'Error during transcription' }))
        ws.close(1011, 'Internal server error')
      }
    } finally {
      clearTimeout(timeout)
      abortController.abort()
      audioStream?.dispose()
      await audioStream?.return()
    }
  })

  const shutdown = ({ graceMs = 5000 } = {}) => {
    if (shutdownPromise) return shutdownPromise
    stopping = true
    logger.info('Shutting down server')
    shutdownPromise = new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        for (const client of wss.clients) client.terminate()
        server.closeAllConnections()
      }, graceMs)
      const httpClosed = new Promise((done, fail) => {
        server.close((error) => {
          if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') fail(error)
          else done()
        })
      })
      const socketsClosed = new Promise((done) => wss.close(done))
      for (const client of wss.clients) {
        sessions.get(client)?.abort()
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ error: 'Server is shutting down' }))
          client.close(1001, 'Server is shutting down')
        }
      }
      Promise.all([httpClosed, socketsClosed])
        .then(resolve, reject)
        .finally(() => clearTimeout(deadline))
    })
    return shutdownPromise
  }

  return { server, wss, shutdown }
}
