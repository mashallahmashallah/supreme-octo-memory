import { test, expect } from '@playwright/test';

const LCP_THRESHOLD_MS = 2500;
const INTERACTION_TARGET_MS = 400;
const QWEN_EXAMPLE_TEXT = 'Nine different, exciting ways of cooking sausage. Incredible. There were three outstanding deliveries in terms of the sausage being the hero. The first dish that we want to dissect, this individual smartly combined different proteins in their sausage. Great seasoning. The blend was absolutely spot on. Congratulations. Please step forward. Natasha.';
const QWEN_EXAMPLE_AUDIO_URL = 'https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen3-TTS-0115/APS-en_33.wav';

function normalizeText(value) {
  return (value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function jaccardWordSimilarity(a, b) {
  const left = new Set(normalizeText(a).split(' ').filter(Boolean));
  const right = new Set(normalizeText(b).split(' ').filter(Boolean));
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function readWavDurationFromArrayBuffer(buffer) {
  const view = new DataView(buffer);
  const sampleRate = view.getUint32(24, true);
  const dataSize = view.getUint32(40, true);
  const channels = view.getUint16(22, true);
  const bitsPerSample = view.getUint16(34, true);
  const bytesPerSample = bitsPerSample / 8;
  return dataSize / (sampleRate * channels * bytesPerSample);
}

test('simulated 3G: app remains responsive and LCP threshold is enforced in UI', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  const jsErrors = [];
  page.on('pageerror', (error) => jsErrors.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      jsErrors.push(`console: ${msg.text()}`);
    }
  });

  const client = await context.newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
    connectionType: 'cellular3g'
  });
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  await page.goto('/index.html', { waitUntil: 'load' });

  const lcpText = page.locator('#webVitals');
  await expect(lcpText).toContainText('LCP:', { timeout: 10000 });
  const lcpMs = await page.evaluate(() => {
    const text = document.querySelector('#webVitals')?.textContent || '';
    const matched = text.match(/LCP:\s*(\d+)ms/);
    return matched ? Number(matched[1]) : null;
  });
  expect(lcpMs).not.toBeNull();
  expect(lcpMs).toBeLessThanOrEqual(LCP_THRESHOLD_MS);

  await page.click('#loadModelBtn');
  await expect(page.locator('#modelStatus')).toContainText('Model loaded', { timeout: 8000 });

  await page.fill('#inputText', 'Quick responsiveness check.');
  const start = Date.now();
  await page.click('#synthBtn');
  const clickDuration = Date.now() - start;
  expect(clickDuration).toBeLessThanOrEqual(INTERACTION_TARGET_MS);

  await expect(page.locator('#synthStatus')).toContainText('Synthesis done', { timeout: 6000 });
  expect(jsErrors).toEqual([]);

  await context.close();
});

test('voice design ASR + TTS text similarity and anti-single-tone safeguards', async ({ page, request }) => {
  await page.goto('/index.html', { waitUntil: 'load' });

  // ASR on Qwen example URL should produce similar text
  await page.fill('#asrAudioUrl', QWEN_EXAMPLE_AUDIO_URL);
  await page.click('#runAsrBtn');
  await expect(page.locator('#asrStatus')).toContainText('ASR complete', { timeout: 3000 });
  const asrText = await page.locator('#asrOutput').innerText();
  expect(jaccardWordSimilarity(asrText, QWEN_EXAMPLE_TEXT)).toBeGreaterThan(0.85);

  // TTS should produce duration similar to reference and non-single-tone stats
  let exampleDurationSec = 25;
  try {
    const exampleResponse = await request.get(QWEN_EXAMPLE_AUDIO_URL);
    if (exampleResponse.ok()) {
      exampleDurationSec = readWavDurationFromArrayBuffer(await exampleResponse.body());
    }
  } catch {
    exampleDurationSec = 25;
  }

  await page.click('#loadModelBtn');
  await expect(page.locator('#modelStatus')).toContainText('Model loaded', { timeout: 8000 });
  await page.fill('#inputText', QWEN_EXAMPLE_TEXT);
  await page.click('#synthBtn');
  await expect(page.locator('#synthStatus')).toContainText('Synthesis done', { timeout: 6000 });

  const metrics = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('tts-lab', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction('history', 'readonly');
      const req = tx.objectStore('history').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const latest = rows.at(-1);
    const buffer = await latest.audioBlob.arrayBuffer();
    const view = new DataView(buffer);
    const sampleRate = view.getUint32(24, true);
    const dataSize = view.getUint32(40, true);
    const channels = view.getUint16(22, true);
    const bitsPerSample = view.getUint16(34, true);
    const bytesPerSample = bitsPerSample / 8;
    return {
      durationSec: dataSize / (sampleRate * channels * bytesPerSample),
      asrTranscript: latest.asrTranscript,
      signalStats: latest.signalStats
    };
  });

  expect(Math.abs(metrics.durationSec - exampleDurationSec)).toBeLessThanOrEqual(3.5);
  expect(jaccardWordSimilarity(metrics.asrTranscript, QWEN_EXAMPLE_TEXT)).toBeGreaterThan(0.9);
  expect(metrics.signalStats.dominantChanges).toBeGreaterThan(30);
  expect(metrics.signalStats.amplitudeStdDev).toBeGreaterThan(3000);

  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('button[data-play-id]').first()).toBeVisible();
});
