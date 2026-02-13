class TtsProcessor extends AudioWorkletProcessor {
  process() {
    return true;
  }
}

registerProcessor('tts-processor', TtsProcessor);
