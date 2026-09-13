import { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { browser } from 'wxt/browser';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ContextBrief, PdfPanelSource, PdfSettings, ReasoningMode, TranslationResult, TranslationTask, WeaveSettings } from '../../lib/contracts';
import { sendRuntimeMessage } from '../../lib/message';
import { PdfCache } from '../../pdf/cache';
import { contextWindow, needsVision, normalizeText, type PdfBlock } from '../../pdf/context';
import { cropPage, openPdf, pageBlocks, readPdf } from '../../pdf/document';
import { digest, estimateTextTokens } from '../../pdf/protocol';
import { renderRestrictedMarkdown } from '../../content/rich-translation';
import { cropScreenshot, ScreenshotCrop } from './ScreenshotCrop';
import './style.css';

type Action = 'selection' | 'explain' | 'summary';
const routeFor = (action: Action) => action === 'summary' ? 'pdfContext' : action === 'explain' ? 'pdfExplanation' : 'pdfTranslation';
interface ParsedDocument { pdf: PDFDocumentProxy; id: string; title: string; sourceKey: string; blocks: Map<number, PdfBlock[]> }
const sourceKey = (source: PdfPanelSource) => `${source.tabId}:${source.url}`;
const isPdf = (source: PdfPanelSource) => /\.pdf(?:$|[?#])/i.test(source.url) || /\.pdf$/i.test(source.title);

function RichText({ text }: { text: string }): React.ReactElement {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (root.current) renderRestrictedMarkdown(root.current, text); }, [text]);
  return <div className="pdf-result" ref={root} />;
}

