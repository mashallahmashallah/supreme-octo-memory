const CHUNK_BYTES = 256 * 1024;

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

    const model = payload.model;
    paused = false;
    cancelled = false;
    activeModelId = model.id;

    try {
      await downloadModel(model);
    } finally {
      activeModelId = null;
    }
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
  const state = (await getDownloadState(model.id)) || { completedShards: [] };
  const completed = new Set(state.completedShards || []);

  postMessage({ type: 'STATUS', payload: `Downloading ${model.name}...` });

  for (let i = 0; i < total; i += 1) {
    if (completed.has(i)) {
      postMessage({
        type: 'PROGRESS',
        payload: {
          value: (i + 1) / total,
          details: `Reused cached shard ${i + 1}/${total}`
        }
      });
      continue;
    }

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
      const buffer = await fetchShardWithRange(model.shards[i].url);
      await verifyShardChecksum(model.shards[i], buffer);
      completed.add(i);
      await putDownloadState(model.id, { completedShards: Array.from(completed).sort((a, b) => a - b) });
      await sleep(100);
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

  await clearDownloadState(model.id);
  postMessage({ type: 'COMPLETE', payload: model.id });
}

async function fetchShardWithRange(url) {
  let offset = 0;
  let totalBytes = null;
  const chunks = [];

  while (totalBytes === null || offset < totalBytes) {
    if (cancelled) {
      throw new Error('Cancelled');
    }

    const canContinue = await waitIfPaused();
    if (!canContinue) {
      throw new Error('Cancelled');
    }

    const endByte = offset + CHUNK_BYTES - 1;
    const response = await fetch(url, {
      headers: { Range: `bytes=${offset}-${endByte}` }
    });

    if (!(response.ok || response.status === 206)) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentRange = response.headers.get('content-range');
    const contentLength = Number(response.headers.get('content-length') || 0);

    if (contentRange) {
      const match = contentRange.match(/bytes\s+(\d+)-(\d+)\/(\d+)/i);
      if (match) {
        totalBytes = Number(match[3]);
      }
    } else if (response.status === 200) {
      totalBytes = contentLength;
    }

    const chunk = await response.arrayBuffer();
    chunks.push(chunk);
    offset += chunk.byteLength;

    if (response.status === 200 && totalBytes !== null) {
      break;
    }

    if (chunk.byteLength === 0) {
      break;
    }
  }

  return concatArrayBuffers(chunks);
}

async function verifyShardChecksum(shard, arrayBuffer) {
  if (!shard.sha256 || shard.sha256 === 'dev') {
    return;
  }

  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  if (hex !== shard.sha256.toLowerCase()) {
    throw new Error(`Checksum mismatch for ${shard.url}`);
  }
}

function concatArrayBuffers(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openStateDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('tts-download-state', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('states')) {
        db.createObjectStore('states', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getDownloadState(id) {
  const db = await openStateDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('states', 'readonly');
    const req = tx.objectStore('states').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putDownloadState(id, value) {
  const db = await openStateDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('states', 'readwrite');
    tx.objectStore('states').put({ id, ...value, updatedAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function clearDownloadState(id) {
  const db = await openStateDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('states', 'readwrite');
    tx.objectStore('states').delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
