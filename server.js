import {
  LanguageCode,
  MediaEncoding,
  StartStreamTranscriptionCommand,
  TranscribeStreamingClient,
} from '@aws-sdk/client-transcribe-streaming'
import { fromEnv } from '@aws-sdk/credential-providers'
import { AbortController } from '@aws-sdk/abort-controller' // Import AbortController
import 'dotenv/config'
import fs from 'node:fs'
import https from 'node:https'
import { WebSocketServer } from 'ws'
import { logger, logWithIP } from './logger.js'
import Joi from 'joi' // Import Joi

/* ==========================
   Configuration and Setup
   ========================== */

// AWS Configuration
const REGION = process.env.AWS_REGION

// Server Configuration
const PORT = process.env.PORT

// Authentication Token
const AUTH_TOKEN = process.env.AUTH_TOKEN

// Configuration validation at startup
if (!REGION) {
  logger.error('AWS_REGION environment variable is not set')
  process.exit(1)
}

if (!PORT) {
  logger.error('PORT environment variable is not set')
  process.exit(1)
}

if (!AUTH_TOKEN) {
  logger.error('AUTH_TOKEN environment variable is not set')
  process.exit(1)
}

// Define default transcription settings
const DEFAULT_LANGUAGE_CODE = LanguageCode.EN_US
const DEFAULT_MEDIA_ENCODING = MediaEncoding.PCM
const DEFAULT_MEDIA_SAMPLE_RATE_HERTZ = 16_000
const DEFAULT_SHOW_SPEAKER_LABEL = false

// Initialize AWS Transcribe Client
const transcribeClient = new TranscribeStreamingClient({
  region: REGION,
  credentials: fromEnv(),
})

const options = {
  key: fs.readFileSync('server.key'),
  cert: fs.readFileSync('server.cert'),
}

// Create an HTTPS server
const server = https.createServer(options, (request, response) => {
  response.writeHead(200)
  response.end('WebSocket Server is running')
})

// Initialize WebSocket Server
const wss = new WebSocketServer({ server })

logger.info(`WebSocket Server is listening on port ${PORT}`)

/* ==========================
   Helper Functions
   ========================== */

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

  ws.on('message', (message) => {
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
  })

  ws.on('close', () => {
    isClosed = true
    if (resolvePromise) {
      resolvePromise()
      resolvePromise = undefined
    }
  })

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
}

const handleTranscriptionStream = async (
  transcriptStream,
  ws,
  clientLogger,
) => {
  try {
    for await (const event of transcriptStream) {
      const results = event.TranscriptEvent?.Transcript?.Results

      if (results) {
        for (const result of results) {
          const transcript = result.Alternatives[0]?.Transcript

          if (transcript) {
            if (result.IsPartial) {
              clientLogger.debug(`Partial transcript: ${transcript}`)
              ws.send(JSON.stringify({ partialTranscript: transcript }))
            } else {
              clientLogger.info(`Final transcript: ${transcript}`)
              ws.send(JSON.stringify({ transcript }))
            }
          } else {
            clientLogger.warn('Received result without transcript.')
          }
        }
      } else {
        clientLogger.error('Unexpected event structure.')
      }
    }
  } catch (error) {
    clientLogger.error(`Error in transcription stream: ${error.message}`)
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ error: 'Error in transcription stream' }))
      ws.close(1011, 'Internal server error')
    }
  }
}

// Define the schema
const querySchema = Joi.object({
  token: Joi.string().required().valid(AUTH_TOKEN),
  language: Joi.string()
    .valid(...Object.values(LanguageCode))
    .default(DEFAULT_LANGUAGE_CODE),
  encoding: Joi.string()
    .valid(...Object.values(MediaEncoding))
    .default(DEFAULT_MEDIA_ENCODING),
  sampleRate: Joi.number()
    .integer()
    .min(8000)
    .max(48000)
    .default(DEFAULT_MEDIA_SAMPLE_RATE_HERTZ),
  speakerLabel: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(DEFAULT_SHOW_SPEAKER_LABEL),
})

const verifyQueryParameters = (url, ws, clientLogger) => {
  const queryParams = Object.fromEntries(url.searchParams.entries())

  const { error, value } = querySchema.validate(queryParams)

  if (error) {
    clientLogger.warn(`Invalid query parameters: ${error.message}`)
    ws.close(1008, 'Invalid query parameters')
    return null
  }

  clientLogger.info('Authentication successful')

  // Build parameters from validated values
  const parameters = {
    LanguageCode: value.language,
    MediaEncoding: value.encoding,
    MediaSampleRateHertz: value.sampleRate,
  }

  if (value.speakerLabel) {
    parameters.ShowSpeakerLabel = true
  }

  return parameters
}

/* ==========================
   WebSocket Server Event Handlers
   ========================== */

wss.on('connection', async (ws, request) => {
  const ip = request.socket.remoteAddress
  const clientLogger = logWithIP(ip)
  clientLogger.info('New connection')

  // Initialize AbortController
  let abortController = new AbortController()

  // Set up WebSocket event handlers immediately
  ws.on('close', (code, reason) => {
    clientLogger.info(`Client disconnected (code: ${code}, reason: ${reason})`)
    if (abortController) {
      abortController.abort() // Abort the AWS Transcribe request
    }
  })

  ws.on('error', (error) => {
    clientLogger.error(`WebSocket error: ${error.message}`)
    if (abortController) {
      abortController.abort() // Abort the AWS Transcribe request
    }
  })

  const url = new URL(request.url, `https://${request.headers.host}`)
  clientLogger.debug(`Parsed URL: ${url.href}`)

  const parameters = verifyQueryParameters(url, ws, clientLogger)

  if (!parameters) {
    clientLogger.warn('Connection terminated due to invalid parameters')
    return
  }

  try {
    parameters.AudioStream = createAudioStream(ws, clientLogger)

    const command = new StartStreamTranscriptionCommand(parameters)

    // Send the command with the abort signal
    const response = await transcribeClient.send(command, {
      abortSignal: abortController.signal,
    })

    clientLogger.info('Transcription started successfully')

    handleTranscriptionStream(response.TranscriptResultStream, ws, clientLogger)
  } catch (error) {
    clientLogger.error(`Error starting transcription: ${error.message}`)
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ error: 'Error starting transcription' }))
      ws.close(1011, 'Internal server error')
    }
  }
})

/* ==========================
   Graceful Shutdown
   ========================== */

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
  logger.error(`Unhandled Rejection: ${reason}`)
  process.exit(1)
})

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error.message}`)
  process.exit(1)
})

process.on('SIGTERM', gracefulShutdown)
process.on('SIGINT', gracefulShutdown)

server.listen(PORT, () => {
  logger.info(`WebSocket Server is running on port ${PORT}`)
})
