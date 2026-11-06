# Client protocol and examples

Clients can stream microphone audio or an existing recording through the same WebSocket protocol. Both should finish by sending the text message `END_OF_STREAM` and keeping the socket open to receive final transcripts. Closing the socket instead cancels transcription and can lose the final words.

## Connect

Local development uses plain WebSocket:

```text
ws://localhost:3000/?token=your-api-token&language=en-US&encoding=pcm&sampleRate=16000&sendPartials=true
```

Use `wss://your-host/` when TLS is provided by a reverse proxy or load balancer. The server itself does not terminate TLS. The token in the URL must match an entry in the server's `API_TOKENS` array. Build query strings with `URLSearchParams` or an equivalent encoder so characters such as `+`, `&`, and `#` are preserved.

| Parameter      | Required | Default | Meaning                                                |
| -------------- | -------- | ------- | ------------------------------------------------------ |
| `token`        | Yes      | —       | Configured API token.                                  |
| `language`     | No       | `en-US` | Language code recognized by the installed AWS SDK.     |
| `encoding`     | No       | `pcm`   | AWS streaming encoding: `pcm`, `flac`, or `ogg-opus`.  |
| `sampleRate`   | No       | `16000` | Integer sample rate from 8000 to 48000 Hz.             |
| `sendPartials` | No       | `true`  | Whether to receive partial results (`true` / `false`). |

Unknown query parameters are accepted but are not forwarded as AWS options. AWS can still reject a language/region/format combination that passes local validation. See [AWS streaming parameters](https://docs.aws.amazon.com/transcribe/latest/APIReference/API_streaming_StartStreamTranscription.html).

## Send audio and finish

1. Send audio bytes as binary WebSocket messages. The server does not convert or resample them. With `encoding=pcm`, use raw signed 16-bit little-endian PCM; a WAV header is not part of that format. The examples below assume **mono PCM at 16,000 Hz**.
2. Pace recorded audio close to real time and receive results concurrently. For mono 16-bit PCM, a 100 ms chunk at 16,000 Hz is 3200 bytes. AWS recommends uniform chunks of roughly 50–200 ms; see [streaming best practices](https://docs.aws.amazon.com/transcribe/latest/dg/streaming.html#best-practices).
3. When recording or playback ends, send `END_OF_STREAM` as a **text** message. Empty binary chunks are ignored. Audio sent after `END_OF_STREAM` is ignored.
4. Keep receiving results until the server closes with `1000`. Disconnecting earlier cancels the AWS request.

A WebSocket message is limited to 1 MiB. Queued audio is limited to 4 MiB or 4096 chunks per connection. These are safety limits, not recommended chunk sizes. Exceeding a limit closes the connection with `1009`.

## Receive results and handle errors

```json
{ "partialTranscript": "Current partial transcription..." }
```

```json
{ "transcript": "Final transcribed text." }
```

Partial text can change. AWS controls when segments become final, and one session can produce several final segments. Suppressing partial results does not change how audio must be sent or how the stream is finished.

Errors may arrive as `{"error":"description"}` before closure. Some failures, such as invalid parameters or oversized messages, only provide a WebSocket close code and reason. Unknown control messages receive a JSON error and leave the connection open.

| Close code | Meaning                                                    |
| ---------- | ---------------------------------------------------------- |
| `1000`     | Normal completion after the transcript stream ends.        |
| `1001`     | Server shutting down; active transcription is cancelled.   |
| `1008`     | Invalid URL, token, or query parameters.                   |
| `1009`     | Audio message or buffering limit exceeded.                 |
| `1011`     | AWS startup timeout or another transcription/server error. |
| `1013`     | Connection capacity reached or server stopping.            |

The server's 30-second timer covers AWS startup and the initial SDK response, which can require the first event. It is cleared when the SDK returns that response; it does not then limit pauses between transcript events or the total session duration. A dropped network connection may appear locally as abnormal closure rather than one of the server's intended codes.

## Node.js file client

Save as `client.mjs` in the repository root. This uses the installed `ws` package and ES modules, matching the project. It streams an existing raw mono PCM recording in paced 100 ms chunks while processing transcript messages as they arrive.

```javascript
import { createReadStream } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket from 'ws'

const [filename, uri] = process.argv.slice(2)
if (!filename || !uri) {
  throw new Error('Usage: node client.mjs recording.pcm "ws://host/?token=..."')
}

const ws = new WebSocket(uri)
ws.on('message', (message) => console.log(JSON.parse(message.toString())))
ws.on('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
ws.on('close', (code, reason) => {
  console.log(`Closed: ${code} ${reason}`)
  if (code !== 1000) process.exitCode = 1
})

ws.on('open', async () => {
  try {
    for await (const chunk of createReadStream(filename, {
      highWaterMark: 3200,
    })) {
      while (ws.bufferedAmount > 3200 && ws.readyState === WebSocket.OPEN) {
        await delay(20)
      }
      if (ws.readyState !== WebSocket.OPEN) return
      if (chunk.length % 2 !== 0)
        throw new Error('Incomplete 16-bit PCM sample')
      ws.send(chunk)
      await delay(100)
    }
    if (ws.readyState === WebSocket.OPEN) ws.send('END_OF_STREAM')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
    ws.close(1000, 'Client error')
  }
})
```

Run it against a local server:

```bash
node client.mjs recording.pcm 'ws://localhost:3000/?token=your-api-token&sendPartials=false'
```

Use the matching `encoding=pcm&sampleRate=16000` settings if your URL supplies these explicitly. Other audio formats or sample rates require changing the client chunking and timing as well as the query parameters.

## Python file client

Install the Python `websockets` package in your Python environment. Save as `client.py`; this example uses the same raw mono 16 kHz PCM input and sends and receives concurrently.

```python
import asyncio
import json
import sys

from websockets.asyncio.client import connect


async def send_audio(websocket, filename):
    with open(filename, "rb") as audio:
        while chunk := audio.read(3200):
            if len(chunk) % 2:
                raise ValueError("Incomplete 16-bit PCM sample")
            await websocket.send(chunk)
            await asyncio.sleep(0.1)
    await websocket.send("END_OF_STREAM")


async def receive_results(websocket):
    async for message in websocket:
        print(json.loads(message))


async def main(filename, uri):
    async with connect(uri) as websocket:
        await asyncio.gather(
            send_audio(websocket, filename),
            receive_results(websocket),
        )


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2]))
```

```bash
python client.py recording.pcm 'ws://localhost:3000/?token=your-api-token&sendPartials=false'
```

For microphone clients, replace the file reader and pacing with your capture pipeline; retain binary messages, concurrent result handling, and the text end-of-stream marker.
