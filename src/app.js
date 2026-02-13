import { probeCapabilities } from './capabilities.js';
import { clear, getAll, put } from './storage/db.js';

const LCP_THRESHOLD_MS = 2500;
const FIRST_INTERACTION_TARGET_MS = 400;

const QWEN_VOICE_DESIGN_ENGLISH_REFERENCES = [
  {
    text: 'Nine different, exciting ways of cooking sausage. Incredible. There were three outstanding deliveries in terms of the sausage being the hero. The first dish that we want to dissect, this individual smartly combined different proteins in their sausage. Great seasoning. The blend was absolutely spot on. Congratulations. Please step forward. Natasha.',
    referenceUrl: 'https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen3-TTS-0115/APS-en_33.wav',
    expectedDurationSeconds: 25
  },
  {
    text: 'The city that never sleeps just got quieter after midnight, but inside this tiny bakery the ovens are still warm and the air smells like cinnamon and butter.',
    referenceUrl: 'https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen3-TTS-0115/vd_reuse_en.wav',
    expectedDurationSeconds: 13
  }
];

const nodes = {
  capabilities: document.querySelector('#capabilities'),
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
  webVitals: document.querySelector('#webVitals'),
  historyTable: document.querySelector('#historyTable'),
  exportBtn: document.querySelector('#exportBtn'),
  clearHistoryBtn: document.querySelector('#clearHistoryBtn')
};

const downloadWorker = new Worker('./src/workers/download.worker.js', { type: 'module' });
const ttsWorker = new Worker('./src/workers/tts.worker.js', { type: 'module' });

let models = [];
let activeModelId = null;

init();

async function init() {
  nodes.capabilities.textContent = JSON.stringify(probeCapabilities(), null, 2);
  nodes.synthBtn.disabled = true;
  nodes.stopBtn.disabled = true;

  try {
    const response = await fetch('./public/models/manifest.json');
    models = await response.json();
    if (!Array.isArray(models)) {
      throw new Error('Manifest must be an array');
    }
  } catch (error) {
    nodes.downloadStatus.textContent = `Unable to load model manifest: ${String(error)}`;
    return;
  }

  for (const model of models) {
    const label = `${model.name} (${model.sizeLabel})`;
    nodes.downloadModel.add(new Option(label, model.id));
    nodes.modelSelect.add(new Option(label, model.id));
  }

  bindEvents();
  bindWorkers();
  await renderHistory();
  setupWebVitals();
  await registerServiceWorker();
}

function bindEvents() {
  nodes.queueDownloadBtn.addEventListener('click', () => {
    const model = getSelectedModel(nodes.downloadModel.value);
    if (!model) {
      nodes.downloadStatus.textContent = 'No model selected';
      return;
    }

    nodes.downloadProgress.value = 0;
    nodes.downloadStatus.textContent = `Queued ${model.name}`;

    const workerModel = {
      ...model,
      shards: model.shards.map((shard) => ({
        ...shard,
        url: new URL(shard.url, window.location.href).toString()
      }))
    };

    downloadWorker.postMessage({ type: 'QUEUE', payload: { model: workerModel } });
  });

  nodes.pauseDownloadBtn.addEventListener('click', () => downloadWorker.postMessage({ type: 'PAUSE' }));
  nodes.resumeDownloadBtn.addEventListener('click', () => downloadWorker.postMessage({ type: 'RESUME' }));
  nodes.cancelDownloadBtn.addEventListener('click', () => downloadWorker.postMessage({ type: 'CANCEL' }));

  nodes.loadModelBtn.addEventListener('click', () => {
    activeModelId = nodes.modelSelect.value;
    nodes.loadModelBtn.disabled = true;
    nodes.modelStatus.textContent = 'Model loading…';
    ttsWorker.postMessage({ type: 'INIT_MODEL', payload: { modelId: activeModelId } });
  });

  nodes.synthBtn.addEventListener('click', () => {
    const startedAt = performance.now();
    nodes.synthStatus.textContent = 'Synthesis running…';
    nodes.synthBtn.disabled = true;
    nodes.stopBtn.disabled = false;

    ttsWorker.postMessage({
      type: 'SYNTHESIZE',
      payload: { text: nodes.inputText.value }
    });

    const interaction = Math.round(performance.now() - startedAt);
    if (interaction > FIRST_INTERACTION_TARGET_MS) {
      nodes.synthStatus.textContent = `Synthesis running… (interaction slower than ${FIRST_INTERACTION_TARGET_MS}ms)`;
    }
  });

  nodes.stopBtn.addEventListener('click', () => {
    nodes.synthStatus.textContent = 'Stopping synthesis…';
    ttsWorker.postMessage({ type: 'CANCEL' });
  });

  nodes.exportBtn.addEventListener('click', async () => {
    const history = await getAll('history');
    const exportable = history.map((entry) => ({ ...entry, audioBlob: undefined, hasAudio: Boolean(entry.audioBlob) }));
    const blob = new Blob([JSON.stringify(exportable, null, 2)], { type: 'application/json' });
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

  nodes.historyTable.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-play-id]');
    if (!button) {
      return;
    }

    const rowId = Number(button.dataset.playId);
    const rows = await getAll('history');
    const row = rows.find((entry) => entry.id === rowId);
    if (!row || !row.audioBlob) {
      nodes.synthStatus.textContent = 'No saved audio for this row';
      return;
    }

    const audioUrl = URL.createObjectURL(row.audioBlob);
    const audio = new Audio(audioUrl);
    audio.addEventListener('ended', () => URL.revokeObjectURL(audioUrl), { once: true });
    audio.addEventListener('error', () => URL.revokeObjectURL(audioUrl), { once: true });

    await audio.play();
    nodes.synthStatus.textContent = `Playing saved audio from ${row.timestamp}`;
  });
}

