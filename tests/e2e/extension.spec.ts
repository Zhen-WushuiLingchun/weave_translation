import { chromium, expect, test } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const fixture = `<!doctype html><html lang="en"><head><title>Field Notes</title><style>
body{min-height:1800px;margin:0;background:#f5f0e8;color:#172027;font:18px/1.75 Georgia,serif}
main{max-width:760px;margin:70px auto;padding:0 34px}h1{font-size:54px;line-height:1.05}p{margin:28px 0}.ltx_equation{width:100%;margin:24px 0}.ltx_align_center{text-align:center}.ltx_eqn_eqno{text-align:right}
</style></head><body><button id="page-control" style="position:fixed;right:70px;top:42%;padding:10px">Page control</button><main><h1>Field notes on contextual translation</h1>
<p>A word rarely travels alone. Its heading, neighboring sentence, and the subject of the article all shape the right translation.</p>
<p id="math-prose">The invariant relation <math alttext="E=mc^2" class="ltx_Math" display="inline"><semantics><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math> fixes the energy scale.</p>
<table id="display-equation" class="ltx_equation ltx_eqn_table"><tbody><tr class="ltx_equation"><td class="ltx_eqn_cell ltx_align_center"><math alttext="d s^2=-c^2dt^2+a(t)^2dr^2" class="ltx_Math" display="block"><semantics><mrow><mi>d</mi><msup><mi>s</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">d s^2=-c^2dt^2+a(t)^2dr^2</annotation></semantics></math></td><td class="ltx_eqn_cell ltx_eqn_eqno"><span>(1)</span></td></tr></tbody></table>
<h2>Working method</h2><p>Weave keeps the source intact, adds a separate translation layer, and lets the reader return to the original at any time.</p>
</main><script>document.querySelector('#page-control').addEventListener('click',event=>event.currentTarget.dataset.clicked='true')</script></body></html>`;
const darkFixture = `<!doctype html><html lang="en"><head><title>Night Notes</title><style>html,body{min-height:100%;background:#111820;color:#f3ebdd}body{margin:0;font:18px/1.7 Georgia,serif}main{max-width:760px;margin:70px auto}</style></head><body><main><h1>Night reading</h1><p>A dark page should receive a dark translation interface.</p></main></body></html>`;

function copyDirectory(source: string, target: string): void {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(targetPath);
      copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

async function removeTemporaryDirectory(directory: string, prefix: string): Promise<void> {
  const resolved = path.resolve(directory);
  const temporaryRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (!resolved.startsWith(temporaryRoot) || !path.basename(resolved).startsWith(prefix)) return;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.rmSync(resolved, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(code ?? '') || attempt === 7) return;
      await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
    }
  }
}

