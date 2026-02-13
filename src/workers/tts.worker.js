let loadedModel = null;

self.onmessage = async (event) => {
  const { type, payload } = event.data;

  if (type === 'INIT_MODEL') {
    const start = performance.now();
    await sleep(350);
    loadedModel = payload.modelId;
    postMessage({ type: 'MODEL_READY', payload: { modelId: loadedModel, loadMs: performance.now() - start } });
  }

  if (type === 'SYNTHESIZE') {
    const start = performance.now();
    if (!loadedModel) {
      postMessage({ type: 'ERROR', payload: 'Model not loaded' });
      return;
    }
    await sleep(120);
    const ttfa = performance.now() - start;
    const textLength = payload.text.length;
    const totalMs = Math.max(300, Math.round(textLength * 16));
    await sleep(totalMs);
    postMessage({
      type: 'SYNTH_COMPLETE',
      payload: {
        modelId: loadedModel,
        mode: 'worker+worklet',
        ttfaMs: Math.round(ttfa),
        totalSynthMs: totalMs,
        rtf: Number((Math.max(1, textLength / 18) / (totalMs / 1000)).toFixed(2))
      }
    });
  }
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
