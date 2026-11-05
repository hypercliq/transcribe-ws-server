import { TranscribeStreamingClient } from '@aws-sdk/client-transcribe-streaming'
import { fromEnv } from '@aws-sdk/credential-providers'
import config from './config/index.js'
import logger from './utils/logger.js'
import { createTranscriptionServer } from './app.js'

const transcribeClient = new TranscribeStreamingClient({
  region: config.aws.region,
  credentials: fromEnv(),
})
const { server, shutdown } = createTranscriptionServer({
  transcribeClient,
  config,
  logger,
})

const memoryTimer = setInterval(() => {
  const memory = process.memoryUsage()
  if (memory.rss > 100_000_000)
    logger.warn(memory, 'Memory usage exceeds 100 MB')
}, 60_000)
memoryTimer.unref()

const gracefulShutdown = () => {
  clearInterval(memoryTimer)
  shutdown()
    .then(() => {
      transcribeClient.destroy()
      logger.info('Server closed')
    })
    .catch((error) => {
      logger.fatal({ err: error }, 'Shutdown failed')
      process.exitCode = 1
    })
}

process.once('SIGTERM', gracefulShutdown)
process.once('SIGINT', gracefulShutdown)

server.listen(config.server.port, () => {
  logger.info(`WebSocket Server is running on port ${config.server.port}`)
})
