// audio-worklet-processor.js

class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.isKeywordDetected = false
    this.KEYWORD = 'hello luminous' // Define your trigger keyword
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    if (input && input.length > 0) {
      const channelData = input[0]

      // Perform keyword detection on channelData
      let sum = 0
      for (const sample of channelData) {
        sum += sample * sample
      }
      const rms = Math.sqrt(sum / channelData.length)

      if (rms > 0.01) {
        // Threshold for demonstration; adjust accordingly
        // this.port.postMessage({ keywordDetected: true });
        this.port.postMessage({ audioData: channelData })
      }

      // Always send the audio data to the main thread
    }
    return true
  }
}

registerProcessor('audio-processor', AudioProcessor)
