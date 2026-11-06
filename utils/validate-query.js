// utils/validateQuery.js
import Joi from 'joi'
import { createHash } from 'node:crypto'
import {
  LanguageCode,
  MediaEncoding,
} from '@aws-sdk/client-transcribe-streaming'
import config from '../config/index.js'

// Define the schema for query parameter validation
const querySchema = Joi.object({
  token: Joi.string()
    .required()
    .valid(...config.auth.apiTokens), // Spread the array into valid options
  language: Joi.string()
    .valid(...Object.values(LanguageCode))
    .default(LanguageCode.EN_US),
  encoding: Joi.string()
    .valid(...Object.values(MediaEncoding))
    .default(MediaEncoding.PCM),
  sampleRate: Joi.number().integer().min(8000).max(48_000).default(16_000),
  sendPartials: Joi.boolean().truthy('true').falsy('false').default(true),
}).unknown(true) // Allow additional query parameters if necessary

/**
 * Validates query parameters from the client's connection URL.
 * @param {URL} url - The URL object from the client's request.
 * @param {Logger} clientLogger - Logger instance for the client.
 * @returns {Object} - An object containing isValid and value properties.
 */
export const validateQueryParameters = (url, clientLogger) => {
  const queryParameters = Object.fromEntries(url.searchParams.entries())
  const { error, value } = querySchema.validate(queryParameters)

  if (error) {
    clientLogger.warn(
      {
        errors: error.details.map(({ path, type }) => ({
          field: path.join('.'),
          type,
        })),
      },
      'Invalid query parameters',
    )
    return { isValid: false, value: undefined }
  }

  clientLogger.info(
    {
      tokenFingerprint: createHash('sha256')
        .update(value.token)
        .digest('hex')
        .slice(0, 12),
      language: value.language,
      encoding: value.encoding,
      sampleRate: value.sampleRate,
      sendPartials: value.sendPartials,
    },
    'Authorized transcription request',
  )
  return { isValid: true, value }
}
