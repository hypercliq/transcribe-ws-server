import {
  LanguageCode,
  MediaEncoding,
  StartStreamTranscriptionCommand,
  TranscribeStreamingClient,
} from '@aws-sdk/client-transcribe-streaming';
import { fromEnv } from '@aws-sdk/credential-providers';
import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import { WebSocketServer } from 'ws';
import { logger, logWithIP } from './logger.js';

/* ==========================
   Configuration and Setup
   ========================== */

// AWS Configuration
const REGION = process.env.AWS_REGION;

// Server Configuration
const PORT = process.env.PORT;

// Authentication Token
const AUTH_TOKEN = process.env.AUTH_TOKEN;

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

const options = {
  key: fs.readFileSync('server.key'),
  cert: fs.readFileSync('server.cert'),
};

// Create an HTTPS server
const server = https.createServer(options, (req, res) => {
  res.writeHead(200);
  res.end('WebSocket Server is running');
});

// Initialize WebSocket Server
const wss = new WebSocketServer({ server });

logger.info(`WebSocket Server is listening on port ${PORT}`);

/* ==========================
   Helper Functions
   ========================== */

const createAudioStream = async function* (ws, clientLogger) {
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
      clientLogger.debug(`Received audio chunk of size: ${message.byteLength} bytes`);
      messageQueue.push(message);
      if (resolvePromise) {
        resolvePromise();
        resolvePromise = null;
      }
    } else {
      clientLogger.warn('Received non-buffer message; ignoring.');
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

const handleTranscriptionStream = async (transcriptStream, ws, clientLogger) => {
  try {
    for await (const event of transcriptStream) {
      const results = event.TranscriptEvent?.Transcript?.Results;

      if (results) {
        results.forEach((result) => {
          const transcript = result.Alternatives[0]?.Transcript;

          if (transcript) {
            if (result.IsPartial) {
              clientLogger.debug(`Partial transcript: ${transcript}`);
              ws.send(JSON.stringify({ partialTranscript: transcript }));
            } else {
              clientLogger.info(`Final transcript: ${transcript}`);
              ws.send(JSON.stringify({ transcript }));
            }
          } else {
            clientLogger.warn('Received result without transcript.');
          }
        });
      } else {
        clientLogger.error('Unexpected event structure.');
      }
    }
  } catch (error) {
    clientLogger.error(`Error in transcription stream: ${error.message}`);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ error: 'Error in transcription stream' }));
      ws.close(1011, 'Internal server error');
    }
  }
};

const verifyQueryParams = (url, ws, clientLogger) => {
  const token = url.searchParams.get('token');
  if (token !== AUTH_TOKEN) {
    clientLogger.warn('Authentication failed. Reason: Invalid token');
    ws.close(1008, 'Authentication failed');
    return;
  }

  clientLogger.info('Authentication successful');

  const params = {};

  // Extract additional transcription parameters
  const languageCode =
    url.searchParams.get('language') || DEFAULT_LANGUAGE_CODE;
  const mediaEncoding =
    url.searchParams.get('encoding') || DEFAULT_MEDIA_ENCODING;
  const mediaSampleRateHertz =
    parseInt(url.searchParams.get('sampleRate'), 10) ||
    DEFAULT_MEDIA_SAMPLE_RATE_HERTZ;
  const showSpeakerLabel =
    url.searchParams.get('speakerLabel') === 'true'
      ? true
      : DEFAULT_SHOW_SPEAKER_LABEL;

  clientLogger.info(
    `Transcription parameters: Language=${languageCode}, Encoding=${mediaEncoding}, SampleRate=${mediaSampleRateHertz}, SpeakerLabel=${showSpeakerLabel}`
  );

  // Check language code
  if (!Object.values(LanguageCode).includes(languageCode)) {
    clientLogger.warn(`Invalid language code: ${languageCode}`);
    ws.close(1008, 'Invalid language code');
    return;
  }

  params.LanguageCode = languageCode;

  // Check media encoding
  if (!Object.values(MediaEncoding).includes(mediaEncoding)) {
    clientLogger.warn(`Invalid media encoding: ${mediaEncoding}`);
    ws.close(1008, 'Invalid media encoding');
    return;
  }

  params.MediaEncoding = mediaEncoding;

  // Check sample rate
  if (mediaSampleRateHertz < 8000 || mediaSampleRateHertz > 48000) {
    clientLogger.warn(`Invalid sample rate: ${mediaSampleRateHertz}`);
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
  const clientLogger = logWithIP(ip);
  clientLogger.info('New connection');

  const url = new URL(req.url, `https://${req.headers.host}`);
  clientLogger.debug(`Parsed URL: ${url.href}`);

  const params = verifyQueryParams(url, ws, clientLogger);

  if (!params) {
    clientLogger.warn('Connection terminated due to invalid parameters');
    return;
  }

  try {
    params.AudioStream = createAudioStream(ws, clientLogger);

    const command = new StartStreamTranscriptionCommand(params);

    const response = await transcribeClient.send(command);
    clientLogger.info('Transcription started successfully');

    handleTranscriptionStream(response.TranscriptResultStream, ws, clientLogger);
  } catch (error) {
    clientLogger.error(`Error starting transcription: ${error.message}`);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ error: 'Error starting transcription' }));
      ws.close(1011, 'Internal server error');
    }
  }

  ws.on('close', (code, reason) => {
    clientLogger.info(`Client disconnected (code: ${code}, reason: ${reason})`);
  });

  ws.on('error', (error) => {
    clientLogger.error(`WebSocket error: ${error.message}`);
  });
});

/* ==========================
   Graceful Shutdown
   ========================== */

const gracefulShutdown = () => {
  logger.info('Shutting down server...');
  wss.close(() => {
    logger.info('WebSocket Server closed');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forcing server shutdown');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

server.listen(PORT, () => {
  logger.info(`WebSocket Server is running on port ${PORT}`);
});
