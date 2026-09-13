import { chromium, expect, test } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pdfFixture } from '../fixtures/pdf';

test('native PDF sidebar: context, models, image confirmation and cache', async () => {
  test.skip(process.env.WEAVE_E2E !== '1', 'Set WEAVE_E2E=1.'); test.setTimeout(90000);
  const extension = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-pdf-extension-')); const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-pdf-profile-'));
  fs.cpSync(path.resolve('.output/chrome-mv3'), extension, { recursive: true });
  const root = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright'); const latest = fs.readdirSync(root).filter((name) => /^chromium-\d+$/.test(name)).sort().at(-1);
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? path.join(root, latest ?? '', 'chrome-win64/chrome.exe');
  const requests: Array<{ model: string; images: number; source: any }> = []; let delay = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/paper.pdf') { response.writeHead(200, { 'Content-Type': 'application/pdf' }); response.end(pdfFixture()); return; }
    if (request.method !== 'POST') { response.writeHead(404); response.end(); return; }
    const chunks: Buffer[] = []; request.on('data', (chunk: Buffer) => chunks.push(chunk)); request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString()); const parts = body.messages[1].content; const source = JSON.parse(typeof parts === 'string' ? parts : parts[0].text);
      const images = typeof parts === 'string' ? 0 : parts.filter((part: any) => part.type === 'image_url').length; requests.push({ model: body.model, images, source });
      const content = source.task === 'summary' ? { summary: '本页讨论质量与能量关系。', terms: [] } : { items: [{ id: 'selection', text: images ? '图中公式为 $E=mc^2$。' : `译文：${source.units[0].text}` }] };
      setTimeout(() => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] })); }, delay);
    });
  });
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Mock server failed'); const base = `http://127.0.0.1:${address.port}`;
    context = await chromium.launchPersistentContext(profile, { executablePath, headless: process.env.WEAVE_E2E_HEADLESS === '1', viewport: { width: 1440, height: 1000 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--remote-debugging-port=0'] });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); const id = new URL(worker.url()).host;
    const setup = await context.newPage(); await setup.goto(`chrome-extension://${id}/options.html`);
    await setup.evaluate(async (baseUrl) => {
      const chrome = (globalThis as any).chrome; const { data } = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', patch: {
        connections: [{ id: 'mock', label: 'Mock', kind: 'openai-compatible', chatEndpoint: `${baseUrl}/chat`, transcriptionEndpoint: '', secretRef: 'mock', keyPersistence: 'session', hasApiKey: false, transcriptionResponseMode: 'json' }],
        models: ['vision', 'other'].map((model) => ({ id: model, label: model, model, connectionId: 'mock', enabled: true, capabilities: model === 'vision' ? ['chat', 'vision', 'reasoningEffort'] : ['chat'] })),
        taskRoutes: Object.fromEntries(Object.entries(data.taskRoutes).map(([key, value]) => [key, { ...(value as object), profileId: 'vision', glossaryMode: 'matched' }])),
      } });
      const button = document.createElement('button'); button.textContent = 'E2E Open Sidebar'; button.onclick = () => { void chrome.windows.getCurrent().then((win: any) => chrome.sidePanel.open({ windowId: win.id })); }; document.body.append(button);
    }, base);
    await setup.getByRole('button', { name: 'E2E Open Sidebar' }).click();
    const native = await context.newPage(); await native.goto(`${base}/paper.pdf`); await native.waitForTimeout(800);
    expect(native.url()).toBe(`${base}/paper.pdf`); expect(native.frames().some((frame) => /mhjfbmdgcfjbbpaeojofohoefgiehjai/.test(frame.url()))).toBe(true);
    const debugPort = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
    const attached = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    await expect.poll(() => attached.contexts().flatMap((ctx) => ctx.pages()).filter((page) => page.url().endsWith('/pdf.html')).length).toBe(1);
    const panel = attached.contexts().flatMap((ctx) => ctx.pages()).find((page) => page.url().endsWith('/pdf.html'))!; const errors: string[] = []; panel.on('pageerror', (error) => errors.push(error.message));
    await expect(panel.getByText('原生阅读 · 侧边理解')).toBeVisible(); expect(requests).toHaveLength(0);
    if (process.env.WEAVE_E2E_HEADLESS !== '1') {
      // Chrome's native menu is outside page DOM; UI Automation targets only this isolated browser PID.
      await native.bringToFront(); await native.mouse.move(542, 188); await native.mouse.down(); await native.mouse.move(915, 188, { steps: 12 }); await native.mouse.up(); await native.mouse.click(650, 188, { button: 'right' });
      const browserCdp = await attached.newBrowserCDPSession(); const processes = await browserCdp.send('SystemInfo.getProcessInfo'); const pid = processes.processInfo.find((entry) => entry.type === 'browser')!.id;
      execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes; $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, ${pid}); $items = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition); $found = $false; foreach ($item in $items) { if ($item.Current.Name -like '*织语*' -and $item.Current.ControlType -eq [System.Windows.Automation.ControlType]::MenuItem) { $pattern = $item.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern); $pattern.Invoke(); $found = $true; break } }; if (-not $found) { throw 'Native Weave context menu item not found in isolated Chromium' }`], { timeout: 10000 });
      await expect(panel.getByLabel('PDF 所选文字')).toHaveValue(/invariant relation/);
      await expect(panel.locator('.pdf-result')).toContainText('译文：');
      expect(await worker.evaluate(async () => Object.keys(await (globalThis as any).chrome.storage.session.get(null)).filter((key) => key.startsWith('weave.pdf.selection.')))).toEqual([]);
      requests.length = 0;
      await panel.getByText('缓存与隐私', { exact: true }).click(); await panel.getByRole('button', { name: '清除此文档缓存' }).click(); await panel.getByText('缓存与隐私', { exact: true }).click();
    }
    await panel.getByLabel('PDF 所选文字').fill('The invariant relation links mass and energy.'); await panel.getByRole('button', { name: '翻译', exact: true }).click();
    await expect(panel.locator('.pdf-result')).toContainText('译文：The invariant'); expect(requests[0]?.images).toBe(0); expect(requests[0]?.source.units[0].before).toContain('quasiparticle');
    await panel.getByRole('button', { name: '翻译', exact: true }).click(); await expect(panel.locator('.pdf-result')).toContainText('译文：'); expect(requests).toHaveLength(1);
    await panel.getByLabel('PDF 任务模型').selectOption('other'); await panel.getByRole('button', { name: '翻译', exact: true }).click(); await expect.poll(() => requests.length).toBe(2); expect(requests[1]?.model).toBe('other'); await expect(panel.locator('.pdf-result')).toContainText('译文：');
    await panel.getByLabel('PDF 当前任务').selectOption('summary'); await panel.getByRole('button', { name: '翻译', exact: true }).click(); await expect(panel.locator('.pdf-result')).toContainText('本页讨论');
    await panel.getByLabel('PDF 当前任务').selectOption('selection'); await panel.getByLabel('PDF 任务模型').selectOption('vision');
    if (process.env.WEAVE_E2E_HEADLESS !== '1') await panel.getByRole('button', { name: '截取当前画面' }).click();
    else { const screenshot = await native.screenshot(); await panel.getByLabel('导入图片文件').setInputFiles({ name: 'native-view.png', mimeType: 'image/png', buffer: screenshot }); }
    await expect(panel.locator('.screenshot-crop')).toBeVisible(); const rect = (await panel.locator('.screenshot-crop').boundingBox())!;
    await panel.mouse.move(rect.x + 10, rect.y + 10); await panel.mouse.down(); await panel.mouse.move(rect.x + rect.width - 10, rect.y + Math.min(rect.height - 5, 120), { steps: 8 }); await panel.mouse.up();
    await expect(panel.getByRole('img', { name: '待发送选区截图预览' })).toBeVisible(); const beforeImage = requests.length;
    await panel.getByRole('button', { name: '翻译', exact: true }).click(); await expect(panel.getByRole('button', { name: '确认发送截图并翻译' })).toBeVisible(); expect(requests).toHaveLength(beforeImage);
    await panel.getByRole('button', { name: '确认发送截图并翻译' }).click(); await expect(panel.locator('.pdf-result')).toContainText('图中公式'); expect(requests.at(-1)?.images).toBe(1); expect(requests.at(-1)?.source.document.pages).toBeNull(); await expect(panel.locator('.pdf-result math')).toHaveCount(1);
    if (process.env.WEAVE_VISUAL_DIR) { await panel.screenshot({ path: path.join(process.env.WEAVE_VISUAL_DIR, 'weave-pdf-sidebar.png') }); await native.screenshot({ path: path.join(process.env.WEAVE_VISUAL_DIR, 'weave-native-pdf.png') }); }
    const afterImage = requests.length; await panel.getByRole('button', { name: '翻译', exact: true }).click(); await panel.getByRole('button', { name: '确认发送截图并翻译' }).click(); await expect(panel.locator('.pdf-result')).toContainText('图中公式'); expect(requests).toHaveLength(afterImage);
    await panel.getByRole('button', { name: '移除图片' }).click(); await panel.getByRole('button', { name: '复用最近选区' }).click(); await expect(panel.getByRole('img', { name: '待发送选区截图预览' })).toBeVisible();
    await panel.getByText('缓存与隐私', { exact: true }).click(); await panel.getByLabel('PDF 缓存保存方式').selectOption('disk'); await panel.getByLabel('PDF 缓存保留期限').selectOption('1');
    await panel.getByRole('button', { name: '翻译', exact: true }).click(); await panel.getByRole('button', { name: '确认发送截图并翻译' }).click(); await expect(panel.locator('.pdf-result')).toContainText('图中公式');
    const records = () => panel.evaluate(async () => new Promise<any[]>((resolve) => { const request = indexedDB.open('weave-pdf-cache', 1); request.onsuccess = () => { const db = request.result; const read = db.transaction('records').objectStore('records').getAll(); read.onsuccess = () => { resolve(read.result); db.close(); }; }; }));
    await expect.poll(async () => (await records()).length).toBeGreaterThan(0); expect((await records()).every((item) => item.expiresAt - item.createdAt === 86400000)).toBe(true);
    await panel.getByRole('button', { name: '清除此文档缓存' }).click(); await expect.poll(async () => (await records()).length).toBe(0);
    delay = 2000; await panel.getByLabel('PDF 所选文字').fill('A new uncached selection.'); await panel.getByLabel('视觉辅助').selectOption('text'); await panel.getByRole('button', { name: '翻译', exact: true }).click(); await panel.getByRole('button', { name: '停止', exact: true }).click(); await panel.waitForTimeout(2200); await expect(panel.locator('.pdf-result')).toBeEmpty();
    await panel.getByLabel('侧边栏主题').selectOption('dark'); expect(await panel.locator('.pdf-panel').getAttribute('data-theme')).toBe('dark'); expect(errors).toEqual([]); expect(native.url()).toBe(`${base}/paper.pdf`);
  } finally {
    if (context) await context.close(); await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const directory of [extension, profile]) { const resolved = path.resolve(directory); if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('weave-pdf-')) { try { fs.rmSync(resolved, { recursive: true, force: true }); } catch { /* Isolated browser may retain handles briefly. */ } } }
  }
});
