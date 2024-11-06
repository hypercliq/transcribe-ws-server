// server.js

import {
  LanguageCode,
  MediaEncoding,
  StartStreamTranscriptionCommand,
  TranscribeStreamingClient
} from '@aws-sdk/client-transcribe-streaming';
import { fromEnv } from '@aws-sdk/credential-providers';
import 'dotenv/config';
import { WebSocketServer } from 'ws';
import logger from './logger.js';

/* ==========================
   Configuration and Setup
   ========================== */

// AWS Configuration
const REGION = process.env.AWS_REGION || 'eu-central-1'; // Replace with your AWS region

// Server Configuration
const PORT = process.env.PORT || 8080;

// Authentication Token
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'your-hardcoded-auth-token'; // Replace with your secure token

// Define default transcription settings
const DEFAULT_LANGUAGE_CODE = LanguageCode.EN_US;
const DEFAULT_MEDIA_ENCODING = MediaEncoding.PCM;
const DEFAULT_MEDIA_SAMPLE_RATE_HERTZ = 16000;
const DEFAULT_SHOW_SPEAKER_LABEL = false;

// Initialize AWS Transcribe Client
const transcribeClient = new TranscribeStreamingClient({
  region: REGION,
  credentials: fromEnv(),
});

// Initialize WebSocket Server
const wss = new WebSocketServer({ port: PORT });

logger.info(`WebSocket Server is listening on port ${PORT}`);

/* ==========================
   Helper Functions
   ========================== */

/**
 * Generates an asynchronous iterable for incoming audio data from the WebSocket.
 * Each audio chunk is wrapped in an AudioEvent object as required by AWS Transcribe.
 * @param {WebSocket} ws - The WebSocket connection.
 * @returns {AsyncGenerator<Object>} - An async generator yielding AudioEvent objects.
 */
const createAudioStream = async function* (ws) {
  const messageQueue = [];
  let isClosed = false;
  let resolvePromise;
  let isResolving = false;

  const waitForMessage = () => {
    if (isResolving) return;
    isResolving = true;
    return new Promise((resolve) => {
      resolvePromise = resolve;
    });
  };

  ws.on('message', (message) => {
    if (Buffer.isBuffer(message)) {
      logger.debug(`Received audio chunk of size: ${message.byteLength} bytes`);
      messageQueue.push(message);
      if (resolvePromise) {
        resolvePromise();
        resolvePromise = null;
      }
    } else {
      logger.warn(`Received non-buffer message; ignoring. Message: ${message}`);
    }
  });

  ws.on('close', () => {
    isClosed = true;
    if (resolvePromise) {
      resolvePromise();
      resolvePromise = null;
    }
  });

  while (true) {
    while (messageQueue.length > 0) {
      const chunk = messageQueue.shift();
      yield { AudioEvent: { AudioChunk: chunk } };
    }

    if (isClosed) {
      break;
    }

    await waitForMessage();
    isResolving = false;
  }
};

/**
 * Handles the transcription stream from AWS Transcribe and sends results to the client.
 * @param {AsyncIterable<Object>} transcriptStream - The transcript result stream from AWS.
 * @param {WebSocket} ws - The WebSocket connection to the client.
 */
const handleTranscriptionStream = async (transcriptStream, ws) => {
  try {
    for await (const event of transcriptStream) {
      const results = event.TranscriptEvent?.Transcript?.Results;

      if (results) {
        results.forEach(result => {
          const transcript = result.Alternatives[0]?.Transcript;

          if (transcript) {
            if (result.IsPartial) {
              logger.debug(`Partial transcript: ${transcript}`);
              ws.send(JSON.stringify({ partialTranscript: transcript }));
            } else {
              logger.info(`Final transcript: ${transcript}`);
              ws.send(JSON.stringify({ transcript }));
            }
          } else {
            logger.warn(`Received result without transcript: ${JSON.stringify(result)}`);
          }
        });
      } else {
        logger.error(`Unexpected event structure: ${JSON.stringify(event)}`);
      }
    }
  } catch (error) {
    logger.error(`Error in transcription stream: ${error}`);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ error: 'Error in transcription stream' }));
      ws.close(1011, 'Internal server error');
    }
  }
};

