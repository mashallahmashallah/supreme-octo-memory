let loadedModel = null;
let activeSynthesisToken = 0;

self.onmessage = async (event) => {
  const { type, payload } = event.data;

  if (type === 'INIT_MODEL') {
    const start = performance.now();
    await sleep(350);
    loadedModel = payload.modelId;
    postMessage({ type: 'MODEL_READY', payload: { modelId: loadedModel, loadMs: performance.now() - start } });
  }

  if (type === 'CANCEL') {
    activeSynthesisToken += 1;
    postMessage({ type: 'SYNTH_CANCELLED' });
  }

  if (type === 'SYNTHESIZE') {
    if (!loadedModel) {
      postMessage({ type: 'ERROR', payload: 'Model not loaded' });
      return;
    }

    const runToken = ++activeSynthesisToken;
    const start = performance.now();

    await cancellableSleep(120, runToken);
    if (runToken !== activeSynthesisToken) {
      return;
    }

    const ttfa = performance.now() - start;
    const textLength = (payload.text || '').length;
    const totalMs = Math.max(300, Math.round(textLength * 16));
    await cancellableSleep(totalMs, runToken);

    if (runToken !== activeSynthesisToken) {
      return;
    }

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

async function cancellableSleep(ms, runToken) {
  const chunkMs = 50;
  const endAt = performance.now() + ms;
  while (performance.now() < endAt) {
    if (runToken !== activeSynthesisToken) {
      return;
    }
    await sleep(Math.min(chunkMs, endAt - performance.now()));
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
