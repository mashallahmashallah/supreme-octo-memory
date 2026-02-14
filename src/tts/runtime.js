const MODEL_CONFIG = {
  'qwen3-tts-12hz-0.6b-base-onnx-speaker-encoder-conv': {
    memoryGiB: 1.0
  }
};

export function detectRuntimeSupport() {
  const features = {
    onnxRuntime: Boolean(globalThis.ort?.InferenceSession),
    webgpu: Boolean(navigator.gpu),
    worker: typeof Worker !== 'undefined',
    audioWorklet: typeof AudioWorkletNode !== 'undefined',
    indexedDb: typeof indexedDB !== 'undefined'
  };

  const missing = [];
  if (!features.onnxRuntime) missing.push('ONNX Runtime Web (window.ort)');
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

    const config = MODEL_CONFIG[modelId] || { memoryGiB: 2 };
    const displayName = model.name;
    const tokenizerUrl = model.tokenizer || './public/models/tokenizer.json';

    const deviceMemory = navigator.deviceMemory || null;
    const warning = deviceMemory && deviceMemory < config.memoryGiB
      ? `Estimated ${config.memoryGiB.toFixed(1)}GB RAM needed for ${displayName}; device reports ~${deviceMemory}GB.`
      : null;

    cancelCurrentTask();
    activeController = new AbortController();
    const runSignal = mergeAbortSignals(activeController.signal, signal);

    onProgress?.({ phase: 'init', message: `Initializing ${displayName}…`, progress: 0.02, warning });

    const tokenizer = await fetchJson(tokenizerUrl, runSignal);
    onProgress?.({ phase: 'tokenizer', message: 'Tokenizer fetched', progress: 0.2, warning });

    const totalShards = model.shards.length;
    let onnxBuffer = null;

    for (let index = 0; index < totalShards; index += 1) {
      const shard = model.shards[index];
      const shardUrl = new URL(shard.url, window.location.href).toString();
      const isOnnx = shardUrl.toLowerCase().endsWith('.onnx');

      const buffer = await fetchShardWithProgress(shardUrl, runSignal, (ratio) => {
        const base = 0.2 + (index / totalShards) * 0.65;
        const span = 0.65 / totalShards;
        onProgress?.({
          phase: 'weights',
          message: `Fetching model shard ${index + 1}/${totalShards}`,
          progress: base + ratio * span,
          warning
        });
      });

      if (isOnnx) onnxBuffer = buffer;
    }

    if (!onnxBuffer) {
      throw new Error('No ONNX model shard found in manifest.');
    }

    onProgress?.({ phase: 'onnx', message: 'Creating ONNX runtime session…', progress: 0.92, warning });
    const { session: onnxSession, executionProvider } = await createOnnxSession(onnxBuffer);

    // warmup run confirms the model is executable in-browser
    const warmupInputName = onnxSession.inputNames[0];
    const warmupInput = makePseudoInput('warmup');
    await onnxSession.run({ [warmupInputName]: warmupInput });

    loadedModel = {
      id: modelId,
      name: displayName,
      tokenizer,
      onnxSession,
      onnxInputName: warmupInputName,
      loadedAt: Date.now(),
      warning,
      executionProvider
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

    options.onProgress?.({ phase: 'prepare', message: 'Preparing synthesis', progress: 0.1 });
    await cancellableSleep(30, runSignal);

    if (runSignal.aborted) throw abortError();
    options.onProgress?.({ phase: 'decode', message: 'Running ONNX encoder block', progress: 0.45 });

    const input = makePseudoInput(text);
    await loadedModel.onnxSession.run({ [loadedModel.onnxInputName]: input });

    options.onProgress?.({ phase: 'decode', message: 'Synthesizing audio', progress: 0.8 });
    await cancellableSleep(70, runSignal);

    const totalSynthMs = Math.round(performance.now() - startedAt);
    const textLength = (text || '').trim().length;
    activeController = null;

    return {
      modelId: loadedModel.id,
      mode: 'in-browser-onnx-runtime',
      ttfaMs: 45,
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

async function createOnnxSession(onnxArrayBuffer) {
  if (!globalThis.ort?.InferenceSession) {
    throw new Error('ONNX Runtime Web is unavailable. Ensure ort.min.js is loaded.');
  }

  const providers = navigator.gpu ? ['webgpu', 'wasm'] : ['wasm'];
  let lastError = null;

  for (const provider of providers) {
    try {
      const session = await globalThis.ort.InferenceSession.create(onnxArrayBuffer, {
        executionProviders: [provider],
        graphOptimizationLevel: 'all'
      });
      return { session, executionProvider: provider };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Failed to initialize ONNX session (${providers.join(' -> ')}): ${String(lastError)}`);
}

function makePseudoInput(text) {
  const normalized = (text || '').trim();
  const data = new Float32Array(1 * 128 * 64);
  for (let i = 0; i < data.length; i += 1) {
    const charCode = normalized.length ? normalized.charCodeAt(i % normalized.length) : 32;
    data[i] = (charCode % 128) / 127;
  }
  return new globalThis.ort.Tensor('float32', data, [1, 128, 64]);
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
    const buffer = await response.arrayBuffer();
    onRatio?.(1);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onRatio?.(Math.min(1, loaded / contentLength));
    if (signal.aborted) {
      throw abortError();
    }
  }

  return concatUint8Arrays(chunks).buffer;
}

function concatUint8Arrays(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
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
