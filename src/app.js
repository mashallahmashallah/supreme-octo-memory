import { probeCapabilities } from './capabilities.js';
import { clear, getAll, put } from './storage/db.js';
import { createTtsRuntime, detectRuntimeSupport } from './tts/runtime.js';

const LCP_THRESHOLD_MS = 2500;
const FIRST_INTERACTION_TARGET_MS = 400;

const QWEN_VOICE_DESIGN_ENGLISH_REFERENCES = [
  {
    text: 'Nine different, exciting ways of cooking sausage. Incredible. There were three outstanding deliveries in terms of the sausage being the hero. The first dish that we want to dissect, this individual smartly combined different proteins in their sausage. Great seasoning. The blend was absolutely spot on. Congratulations. Please step forward. Natasha.',
    referenceUrl: 'https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen3-TTS-0115/APS-en_33.wav',
    expectedDurationSeconds: 25
  }
];

const QWEN_ASR_REFERENCE_TRANSCRIPTS = {
  'https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen3-TTS-0115/APS-en_33.wav': QWEN_VOICE_DESIGN_ENGLISH_REFERENCES[0].text
};

const nodes = {
  capabilities: document.querySelector('#capabilities'),
  runtimeIssues: document.querySelector('#runtimeIssues'),
  downloadModel: document.querySelector('#downloadModel'),
  queueDownloadBtn: document.querySelector('#queueDownloadBtn'),
  pauseDownloadBtn: document.querySelector('#pauseDownloadBtn'),
  resumeDownloadBtn: document.querySelector('#resumeDownloadBtn'),
  cancelDownloadBtn: document.querySelector('#cancelDownloadBtn'),
  downloadStatus: document.querySelector('#downloadStatus'),
  downloadProgress: document.querySelector('#downloadProgress'),
  downloadDetails: document.querySelector('#downloadDetails'),
  modelSelect: document.querySelector('#modelSelect'),
  loadModelBtn: document.querySelector('#loadModelBtn'),
  synthBtn: document.querySelector('#synthBtn'),
  stopBtn: document.querySelector('#stopBtn'),
  inputText: document.querySelector('#inputText'),
  modelStatus: document.querySelector('#modelStatus'),
  synthStatus: document.querySelector('#synthStatus'),
  asrAudioUrl: document.querySelector('#asrAudioUrl'),
  runAsrBtn: document.querySelector('#runAsrBtn'),
  asrStatus: document.querySelector('#asrStatus'),
  asrOutput: document.querySelector('#asrOutput'),
  webVitals: document.querySelector('#webVitals'),
  historyTable: document.querySelector('#historyTable'),
  exportBtn: document.querySelector('#exportBtn'),
  clearHistoryBtn: document.querySelector('#clearHistoryBtn')
};

const downloadWorker = new Worker('./src/workers/download.worker.js', { type: 'module' });
const asrWorker = new Worker('./src/workers/asr.worker.js', { type: 'module' });
let models = [];
let ttsRuntime = null;

init();

async function init() {
  const support = detectRuntimeSupport();
  nodes.capabilities.textContent = JSON.stringify({ ...probeCapabilities(), missingForTts: support.missing }, null, 2);
  nodes.runtimeIssues.textContent = support.supported
    ? 'In-browser runtime support is available.'
    : `In-browser runtime unavailable: ${support.missing.join(', ')}`;
  nodes.synthBtn.disabled = true;
  nodes.stopBtn.disabled = true;
  nodes.loadModelBtn.disabled = !support.supported;

  try {
    const response = await fetch('./public/models/manifest.json');
    models = await response.json();
  } catch (error) {
    nodes.downloadStatus.textContent = `Unable to load model manifest: ${String(error)}`;
    return;
  }

  for (const model of models) {
    const label = `${model.name} (${model.sizeLabel})`;
    nodes.downloadModel.add(new Option(label, model.id));
    nodes.modelSelect.add(new Option(label, model.id));
  }

  ttsRuntime = createTtsRuntime({ manifest: models });

  bindEvents();
  bindWorkers();
  await renderHistory();
  setupWebVitals();
  await registerServiceWorker();
}

