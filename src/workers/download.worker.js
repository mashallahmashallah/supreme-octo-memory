let paused = false;
let cancelled = false;
let activeModelId = null;

self.onmessage = async (event) => {
  const { type, payload } = event.data;
  if (type === 'QUEUE') {
    if (activeModelId) {
      postMessage({ type: 'STATUS', payload: 'A download is already running' });
      return;
    }
    paused = false;
    cancelled = false;
    activeModelId = payload.model.id;
    await downloadModel(payload.model);
    activeModelId = null;
    return;
  }

  if (type === 'PAUSE') {
    paused = true;
    postMessage({ type: 'STATUS', payload: 'Paused' });
  }

  if (type === 'RESUME') {
    paused = false;
    postMessage({ type: 'STATUS', payload: 'Resumed' });
  }

  if (type === 'CANCEL') {
    cancelled = true;
    paused = false;
    postMessage({ type: 'STATUS', payload: 'Cancelling…' });
  }
};

async function waitIfPaused() {
  while (paused) {
    if (cancelled) {
      return false;
    }
    await sleep(150);
  }
  return true;
}

async function downloadModel(model) {
  const total = model.shards.length;
  postMessage({ type: 'STATUS', payload: `Downloading ${model.name}...` });

  for (let i = 0; i < total; i += 1) {
    if (cancelled) {
      postMessage({ type: 'STATUS', payload: 'Cancelled' });
      postMessage({ type: 'CANCELLED' });
      return;
    }

    const canContinue = await waitIfPaused();
    if (!canContinue) {
      postMessage({ type: 'STATUS', payload: 'Cancelled' });
      postMessage({ type: 'CANCELLED' });
      return;
    }

    postMessage({ type: 'DETAILS', payload: `Fetching shard ${i + 1}/${total}` });

    try {
      const response = await fetch(model.shards[i].url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      await response.arrayBuffer();
      await sleep(200);
    } catch (error) {
      postMessage({ type: 'STATUS', payload: 'Download error' });
      postMessage({ type: 'ERROR', payload: String(error) });
      return;
    }

    postMessage({
      type: 'PROGRESS',
      payload: {
        value: (i + 1) / total,
        details: `Verified shard ${i + 1}/${total}`
      }
    });
  }

  postMessage({ type: 'COMPLETE', payload: model.id });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
