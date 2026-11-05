# WebSocket Server for AWS Transcribe Streaming

A small WebSocket gateway for real-time speech-to-text with AWS Transcribe Streaming. Clients send audio and receive JSON partial and final transcripts. See [USAGE.md](USAGE.md) for the protocol and paced file-client examples.

## Requirements

- A maintained Node LTS release: **22.21+, 24.10+, or 26.x**. `.node-version` selects Node 26. Other major versions are excluded by `engines` and `engine-strict`.
- An AWS account with Transcribe Streaming available in the configured region and credentials authorized for `transcribe:StartStreamTranscription`.
- Audio encoded for streaming; the server forwards bytes without decoding, converting, or resampling them.

## Install and run

```bash
git clone https://github.com/hypercliq/transcribe-ws-server.git
cd transcribe-ws-server
npm ci
cp .env.example .env
```

Edit `.env` to supply your AWS credentials and replace `API_TOKENS` with a non-empty JSON array of private tokens. Give separate clients separate tokens when you need to distinguish their requests in logs. Generate a token with:

```bash
node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"
```

Start the server from the repository root:

```bash
npm start
```

Node's native loader reads `.env` from the current working directory. The file is optional when configuration is supplied by the deployment environment, and existing environment variables take precedence. Other `.env.*` files are not selected automatically. An existing `.env` that cannot be read causes startup to fail.

The AWS client uses `fromEnv()`: set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, plus `AWS_SESSION_TOKEN` for temporary credentials. Credentials are resolved when a transcription starts; a successful startup or health response does not prove that credentials work. IAM role, shared-profile, and other default-chain credential sources are not enabled by this server configuration.

## Configuration

| Variable                | Required                  | Default             | Purpose                                                                         |
| ----------------------- | ------------------------- | ------------------- | ------------------------------------------------------------------------------- |
| `AWS_REGION`            | Yes                       | —                   | AWS region used for Transcribe Streaming.                                       |
| `PORT`                  | Yes                       | —                   | TCP port for the HTTP and WebSocket server.                                     |
| `API_TOKENS`            | Yes                       | —                   | Non-empty JSON array of non-empty strings, e.g. `'["token-a"]'`.                |
| `AWS_ACCESS_KEY_ID`     | For transcription         | —                   | AWS access key for the environment credential provider.                         |
| `AWS_SECRET_ACCESS_KEY` | For transcription         | —                   | AWS secret key for the environment credential provider.                         |
| `AWS_SESSION_TOKEN`     | For temporary credentials | —                   | Session token belonging to the AWS access key.                                  |
| `NODE_ENV`              | No                        | `development`       | `development` selects pretty console logs; `production` selects JSON file logs. |
| `LOG_LEVEL`             | No                        | `info`              | `debug`, `info`, `warn`, or `error`.                                            |
| `LOG_FILE`              | No                        | `logs/combined.log` | Destination for production JSON logs, relative to the working directory.        |
| `LOG_TRANSCRIPTS`       | No                        | `false`             | Opt in to logging spoken content.                                               |

Do not commit `.env` or AWS credentials. Restart the process after changing configuration or tokens.

## Deployment and health

The application serves **plain HTTP and `ws://`**; it does not create a TLS listener. Use `ws://localhost:PORT/` locally. For public `wss://` access, terminate TLS at a reverse proxy or load balancer that forwards WebSocket upgrades to this server. Protect query strings in proxy access logs: connection URLs contain authentication tokens even though application logs redact them.

For an install without development dependencies:

```bash
npm ci --omit=dev
NODE_ENV=production npm start
```

The explicit environment setting overrides the development value in the example `.env`. Development logging requires `pino-pretty`, which is excluded by `--omit=dev`.

`GET /health` responds with HTTP 200 and `{"status":"ok"}` while serving. It checks process availability, not AWS connectivity, credentials, service quotas, or remaining session capacity. Shutdown stops listening immediately.

## Limits and shutdown

The current limits are defined in [config/index.js](config/index.js) and [utils/audio-stream.js](utils/audio-stream.js):

- Up to 100 tracked WebSocket connections per process; excess connections close with `1013`.
- A 30-second **AWS startup timeout**. It is cleared when the SDK returns its streaming response, which can require an initial event; it is not a session-duration or idle-audio limit.
- At most 1 MiB per WebSocket message and 4 MiB / 4096 queued audio chunks per connection. Limit breaches close with `1009`.
- No application heartbeat or session/idle-duration policy. File clients must pace audio close to real time.

On `SIGTERM` or `SIGINT`, the server stops accepting new connections, aborts tracked AWS requests, and closes open clients with `1001`. After five seconds it terminates remaining sockets. Shutdown cancels active transcriptions; it does not promise to drain their final results.

## Logging and debugging

Development logs go to the console. Production logs go to `LOG_FILE` as JSON; production does not also emit the same application logs to stdout. Arrange file rotation or collection in your deployment.

Connection logs include a random `sessionId`, socket `IP`, and the supplied `forwardedFor` header. The forwarded header is unverified client input, not an authenticated identity. Authorized-request logs add:

- `tokenFingerprint`: the first 12 hexadecimal characters of SHA-256 of the matching API token, allowing requests from the same token to be correlated without recording it.
- `language`, `encoding`, `sampleRate`, and `sendPartials`: validated request settings, including defaults.

Validation failures identify invalid fields and error types without listing permitted token values. Raw API tokens and complete connection URLs are not logged. Final transcript text is excluded by default. To inspect spoken content temporarily, set `LOG_TRANSCRIPTS=true`: final text logs at `info`, and partial text logs at `debug` when partial results are enabled and `LOG_LEVEL=debug`. These logs can contain sensitive speech.

## Development checks

```bash
npm ci
npm run check
```

`check` runs formatting checks, ESLint, and tests. Use `npm run format` or `npm run lint:fix` for deliberate fixes. Tests use isolated configuration processes and local WebSocket connections with a fake AWS client; no AWS credentials or paid AWS calls are required.

CI checks Node 22, 24, and 26 LTS. Dependabot checks npm packages and pinned GitHub Actions weekly. Add a future Node line only after it enters LTS and passes CI; remove a line when it reaches end of life.

## Troubleshooting

| Symptom                         | Check                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Startup configuration error     | Check required values, the JSON syntax of `API_TOKENS`, and the working directory for `.env`.          |
| Missing `pino-pretty`           | Set `NODE_ENV=production` for a production-only install, or install development dependencies.          |
| No console logs in production   | Inspect `LOG_FILE` and its directory permissions.                                                      |
| Connection refused or TLS error | Check `PORT`, listener reachability, and whether the URL uses the appropriate `ws://` / `wss://` path. |
| Close `1008`                    | Check the token and query parameters; URL-encode values using `URLSearchParams` or an equivalent.      |
| Close `1009`                    | Reduce audio message size and pace the upload; do not send an entire large file immediately.           |
| Close `1011`                    | Inspect the session logs for AWS credentials, region, format, quota, network, or startup failures.     |
| Missing final words             | Send `END_OF_STREAM` and keep receiving until the server closes normally; closing early cancels AWS.   |

## License

[EUPL-1.2-or-later](LICENSE).
