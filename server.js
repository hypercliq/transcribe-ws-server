import http from 'node:http'
import { WebSocketServer } from 'ws'
import config from './config/index.js'
import logger, { logWithIP } from './utils/logger.js'
import { validateQueryParameters } from './utils/validate-query.js'
import { handleTranscriptionStream } from './handlers/transcription-handler.js'
import { createAudioStream } from './utils/audio-stream.js'
import {
  StartStreamTranscriptionCommand,
  TranscribeStreamingClient,
} from '@aws-sdk/client-transcribe-streaming'
import { fromEnv } from '@aws-sdk/credential-providers'
import { AbortController } from 'abort-controller'

// Initialize AWS Transcribe Client
const transcribeClient = new TranscribeStreamingClient({
  region: config.aws.region,
  credentials: fromEnv(), // Use environment variables for credentials
})

// Create an HTTP server with a health check endpoint
const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ status: 'ok' }))
  } else {
    response.writeHead(404)
    response.end()
  }
})

// Initialize WebSocket Server
const wss = new WebSocketServer({ server })

// Connection counter
let connectionCount = 0

/* ==========================
   WebSocket Server Event Handlers
   ========================== */

wss.on('connection', async (ws, request) => {
  if (connectionCount >= config.server.maxConnections) {
    logger.warn(
      'Maximum number of connections reached. Rejecting new connection.',
    )
    ws.close(1013, 'Server is busy') // 1013: Try again later
    return
  }

  connectionCount++
  const ip = request.socket.remoteAddress
  const clientLogger = logWithIP(ip)
  clientLogger.info('New connection')

  // Initialize AbortController for request cancellation
  const abortController = new AbortController()

  // Handle WebSocket close event
  ws.on('close', (code, reason) => {
    connectionCount--
    clientLogger.info(`Client disconnected (code: ${code}, reason: ${reason})`)
    if (!abortController.signal.aborted) {
      abortController.abort() // Abort the AWS Transcribe request
    }
  })

  // Handle WebSocket error event
  ws.on('error', (error) => {
    clientLogger.error(`WebSocket error: ${error.message}`, {
      stack: error.stack,
    })
    if (!abortController.signal.aborted) {
      abortController.abort() // Abort the AWS Transcribe request
    }
  })

  try {
    const url = new URL(request.url, `http://${request.headers.host}`)
    clientLogger.debug(`Parsed URL: ${url.href}`)

    const { isValid, value } = validateQueryParameters(url, clientLogger)

    if (!isValid) {
      ws.close(1008, 'Invalid query parameters') // 1008: Policy violation
      return
    }

    // Build parameters for AWS Transcribe
    const parameters = {
      LanguageCode: value.language,
      MediaEncoding: value.encoding,
      MediaSampleRateHertz: value.sampleRate,
      AudioStream: createAudioStream(ws, clientLogger),
    }

    const command = new StartStreamTranscriptionCommand(parameters)

    // Set a timeout for the AWS Transcribe request
    const timeout = setTimeout(() => {
      if (!abortController.signal.aborted) {
        abortController.abort()
        clientLogger.error('AWS Transcribe request timed out')
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ error: 'AWS Transcribe request timed out' }))
          ws.close(1000, 'AWS Transcribe request timed out') // 1000: Normal closure
        }
      }
    }, config.server.transcribeTimeoutMs)

    try {
      // Send the transcription command with abort signal
      const response = await transcribeClient.send(command, {
        abortSignal: abortController.signal,
      })

      clearTimeout(timeout) // Clear timeout upon success
      clientLogger.info('Transcription started successfully')

      await handleTranscriptionStream(
        response.TranscriptResultStream,
        ws,
        clientLogger,
        value.sendPartials,
      )
    } catch (error) {
      clientLogger.error(`Error during transcription: ${error.message}`, {
        stack: error.stack,
      })
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ error: 'Error during transcription' }))
        ws.close(1011, 'Internal server error') // 1011: Internal server error
      }
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    clientLogger.error(`Error during connection setup: ${error.message}`, {
      stack: error.stack,
    })
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ error: 'Error during connection setup' }))
      ws.close(1011, 'Internal server error')
    }
  }
})

/* ==========================
   Graceful Shutdown
   ========================== */

// Handles server shutdown gracefully
const gracefulShutdown = () => {
  logger.info('Shutting down server...')
  wss.close(() => {
    logger.info('WebSocket Server closed')
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(0)
  })

  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forcing server shutdown')
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(1)
  }, 10_000)
}

// Global error handlers
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled Rejection: ${reason}`, { stack: reason.stack })
  process.exit(1)
})

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error.message}`, { stack: error.stack })
  process.exit(1)
})

process.on('SIGTERM', gracefulShutdown)
process.on('SIGINT', gracefulShutdown)

// Log memory usage at regular intervals
setInterval(() => {
  const memoryUsage = process.memoryUsage()
  // if memory is over 100MB, log it
  if (memoryUsage.rss > 100_000_000)
    logger.warn(
      `Memory Usage: RSS=${memoryUsage.rss}, HeapTotal=${memoryUsage.heapTotal}, HeapUsed=${memoryUsage.heapUsed}, External=${memoryUsage.external}`,
    )
}, 60_000) // Every 60 seconds

// Start the server
server.listen(config.server.port, () => {
  logger.info(`WebSocket Server is running on port ${config.server.port}`)
})
