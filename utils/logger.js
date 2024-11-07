import pino from 'pino'
import config from '../config/index.js'

// Define transport targets
const targets = [
  {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
    level: config.logging.level,
  },
]

// Add file transport for production
if (config.environment === 'production') {
  targets.push({
    target: 'pino/file',
    options: {
      destination: 'logs/combined.log',
      mkdir: true, // Ensure directories are created if they do not exist
    },
    level: config.logging.level,
  })
}

// Create pino transports
const transportOptions = {
  targets,
}

// Initialize the logger
const logger = pino(
  {
    level: config.logging.level,
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
