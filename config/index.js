// config/index.js
import { loadEnvFile } from 'node:process'
import Joi from 'joi'

// An optional .env supplements existing environment variables.
try {
  loadEnvFile()
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

// Define the schema for environment variables with transformation
const environmentSchema = Joi.object({
  AWS_REGION: Joi.string().required(),
  PORT: Joi.number().integer().min(1).required(),
  API_TOKENS: Joi.string()
    .required()
    .custom((value, helpers) => {
      let tokens
      try {
        tokens = JSON.parse(value)
      } catch {
        // JSON parser messages can contain token material; use a fixed message.
        return helpers.error('tokens.json')
      }
      if (!Array.isArray(tokens) || tokens.length === 0) {
        return helpers.error('tokens.array')
      }
      if (
        tokens.some((token) => typeof token !== 'string' || token.trim() === '')
      ) {
        return helpers.error('tokens.entries')
      }
      return tokens
    }, 'API Tokens Parsing')
    .messages({
      'tokens.json': '{{#label}} must be valid JSON',
      'tokens.array': '{{#label}} must be a non-empty JSON array',
      'tokens.entries': '{{#label}} entries must be non-empty strings',
    }),
  LOG_LEVEL: Joi.string()
    .valid('debug', 'info', 'warn', 'error')
    .default('info'),
  LOG_FILE: Joi.string().default('logs/combined.log'),
  LOG_TRANSCRIPTS: Joi.boolean().default(false),
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
    transcribeTimeoutMs: 30_000, // AWS startup timeout, not session duration
    maxAudioMessageBytes: 1024 * 1024,
    maxBufferedAudioBytes: 4 * 1024 * 1024,
  },
  auth: {
    apiTokens: environmentVariables.API_TOKENS, // Already parsed as an array
  },
  logging: {
    level: environmentVariables.LOG_LEVEL,
    file: environmentVariables.LOG_FILE,
    transcripts: environmentVariables.LOG_TRANSCRIPTS,
  },
  environment: environmentVariables.NODE_ENV,
}
