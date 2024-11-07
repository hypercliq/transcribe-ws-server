import {
  LanguageCode,
  MediaEncoding,
  StartStreamTranscriptionCommand,
  TranscribeStreamingClient,
} from '@aws-sdk/client-transcribe-streaming'
import { fromEnv } from '@aws-sdk/credential-providers'
import { AbortController } from '@aws-sdk/abort-controller'
import 'dotenv/config'
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { logger, logWithIP } from './logger.js'
import Joi from 'joi'

/* ==========================
   Configuration and Setup
   ========================== */

// AWS Configuration
const REGION = process.env.AWS_REGION

// Server Configuration
const PORT = process.env.PORT

// API Token for Authorization
const API_TOKEN = process.env.API_TOKEN

// Validate required environment variables
if (!REGION) {
  logger.error('AWS_REGION environment variable is not set')
  throw new Error('Configuration Error')
}

if (!PORT) {
  logger.error('PORT environment variable is not set')
  throw new Error('Configuration Error')
}

if (!API_TOKEN) {
  logger.error('API_TOKEN environment variable is not set')
  throw new Error('Configuration Error')
}

// Define constants
const MAX_CONNECTIONS = 100
const TRANSCRIBE_TIMEOUT_MS = 30_000 // 30 seconds

// Default transcription settings
const DEFAULT_LANGUAGE_CODE = LanguageCode.EN_US
const DEFAULT_MEDIA_ENCODING = MediaEncoding.PCM
const DEFAULT_MEDIA_SAMPLE_RATE_HERTZ = 16_000
const DEFAULT_SEND_PARTIALS = true

// Initialize AWS Transcribe Client
const transcribeClient = new TranscribeStreamingClient({
  region: REGION,
  credentials: fromEnv(),
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
   Helper Functions
   ========================== */

/**
 * Creates an asynchronous generator that yields audio chunks received from the client.
 * @param {WebSocket} ws - The WebSocket connection.
 * @param {Logger} clientLogger - Logger instance for the client.
 */
const createAudioStream = async function* (ws, clientLogger) {
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
  }
}

/**
 * Handles the transcription stream from AWS Transcribe and sends results to the client.
 * @param {AsyncIterable} transcriptStream - The transcription result stream.
 * @param {WebSocket} ws - The WebSocket connection.
 * @param {Logger} clientLogger - Logger instance for the client.
 * @param {boolean} sendPartials - Whether to send partial transcripts.
 */
const handleTranscriptionStream = async (
  transcriptStream,
  ws,
  clientLogger,
  sendPartials,
) => {
  try {
    for await (const event of transcriptStream) {
      await processTranscriptEvent(event, ws, clientLogger, sendPartials)
    }
  } catch (error) {
    handleTranscriptionError(error, ws, clientLogger)
  }
}

/**
 * Processes individual transcription events.
 * @param {Object} event - The transcription event.
 * @param {WebSocket} ws - The WebSocket connection.
 * @param {Logger} clientLogger - Logger instance for the client.
 * @param {boolean} sendPartials - Whether to send partial transcripts.
 */
const processTranscriptEvent = async (
  event,
  ws,
  clientLogger,
  sendPartials,
) => {
  const results = event.TranscriptEvent?.Transcript?.Results

  if (results) {
    for (const result of results) {
      await processTranscriptResult(result, ws, clientLogger, sendPartials)
    }
  } else {
    clientLogger.error('Unexpected event structure.')
  }
}

/**
 * Processes individual transcription results and sends them to the client.
 * @param {Object} result - The transcription result.
 * @param {WebSocket} ws - The WebSocket connection.
 * @param {Logger} clientLogger - Logger instance for the client.
 * @param {boolean} sendPartials - Whether to send partial transcripts.
 */
const processTranscriptResult = async (
  result,
  ws,
  clientLogger,
  sendPartials,
) => {
  const transcript = result.Alternatives[0]?.Transcript

  if (transcript) {
    if (!result.IsPartial) {
      clientLogger.info(`Final transcript: ${transcript}`)
      ws.send(JSON.stringify({ transcript }))
    } else if (sendPartials) {
      clientLogger.debug(`Partial transcript: ${transcript}`)
      ws.send(JSON.stringify({ partialTranscript: transcript }))
    } else {
      clientLogger.debug('Partial transcripts are disabled.')
    }
  } else {
    clientLogger.warn('Received result without transcript.')
  }
}

/**
 * Handles errors that occur during transcription.
 * @param {Error} error - The error that occurred.
 * @param {WebSocket} ws - The WebSocket connection.
 * @param {Logger} clientLogger - Logger instance for the client.
 */
const handleTranscriptionError = (error, ws, clientLogger) => {
  clientLogger.error(`Error in transcription stream: ${error.message}`, {
    stack: error.stack,
  })
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ error: 'Error in transcription stream' }))
    ws.close(1011, 'Internal server error')
  }
}

/**
 * Validates query parameters from the client's connection URL.
 * @param {URL} url - The URL object from the client's request.
 * @param {Logger} clientLogger - Logger instance for the client.
 * @returns {Object} - An object containing isValid and value properties.
 */
const validateQueryParameters = (url, clientLogger) => {
  const queryParameters = Object.fromEntries(url.searchParams.entries())
  const { error, value } = querySchema.validate(queryParameters)

  if (error) {
    clientLogger.warn(`Invalid query parameters: ${error.message}`)
    return { isValid: false, value: undefined }
  }

  clientLogger.info('Authorization successful')
  return { isValid: true, value }
}

// Define the schema for query parameter validation
const querySchema = Joi.object({
  token: Joi.string().required().valid(API_TOKEN),
  language: Joi.string()
    .valid(...Object.values(LanguageCode))
    .default(DEFAULT_LANGUAGE_CODE),
  encoding: Joi.string()
    .valid(...Object.values(MediaEncoding))
    .default(DEFAULT_MEDIA_ENCODING),
  sampleRate: Joi.number()
    .integer()
    .min(8000)
    .max(48_000)
    .default(DEFAULT_MEDIA_SAMPLE_RATE_HERTZ),
  sendPartials: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(DEFAULT_SEND_PARTIALS),
})

/* ==========================
   WebSocket Server Event Handlers
   ========================== */

wss.on('connection', async (ws, request) => {
  if (connectionCount >= MAX_CONNECTIONS) {
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
      ws.close(1008, 'Invalid query parameters')
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
          ws.close(1000, 'AWS Transcribe request timed out')
        }
      }
    }, TRANSCRIBE_TIMEOUT_MS)

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
        ws.close(1011, 'Internal server error')
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
  logger.info(
    `Memory Usage: RSS=${memoryUsage.rss}, HeapTotal=${memoryUsage.heapTotal}, HeapUsed=${memoryUsage.heapUsed}, External=${memoryUsage.external}`,
  )
}, 60_000) // Every 60 seconds

// Start the server
server.listen(PORT, () => {
  logger.info(`WebSocket Server is running on port ${PORT}`)
})
