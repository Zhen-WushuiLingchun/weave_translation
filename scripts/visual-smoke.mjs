import { chromium } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const builtExtensionPath = path.resolve('.output/chrome-mv3');
console.log(JSON.stringify({ step: 'prepare', builtExtensionPath }));
const installedRoot = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
const chromiumDirectory = fs.readdirSync(installedRoot).filter((name) => /^chromium-\d+$/.test(name)).sort().at(-1);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? path.join(installedRoot, chromiumDirectory ?? '', 'chrome-win64', 'chrome.exe');
const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-profile-'));
const extensionDirectory = builtExtensionPath;
console.log(JSON.stringify({ step: 'profile', profileDirectory, extensionDirectory }));
const manifestPath = path.join(extensionDirectory, 'manifest.json');
const originalManifest = fs.readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(originalManifest);
manifest.host_permissions = ['http://*/*', 'https://*/*'];
fs.writeFileSync(manifestPath, JSON.stringify(manifest));

const visualDirectory = process.env.WEAVE_VISUAL_DIR ?? path.resolve('test-results/visual');
fs.mkdirSync(visualDirectory, { recursive: true });
console.log(JSON.stringify({ step: 'launch', executablePath, extensionDirectory }));

let context;
try {
  context = await chromium.launchPersistentContext(profileDirectory, {
    headless: false,
    executablePath,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extensionDirectory}`, `--load-extension=${extensionDirectory}`],
  });
  const serviceWorker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(serviceWorker.url()).host;
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  console.log(JSON.stringify({ step: 'onboarding', extensionId }));
  await page.goto(`chrome-extension://${extensionId}/onboarding.html`);
  await page.getByRole('heading', { name: /让译文理解/ }).waitFor();
  await page.screenshot({ path: path.join(visualDirectory, 'weave-onboarding.png'), fullPage: true });

  console.log(JSON.stringify({ step: 'options' }));
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByRole('heading', { name: '模型服务' }).waitFor();
  await page.screenshot({ path: path.join(visualDirectory, 'weave-options.png'), fullPage: true });

  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html lang="en"><head><title>Field Notes</title><style>body{margin:0;background:#f5f0e8;color:#172027;font:18px/1.75 Georgia,serif}main{max-width:760px;margin:70px auto;padding:0 34px}h1{font-size:54px;line-height:1.05}p{margin:28px 0}</style></head><body><main><h1>Field notes on contextual translation</h1><p>A word rarely travels alone. Its heading, neighboring sentence, and the subject of the article all shape the right translation.</p><h2>Working method</h2><p>Weave keeps the source intact, adds a separate translation layer, and lets the reader return to the original at any time.</p></main></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not start.');
  console.log(JSON.stringify({ step: 'dock', port: address.port }));
  await page.goto(`http://127.0.0.1:${address.port}`);
  const grip = page.getByRole('button', { name: '拖动或展开织语' });
  await grip.waitFor({ state: 'visible', timeout: 10_000 });
  await grip.hover();
  await page.getByRole('button', { name: /翻译本页/ }).waitFor({ state: 'visible' });
  const noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  if (!noHorizontalOverflow) throw new Error('Dock introduced horizontal page overflow.');
  await page.screenshot({ path: path.join(visualDirectory, 'weave-dock.png'), fullPage: false });
  server.close();
  if (errors.length > 0) throw new Error(`Browser console errors: ${errors.join(' | ')}`);
  console.log(JSON.stringify({ step: 'complete', screenshots: visualDirectory, errors }));
} finally {
  if (context) await context.close();
  fs.writeFileSync(manifestPath, originalManifest);
}
