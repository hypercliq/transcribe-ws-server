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
- **Node.js**: Use a maintained LTS release: Node 22.21+, 24.10+, or 26.x. The development default in `.node-version` is Node 26 LTS. Odd-numbered and future unverified releases are excluded.
- **Environment Variables**: Configure necessary environment variables.

## Installation

1. **Clone the repository**:

   ```bash
   git clone https://github.com/hypercliq/transcribe-ws-server.git
   cd transcribe-ws-server
   ```

2. **Install dependencies**:

   ```bash
   npm ci
   ```

3. **Set up environment variables**:

   Create a `.env` file in the project root with the following variables:

   ```bash
   AWS_ACCESS_KEY_ID=your-access-key-id
   AWS_SECRET_ACCESS_KEY=your-secret-access-key
   AWS_REGION=your-aws-region
   PORT=your-server-port
   API_TOKENS='["your-api-token"]' # non-empty JSON array for client authorization
   NODE_ENV=production # use development with dev dependencies for pretty console logs
   LOG_LEVEL=info # optional: debug, info, warn, error
   ```

   If another AWS credential method is preferred, update the `aws-sdk` configuration in `server.js`. Right now it uses `fromEnv()`.

## Running the Server

Start the server with:

```bash
npm start
```

The server will listen on the port specified in the `PORT` environment variable.

## Development checks

Run `npm ci` to install the locked dependencies, then `npm run check` to check formatting, lint, and run the tests. Use `npm run format` or `npm run lint:fix` for deliberate fixes. Tests use local WebSocket connections with a fake AWS client and do not require AWS credentials.

CI runs these checks on Node 22, 24, and 26 LTS. Dependabot checks npm packages and pinned GitHub Actions weekly. Before adding a future Node major, confirm that it has entered LTS and passes this matrix; remove a line when it reaches end of life.

Production-only installs use `npm ci --omit=dev` with `NODE_ENV=production`. Development logging requires the optional development dependency `pino-pretty`.

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
- Transcription results, when explicitly enabled
- Errors and exceptions
- Memory usage statistics

Connection logs include a session ID, socket IP, the supplied `X-Forwarded-For` header (unverified), a stable token fingerprint, and the validated language, encoding, sample rate, and partial-result setting. Raw API tokens and connection URLs are not logged.

Transcription text is excluded by default. Set `LOG_TRANSCRIPTS=true` to log final transcripts at `info` level and partial transcripts at `debug` level for debugging. These logs can contain sensitive spoken content.

**Log Levels** can be set using the `LOG_LEVEL` environment variable (`debug`, `info`, `warn`, `error`).

In development mode, logs are written to the console. In production, logs are also written to a file in JSON format.

## Environment Variables Summary

- `AWS_ACCESS_KEY_ID`: AWS access key ID for Transcribe service.
- `AWS_SECRET_ACCESS_KEY`: AWS secret access key for Transcribe service.
- `AWS_REGION`: AWS region where Transcribe service is available.
- `PORT`: Port number the server listens on.
- `API_TOKENS`: Non-empty JSON array of tokens used for client authorization.
- `LOG_LEVEL` (optional): Logging level for the server.

## Graceful Shutdown

The server handles `SIGTERM` and `SIGINT` signals to allow for graceful shutdown, ensuring all active connections are properly closed.

## Troubleshooting

- **Connection Refused**: Ensure the server is running and the port is open.
- **Authorization Failed**: Verify the `token` parameter matches one of `API_TOKENS`.
- **Invalid Parameters**: Check that query parameters are correctly formatted.
- **Transcription Timeout**: Ensure audio data is being sent consistently.

## License

This project is licensed under the EUPL-1.2-or-later license. See the [LICENSE](LICENSE) file for details.

---

_Note: Replace `your-server-address`, `your-api-token`, and other placeholders with actual values relevant to your deployment._