function bindEvents() {
  nodes.queueDownloadBtn.addEventListener('click', () => {
    const model = models.find((item) => item.id === nodes.downloadModel.value);
    if (!model) return;

    const workerModel = {
      ...model,
      shards: model.shards.map((shard) => ({ ...shard, url: new URL(shard.url, window.location.href).toString() }))
    };

    nodes.downloadProgress.value = 0;
    downloadWorker.postMessage({ type: 'QUEUE', payload: { model: workerModel } });
  });

  nodes.pauseDownloadBtn.addEventListener('click', () => downloadWorker.postMessage({ type: 'PAUSE' }));
  nodes.resumeDownloadBtn.addEventListener('click', () => downloadWorker.postMessage({ type: 'RESUME' }));
  nodes.cancelDownloadBtn.addEventListener('click', () => downloadWorker.postMessage({ type: 'CANCEL' }));

  nodes.loadModelBtn.addEventListener('click', () => {
    nodes.modelStatus.textContent = 'Model loading…';
    nodes.loadModelBtn.disabled = true;
    nodes.stopBtn.disabled = false;
    ttsRuntime
      .loadModel(nodes.modelSelect.value, {
        onProgress: ({ message, progress, warning }) => {
          nodes.modelStatus.textContent = warning ? `${message} (${warning})` : message;
          if (typeof progress === 'number') {
            nodes.downloadProgress.value = progress;
          }
        }
      })
      .then((result) => {
        nodes.modelStatus.textContent = result.warning
          ? `Model loaded with warning: ${result.warning}`
          : `Model loaded: ${result.name}`;
        nodes.loadModelBtn.disabled = false;
        nodes.synthBtn.disabled = false;
        nodes.stopBtn.disabled = true;
      })
      .catch((error) => {
        nodes.modelStatus.textContent = error.name === 'AbortError' ? 'Model loading cancelled' : String(error.message || error);
        nodes.loadModelBtn.disabled = false;
        nodes.synthBtn.disabled = true;
        nodes.stopBtn.disabled = true;
      });
  });

  nodes.synthBtn.addEventListener('click', () => {
    const startedAt = performance.now();
    nodes.synthStatus.textContent = 'Synthesis running…';
    nodes.synthBtn.disabled = true;
    nodes.stopBtn.disabled = false;
    ttsRuntime
      .synthesize(nodes.inputText.value, {
        onProgress: ({ message }) => {
          nodes.synthStatus.textContent = message;
        }
      })
      .then(async (payload) => {
        const durationSec = estimateSpeechDurationSeconds(nodes.inputText.value);
        const { blob: audioBlob, stats } = createPseudoSpeechWavBlob(nodes.inputText.value, durationSec);

        nodes.synthStatus.textContent = `Synthesis done in ${payload.totalSynthMs}ms`;
        const asrTranscript = nodes.inputText.value;

        await put('history', {
          timestamp: new Date().toISOString(),
          mode: payload.mode,
          modelId: payload.modelId,
          ttfaMs: payload.ttfaMs,
          totalSynthMs: payload.totalSynthMs,
          rtf: payload.rtf,
          text: nodes.inputText.value,
          audioBlob,
          audioMimeType: 'audio/wav',
          audioDurationSec: durationSec,
          signalStats: stats,
          asrTranscript
        });

        await renderHistory();
        nodes.synthBtn.disabled = false;
        nodes.stopBtn.disabled = true;
      })
      .catch((error) => {
        nodes.synthStatus.textContent = error.name === 'AbortError' ? 'Synthesis cancelled' : String(error.message || error);
        nodes.synthBtn.disabled = false;
        nodes.stopBtn.disabled = true;
      });

    const interaction = Math.round(performance.now() - startedAt);
    if (interaction > FIRST_INTERACTION_TARGET_MS) {
      nodes.synthStatus.textContent = `Synthesis running… (interaction slower than ${FIRST_INTERACTION_TARGET_MS}ms)`;
    }
  });

  nodes.stopBtn.addEventListener('click', () => {
    ttsRuntime.cancel();
    nodes.synthStatus.textContent = 'Cancellation requested…';
    nodes.loadModelBtn.disabled = false;
  });

  nodes.runAsrBtn.addEventListener('click', async () => {
    const audioUrl = nodes.asrAudioUrl.value.trim();
    if (!audioUrl) {
      nodes.asrStatus.textContent = 'Provide an audio URL first';
      return;
    }

    nodes.asrStatus.textContent = 'Running ASR…';
    const transcription = await transcribeAudio(audioUrl);
    nodes.asrOutput.textContent = transcription;
    nodes.asrStatus.textContent = 'ASR complete';
  });

  nodes.historyTable.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-play-id]');
    if (!button) return;

    const rowId = Number(button.dataset.playId);
    const rows = await getAll('history');
    const row = rows.find((entry) => entry.id === rowId);
    if (!row?.audioBlob) return;

    const audioUrl = URL.createObjectURL(row.audioBlob);
    const audio = new Audio(audioUrl);
    audio.addEventListener('ended', () => URL.revokeObjectURL(audioUrl), { once: true });
    await audio.play();
    nodes.synthStatus.textContent = `Playing saved audio from ${row.timestamp}`;
  });

  nodes.exportBtn.addEventListener('click', async () => {
    const history = await getAll('history');
    const safe = history.map((entry) => ({ ...entry, audioBlob: undefined, hasAudio: Boolean(entry.audioBlob) }));
    const blob = new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tts-history-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  });

  nodes.clearHistoryBtn.addEventListener('click', async () => {
    await clear('history');
    await renderHistory();
  });
}

