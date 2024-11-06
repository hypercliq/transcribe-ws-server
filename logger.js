import { createLogger, format, transports } from 'winston';

// Determine the log level
const LOG_LEVEL =
  process.env.LOG_LEVEL ||
  (process.env.NODE_ENV === 'development' ? 'debug' : 'info');

// Format for console output (simple text)
const consoleFormat = format.combine(
  format.colorize(),
  format.printf(({ level, message, clientIP }) => {
    const ipInfo = clientIP ? `[${clientIP}] ` : '';
    return `${level}: ${ipInfo}${message}`;
  })
);

// Format for file output (JSON)
const fileFormat = format.combine(format.timestamp(), format.json());

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
});

// Function to create a child logger with client IP
const logWithIP = (clientIP) => logger.child({ clientIP });

export { logger, logWithIP };
