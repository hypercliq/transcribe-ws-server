# WebSocket Server for AWS Transcribe Streaming

This WebSocket server provides real-time speech-to-text transcription using AWS Transcribe Streaming.

## Features

- Real-time transcription of audio streams.
- Supports multiple languages and audio encoding formats.
- Provides partial and final transcription results.
- Health check endpoint for monitoring server status.
- Graceful shutdown and error handling.

## Prerequisites

- **AWS Account**: Required for AWS Transcribe Streaming service.
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
   API_TOKEN=your-api-token
   ```

## Running the Server

Start the server with:

```bash
node server.js
```

The server will listen on the port specified in the `PORT` environment variable.

## Health Check Endpoint

- **URL**: `http://your-server-address:PORT/health`
- **Method**: `GET`
- **Response**:

  ```json
  { "status": "ok" }
  ```

Use this endpoint to monitor the server's health status.

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
- `API_TOKEN`: Token used for client authorization.
- `LOG_LEVEL` (optional): Logging level for the server.

## Graceful Shutdown

The server handles `SIGTERM` and `SIGINT` signals to allow for graceful shutdown, ensuring all active connections are properly closed.

## Troubleshooting

- **Connection Refused**: Ensure the server is running and the port is open.
- **Authorization Failed**: Verify the `token` parameter matches `API_TOKEN`.
- **Invalid Parameters**: Check that query parameters are correctly formatted.
- **Transcription Timeout**: Ensure audio data is being sent consistently.

## License

This project is licensed under the MIT License.

---

*Note: Replace `your-server-address`, `your-api-token`, and other placeholders with actual values relevant to your deployment.*
