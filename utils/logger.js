import pino from 'pino'
import config from '../config/index.js'

// Define transport targets conditionally
const targets = [
  // Transport for development (pretty-printed logs)
  ...(config.environment === 'development'
    ? [
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
    : [
        {
          target: 'pino/file',
          options: {
            destination: config.logging.file,
            mkdir: true, // Ensure directories are created if they do not exist
          },
          level: config.logging.level,
        },
      ]),
]

// Create transport options with the defined targets
const transportOptions = {
  targets,
}

// Initialize the logger with transport options
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
