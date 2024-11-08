// config/index.js
import dotenv from 'dotenv'
import Joi from 'joi'

// Load environment variables from .env file
dotenv.config()

// Define the schema for environment variables with transformation
const environmentSchema = Joi.object({
  AWS_REGION: Joi.string().required(),
  PORT: Joi.number().integer().min(1).required(),
  API_TOKENS: Joi.string()
    .required()
    .custom((value, helpers) => {
      try {
        const tokens = JSON.parse(value)
        if (!Array.isArray(tokens)) {
          throw new TypeError('API_TOKENS must be a JSON array.')
        }
        // Validate each token is a non-empty string
        const invalidTokens = tokens.filter(
          (token) => typeof token !== 'string' || token.trim() === '',
        )
        if (invalidTokens.length > 0) {
          throw new Error('All API tokens must be non-empty strings.')
        }
        return tokens // Return the parsed array
      } catch {
        return helpers.error('any.invalid')
      }
    }, 'API Tokens Parsing'),
  LOG_LEVEL: Joi.string()
    .valid('debug', 'info', 'warn', 'error')
    .default('info'),
  LOG_FILE: Joi.string().default('logs/combined.log'),
  NODE_ENV: Joi.string()
    .valid('development', 'production')
    .default('development'),
  AWS_ACCESS_KEY_ID: Joi.string().optional(),
  AWS_SECRET_ACCESS_KEY: Joi.string().optional(),
}).unknown(true) // Allow additional variables

// Validate the environment variables
const { error, value: environmentVariables } = environmentSchema.validate(
  process.env,
  { abortEarly: false }, // Optional: Gather all errors
)

if (error) {
  throw new Error(`Config validation error: ${error.message}`)
}

export default {
  aws: {
    region: environmentVariables.AWS_REGION,
  },
  server: {
    port: environmentVariables.PORT,
    maxConnections: 100,
    transcribeTimeoutMs: 30_000, // 30 seconds
  },
  auth: {
    apiTokens: environmentVariables.API_TOKENS, // Already parsed as an array
  },
  logging: {
    level: environmentVariables.LOG_LEVEL,
    file: environmentVariables.LOG_FILE,
  },
  environment: environmentVariables.NODE_ENV,
}