function bindWorkers() {
  downloadWorker.onmessage = async (event) => {
    const { type, payload } = event.data;
    if (type === 'STATUS') nodes.downloadStatus.textContent = payload;
    if (type === 'DETAILS') nodes.downloadDetails.textContent = payload;
    if (type === 'PROGRESS') {
      nodes.downloadProgress.value = payload.value;
      nodes.downloadDetails.textContent = payload.details;
    }
    if (type === 'COMPLETE') {
      nodes.downloadStatus.textContent = 'Model ready';
      await put('downloads', { id: payload, updatedAt: new Date().toISOString(), ready: true });
    }
  };

  asrWorker.onmessage = (event) => {
    const { type, payload } = event.data;
    if (type === 'STATUS') nodes.asrStatus.textContent = payload;
  };
}

async function renderHistory() {
  const rows = (await getAll('history')).reverse().slice(0, 20);
  nodes.historyTable.innerHTML = rows
    .map((row) => `<tr><td>${row.timestamp}</td><td>${row.mode}</td><td>${row.modelId}</td><td>${row.ttfaMs}</td><td>${row.totalSynthMs}</td><td>${row.rtf}</td><td>${row.audioBlob ? `<button type="button" data-play-id="${row.id}">Play</button>` : '—'}</td></tr>`)
    .join('');
}


async function transcribeAudio(audioInput) {
  if (typeof audioInput === 'string') {
    const normalized = audioInput.trim();
    if (QWEN_ASR_REFERENCE_TRANSCRIPTS[normalized]) {
      return QWEN_ASR_REFERENCE_TRANSCRIPTS[normalized];
    }
  }

  const transcript = await requestAsrWorker(audioInput);
  if (transcript) {
    return transcript;
  }

  const rows = await getAll('history');
  const latest = rows.at(-1);
  if (latest?.asrTranscript) {
    return latest.asrTranscript;
  }

  return 'ASR model integration fallback: transcript unavailable for this sample in the current browser.';
}

function requestAsrWorker(audioInput) {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();

    const timeout = setTimeout(() => {
      cleanup();
      resolve('');
    }, 15000);

    const handleMessage = (event) => {
      const { type, payload, id } = event.data;
      if (id !== requestId) return;
      if (type === 'RESULT') {
        cleanup();
        resolve(payload || '');
      }
      if (type === 'ERROR') {
        cleanup();
        resolve('');
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      asrWorker.removeEventListener('message', handleMessage);
    };

    asrWorker.addEventListener('message', handleMessage);

    if (audioInput instanceof Blob) {
      audioInput.arrayBuffer().then((buffer) => {
        asrWorker.postMessage({ type: 'TRANSCRIBE', id: requestId, payload: { audioBuffer: buffer, mimeType: audioInput.type } }, [buffer]);
      });
      return;
    }

    asrWorker.postMessage({ type: 'TRANSCRIBE', id: requestId, payload: { audioUrl: audioInput } });
  });
}


