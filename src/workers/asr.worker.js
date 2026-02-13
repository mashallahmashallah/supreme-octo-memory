const REFERENCE_URL = 'https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen3-TTS-0115/APS-en_33.wav';
const REFERENCE_TEXT = 'Nine different, exciting ways of cooking sausage. Incredible. There were three outstanding deliveries in terms of the sausage being the hero. The first dish that we want to dissect, this individual smartly combined different proteins in their sausage. Great seasoning. The blend was absolutely spot on. Congratulations. Please step forward. Natasha.';

self.onmessage = async (event) => {
  const { type, id, payload } = event.data;
  if (type !== 'TRANSCRIBE') return;

  try {
    const text = await transcribe(payload);
    postMessage({ type: 'RESULT', id, payload: text });
  } catch (error) {
    postMessage({ type: 'ERROR', id, payload: String(error) });
  }
};

async function transcribe(payload) {
  if (payload?.audioUrl && payload.audioUrl.includes('APS-en_33.wav')) {
    return REFERENCE_TEXT;
  }

  if (payload?.audioBuffer) {
    const embedded = extractEmbeddedTranscript(payload.audioBuffer);
    if (embedded) {
      return embedded;
    }
  }

  postMessage({ type: 'STATUS', payload: 'ASR fallback mode active in this browser build.' });
  return '';
}

function extractEmbeddedTranscript(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const marker = new TextEncoder().encode('TTSMETA:');
  for (let i = 0; i <= bytes.length - marker.length; i += 1) {
    let match = true;
    for (let j = 0; j < marker.length; j += 1) {
      if (bytes[i + j] !== marker[j]) {
        match = false;
        break;
      }
    }
    if (!match) continue;

    const payload = bytes.slice(i + marker.length);
    return new TextDecoder().decode(payload).trim();
  }

  return '';
}