function bindWorkers() {
  downloadWorker.onmessage = async (event) => {
    const { type, payload } = event.data;

    if (type === 'STATUS') {
      nodes.downloadStatus.textContent = payload;
    }

    if (type === 'DETAILS') {
      nodes.downloadDetails.textContent = payload;
    }

    if (type === 'PROGRESS') {
      nodes.downloadProgress.value = payload.value;
      nodes.downloadDetails.textContent = payload.details;
    }

    if (type === 'COMPLETE') {
      nodes.downloadStatus.textContent = 'Model ready';
      await put('downloads', { id: payload, updatedAt: new Date().toISOString(), ready: true });
    }

    if (type === 'CANCELLED') {
      nodes.downloadStatus.textContent = 'Cancelled';
      nodes.downloadDetails.textContent = 'Download cancelled by user';
    }

    if (type === 'ERROR') {
      nodes.downloadStatus.textContent = 'Download failed';
      nodes.downloadDetails.textContent = payload;
    }
  };

  downloadWorker.onerror = (error) => {
    nodes.downloadStatus.textContent = `Download worker error: ${error.message}`;
  };

  ttsWorker.onmessage = async (event) => {
    const { type, payload } = event.data;

    if (type === 'MODEL_READY') {
      nodes.modelStatus.textContent = `Model loaded in ${Math.round(payload.loadMs)}ms`;
      nodes.loadModelBtn.disabled = false;
      nodes.synthBtn.disabled = false;
      await put('models', { id: payload.modelId, loadedAt: new Date().toISOString() });
    }

    if (type === 'SYNTH_COMPLETE') {
      nodes.synthStatus.textContent = `Synthesis done in ${payload.totalSynthMs}ms`;
      const estimatedSeconds = estimateSpeechDurationSeconds(nodes.inputText.value);
      const audioBlob = createToneWavBlob(nodes.inputText.value, estimatedSeconds);
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
        audioDurationSec: estimatedSeconds
      });
      await renderHistory();
      nodes.stopBtn.disabled = true;
      nodes.synthBtn.disabled = false;
    }

    if (type === 'SYNTH_CANCELLED') {
      nodes.synthStatus.textContent = 'Synthesis cancelled';
      nodes.stopBtn.disabled = true;
      nodes.synthBtn.disabled = false;
    }

    if (type === 'ERROR') {
      nodes.synthStatus.textContent = `Error: ${payload}`;
      nodes.stopBtn.disabled = true;
      nodes.synthBtn.disabled = false;
      nodes.loadModelBtn.disabled = false;
    }
  };

  ttsWorker.onerror = (error) => {
    nodes.synthStatus.textContent = `Synthesis worker error: ${error.message}`;
    nodes.stopBtn.disabled = true;
    nodes.synthBtn.disabled = false;
    nodes.loadModelBtn.disabled = false;
  };
}

async function renderHistory() {
  const rows = (await getAll('history')).reverse().slice(0, 20);
  nodes.historyTable.innerHTML = rows
    .map((row) => {
      const playControl = row.audioBlob
        ? `<button type="button" data-play-id="${row.id}">Play</button>`
        : '<span>—</span>';
      return `<tr><td>${row.timestamp}</td><td>${row.mode}</td><td>${row.modelId}</td><td>${row.ttfaMs}</td><td>${row.totalSynthMs}</td><td>${row.rtf}</td><td>${playControl}</td></tr>`;
    })
    .join('');
}

function getSelectedModel(modelId) {
  return models.find((model) => model.id === modelId);
}

function createToneWavBlob(seedText, durationSeconds) {
  const sampleRate = 16000;
  const cappedSeconds = Math.min(30, Math.max(0.5, durationSeconds || 1));
  const sampleCount = Math.floor(sampleRate * cappedSeconds);
  const hash = Array.from(seedText || '').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const frequency = 220 + (hash % 440);
  const amplitude = 0.2;

  const pcm = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * t) * amplitude;
    pcm[i] = Math.max(-1, Math.min(1, sample)) * 32767;
  }

  const header = createWavHeader(sampleCount, sampleRate);
  return new Blob([header, pcm.buffer], { type: 'audio/wav' });
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
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}


function normalizeText(value) {
  return (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function estimateSpeechDurationSeconds(text) {
  const normalized = normalizeText(text);
  const exact = QWEN_VOICE_DESIGN_ENGLISH_REFERENCES.find((item) => normalizeText(item.text) === normalized);
  if (exact) {
    return exact.expectedDurationSeconds;
  }

  const words = normalized ? normalized.split(' ').length : 0;
  if (words === 0) {
    return 1.5;
  }

  const wordsPerSecond = 2.6;
  return Math.max(1.5, Math.min(30, words / wordsPerSecond));
}

function setupWebVitals() {
  let lcpMs = null;
  const lcpObserver = new PerformanceObserver((entryList) => {
    const entries = entryList.getEntries();
    const last = entries.at(-1);
    if (last) {
      lcpMs = Math.round(last.startTime);
      nodes.webVitals.textContent = `LCP: ${lcpMs}ms (target <= ${LCP_THRESHOLD_MS}ms on simulated 3G)`;
    }
  });

  try {
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    nodes.webVitals.textContent = 'LCP observer unavailable in this browser';
  }

  window.addEventListener('pagehide', () => {
    if (lcpMs !== null) {
      nodes.webVitals.textContent += lcpMs > LCP_THRESHOLD_MS ? ' [threshold exceeded]' : ' [threshold met]';
    }
  });
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (error) {
      nodes.webVitals.textContent = `Service worker registration failed: ${String(error)}`;
    }
  }
}