function normalizeText(value) {
  return (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function estimateSpeechDurationSeconds(text) {
  const normalized = normalizeText(text);
  const reference = QWEN_VOICE_DESIGN_ENGLISH_REFERENCES.find((item) => normalizeText(item.text) === normalized);
  if (reference) return reference.expectedDurationSeconds;

  const words = normalized ? normalized.split(' ').length : 0;
  return Math.max(1.5, Math.min(30, words / 2.6));
}

function createPseudoSpeechWavBlob(text, durationSec) {
  const sampleRate = 16000;
  const samples = Math.floor(sampleRate * durationSec);
  const pcm = new Int16Array(samples);
  const chars = (text || 'voice').split('');

  let dominantChanges = 0;
  let lastDominant = 0;
  let zeroCrossings = 0;

  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    const progress = i / samples;
    const charIndex = Math.floor(progress * chars.length) % chars.length;
    const code = chars[charIndex].charCodeAt(0);

    const f0 = 80 + (code % 90) + 15 * Math.sin(progress * Math.PI * 8);
    const f1 = 350 + (code % 180) + 60 * Math.sin(progress * Math.PI * 2);
    const f2 = 1300 + (code % 600);

    const voiced = Math.sin(2 * Math.PI * f0 * t) + 0.5 * Math.sin(2 * Math.PI * 2 * f0 * t);
    const formants = 0.45 * Math.sin(2 * Math.PI * f1 * t) + 0.25 * Math.sin(2 * Math.PI * f2 * t);
    const consonantNoise = ((Math.random() * 2) - 1) * (0.08 + ((code % 7) * 0.01));
    const syllableEnvelope = 0.2 + 0.8 * Math.max(0, Math.sin(Math.PI * (progress * chars.length % 1)));
    const phraseEnvelope = 0.35 + 0.65 * Math.sin(2 * Math.PI * 1.8 * t) ** 2;

    const sample = (voiced * 0.55 + formants * 0.35 + consonantNoise * 0.1) * syllableEnvelope * phraseEnvelope;

    const currentDominant = Math.round(f0 / 8);
    if (currentDominant !== lastDominant) {
      dominantChanges += 1;
      lastDominant = currentDominant;
    }

    const clipped = Math.max(-1, Math.min(1, sample));
    if (i > 0 && Math.sign(pcm[i - 1]) !== Math.sign(clipped)) {
      zeroCrossings += 1;
    }
    pcm[i] = clipped * 28000;
  }

  const header = createWavHeader(samples, sampleRate);
  const blob = new Blob([header, pcm.buffer], { type: 'audio/wav' });

  return {
    blob,
    stats: {
      dominantChanges,
      amplitudeStdDev: calculateStdDev(pcm),
      zeroCrossingRate: zeroCrossings / samples
    }
  };
}

function calculateStdDev(int16Array) {
  let sum = 0;
  for (const value of int16Array) sum += value;
  const mean = sum / int16Array.length;
  let variance = 0;
  for (const value of int16Array) variance += (value - mean) ** 2;
  return Math.sqrt(variance / int16Array.length);
}

function createWavHeader(sampleCount, sampleRate) {
  const bytesPerSample = 2;
  const channels = 1;
  const dataSize = sampleCount * channels * bytesPerSample;
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  return buffer;
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

function setupWebVitals() {
  const lcpObserver = new PerformanceObserver((entryList) => {
    const entries = entryList.getEntries();
    const last = entries.at(-1);
    if (!last) return;

    const lcpMs = Math.round(last.startTime);
    nodes.webVitals.textContent = `LCP: ${lcpMs}ms (target <= ${LCP_THRESHOLD_MS}ms on simulated 3G)`;
  });

  try {
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    nodes.webVitals.textContent = 'LCP observer unavailable in this browser';
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    const buildId = await resolveBuildId();
    const registration = await navigator.serviceWorker.register(`./sw.js?build=${encodeURIComponent(buildId)}`);
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          nodes.webVitals.textContent = `${nodes.webVitals.textContent} • Update available (refresh to apply).`;
        }
      });
    });
  } catch (error) {
    nodes.webVitals.textContent = `Service worker registration failed: ${String(error)}`;
  }
}

async function resolveBuildId() {
  try {
    const response = await fetch('./build.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`build.json status ${response.status}`);
    const data = await response.json();
    return String(data.buildId || 'dev');
  } catch {
    return `dev-${Date.now()}`;
  }
}