function PdfPanel(): React.ReactElement {
  const [settings, setSettings] = useState<WeaveSettings>();
  const [source, setSource] = useState<PdfPanelSource>();
  const [text, setText] = useState('');
  const [pageHint, setPageHint] = useState(1);
  const [autoLocate, setAutoLocate] = useState(true);
  const [contextEnabled, setContextEnabled] = useState(true);
  const [docName, setDocName] = useState('');
  const [totalPages, setTotalPages] = useState(0);
  const [indexed, setIndexed] = useState(0);
  const [status, setStatus] = useState('在原生 PDF 中选中文字，右键选择“用织语翻译所选文字”。');
  const [contextNote, setContextNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<Action>('selection');
  const [result, setResult] = useState('');
  const [summary, setSummary] = useState<ContextBrief>();
  const [overrides, setOverrides] = useState<Partial<Record<Action, string>>>({});
  const [thinking, setThinking] = useState<Partial<Record<Action, ReasoningMode>>>({});
  const [screen, setScreen] = useState('');
  const [regionImage, setRegionImage] = useState('');
  const [preview, setPreview] = useState<NonNullable<TranslationTask['images']>>([]);
  const [awaiting, setAwaiting] = useState(false);
  const [cacheNote, setCacheNote] = useState('');
  const [password, setPassword] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const screenshotInput = useRef<HTMLInputElement>(null);
  const documentRef = useRef<ParsedDocument | undefined>(undefined);
  const sourceRef = useRef<PdfPanelSource | undefined>(undefined);
  const cache = useRef(new PdfCache());
  const sessionId = useRef(crypto.randomUUID());
  const operation = useRef<AbortController | undefined>(undefined);
  const generation = useRef(0);
  const lastNonce = useRef('');

  const cancel = useCallback((release = false) => {
    generation.current++; operation.current?.abort(); setBusy(false); setAwaiting(false);
    void sendRuntimeMessage({ type: 'PDF_CANCEL', sessionId: sessionId.current, release }).catch(() => undefined);
  }, []);
  const discardDocument = useCallback(() => {
    const previous = documentRef.current; documentRef.current = undefined;
    if (previous) void previous.pdf.loadingTask.destroy();
    cache.current.release(); setDocName(''); setTotalPages(0); setIndexed(0); setSummary(undefined); setContextNote('');
  }, []);
  useEffect(() => {
    let alive = true; let windowId: number | undefined;
    const refresh = async () => {
      if (windowId == null) return;
      const next = await sendRuntimeMessage<PdfPanelSource>({ type: 'PDF_PANEL_SOURCE', windowId });
      if (!alive) return;
      const changed = !sourceRef.current || sourceKey(sourceRef.current) !== sourceKey(next);
      if (changed) { cancel(true); discardDocument(); setResult(''); setPreview([]); setScreen(''); setRegionImage(''); setPageHint(1); setText(next.text); }
      if (next.nonce !== sourceRef.current?.nonce) { cancel(); setText(next.text); setPreview([]); setRegionImage(''); setScreen(''); }
      sourceRef.current = next; setSource(next);
    };
    void (async () => {
      const configured = await sendRuntimeMessage<WeaveSettings>({ type: 'GET_SETTINGS' });
      if (!alive) return; setSettings(configured); setContextEnabled(configured.contextEnabled);
      await cache.current.prune(configured.pdf).catch(() => setCacheNote('磁盘缓存暂不可用，可继续翻译。'));
      windowId = (await browser.windows.getCurrent()).id; await refresh();
    })().catch((error: unknown) => setStatus(String(error)));
    const message = (value: unknown) => { if ((value as { type?: string })?.type === 'PDF_SELECTION_CHANGED') void refresh().catch(() => undefined); };
    const activated = (info: { windowId: number }) => { if (info.windowId === windowId) void refresh().catch(() => undefined); };
    const updated = (tabId: number, change: { url?: string }) => { if (tabId === sourceRef.current?.tabId && change.url) void refresh().catch(() => undefined); };
    browser.runtime.onMessage.addListener(message); browser.tabs.onActivated.addListener(activated); browser.tabs.onUpdated.addListener(updated);
    const release = () => { alive = false; operation.current?.abort(); cache.current.release(); void documentRef.current?.pdf.loadingTask.destroy(); void sendRuntimeMessage({ type: 'PDF_CANCEL', sessionId: sessionId.current, release: true }).catch(() => undefined); };
    window.addEventListener('pagehide', release);
    return () => { release(); window.removeEventListener('pagehide', release); browser.runtime.onMessage.removeListener(message); browser.tabs.onActivated.removeListener(activated); browser.tabs.onUpdated.removeListener(updated); };
  }, [cancel, discardDocument]);

  async function parse(source: PdfPanelSource, signal: AbortSignal, file?: File): Promise<ParsedDocument> {
    const existing = documentRef.current;
    if (!file && existing?.sourceKey === sourceKey(source)) return existing;
    setContextNote('正在本地解析文档；原生阅读画面保持不变…');
    const bytes = await readPdf(file ?? source.url, signal); const opened = await openPdf(bytes, signal, password || undefined);
    if (signal.aborted || sourceKey(sourceRef.current!) !== sourceKey(source)) { await opened.pdf.loadingTask.destroy(); throw new Error('文档已切换。'); }
    const doc: ParsedDocument = { ...opened, title: file?.name ?? source.title, sourceKey: sourceKey(source), blocks: new Map() };
    if (existing) void existing.pdf.loadingTask.destroy(); documentRef.current = doc; setDocName(doc.title); setTotalPages(doc.pdf.numPages); setIndexed(0);
    setContextNote('文档已在本地就绪。不会发送完整 PDF。'); return doc;
  }
  async function collect(doc: ParsedDocument, page: number): Promise<PdfBlock[]> {
    const found = doc.blocks.get(page); if (found) return found;
    const values = await pageBlocks(await doc.pdf.getPage(page));
    if (documentRef.current === doc) { doc.blocks.set(page, values); setIndexed(doc.blocks.size); }
    return values;
  }
  async function locate(doc: ParsedDocument, selection: string, hint: number, signal: AbortSignal): Promise<number | undefined> {
    const needle = normalizeText(selection).toLowerCase();
    if (!needle) return hint;
    const matches = (values: PdfBlock[]) => normalizeText(values.map((block) => block.text).join(' ')).toLowerCase().includes(needle);
    if (matches(await collect(doc, hint))) return hint;
    // No cloud calls while locating. Stop at 2000 pages / 3 million extracted characters.
    let characters = 0;
    for (let page = 1; page <= Math.min(doc.pdf.numPages, 2000); page++) {
      signal.throwIfAborted(); const values = await collect(doc, page);
      characters += values.reduce((total, block) => total + block.text.length, 0);
      if (matches(values)) return page;
      if (characters >= 3000000) break;
      if (page % 5 === 0) { setContextNote(`正在本地定位选文：${page}/${doc.pdf.numPages} 页…`); await new Promise((resolve) => setTimeout(resolve, 0)); }
    }
    return undefined;
  }

  async function translate(nextAction: Action, confirmed = false) {
    const currentSource = sourceRef.current;
    if (!settings || !currentSource) return;
    cancel(); const ticket = generation.current; const controller = new AbortController(); operation.current = controller;
    const timer = setTimeout(() => controller.abort(), 120000);
    const current = () => !controller.signal.aborted && ticket === generation.current;
    setAction(nextAction); setBusy(true); setResult(''); setPreview([]); setStatus('正在准备翻译…');
    try {
      const route = settings.taskRoutes[routeFor(nextAction)]; const modelId = overrides[nextAction] ?? route.profileId;
      const model = settings.models.find((entry) => entry.id === modelId && entry.enabled && entry.capabilities.includes('chat'));
      if (!model) throw new Error('请为此 PDF 任务配置可用的聊天模型。');
      let doc = documentRef.current; let page = Math.max(1, Math.min(doc?.pdf.numPages ?? Infinity, pageHint)); let known = false;
      if (!doc && contextEnabled && isPdf(currentSource) && /^https?:\/\//i.test(currentSource.url)) {
        try { doc = await parse(currentSource, controller.signal); }
        catch (error) { controller.signal.throwIfAborted(); setContextNote(`文档上下文不可用：${error instanceof Error ? error.message : '读取失败'}。本次只翻译所选文字；也可关联本地 PDF。`); }
      }
      if (doc) {
        page = Math.min(page, doc.pdf.numPages);
        const located = regionImage && !text && autoLocate ? undefined
          : contextEnabled && autoLocate && nextAction !== 'summary' ? await locate(doc, text, page, controller.signal) : page;
        known = located != null;
        if (located != null) { page = located; if (page !== pageHint) setSummary(undefined); setPageHint(page); }
        setContextNote(known ? `上下文：第 ${page} 页${autoLocate && text ? '（按文字匹配，可手动修正）' : '（指定页码）'}。` : '未能准确定位选文；本次不附加可能无关的段落。可关闭自动定位并指定页码。');
        if (known && contextEnabled) for (const number of [page - 1, page, page + 1]) if (number >= 1 && number <= doc.pdf.numPages) await collect(doc, number);
      } else if (/^file:/i.test(currentSource.url)) setContextNote('本地 PDF 需要关联一次同一文件才能提取上下文；未关联时仍可翻译所选文字。');
      if (!current()) return;
      let selectedText = normalizeText(text);
      if (nextAction === 'summary') {
        if (!doc) throw new Error('请先关联当前 PDF，再生成指定页的摘要。');
        selectedText = (await collect(doc, page)).map((block) => block.text).join('\n\n');
        while (estimateTextTokens(selectedText) > settings.pdf.contextBudget - 3000) selectedText = selectedText.slice(0, Math.floor(selectedText.length * .85));
        if (!selectedText) throw new Error('该页没有文字层。请用当前画面截图辅助翻译。');
      }
      const imageRequested = nextAction !== 'summary' && settings.pdf.visionMode !== 'text'
        && (Boolean(regionImage) || settings.pdf.visionMode === 'image' || needsVision(selectedText));
      const images: NonNullable<TranslationTask['images']> = [];
      if (imageRequested) {
        if (!model.capabilities.includes('vision')) throw new Error('当前模型未启用 vision。请选择视觉模型，或改用仅文字模式。');
        let image = regionImage;
        if (!image && doc && known) {
          const block = (await collect(doc, page)).find((item) => normalizeText(item.text).includes(selectedText));
          if (block) {
            const key = `image:${doc.id}:${page}:v1:${JSON.stringify(block.box)}`;
            image = await cache.current.get<string>(key, settings.pdf).catch(() => undefined) ?? '';
            if (!image) { image = await cropPage(await doc.pdf.getPage(page), block.box, controller.signal); if (current()) await cache.current.put(key, doc.id, image, settings.pdf).catch(() => undefined); }
          }
        }
        if (!image) throw new Error('请先点击“截取当前画面”，在侧边栏圈选公式或扫描区域；也可粘贴/导入截图。');
        if (regionImage) await rememberImage(image);
        images.push({ page, purpose: 'selection', dataUrl: image });
      }
      if (!selectedText && !images.length) throw new Error('请在 PDF 中选中文字后使用右键织语菜单，或在这里粘贴文字。');
      const id = doc?.id ?? await digest(`unparsed:${currentSource.url}`);
      const usableSummary = known && page === pageHint && contextEnabled ? summary : undefined;
      const snippet = contextWindow(selectedText, page, known && contextEnabled && doc && nextAction !== 'summary' ? [...doc.blocks.values()].flat() : [], settings.pdf.contextBudget, images.length, usableSummary?.summary ?? '');
      const task: TranslationTask = { id: crypto.randomUUID(), kind: nextAction, scope: 'pdf', route: routeFor(nextAction), sourceLanguage: settings.sourceLanguage, targetLanguage: settings.targetLanguage,
        units: [{ id: 'selection', text: selectedText || '[Translate the selected screenshot region. Preserve formulas.]', before: snippet.text, headingPath: snippet.heading }],
        pdf: { documentId: id, pages: snippet.pages, budget: settings.pdf.contextBudget, locationKnown: known },
        ...(images.length ? { images } : {}), ...(usableSummary && nextAction !== 'summary' ? { context: usableSummary } : {}) };
      if (!current()) return;
      setPreview(images);
      const note = `${known ? `第 ${snippet.pages.join('、')} 页` : '未定位 PDF 页码 · 仅选区'} · ${images.length} 张图 · 输入估算 ≤ ${snippet.estimatedTokens.toLocaleString()} tokens`;
      if (images.length && !confirmed) { setAwaiting(true); setStatus(`${note}\n图片仍在本地。确认后发送给 ${model.label}。`); return; }
      setStatus(`正在${nextAction === 'summary' ? '生成本页摘要' : nextAction === 'explain' ? '解释语境' : '翻译'}…\n${note}`);
      const response = await sendRuntimeMessage<TranslationResult>({ type: 'PDF_TRANSLATE', task, profileId: modelId, reasoningMode: thinking[nextAction] ?? route.reasoningMode, sessionId: sessionId.current,
        ...(/^https?:/.test(currentSource.url) ? { documentUrl: currentSource.url } : {}) });
      if (!current()) return;
      const translated = response.items.find((item) => item.id === 'selection');
      if (!translated || translated.error) throw new Error(translated?.error ?? '模型未返回译文。');
      if (nextAction === 'summary') {
        const brief = JSON.parse(translated.text) as ContextBrief;
        if (typeof brief.summary !== 'string') throw new Error('模型返回的摘要格式无效。');
        const bounded = { summary: brief.summary.slice(0, 1200), terms: [] }; setSummary(bounded); setResult(bounded.summary);
      } else setResult(translated.text);
      setStatus(`已完成。${note}\n公式与数字请对照原文核验。`);
    } catch (error) { if (ticket === generation.current) setStatus(`未完成：${controller.signal.aborted ? '请求已超时' : error instanceof Error ? error.message : '翻译失败'}`); }
    finally { clearTimeout(timer); if (ticket === generation.current) setBusy(false); }
  }

  // A context-menu click is the explicit translation action; opening the panel alone does nothing.
  useEffect(() => {
    if (!source?.nonce || source.nonce === lastNonce.current || !settings) return;
    lastNonce.current = source.nonce; void translate('selection');
  }, [source?.nonce, settings]);

  async function attach(file: File) {
    const selected = sourceRef.current; if (!selected) return;
    cancel(); const controller = new AbortController(); operation.current = controller; setBusy(true);
    try { await parse(selected, controller.signal, file); }
    catch (error) { setContextNote(error instanceof Error ? error.message : '无法读取文件'); }
    finally { if (operation.current === controller) setBusy(false); }
  }
  async function clearCache(documentId?: string) {
    cancel(); setPreview([]); setRegionImage(''); setScreen(''); setResult(''); setSummary(undefined);
    await cache.current.clear(documentId); await sendRuntimeMessage({ type: 'PDF_CACHE_CLEAR', ...(documentId ? { documentId } : {}) });
    setCacheNote(documentId ? '本文档缓存已清除。' : '全部 PDF 缓存已清除。');
  }
  async function updatePdf(patch: Partial<PdfSettings>) {
    if (!settings) return; cancel(); const next = { ...settings.pdf, ...patch };
    try {
      if (settings.pdf.cachePersistence === 'disk' && next.cachePersistence === 'session') await clearCache();
      const updated = await sendRuntimeMessage<WeaveSettings>({ type: 'SAVE_SETTINGS', patch: { pdf: next } }); setSettings(updated); await cache.current.prune(updated.pdf);
    } catch (error) { setCacheNote(String(error)); }
  }
  async function capture() {
    const current = sourceRef.current; if (!current) return; cancel(); const ticket = generation.current;
    try {
      const data = await sendRuntimeMessage<string>({ type: 'PDF_CAPTURE', tabId: current.tabId, windowId: current.windowId });
      if (ticket !== generation.current) return; setScreen(data); setRegionImage(''); setPreview([]); setStatus('在下面的画面中圈选目标区域，然后点击翻译。');
    } catch { setStatus('无法截取当前标签页。请先点击一次 Chrome 工具栏的织语图标以授予临时访问，或在此粘贴/导入截图。'); }
  }
  async function importImage(file: File) {
    if (!file.type.startsWith('image/') || file.size > 16 * 1048576) { setStatus('请选择不超过 16 MiB 的图片。'); return; }
    cancel(); const ticket = generation.current; const url = URL.createObjectURL(file);
    try { const image = await cropScreenshot(url); if (ticket === generation.current) { setScreen(image); setRegionImage(''); } }
    catch { setStatus('无法读取图片。'); } finally { URL.revokeObjectURL(url); }
  }
  async function rememberImage(image: string) {
    if (!settings || !sourceRef.current) return;
    const doc = documentRef.current;
    const ticket = generation.current;
    const id = doc?.id ?? await digest(`unparsed:${sourceRef.current.url}`);
    const policy = doc ? settings.pdf : { ...settings.pdf, cachePersistence: 'session' as const };
    const key = `image:${id}:selection:${await digest(image)}`;
    const existing = await cache.current.get<string>(key, policy).catch(() => undefined);
    if (!existing && ticket === generation.current) await cache.current.put(key, id, image, policy).catch(() => setCacheNote('截图缓存不可用。'));
  }
  async function reuseImage() {
    if (!settings || !sourceRef.current) return;
    const doc = documentRef.current;
    const id = doc?.id ?? await digest(`unparsed:${sourceRef.current.url}`);
    const policy = doc ? settings.pdf : { ...settings.pdf, cachePersistence: 'session' as const };
    const image = await cache.current.latestImage(id, policy);
    if (!image) { setStatus('本次文档没有可复用截图。跨次阅读请先关联同一 PDF，并启用磁盘缓存。'); return; }
    cancel(); setRegionImage(image); setScreen(''); setText(''); setPreview([{ page: pageHint, purpose: 'selection', dataUrl: image }]);
    setStatus('已取回此文档最近的截图。请核对区域后点击翻译；发送前仍需确认。');
  }
  async function clearCurrentCache() {
    if (!sourceRef.current) return;
    await clearCache(documentRef.current?.id ?? await digest(`unparsed:${sourceRef.current.url}`));
  }

  const route = settings?.taskRoutes[routeFor(action)]; const modelId = overrides[action] ?? route?.profileId ?? '';
  const models = settings?.models.filter((model) => model.enabled && model.capabilities.includes('chat')) ?? [];
  const model = models.find((entry) => entry.id === modelId);
  return <main className="pdf-panel" data-theme={settings?.pdf.theme ?? 'auto'} onPaste={(event) => { const file = [...event.clipboardData.items].find((item) => item.type.startsWith('image/'))?.getAsFile(); if (file) { event.preventDefault(); void importImage(file); } }}>
    <header><span className="brand-mark">织</span><div><h1>文献翻译</h1><small>NATIVE PDF · WEAVE SIDEBAR</small></div><button title="完整设置" onClick={() => void sendRuntimeMessage({ type: 'OPEN_OPTIONS' })}>⚙</button></header>
    <section className="source-info"><span className="kicker">原生阅读 · 侧边理解</span><p title={source?.title}>{source?.title || '等待当前文档…'}</p><small>不替换 Chrome PDF 查看器，不改动原文。</small></section>
    <section className="task-controls"><label>任务<select aria-label="PDF 当前任务" value={action} onChange={(event) => { cancel(); setAction(event.target.value as Action); }}><option value="selection">划词翻译</option><option value="explain">语境解释</option><option value="summary">指定页摘要</option></select></label>
      <label>模型<select aria-label="PDF 任务模型" value={modelId} onChange={(event) => { cancel(); setOverrides({ ...overrides, [action]: event.target.value }); }}><option value="">未配置</option>{models.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}{entry.capabilities.includes('vision') ? ' · 视觉' : ''}</option>)}</select></label>
      <label>思考深度<select aria-label="PDF 思考深度" disabled={!model?.capabilities.includes('reasoningEffort')} value={thinking[action] ?? route?.reasoningMode ?? 'compatible'} onChange={(event) => { cancel(); setThinking({ ...thinking, [action]: event.target.value as ReasoningMode }); }}><option value="compatible">模型默认</option><option value="fast">快速</option><option value="balanced">均衡</option><option value="deep">深入</option></select></label>
      <label>视觉辅助<select aria-label="视觉辅助" value={settings?.pdf.visionMode ?? 'auto'} onChange={(event) => void updatePdf({ visionMode: event.target.value as PdfSettings['visionMode'] })}><option value="auto">自动 · 按需附图</option><option value="text">仅文字</option><option value="image">附带截图</option></select></label>
    </section>
    {!model?.capabilities.includes('reasoningEffort') && <small className="quiet">此模型不发送思考参数。</small>}
    <label className="selected-input">所选文字<textarea aria-label="PDF 所选文字" placeholder="在 PDF 中选中 → 右键织语，或在此粘贴。" value={text} onChange={(event) => { cancel(); setText(event.target.value); setRegionImage(''); setPreview([]); }} rows={4} /></label>
    <div className="image-actions"><button onClick={() => void capture()}>截取当前画面</button><button onClick={() => screenshotInput.current?.click()}>导入截图</button><button onClick={() => void reuseImage().catch((error: unknown) => setStatus(String(error)))}>复用最近选区</button>{(screen || regionImage) && <button onClick={() => { cancel(); setScreen(''); setRegionImage(''); setPreview([]); }}>移除图片</button>}</div>
    <input type="file" accept="image/*" aria-label="导入图片文件" hidden ref={screenshotInput} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importImage(file); event.target.value = ''; }} />
    {screen && !regionImage && <ScreenshotCrop url={screen} onSelect={(image) => { cancel(); setRegionImage(image); setScreen(''); setText(''); setPreview([{ page: pageHint, purpose: 'selection', dataUrl: image }]); void rememberImage(image); setStatus('区域已选好。点击翻译准备请求，确认后才会发送图片。'); }} />}
    {!!preview.length && <div className="image-previews">{preview.map((image, index) => <figure key={index}><img src={image.dataUrl} alt="待发送选区截图预览" /><figcaption>仅此区域 · 本地预览</figcaption></figure>)}</div>}
    <div className="translate-actions">{busy ? <button onClick={() => { cancel(); setStatus('已停止。'); }}>停止</button> : <button className="primary" onClick={() => void translate(action, awaiting)}>{awaiting ? '确认发送截图并翻译' : '翻译'}</button>}
      <button disabled={busy || !text} onClick={() => void translate('explain')}>解释语境</button>{result && <button onClick={() => void navigator.clipboard.writeText(result).catch(() => setStatus('请手动选择译文复制。'))}>复制译文</button>}</div>
    <p role="status" className={busy ? 'status working' : 'status'}>{status}</p><RichText text={result} />
    <details className="context-settings" open><summary>上下文 <small>{docName ? `${indexed}/${totalPages} 页已索引` : '按需读取'}</small></summary>
      <label className="check"><input type="checkbox" checked={contextEnabled} onChange={(event) => { cancel(); setContextEnabled(event.target.checked); }} />读取邻近段落与本地检索上下文</label>
      <label>输入预算<select aria-label="PDF 输入预算" value={settings?.pdf.contextBudget ?? 8000} onChange={(event) => void updatePdf({ contextBudget: Number(event.target.value) as 8000 | 16000 })}><option value="8000">8k · 日常阅读</option><option value="16000">16k · 深入理解</option></select></label>
      <div className="page-hint"><label>所在页码<input aria-label="上下文页码" type="number" min="1" max={totalPages || undefined} value={pageHint} onChange={(event) => { cancel(); setPageHint(Math.max(1, Number(event.target.value) || 1)); setSummary(undefined); }} /></label><label className="check"><input type="checkbox" checked={autoLocate} onChange={(event) => { cancel(); setAutoLocate(event.target.checked); }} />自动定位选文</label></div>
      <p className="quiet">{contextNote || '在线 PDF 按需解析；本地 PDF 关联一次同一文件即可。选文重复或公式提取不完整时，请手动修正页码。'}</p>
      {docName && <p className="attached-name" title={docName}>已关联：{docName}</p>}
      <div className="image-actions"><button onClick={() => input.current?.click()}>关联本地 PDF</button><button disabled={!source || busy || !/^https?:/.test(source.url)} onClick={() => { if (!source) return; cancel(); const controller = new AbortController(); operation.current = controller; setBusy(true); void parse(source, controller.signal).catch((error: unknown) => setContextNote(String(error))).finally(() => { if (operation.current === controller) setBusy(false); }); }}>读取当前在线 PDF</button></div>
      <input ref={input} type="file" accept="application/pdf,.pdf" hidden aria-label="关联 PDF 文件" onChange={(event) => { const file = event.target.files?.[0]; if (file) void attach(file); event.target.value = ''; }} />
      <label>PDF 密码（如需）<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" /></label>
      {summary && <small className="quiet">本页摘要已附加到后续请求；切换文档或手动页码会清除。</small>}
    </details>
    <details className="cache-settings"><summary>缓存与隐私</summary><label>保存方式<select aria-label="PDF 缓存保存方式" value={settings?.pdf.cachePersistence ?? 'session'} onChange={(event) => void updatePdf({ cachePersistence: event.target.value as 'session' | 'disk' })}><option value="session">仅本次阅读</option><option value="disk">保存在此设备</option></select></label>
      <label>自动过期<select aria-label="PDF 缓存保留期限" value={settings?.pdf.cacheDays ?? 7} onChange={(event) => void updatePdf({ cacheDays: Number(event.target.value) as 1 | 7 | 30 })}><option value="1">1 天</option><option value="7">7 天</option><option value="30">30 天</option></select></label>
      <label>容量上限<select aria-label="PDF 缓存容量" value={settings?.pdf.cacheMaxMb ?? 64} onChange={(event) => void updatePdf({ cacheMaxMb: Number(event.target.value) as 32 | 64 | 128 })}>{[32, 64, 128].map((mb) => <option key={mb} value={mb}>{mb} MiB</option>)}</select></label>
      <p className="quiet">默认关闭侧边栏后释放会话截图。磁盘缓存存截图、译文和摘要，不存原 PDF；从写入起计时，过期项在启动或读写时清理，满额淘汰最久未用项。设备存储未加密。新请求仍可能需要重新发送图片。</p>
      <button onClick={() => void clearCurrentCache().catch((error: unknown) => setCacheNote(String(error)))}>清除此文档缓存</button><button onClick={() => void clearCache().catch((error: unknown) => setCacheNote(String(error)))}>清除全部 PDF 缓存</button><p className="quiet">{cacheNote}</p>
    </details>
    <footer><span>只在用户操作时调用模型</span><select aria-label="侧边栏主题" value={settings?.pdf.theme ?? 'auto'} onChange={(event) => void updatePdf({ theme: event.target.value as PdfSettings['theme'] })}><option value="auto">跟随系统</option><option value="light">暖纸</option><option value="dark">深墨</option></select></footer>
  </main>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<PdfPanel />);
