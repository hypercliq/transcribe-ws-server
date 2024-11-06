// test-audio-sender.js

async function sendTestAudio() {
  const ws = new WebSocket(
    'ws://localhost:8080/?token=your-hardcoded-auth-token&language=es-ES',
  )
  ws.binaryType = 'arraybuffer'

  ws.onopen = () => {
    console.log('Connected to server')
    fetch('speech.pcm')
      .then((response) => response.arrayBuffer())
      .then((buffer) => {
        ws.send(buffer)
        console.log('Test audio sent')
        ws.close()
      })
  }

  ws.onmessage = (event) => {
    console.log('Received message:', event.data)
  }

  ws.onclose = () => {
    console.log('WebSocket connection closed')
  }
}

sendTestAudio()
