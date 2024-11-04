// server.js

import { WebSocketServer } from 'ws';
import { StartStreamTranscriptionCommand, TranscribeStreamingClient } from '@aws-sdk/client-transcribe-streaming';
import { fromEnv } from '@aws-sdk/credential-providers';
import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Polyfill for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// AWS Configuration
const REGION = process.env.AWS_REGION || 'eu-central-1'; // Replace with your AWS region

// Server Configuration
const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

// Authentication Token
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'your-hardcoded-auth-token'; // Replace with your secure token

// Initialize AWS Transcribe Client
const transcribeClient = new TranscribeStreamingClient({
  region: REGION,
  credentials: fromEnv(),
});

wss.on('connection', async function connection(ws, req) {
  // Extract token from 'sec-websocket-protocol' header
  let protocols = req.headers['sec-websocket-protocol'];

  if (!protocols) {
    ws.close(1008, 'Unauthorized: No protocol provided');
    console.warn('Connection closed: No protocol provided');
    return;
  }

  // 'sec-websocket-protocol' can be a comma-separated string
  if (typeof protocols === 'string') {
    protocols = protocols.split(',').map(p => p.trim());
  }

  const token = protocols[0]; // Assuming the first protocol is the token

  if (token !== AUTH_TOKEN) {
    ws.close(1008, 'Unauthorized: Invalid token');
    console.warn('Connection closed: Invalid token');
    return;
  }

  // Accept the protocol by echoing back the token
  ws.send('', {
    binary: false,
    compress: false,
    fin: true,
    mask: false,
    opcode: 0x1,
    headers: { 'Sec-WebSocket-Protocol': token },
  });

  console.log('Client connected and authenticated');

  // Prepare the audio stream from the WebSocket
  const audioStream = async function* () {
    try {
      for await (const chunk of wsAudioStream(ws)) {
        yield { AudioEvent: { AudioChunk: chunk } };
      }
    } catch (err) {
      console.error('Error in audio stream generator:', err);
    }
  };

  // Start the Transcription Command
  const command = new StartStreamTranscriptionCommand({
    LanguageCode: 'fr-FR', // Replace with your target language code
    MediaEncoding: 'pcm',
    MediaSampleRateHertz: 16000,
    AudioStream: audioStream(),
    ShowSpeakerLabel: true, // Optional: Remove if not needed
  });

  try {
    const response = await transcribeClient.send(command);
    console.log('Transcription started successfully');

    // Handle the transcription stream
    handleTranscriptionStream(response.TranscriptResultStream, ws);
  } catch (err) {
    console.error('Error starting transcription:', err);
    ws.send(JSON.stringify({ error: 'Error starting transcription' }));
    ws.close(1011, 'Internal server error');
  }

  ws.on('close', () => {
    console.log('Client disconnected');
    // Additional cleanup if necessary
  });
});

// Function to handle incoming audio data from WebSocket
async function* wsAudioStream(ws) {
  const messageQueue = [];
  let isClosed = false;

  ws.on('message', (message) => {
    // You can uncomment the next line for debugging
    // console.log('Received audio data:', message);
    messageQueue.push(message);
  });

  ws.on('close', () => {
    isClosed = true;
  });

  while (!isClosed || messageQueue.length > 0) {
    if (messageQueue.length > 0) {
      yield messageQueue.shift();
    } else {
      // Wait briefly for new messages
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

// Function to handle the transcription result stream
async function handleTranscriptionStream(transcriptStream, ws) {
  try {
    for await (const event of transcriptStream) {
      if (event.TranscriptEvent?.Transcript?.Results) {
        for (const result of event.TranscriptEvent.Transcript.Results) {
          const transcript = result.Alternatives[0].Transcript;

          if (result.IsPartial) {
            console.log('Partial transcript:', transcript);
            // Send partial transcript to the client
            ws.send(JSON.stringify({ partialTranscript: transcript }));
          } else {
            console.log('Final transcript:', transcript);
            // Send final transcript to the client
            ws.send(JSON.stringify({ transcript }));
          }
        }
      } else {
        console.error('Unexpected event structure:', event);
      }
    }
  } catch (err) {
    console.error('Error in transcription stream:', err);
    ws.send(JSON.stringify({ error: 'Error in transcription stream' }));
    ws.close(1011, 'Internal server error');
  }
}

console.log(`Server is listening on port ${PORT}`);