test('loads the unpacked extension and translates a real page through a mock provider', async () => {
  test.skip(process.env.WEAVE_E2E !== '1', 'Set WEAVE_E2E=1 to run the Chrome extension smoke test.');
  const builtExtensionPath = path.resolve('.output/chrome-mv3');
  const extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-e2e-extension-'));
  copyDirectory(builtExtensionPath, extensionPath);
  const manifestPath = path.join(extensionPath, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { host_permissions?: string[]; optional_host_permissions?: string[]; content_scripts?: unknown[] };
  expect(manifest.host_permissions).toEqual(['http://*/*', 'https://*/*']);
  expect(manifest.optional_host_permissions).toBeUndefined();
  expect(manifest.content_scripts?.length).toBeGreaterThan(0);

  const installedRoot = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  const chromiumDirectory = fs.readdirSync(installedRoot).filter((name) => /^chromium-\d+$/.test(name)).sort().at(-1);
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? path.join(installedRoot, chromiumDirectory ?? '', 'chrome-win64', 'chrome.exe');
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-e2e-'));
  const visualDirectory = process.env.WEAVE_VISUAL_DIR;
  if (visualDirectory) fs.mkdirSync(visualDirectory, { recursive: true });

  let requestCount = 0;
  const reasoningEfforts: string[] = [];
  let sawLatexMetadata = false;
  let sawDisplayLatexContext = false;
  const server = http.createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      let raw = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { raw += chunk; });
      request.on('end', () => {
        requestCount += 1;
        const payload = JSON.parse(raw) as { stream?: boolean; reasoning_effort?: string; messages: Array<{ role: string; content: string }> };
        reasoningEfforts.push(payload.reasoning_effort ?? 'compatible');
        const task = JSON.parse(payload.messages.find((message) => message.role === 'user')?.content ?? '{}') as {
          task?: string;
          units?: Array<{
            id: string;
            text: string;
            math?: Array<{ token: string; latex: string }>;
            contextMath?: Array<{ latex: string }>;
          }>;
        };
        if (task.units?.some((unit) => unit.math?.some((math) => math.latex === 'E=mc^2'))) sawLatexMetadata = true;
        if (task.units?.some((unit) => unit.contextMath?.some((math) => math.latex.includes('d s^2=')))) sawDisplayLatexContext = true;
        const content = task.task === 'summary'
          ? JSON.stringify({ summary: 'An article about context-aware translation.', terms: [] })
          : JSON.stringify({ items: (task.units ?? []).map((unit) => ({ id: unit.id, text: `译文：${unit.text}` })) });
        if (payload.stream) {
          response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
          setTimeout(() => response.end(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`), 1_200);
          return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(request.url === '/dark' ? darkFixture : fixture);
  });

  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server did not start.');

    context = await chromium.launchPersistentContext(profileDirectory, {
      headless: process.env.WEAVE_E2E_HEADLESS === '1',
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
    await expect(page.getByText('全站侧边栏已启用')).toBeVisible();
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
            model: 'mock-translator', reasoningMode: 'compatible', targetLanguage: 'zh-CN', keyPersistence: 'session', hasApiKey: false,
          },
          siteRules: { '127.0.0.1': { reasoningMode: 'deep' } },
        },
      });
    }, `http://127.0.0.1:${address.port}/v1/chat/completions`);
    if (visualDirectory) await page.screenshot({ path: path.join(visualDirectory, 'weave-options.png'), fullPage: true });
    await page.getByRole('button', { name: /网页翻译/ }).click();
    await expect(page.getByRole('heading', { name: '站点翻译档案' })).toBeVisible();
    await expect(page.getByText(/example\.com\/\*/)).toBeVisible();
    if (visualDirectory) await page.screenshot({ path: path.join(visualDirectory, 'weave-site-profiles.png'), fullPage: true });

    await page.goto(`http://127.0.0.1:${address.port}/dark`);
    await expect(page.locator('.weave-shell')).toHaveClass(/weave-theme-dark/, { timeout: 10_000 });
    const darkGrip = page.getByRole('button', { name: '拖动位置或点击打开织语' });
    await expect(darkGrip).toBeVisible();
    await darkGrip.click();
    const darkPanel = page.getByLabel('织语快捷设置');
    await expect(darkPanel).toBeVisible();
    const themeSelect = darkPanel.getByLabel('主题');
    await themeSelect.selectOption('light');
    await expect(page.locator('.weave-shell')).toHaveClass(/weave-theme-light/);
    await expect(darkGrip).toBeVisible();
    await themeSelect.selectOption('dark');
    await expect(page.locator('.weave-shell')).toHaveClass(/weave-theme-dark/);
    await expect(darkGrip).toBeVisible();
    await themeSelect.selectOption('auto');
    await expect(page.locator('.weave-shell')).toHaveClass(/weave-theme-dark/);
    await expect(darkGrip).toBeVisible();
    await page.evaluate(() => {
      const replacement = document.body.cloneNode(true);
      document.body.replaceWith(replacement);
    });
    await expect(darkGrip).toBeVisible();
    await page.goto(`http://127.0.0.1:${address.port}/article`);
    await expect(page.locator('.weave-shell')).toHaveClass(/weave-theme-light/, { timeout: 10_000 });
    const grip = page.getByRole('button', { name: '拖动位置或点击打开织语' });
    await expect(grip).toBeVisible({ timeout: 10_000 });
    const pageControl = page.getByRole('button', { name: 'Page control' });
    await pageControl.click();
    await expect(pageControl).toHaveAttribute('data-clicked', 'true');
    await page.evaluate(() => {
      const replacement = document.body.cloneNode(true);
      document.body.replaceWith(replacement);
    });
    await expect(grip).toBeVisible();
    await expect(page.locator('.weave-shell')).toHaveClass(/weave-theme-light/);
    const floatingHost = page.locator('weave-translation-root');
    await expect(floatingHost).toHaveAttribute('popover', 'manual');
    expect(await floatingHost.evaluate((host) => host.matches(':popover-open'))).toBe(true);
    await page.evaluate(() => {
      const cover = document.createElement('div');
      cover.id = 'maximum-z-index-cover';
      cover.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.02);pointer-events:auto';
      document.body.append(cover);
    });
    const dockPanel = page.getByLabel('织语快捷设置');
    await grip.hover();
    await page.waitForTimeout(250);
    await expect(dockPanel).not.toBeVisible();
    await grip.click();
    await expect(dockPanel).toBeVisible();
    await page.mouse.move(100, 100);
    await page.waitForTimeout(750);
    await expect(dockPanel).not.toBeVisible();
    await grip.click();
    await expect(dockPanel).toBeVisible();
    const translateButton = page.getByRole('button', { name: /翻译本页/ });
    await expect(translateButton).toBeVisible();
    await translateButton.click();
    await expect(page.locator('[data-weave-translation]').first()).toContainText('译文：', { timeout: 15_000 });
    await expect(page.locator('[data-weave-translation]').first()).toHaveAttribute('data-weave-theme', 'light');
    const mathTranslation = page.locator('#math-prose + [data-weave-translation]');
    await expect(mathTranslation).toBeVisible();
    await expect(mathTranslation.locator('[data-weave-math="inline"] math')).toHaveCount(1);
    await expect(page.locator('#display-equation [data-weave-translation]')).toHaveCount(0);
    expect(sawLatexMetadata).toBe(true);
    expect(sawDisplayLatexContext).toBe(true);
    if (visualDirectory) await page.screenshot({ path: path.join(visualDirectory, 'weave-arxiv-math.png'), fullPage: false });
    expect(requestCount).toBeGreaterThanOrEqual(2);
    expect(reasoningEfforts).toContain('high');

    const selectWorkingMethod = async () => page.locator('h2').evaluate((heading) => {
      const range = document.createRange();
      range.selectNodeContents(heading);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      heading.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 560, clientY: 320 }));
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await selectWorkingMethod();
    const selectionDot = page.getByRole('button', { name: '翻译所选文本' });
    await expect(selectionDot).toBeVisible();
    const dotBeforeScroll = await selectionDot.boundingBox();
    if (!dotBeforeScroll) throw new Error('Selection dot has no bounding box.');
    await page.evaluate(() => window.scrollBy(0, 60));
    await expect.poll(async () => (await selectionDot.boundingBox())?.y ?? dotBeforeScroll.y).toBeLessThan(dotBeforeScroll.y - 30);
    await expect(selectionDot).toBeVisible();

    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await expect(selectionDot).toHaveCount(0);

    await selectWorkingMethod();
    await expect(selectionDot).toBeVisible();
    await page.mouse.click(1100, 700);
    await expect(selectionDot).toHaveCount(0);

    await page.evaluate(() => window.scrollTo(0, 0));
    await selectWorkingMethod();
    await expect(selectionDot).toBeVisible();
    await page.evaluate(() => window.scrollBy(0, 400));
    await expect(selectionDot).toHaveCount(0);

    await page.evaluate(() => window.scrollTo(0, 0));
    await selectWorkingMethod();
    await expect(selectionDot).toBeVisible();
    await selectionDot.click();
    const cardHandle = page.locator('[aria-label="拖动划词翻译卡片"]');
    const selectionCard = page.locator('.weave-selection-card');
    await expect(cardHandle).toBeVisible();
    await expect(page.getByRole('status')).toContainText('正在翻译所选文本');
    await page.waitForTimeout(250);
    await expect(page.getByRole('status')).toContainText('正在翻译所选文本');
    if (visualDirectory) await page.screenshot({ path: path.join(visualDirectory, 'weave-selection-loading.png'), fullPage: false });
    await expect(page.locator('.weave-selection-result')).toContainText('译文：Working method');
    expect(reasoningEfforts).toContain('none');
    const beforeDrag = await cardHandle.boundingBox();
    if (!beforeDrag) throw new Error('Selection card drag handle has no bounding box.');
    await page.mouse.move(beforeDrag.x + beforeDrag.width / 2, beforeDrag.y + beforeDrag.height / 2);
    await page.mouse.down();
    await page.mouse.move(beforeDrag.x - 220, beforeDrag.y - 120, { steps: 8 });
    await page.mouse.up();
    const afterDrag = await selectionCard.evaluate((card) => {
      const rect = card.getBoundingClientRect();
      return { x: rect.x, y: rect.y };
    });
    expect(afterDrag.x).toBeLessThan(beforeDrag.x - 100);
    expect(afterDrag.x).toBeGreaterThanOrEqual(12);
    expect(afterDrag.y).toBeGreaterThanOrEqual(12);
    await page.waitForTimeout(80);
    await expect(selectionCard).toBeVisible();
    await expect(page.getByRole('button', { name: '翻译所选文本' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(consoleErrors).toEqual([]);
    if (visualDirectory) await page.screenshot({ path: path.join(visualDirectory, 'weave-dock.png'), fullPage: false });
    if (visualDirectory) await page.screenshot({ path: path.join(visualDirectory, 'weave-selection-card.png'), fullPage: false });
  } finally {
    if (context) await context.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await removeTemporaryDirectory(profileDirectory, 'weave-e2e-');
    await removeTemporaryDirectory(extensionPath, 'weave-e2e-extension-');
  }
});
