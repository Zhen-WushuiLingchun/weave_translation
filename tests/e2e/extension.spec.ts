import { chromium, expect, test } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const fixture = `<!doctype html><html lang="en"><head><title>Field Notes</title><style>
body{margin:0;background:#f5f0e8;color:#172027;font:18px/1.75 Georgia,serif}
main{max-width:760px;margin:70px auto;padding:0 34px}h1{font-size:54px;line-height:1.05}p{margin:28px 0}
</style></head><body><main><h1>Field notes on contextual translation</h1>
<p>A word rarely travels alone. Its heading, neighboring sentence, and the subject of the article all shape the right translation.</p>
<h2>Working method</h2><p>Weave keeps the source intact, adds a separate translation layer, and lets the reader return to the original at any time.</p>
</main></body></html>`;

test('loads the unpacked extension and translates a real page through a mock provider', async () => {
  test.skip(process.env.WEAVE_E2E !== '1', 'Set WEAVE_E2E=1 to run the Chrome extension smoke test.');
  const extensionPath = path.resolve('.output/chrome-mv3');
  const manifestPath = path.join(extensionPath, 'manifest.json');
  const originalManifest = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(originalManifest) as { host_permissions?: string[] };
  manifest.host_permissions = ['http://*/*', 'https://*/*'];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  const installedRoot = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  const chromiumDirectory = fs.readdirSync(installedRoot).filter((name) => /^chromium-\d+$/.test(name)).sort().at(-1);
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? path.join(installedRoot, chromiumDirectory ?? '', 'chrome-win64', 'chrome.exe');
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-e2e-'));
  const visualDirectory = process.env.WEAVE_VISUAL_DIR;
  if (visualDirectory) fs.mkdirSync(visualDirectory, { recursive: true });

  let requestCount = 0;
  const server = http.createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      let raw = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { raw += chunk; });
      request.on('end', () => {
        requestCount += 1;
        const payload = JSON.parse(raw) as { messages: Array<{ role: string; content: string }> };
        const task = JSON.parse(payload.messages.find((message) => message.role === 'user')?.content ?? '{}') as {
          task?: string;
          units?: Array<{ id: string; text: string }>;
        };
        const content = task.task === 'summary'
          ? JSON.stringify({ summary: 'An article about context-aware translation.', terms: [] })
          : JSON.stringify({ items: (task.units ?? []).map((unit) => ({ id: unit.id, text: `译文：${unit.text}` })) });
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(fixture);
  });

  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server did not start.');

    context = await chromium.launchPersistentContext(profileDirectory, {
      headless: false,
      executablePath,
      viewport: { width: 1440, height: 900 },
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const serviceWorker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

    await page.goto(`chrome-extension://${extensionId}/onboarding.html`);
    await expect(page.getByRole('heading', { name: /让译文理解/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /启用所有网页侧边坞|全站侧边坞已启用/ })).toBeVisible();
    if (visualDirectory) await page.screenshot({ path: path.join(visualDirectory, 'weave-onboarding.png'), fullPage: true });

    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(page.getByRole('heading', { name: '模型服务' })).toBeVisible();
    await expect(page.getByText('Chat Completions 完整地址')).toBeVisible();
    await page.evaluate(async (endpoint) => {
      const runtime = (globalThis as unknown as {
        chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
      }).chrome.runtime;
      await runtime.sendMessage({
        type: 'SAVE_SETTINGS',
        patch: {
          provider: {
            id: 'e2e-mock', label: 'E2E Mock', kind: 'openai-compatible', endpoint,
            model: 'mock-translator', targetLanguage: 'zh-CN', keyPersistence: 'session', hasApiKey: false,
          },
        },
      });
    }, `http://127.0.0.1:${address.port}/v1/chat/completions`);
    if (visualDirectory) await page.screenshot({ path: path.join(visualDirectory, 'weave-options.png'), fullPage: true });

    await page.goto(`http://127.0.0.1:${address.port}/article`);
    const grip = page.getByRole('button', { name: '拖动或展开织语' });
    await expect(grip).toBeVisible({ timeout: 10_000 });
    await grip.hover();
    const translateButton = page.getByRole('button', { name: /翻译本页/ });
    await expect(translateButton).toBeVisible();
    await translateButton.click();
    await expect(page.locator('[data-weave-translation]').first()).toContainText('译文：', { timeout: 15_000 });
    expect(requestCount).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(consoleErrors).toEqual([]);
    if (visualDirectory) await page.screenshot({ path: path.join(visualDirectory, 'weave-dock.png'), fullPage: false });
  } finally {
    if (context) await context.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.writeFileSync(manifestPath, originalManifest);
  }
});
