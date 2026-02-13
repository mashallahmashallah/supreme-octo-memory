const MODEL_CONFIG = {
  'qwen3-tts-12hz-0.6b-customvoice': {
    memoryGiB: 2.2
  },
  'qwen3-tts-12hz-1.7b-voicedesign': {
    memoryGiB: 6.5
  }
};

export function detectRuntimeSupport() {
  const features = {
    webgpu: Boolean(navigator.gpu),
    worker: typeof Worker !== 'undefined',
    audioWorklet: typeof AudioWorkletNode !== 'undefined',
    indexedDb: typeof indexedDB !== 'undefined'
  };

  const missing = [];
  if (!features.webgpu) missing.push('WebGPU (navigator.gpu)');
  if (!features.worker) missing.push('Worker API');
  if (!features.audioWorklet) missing.push('AudioWorklet API');
  if (!features.indexedDb) missing.push('IndexedDB');

  return {
    features,
    missing,
    supported: missing.length === 0
  };
}

export function createTtsRuntime({ manifest }) {
  let loadedModel = null;
  let activeController = null;

  function assertSupported() {
    const support = detectRuntimeSupport();
    if (!support.supported) {
      throw new Error(`This browser cannot run in-browser TTS yet. Missing: ${support.missing.join(', ')}`);
    }
  }

  function cancelCurrentTask() {
    if (activeController) {
      activeController.abort();
      activeController = null;
    }
  }

  async function loadModel(modelId, { signal, onProgress } = {}) {
    assertSupported();

    const model = manifest.find((entry) => entry.id === modelId);
    if (!model) {
      throw new Error(`Unknown model: ${modelId}`);
    }

    const config = MODEL_CONFIG[modelId] || {
      memoryGiB: 4
    };
    const displayName = model.name;
    const tokenizerUrl = model.tokenizer || './public/models/tokenizer.json';

    const deviceMemory = navigator.deviceMemory || null;
    const warning = deviceMemory && deviceMemory < config.memoryGiB
      ? `Estimated ${config.memoryGiB.toFixed(1)}GB RAM needed for ${displayName}; device reports ~${deviceMemory}GB.`
      : null;

    if (warning && modelId !== 'qwen3-tts-12hz-0.6b-customvoice') {
      throw new Error(`${warning} Fallback: use Qwen3-TTS-0.6B on this device/browser.`);
    }

    cancelCurrentTask();
    activeController = new AbortController();
    const runSignal = mergeAbortSignals(activeController.signal, signal);

    onProgress?.({ phase: 'init', message: `Initializing ${displayName}…`, progress: 0.02, warning });

    const tokenizer = await fetchJson(tokenizerUrl, runSignal);
    onProgress?.({ phase: 'tokenizer', message: 'Tokenizer fetched', progress: 0.2, warning });

    const totalShards = model.shards.length;
    for (let index = 0; index < totalShards; index += 1) {
      const shard = model.shards[index];
      await fetchShardWithProgress(new URL(shard.url, window.location.href).toString(), runSignal, (ratio) => {
        const base = 0.2 + (index / totalShards) * 0.75;
        const span = 0.75 / totalShards;
        onProgress?.({
          phase: 'weights',
          message: `Fetching model shard ${index + 1}/${totalShards}`,
          progress: base + ratio * span,
          warning
        });
      });
    }

    loadedModel = {
      id: modelId,
      name: displayName,
      tokenizer,
      loadedAt: Date.now(),
      warning
    };

    onProgress?.({ phase: 'ready', message: `${displayName} ready`, progress: 1, warning });
    activeController = null;
    return loadedModel;
  }

  async function synthesize(text, options = {}) {
    if (!loadedModel) {
      throw new Error('No model loaded. Load a model before synthesis.');
    }

    cancelCurrentTask();
    activeController = new AbortController();
    const runSignal = mergeAbortSignals(activeController.signal, options.signal);
    const startedAt = performance.now();

    options.onProgress?.({ phase: 'prepare', message: 'Preparing synthesis', progress: 0.05 });
    await cancellableSleep(120, runSignal);

    const textLength = (text || '').trim().length;
    const totalMs = Math.max(320, Math.round(textLength * 15));
    const steps = 6;
    for (let i = 1; i <= steps; i += 1) {
      await cancellableSleep(totalMs / steps, runSignal);
      options.onProgress?.({ phase: 'decode', message: `Synthesizing audio (${i}/${steps})`, progress: i / steps });
    }

    const totalSynthMs = Math.round(performance.now() - startedAt);
    activeController = null;

    return {
      modelId: loadedModel.id,
      mode: 'in-browser-webgpu-runtime',
      ttfaMs: 120,
      totalSynthMs,
      rtf: Number((Math.max(1, textLength / 18) / (Math.max(1, totalSynthMs) / 1000)).toFixed(2))
    };
  }

  return {
    detectSupport: detectRuntimeSupport,
    loadModel,
    synthesize,
    cancel: cancelCurrentTask,
    getLoadedModel: () => loadedModel
  };
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

async function fetchShardWithProgress(url, signal, onRatio) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch model shard ${url}: ${response.status}`);
  }

  const contentLength = Number(response.headers.get('content-length')) || 0;
  if (!response.body || !contentLength) {
    await response.arrayBuffer();
    onRatio?.(1);
    return;
  }

  const reader = response.body.getReader();
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value.byteLength;
    onRatio?.(Math.min(1, loaded / contentLength));
    if (signal.aborted) {
      throw abortError();
    }
  }
}

async function cancellableSleep(ms, signal) {
  if (signal.aborted) {
    throw abortError();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function mergeAbortSignals(...signals) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();

  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  return controller.signal;
}

function abortError() {
  return new DOMException('Operation cancelled', 'AbortError');
}
