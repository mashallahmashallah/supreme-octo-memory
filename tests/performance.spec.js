import { test, expect } from '@playwright/test';

const LCP_THRESHOLD_MS = 2500;
const INTERACTION_TARGET_MS = 400;
const QWEN_EXAMPLE_TEXT = 'Nine different, exciting ways of cooking sausage. Incredible. There were three outstanding deliveries in terms of the sausage being the hero. The first dish that we want to dissect, this individual smartly combined different proteins in their sausage. Great seasoning. The blend was absolutely spot on. Congratulations. Please step forward. Natasha.';
const QWEN_EXAMPLE_AUDIO_URL = 'https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen3-TTS-0115/APS-en_33.wav';

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
  await expect(page.locator('#modelStatus')).toContainText('Model loaded', { timeout: 3000 });

  const start = Date.now();
  await page.click('#synthBtn');
  const clickDuration = Date.now() - start;
  expect(clickDuration).toBeLessThanOrEqual(INTERACTION_TARGET_MS);

  await expect(page.locator('#synthStatus')).toContainText('Synthesis done', { timeout: 6000 });
  expect(jsErrors).toEqual([]);

  await context.close();
});

test('synthesis can be cancelled without JS errors', async ({ page }) => {
  const jsErrors = [];
  page.on('pageerror', (error) => jsErrors.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      jsErrors.push(`console: ${msg.text()}`);
    }
  });

  await page.goto('/index.html', { waitUntil: 'load' });
  await page.click('#loadModelBtn');
  await expect(page.locator('#modelStatus')).toContainText('Model loaded', { timeout: 3000 });

  await page.fill('#inputText', 'This text is intentionally longer to allow cancellation before completion. '.repeat(40));
  await page.click('#synthBtn');
  await page.click('#stopBtn');

  await expect(page.locator('#synthStatus')).toContainText('cancelled', { timeout: 2000 });
  await expect(page.locator('#synthBtn')).toBeEnabled();
  await expect(page.locator('#stopBtn')).toBeDisabled();
  expect(jsErrors).toEqual([]);
});

test('downloads can pause resume and complete without JS errors', async ({ page }) => {
  const jsErrors = [];
  page.on('pageerror', (error) => jsErrors.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      jsErrors.push(`console: ${msg.text()}`);
    }
  });

  await page.goto('/index.html', { waitUntil: 'load' });
  await page.click('#queueDownloadBtn');
  await page.click('#pauseDownloadBtn');
  await expect(page.locator('#downloadStatus')).toContainText('Paused');
  await page.click('#resumeDownloadBtn');

  await expect(page.locator('#downloadStatus')).toContainText('Model ready', { timeout: 6000 });
  const progress = await page.locator('#downloadProgress').evaluate((element) => Number(element.value));
  expect(progress).toBeGreaterThanOrEqual(1);
  expect(jsErrors).toEqual([]);
});

test('voice design example duration is close to Qwen reference and persists after refresh', async ({ page, request }) => {
  const jsErrors = [];
  page.on('pageerror', (error) => jsErrors.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      jsErrors.push(`console: ${msg.text()}`);
    }
  });

  let exampleDurationSec = 25;
  try {
    const exampleResponse = await request.get(QWEN_EXAMPLE_AUDIO_URL);
    if (exampleResponse.ok()) {
      exampleDurationSec = readWavDurationFromArrayBuffer(await exampleResponse.body());
    }
  } catch {
    exampleDurationSec = 25;
  }

  await page.goto('/index.html', { waitUntil: 'load' });
  await page.click('#loadModelBtn');
  await expect(page.locator('#modelStatus')).toContainText('Model loaded', { timeout: 3000 });

  await page.fill('#inputText', QWEN_EXAMPLE_TEXT);
  await page.click('#synthBtn');
  await expect(page.locator('#synthStatus')).toContainText('Synthesis done', { timeout: 6000 });

  const generatedDurationSec = await page.evaluate(async () => {
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
    return dataSize / (sampleRate * channels * bytesPerSample);
  });

  expect(Math.abs(generatedDurationSec - exampleDurationSec)).toBeLessThanOrEqual(3.5);

  await page.reload({ waitUntil: 'load' });
  const playButton = page.locator('button[data-play-id]').first();
  await expect(playButton).toBeVisible();
  await playButton.click();
  await expect(page.locator('#synthStatus')).toContainText('Playing saved audio', { timeout: 2000 });
  expect(jsErrors).toEqual([]);
});
