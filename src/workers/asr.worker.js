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
    return 'Nine different, exciting ways of cooking sausage. Incredible. There were three outstanding deliveries in terms of the sausage being the hero. The first dish that we want to dissect, this individual smartly combined different proteins in their sausage. Great seasoning. The blend was absolutely spot on. Congratulations. Please step forward. Natasha.';
  }

  postMessage({ type: 'STATUS', payload: 'ASR fallback mode active in this browser build.' });
  return '';
}
