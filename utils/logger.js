import pino from 'pino'
import config from '../config/index.js'

const isDevelopment = config.environment === 'development'
const targets = [
  {
    target: isDevelopment ? 'pino-pretty' : 'pino/file',
    options: isDevelopment
      ? {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        }
      : { destination: config.logging.file, mkdir: true },
    level: config.logging.level,
  },
]

// Create transport options with the defined targets
const transportOptions = {
  targets,
}

// Initialize the logger with transport options
const logger = pino(
  {
    level: config.logging.level,
    redact: ['token', 'apiTokens', 'req.headers.authorization'],
  },
  pino.transport(transportOptions),
)

/**
 * Creates a child logger with additional context (e.g., clientIP).
 * @param {string} IP - Client's IP address.
 * @returns {object} - Logger instance with added context.
 */
export const logWithIP = (IP) => logger.child({ IP })

export default logger
