# Using the WebSocket Server for AWS Transcribe Streaming

This document provides information for users who want to connect to the WebSocket server for real-time speech-to-text transcription.

## Connecting to the WebSocket Server

### Connection URL Format

```plaintext
wss://your-server-address:PORT/?token=your-api-token&language=en-US&encoding=pcm&sampleRate=16000&speakerLabel=false
```

### Query Parameters

- `token` (required): API token matching `API_TOKEN` environment variable.
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

## Example Client Implementations

### JavaScript (Node.js)

Below is an example of a simple client using Node.js `ws` library:

```javascript
// client.js

const WebSocket = require('ws');

const ws = new WebSocket('wss://your-server-address:PORT/?token=your-api-token');

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

### Python

Below is an example of a simple client using Python `websockets` library:

```python
# client.py

import asyncio
import websockets
import json

async def send_audio(uri):
    async with websockets.connect(uri) as websocket:
        print("Connected to the server")

        # Replace with actual audio streaming logic
        # For example, send audio data from microphone or a file
        async for chunk in get_audio_stream():  # Implement this function
            await websocket.send(chunk)

        async for message in websocket:
            data = json.loads(message)
            if "partialTranscript" in data:
                print("Partial Transcript:", data["partialTranscript"])
            elif "transcript" in data:
                print("Final Transcript:", data["transcript"])
            elif "error" in data:
                print("Error:", data["error"])

asyncio.get_event_loop().run_until_complete(
    send_audio('wss://your-server-address:PORT/?token=your-api-token')
)
```

---

*Note: Replace `your-server-address`, `your-api-token`, and other placeholders with actual values relevant to your deployment.*