/**
 * Verifies the query parameters from the URL and extracts transcription parameters.
 * @param {URL} url - The URL object containing query parameters.
 * @param {WebSocket} ws - The WebSocket connection.
 * @param {string} ip - The IP address of the client.
 * @returns {Object} - The transcription parameters.
 */
const verifyQueryParams = (url, ws, ip) => {
  const token = url.searchParams.get('token');
  if (token !== AUTH_TOKEN) {
    logger.warn(`Authentication failed for client from IP: ${ip}. Reason: Invalid token`);
    ws.close(1008, 'Authentication failed'); // 1008: Policy Violation
    return;
  }

  logger.info(`Authentication successful for client from IP: ${ip}`);

  const params = {};

  // Extract additional transcription parameters
  const languageCode = url.searchParams.get('language') || DEFAULT_LANGUAGE_CODE;
  const mediaEncoding = url.searchParams.get('encoding') || DEFAULT_MEDIA_ENCODING;
  const mediaSampleRateHertz = parseInt(url.searchParams.get('sampleRate'), 10) || DEFAULT_MEDIA_SAMPLE_RATE_HERTZ;
  const showSpeakerLabel = url.searchParams.get('speakerLabel') === 'true' ? true : DEFAULT_SHOW_SPEAKER_LABEL;

  logger.info(`Transcription parameters: Language=${languageCode}, Encoding=${mediaEncoding}, SampleRate=${mediaSampleRateHertz}, SpeakerLabel=${showSpeakerLabel}`);

  // Check language code
  if (!Object.values(LanguageCode).includes(languageCode)) {
    logger.warn(`Invalid language code: ${languageCode}`);
    ws.close(1008, 'Invalid language code');
    return;
  }

  params.LanguageCode = languageCode;

  // Check media encoding
  if (!Object.values(MediaEncoding).includes(mediaEncoding)) {
    logger.warn(`Invalid media encoding: ${mediaEncoding}`);
    ws.close(1008, 'Invalid media encoding');
    return;
  }

  params.MediaEncoding = mediaEncoding;

  // Check sample rate
  if (mediaSampleRateHertz < 8000 || mediaSampleRateHertz > 48000) {
    logger.warn(`Invalid sample rate: ${mediaSampleRateHertz}`);
    ws.close(1008, 'Invalid sample rate');
    return;
  }

  params.MediaSampleRateHertz = mediaSampleRateHertz;

  if (showSpeakerLabel) {
    params.ShowSpeakerLabel = showSpeakerLabel;
  }

  return params;
};

/* ==========================
   WebSocket Server Event Handlers
   ========================== */

wss.on('connection', async (ws, req) => {
  const ip = req.socket.remoteAddress;
  logger.info(`New connection from IP: ${ip}`);

  // Parse the URL to extract the token from query parameters
  const url = new URL(req.url, `http://${req.headers.host}`);
  logger.debug(`Parsed URL: ${url.href}`);
  
  // Verify the authentication token and extract transcription parameters
  const params = verifyQueryParams(url, ws, ip);

  if (!params) {
    logger.warn(`Connection terminated for IP: ${ip} due to invalid parameters`);
    return; // Terminate connection if params are invalid
  }

  try {
    params.AudioStream = createAudioStream(ws);

    // Configure AWS Transcribe Command with the same audioStream
    const command = new StartStreamTranscriptionCommand(params);

    // Start transcription
    const response = await transcribeClient.send(command);
    logger.info('Transcription started successfully');

    // Handle transcription results
    handleTranscriptionStream(response.TranscriptResultStream, ws);
  } catch (error) {
    logger.error(`Error starting transcription: ${error}`);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ error: 'Error starting transcription' }));
      ws.close(1011, 'Internal server error');
    }
  }

  // Handle client disconnection
  ws.on('close', (code, reason) => {
    logger.info(`Client from IP: ${ip} disconnected (code: ${code}, reason: ${reason})`);
  });

  // Handle unforeseen errors
  ws.on('error', (error) => {
    logger.error(`WebSocket error for client from IP: ${ip}: ${error}`);
  });
});

/* ==========================
   Graceful Shutdown
   ========================== */

/**
 * Handles graceful shutdown on receiving termination signals.
 */
const gracefulShutdown = () => {
  logger.info('Shutting down server...');
  wss.close(() => {
    logger.info('WebSocket Server closed');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forcing server shutdown');
    process.exit(1);
  }, 10000);
};

// Listen for termination signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
