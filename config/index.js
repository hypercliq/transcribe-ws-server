// config/index.js
import dotenv from 'dotenv'
import Joi from 'joi'

// Load environment variables from .env file
dotenv.config()

// Define the schema for environment variables
const environmentSchema = Joi.object({
  AWS_REGION: Joi.string().required(),
  PORT: Joi.number().integer().min(1).required(),
  API_TOKEN: Joi.string().required(),
  LOG_LEVEL: Joi.string()
    .valid('debug', 'info', 'warn', 'error')
    .default('info'),
  NODE_ENV: Joi.string()
    .valid('development', 'production')
    .default('development'),
  AWS_ACCESS_KEY_ID: Joi.string().optional(),
  AWS_SECRET_ACCESS_KEY: Joi.string().optional(),
}).unknown(true) // Allow additional variables

// Validate the environment variables
const { error, value: environmentVariables } = environmentSchema.validate(
  process.env,
)

if (error) {
  throw new Error(`Config validation error: ${error.message}`)
}

export default {
  aws: {
    region: environmentVariables.AWS_REGION,
    // do not include AWS keys in a object
  },
  server: {
    port: environmentVariables.PORT,
    maxConnections: 100,
    transcribeTimeoutMs: 30_000, // 30 seconds
  },
  auth: {
    apiToken: environmentVariables.API_TOKEN,
  },
  logging: {
    level: environmentVariables.LOG_LEVEL,
  },
  environment: environmentVariables.NODE_ENV,
}
