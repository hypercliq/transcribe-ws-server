import fs from 'fs';

// Read the JSON data from a file
const jsonData = fs.readFileSync('asrOutput.json', 'utf8');
const data = JSON.parse(jsonData);

// Function to create chat-like output
function createChatTranscript(data) {
  const segments = data.results.audio_segments;
  const chatTranscript = segments.map(segment => {
    const timestamp = segment.start_time;
    const speaker = segment.speaker_label === "spk_0" ? "speaker 1" : "speaker 2";
    const transcript = segment.transcript;
    return `[${timestamp}] ${speaker}: ${transcript}`;
  });
  return chatTranscript.join('\n');
}

// Generate the chat transcript
const chatTranscript = createChatTranscript(data);

// Save the chat transcript to a file
fs.writeFileSync('audio_identification.txt', chatTranscript, 'utf8');

console.log('Chat transcript saved to audio_identification.txt');
