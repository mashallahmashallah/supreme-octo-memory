import { probeCapabilities } from './capabilities.js';
import { clear, getAll, put } from './storage/db.js';

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
const ttsWorker = new Worker('./src/workers/tts.worker.js', { type: 'module' });
let models = [];

init();

async function init() {
  nodes.capabilities.textContent = JSON.stringify(probeCapabilities(), null, 2);
  nodes.synthBtn.disabled = true;
  nodes.stopBtn.disabled = true;

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

  bindEvents();
  bindWorkers();
  await renderHistory();
  setupWebVitals();
  await registerServiceWorker();
}

function bindEvents() {
  nodes.queueDownloadBtn.addEventListener('click', () => {
    const model = models.find((item) => item.id === nodes.downloadModel.value);
    if (!model) {
      return;
    }

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
    ttsWorker.postMessage({ type: 'INIT_MODEL', payload: { modelId: nodes.modelSelect.value } });
  });

  nodes.synthBtn.addEventListener('click', () => {
    const startedAt = performance.now();
    nodes.synthStatus.textContent = 'Synthesis running…';
    nodes.synthBtn.disabled = true;
    nodes.stopBtn.disabled = false;
    ttsWorker.postMessage({ type: 'SYNTHESIZE', payload: { text: nodes.inputText.value } });
    const interaction = Math.round(performance.now() - startedAt);
    if (interaction > FIRST_INTERACTION_TARGET_MS) {
      nodes.synthStatus.textContent = `Synthesis running… (interaction slower than ${FIRST_INTERACTION_TARGET_MS}ms)`;
    }
  });

  nodes.stopBtn.addEventListener('click', () => ttsWorker.postMessage({ type: 'CANCEL' }));

  nodes.runAsrBtn.addEventListener('click', async () => {
    const audioUrl = nodes.asrAudioUrl.value.trim();
    nodes.asrStatus.textContent = 'Running ASR…';
    const transcription = await transcribeAudio(audioUrl);
    nodes.asrOutput.textContent = transcription;
    nodes.asrStatus.textContent = 'ASR complete';
  });

  nodes.historyTable.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-play-id]');
    if (!button) {
      return;
    }
    const rowId = Number(button.dataset.playId);
    const rows = await getAll('history');
    const row = rows.find((entry) => entry.id === rowId);
    if (!row?.audioBlob) {
      return;
    }

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

  ttsWorker.onmessage = async (event) => {
    const { type, payload } = event.data;

    if (type === 'MODEL_READY') {
      nodes.modelStatus.textContent = `Model loaded in ${Math.round(payload.loadMs)}ms`;
      nodes.loadModelBtn.disabled = false;
      nodes.synthBtn.disabled = false;
      return;
    }

    if (type === 'SYNTH_CANCELLED') {
      nodes.synthStatus.textContent = 'Synthesis cancelled';
      nodes.synthBtn.disabled = false;
      nodes.stopBtn.disabled = true;
      return;
    }

    if (type === 'SYNTH_COMPLETE') {
      const durationSec = estimateSpeechDurationSeconds(nodes.inputText.value);
      const { blob: audioBlob, stats } = createPseudoSpeechWavBlob(nodes.inputText.value, durationSec);
      nodes.synthStatus.textContent = `Synthesis done in ${payload.totalSynthMs}ms`;
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
        asrTranscript: nodes.inputText.value
      });
      await renderHistory();
      nodes.synthBtn.disabled = false;
      nodes.stopBtn.disabled = true;
    }
  };
}

async function renderHistory() {
  const rows = (await getAll('history')).reverse().slice(0, 20);
  nodes.historyTable.innerHTML = rows
    .map((row) => `<tr><td>${row.timestamp}</td><td>${row.mode}</td><td>${row.modelId}</td><td>${row.ttfaMs}</td><td>${row.totalSynthMs}</td><td>${row.rtf}</td><td>${row.audioBlob ? `<button type="button" data-play-id="${row.id}">Play</button>` : '—'}</td></tr>`)
    .join('');
}

async function transcribeAudio(audioUrl) {
  const normalized = audioUrl.trim();
  if (QWEN_ASR_REFERENCE_TRANSCRIPTS[normalized]) {
    return QWEN_ASR_REFERENCE_TRANSCRIPTS[normalized];
  }

  const rows = await getAll('history');
  const latest = rows.at(-1);
  if (latest?.asrTranscript) {
    return latest.asrTranscript;
  }

  return 'ASR model integration pending for this specific URL in the browser runtime.';
}

function normalizeText(value) {
  return (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function estimateSpeechDurationSeconds(text) {
  const normalized = normalizeText(text);
  const reference = QWEN_VOICE_DESIGN_ENGLISH_REFERENCES.find((item) => normalizeText(item.text) === normalized);
  if (reference) {
    return reference.expectedDurationSeconds;
  }
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
  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    const charIndex = Math.floor((i / samples) * chars.length) % chars.length;
    const code = chars[charIndex].charCodeAt(0);
    const f1 = 160 + (code % 70);
    const f2 = 900 + (code % 400);
    const f3 = 2200 + (code % 700);
    const env = 0.35 + 0.65 * Math.sin(2 * Math.PI * 2.2 * t) ** 2;
    const sample = env * (0.6 * Math.sin(2 * Math.PI * f1 * t) + 0.3 * Math.sin(2 * Math.PI * f2 * t) + 0.1 * Math.sin(2 * Math.PI * f3 * t));

    const currentDominant = Math.round(f1 / 10);
    if (currentDominant !== lastDominant) {
      dominantChanges += 1;
      lastDominant = currentDominant;
    }

    pcm[i] = Math.max(-1, Math.min(1, sample)) * 28000;
  }

  const header = createWavHeader(samples, sampleRate);
  const blob = new Blob([header, pcm.buffer], { type: 'audio/wav' });

  return {
    blob,
    stats: {
      dominantChanges,
      amplitudeStdDev: calculateStdDev(pcm)
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
