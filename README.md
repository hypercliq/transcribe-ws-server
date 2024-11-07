# WebSocket Server for AWS Transcribe Streaming

This WebSocket server provides real-time speech-to-text transcription using AWS Transcribe Streaming. Clients can connect to the server, send audio data, and receive transcribed text in real-time.

## Features

- Real-time transcription of audio streams.
- Supports multiple languages and audio encoding formats.
- Provides partial and final transcription results.
- Health check endpoint for monitoring server status.
- Graceful shutdown and error handling.

## Prerequisites

- **AWS Account**: Required for AWS Transcribe Streaming service.
- **SSL Certificates**: `server.key` and `server.cert` files for HTTPS and secure WebSocket connections.
- **Node.js**: Ensure Node.js is installed on your system.
- **Environment Variables**: Configure necessary environment variables.

## Installation

1. **Clone the repository**:

   ```bash
   git clone https://github.com/your-repo.git
   cd your-repo
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Set up environment variables**:

   Create a `.env` file in the project root with the following variables:

   ```bash
   AWS_REGION=your-aws-region
   PORT=your-server-port
   AUTH_TOKEN=your-authentication-token
   ```

4. **Place SSL certificates**:

   Ensure `server.key` and `server.cert` are placed in the project root directory.

## Running the Server

Start the server with:

```bash
node server.js
```

The server will listen on the port specified in the `PORT` environment variable.

## Health Check Endpoint

- **URL**: `https://your-server-address:PORT/health`
- **Method**: `GET`
- **Response**:

  ```json
  { "status": "ok" }
  ```

Use this endpoint to monitor the server's health status.

## Connecting to the WebSocket Server

### Connection URL Format

```plaintext
wss://your-server-address:PORT/?token=your-auth-token&language=en-US&encoding=pcm&sampleRate=16000&speakerLabel=false
```

### Query Parameters

- `token` (required): Authentication token matching `AUTH_TOKEN` environment variable.
- `language` (optional): Language code for transcription (default: `en-US`).
- `encoding` (optional): Audio encoding format (default: `pcm`).
- `sampleRate` (optional): Audio sample rate in Hertz (default: `16000`).
- `speakerLabel` (optional): Enable speaker labeling (`true` or `false`, default: `false`).

### Supported Language Codes

Refer to the [AWS Transcribe Streaming documentation](https://docs.aws.amazon.com/transcribe/latest/dg/API_streaming_StartStreamTranscription.html#API_streaming_StartStreamTranscription_RequestParameters) for supported language codes.

### Example Connection String

```plaintext
wss://your-server-address:PORT/?token=123abc&language=en-US&encoding=pcm&sampleRate=16000
```

## Sending Audio Data

- **Format**: Send audio data as binary messages over the WebSocket connection.
- **Chunking**: Audio data should be sent in small chunks to ensure real-time processing.

## Receiving Transcription Results

The server will send transcription results in JSON format:

- **Partial Transcripts**:

  ```json
  { "partialTranscript": "Current partial transcription..." }
  ```

- **Final Transcripts**:

  ```json
  { "transcript": "Final transcribed text." }
  ```

## Handling Errors

The server will send an error message and close the connection in case of issues:

- **Error Message**:

  ```json
  { "error": "Error description." }
  ```

- **WebSocket Close Codes**:

  - `1000`: Normal closure (e.g., transcription timeout).
  - `1008`: Policy violation (e.g., invalid query parameters).
  - `1011`: Server error during transcription.

## Example Client Implementation

Below is an example of a simple client using Node.js `ws` library:

```javascript
// client.js

const WebSocket = require('ws');

const ws = new WebSocket('wss://your-server-address:PORT/?token=your-auth-token');

ws.on('open', () => {
  console.log('Connected to the server');

  // Replace with actual audio streaming logic
  // For example, send audio data from microphone or a file
  const audioStream = getAudioStream(); // Implement this function

  audioStream.on('data', (chunk) => {
    ws.send(chunk);
  });
});

ws.on('message', (message) => {
  const data = JSON.parse(message);
  if (data.partialTranscript) {
    console.log('Partial Transcript:', data.partialTranscript);
  } else if (data.transcript) {
    console.log('Final Transcript:', data.transcript);
  } else if (data.error) {
    console.error('Error:', data.error);
  }
});

ws.on('close', (code, reason) => {
  console.log(`Connection closed (code: ${code}, reason: ${reason})`);
});
```

## Logging

The server uses `pino` for logging. Logs include:

- Connection events
- Transcription results
- Errors and exceptions
- Memory usage statistics

**Log Levels** can be set using the `LOG_LEVEL` environment variable (`debug`, `info`, `warn`, `error`).

## Environment Variables Summary

- `AWS_REGION`: AWS region where Transcribe service is available.
- `PORT`: Port number the server listens on.
- `AUTH_TOKEN`: Token used for client authentication.
- `LOG_LEVEL` (optional): Logging level for the server.

## Graceful Shutdown

The server handles `SIGTERM` and `SIGINT` signals to allow for graceful shutdown, ensuring all active connections are properly closed.

## Troubleshooting

- **Connection Refused**: Ensure the server is running and the port is open.
- **Authentication Failed**: Verify the `token` parameter matches `AUTH_TOKEN`.
- **Invalid Parameters**: Check that query parameters are correctly formatted.
- **Transcription Timeout**: Ensure audio data is being sent consistently.

## License

This project is licensed under the MIT License.

---

*Note: Replace `your-server-address`, `your-auth-token`, and other placeholders with actual values relevant to your deployment.*
