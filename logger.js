import pino from 'pino'

// Determine the current environment (default to 'development')
const environment = process.env.NODE_ENV || 'development'

// Determine the log level, allowing override via LOG_LEVEL env var
const LOG_LEVEL =
  process.env.LOG_LEVEL || (environment === 'development' ? 'debug' : 'info')

// Define transport targets
const targets = [
  {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
]

// Add file transport for production
if (environment === 'production') {
  targets.push({
    target: 'pino/file',
    options: {
      destination: 'combined.log',
      mkdir: true, // Ensure directories are created if they do not exist
    },
  })
}

// Create pino transports
const transports = pino.transport({
  targets,
})

// Initialize the logger
export const logger = pino({ level: LOG_LEVEL }, transports)

// Function to create a child logger with additional context (e.g., clientIP)
export const logWithIP = (IP) => logger.child({ IP })
