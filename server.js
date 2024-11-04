// server.js

import { WebSocketServer } from 'ws';
import {
  LanguageCode,
  StartStreamTranscriptionCommand,
  TranscribeStreamingClient
} from '@aws-sdk/client-transcribe-streaming';
import { fromEnv } from '@aws-sdk/credential-providers';
import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

/* ==========================
   Configuration and Setup
   ========================== */

// Polyfill for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// AWS Configuration
const REGION = process.env.AWS_REGION || 'eu-central-1'; // Replace with your AWS region

// Server Configuration
const PORT = process.env.PORT || 8080;

// Authentication Token
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'your-hardcoded-auth-token'; // Replace with your secure token

// Define default transcription settings
const DEFAULT_LANGUAGE_CODE = 'en-US';
const DEFAULT_MEDIA_ENCODING = 'pcm';
const DEFAULT_MEDIA_SAMPLE_RATE_HERTZ = 16000;
const DEFAULT_SHOW_SPEAKER_LABEL = false;

// Initialize AWS Transcribe Client
const transcribeClient = new TranscribeStreamingClient({
  region: REGION,
  credentials: fromEnv(),
});

// Initialize WebSocket Server
const wss = new WebSocketServer({ port: PORT });

console.log(`WebSocket Server is listening on port ${PORT}`);

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
      messageQueue.push(message);
      if (resolvePromise) {
        resolvePromise();
        resolvePromise = null;
      }
    } else {
      console.warn('Received non-buffer message; ignoring.');
    }
  });

  ws.on('close', () => {
    isClosed = true;
    if (resolvePromise) {
      resolvePromise();
      resolvePromise = null;
    }
  });

  while (!isClosed || messageQueue.length > 0) {
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
              console.log('Partial transcript:', transcript);
              ws.send(JSON.stringify({ partialTranscript: transcript }));
            } else {
              console.log('Final transcript:', transcript);
              ws.send(JSON.stringify({ transcript }));
            }
          } else {
            console.warn('Received result without transcript:', result);
          }
        });
      } else {
        console.error('Unexpected event structure:', event);
      }
    }
  } catch (error) {
    console.error('Error in transcription stream:', error);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ error: 'Error in transcription stream' }));
      ws.close(1011, 'Internal server error');
    }
  }
};

/* ==========================
   WebSocket Server Event Handlers
   ========================== */

wss.on('connection', async (ws, req) => {
  const ip = req.socket.remoteAddress;

  // Parse the URL to extract the token from query parameters
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (token !== AUTH_TOKEN) {
    console.warn(`Authentication failed for client from IP: ${ip}. Invalid token.`);
    ws.close(1008, 'Authentication failed'); // 1008: Policy Violation
    return;
  }

  console.log(`Authentication successful for client from IP: ${ip}`);

  // Extract additional transcription parameters
  const languageCode = url.searchParams.get('language') || DEFAULT_LANGUAGE_CODE;
  const mediaEncoding = url.searchParams.get('encoding') || DEFAULT_MEDIA_ENCODING;
  const mediaSampleRateHertz = parseInt(url.searchParams.get('sampleRate'), 10) || DEFAULT_MEDIA_SAMPLE_RATE_HERTZ;
  const showSpeakerLabel = url.searchParams.get('speakerLabel') === 'true' ? true : DEFAULT_SHOW_SPEAKER_LABEL;

  console.log(`Transcription parameters: Language=${languageCode}, Encoding=${mediaEncoding}, SampleRate=${mediaSampleRateHertz}, SpeakerLabel=${showSpeakerLabel}`);


  try {
    // Create a single audio stream generator
    const audioStream = createAudioStream(ws);

    // Configure AWS Transcribe Command with the same audioStream
    const command = new StartStreamTranscriptionCommand({
      LanguageCode: languageCode,
      MediaEncoding: mediaEncoding,
      MediaSampleRateHertz: mediaSampleRateHertz,
      AudioStream: audioStream, // Use the single generator
      ShowSpeakerLabel: showSpeakerLabel,
    });

    // Start transcription
    const response = await transcribeClient.send(command);
    console.log('Transcription started successfully');

    // Handle transcription results
    handleTranscriptionStream(response.TranscriptResultStream, ws);
  } catch (error) {
    console.error('Error starting transcription:', error);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ error: 'Error starting transcription' }));
      ws.close(1011, 'Internal server error');
    }
  }

  // Handle client disconnection
  ws.on('close', (code, reason) => {
    console.log(`Client from IP: ${ip} disconnected (code: ${code}, reason: ${reason})`);
  });

  // Handle unforeseen errors
  ws.on('error', (error) => {
    console.error(`WebSocket error for client from IP: ${ip}:`, error);
  });
});

/* ==========================
   Graceful Shutdown
   ========================== */

/**
 * Handles graceful shutdown on receiving termination signals.
 */
const gracefulShutdown = () => {
  console.log('Shutting down server...');
  wss.close(() => {
    console.log('WebSocket Server closed');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('Forcing server shutdown');
    process.exit(1);
  }, 10000);
};

// Listen for termination signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
