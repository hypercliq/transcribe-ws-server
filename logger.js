import { createLogger, format, transports } from 'winston'

// Determine the log level
const LOG_LEVEL =
  process.env.LOG_LEVEL ||
  (process.env.NODE_ENV === 'development' ? 'debug' : 'info')

// Format for console output (simple text)
const consoleFormat = format.combine(
  format.colorize(),
  format.errors({ stack: true }),
  format.printf(({ level, message, clientIP, stack }) => {
    const ipInfo = clientIP ? `[${clientIP}] ` : ''
    const stackInfo = stack ? `\nStack: ${stack}` : ''
    return `${level}: ${ipInfo}${message}${stackInfo}`
  }),
)

// Format for file output (JSON)
const fileFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.json(),
)

const logger = createLogger({
  level: LOG_LEVEL,
  transports: [
    new transports.Console({
      format: consoleFormat,
    }),
    new transports.File({
      filename: 'combined.log',
      format: fileFormat,
    }),
  ],
})

// Function to create a child logger with client IP
const logWithIP = (clientIP) => logger.child({ clientIP })

export { logger, logWithIP }
