import { test, expect } from '@playwright/test';

const LCP_THRESHOLD_MS = 2500;
const INTERACTION_TARGET_MS = 400;

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
