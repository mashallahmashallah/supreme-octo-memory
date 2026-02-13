let paused = false;
let cancelled = false;

self.onmessage = async (event) => {
  const { type, payload } = event.data;
  if (type === 'QUEUE') {
    paused = false;
    cancelled = false;
    await downloadModel(payload.model);
  } else if (type === 'PAUSE') {
    paused = true;
  } else if (type === 'RESUME') {
    paused = false;
  } else if (type === 'CANCEL') {
    cancelled = true;
  }
};

async function waitIfPaused() {
  while (paused) {
    await sleep(150);
  }
}

async function downloadModel(model) {
  const total = model.shards.length;
  postMessage({ type: 'STATUS', payload: `Downloading ${model.name}...` });

  for (let i = 0; i < total; i += 1) {
    if (cancelled) {
      postMessage({ type: 'STATUS', payload: 'Cancelled' });
      return;
    }
    await waitIfPaused();
    postMessage({ type: 'DETAILS', payload: `Fetching shard ${i + 1}/${total}` });
    const response = await fetch(model.shards[i].url);
    await response.arrayBuffer();
    await sleep(200);
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
