import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ContextBrief,
  DockSide,
  PageMode,
  SiteRule,
  TranslationResult,
  TranslationUnit,
  WeaveSettings,
} from '../../lib/contracts';
import { DEFAULT_SITE_RULE } from '../../lib/defaults';
import { sendRuntimeMessage } from '../../lib/message';
import { containingContext, extractPage } from '../../content/context';
import { clampFloatingPosition } from '../../content/floating-position';
import { PageTranslator, type PageTranslationStatus } from '../../content/page-translator';
import { VideoController, type VideoStatus } from '../../content/video-controller';

interface SelectionState {
  unit: TranslationUnit;
  x: number;
  y: number;
  result?: string;
  explanation?: string;
  loading: boolean;
  loadingStage?: 'context' | 'translation' | 'explanation' | undefined;
  error?: string;
}

const IDLE_PAGE: PageTranslationStatus = { state: 'idle', completed: 0, total: 0 };

function pageStatusLabel(status: PageTranslationStatus): string {
  switch (status.state) {
    case 'analyzing':
      return '正在理解页面';
    case 'translating':
      return `翻译 ${status.completed}/${status.total}`;
    case 'translated':
      return `已翻译 ${status.completed} 段`;
    case 'error':
      return status.message ?? '翻译失败';
    default:
      return '页面待翻译';
  }
}

function isWeaveInteraction(event: Event): boolean {
  return event.composedPath().some((target) => (
    target instanceof Element && (target.matches('[data-weave-root]') || target.tagName === 'WEAVE-TRANSLATION-ROOT')
  ));
}

export default function App(): React.ReactElement | null {
  const [settings, setSettings] = useState<WeaveSettings>();
  const [expanded, setExpanded] = useState(false);
  const [pageStatus, setPageStatus] = useState<PageTranslationStatus>(IDLE_PAGE);
  const [videoStatus, setVideoStatus] = useState<VideoStatus>({ supported: false, enabled: false, state: 'idle' });
  const [selection, setSelection] = useState<SelectionState>();
  const [notice, setNotice] = useState('');
  const [isFullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const translatorRef = useRef<PageTranslator | undefined>(undefined);
  const videoRef = useRef<VideoController | undefined>(undefined);
  const selectionCardRef = useRef<HTMLElement | null>(null);
  const selectionCardDraggingRef = useRef(false);
  const retractTimer = useRef<number | undefined>(undefined);
  const host = location.hostname;

  const siteRule = useMemo(() => ({ ...DEFAULT_SITE_RULE, ...settings?.siteRules[host] }), [host, settings]);

  useEffect(() => {
    void sendRuntimeMessage<WeaveSettings>({ type: 'GET_SETTINGS' }).then((loaded) => {
      setSettings(loaded);
      translatorRef.current = new PageTranslator(loaded, setPageStatus);
      videoRef.current = new VideoController(loaded, setVideoStatus);
      setVideoStatus({ supported: videoRef.current.supported, enabled: false, state: 'idle' });
      const rule = { ...DEFAULT_SITE_RULE, ...loaded.siteRules[host] };
      if (rule.autoTranslate && !rule.paused) void translatorRef.current.start();
    });
    const fullscreenListener = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', fullscreenListener);
    return () => {
      document.removeEventListener('fullscreenchange', fullscreenListener);
      translatorRef.current?.stop();
      videoRef.current?.disable(false);
    };
  }, [host]);

  useEffect(() => {
    if (!settings?.selectionEnabled || siteRule.paused) return;
    const onPointerUp = (event: PointerEvent) => {
      if (selectionCardDraggingRef.current) return;
      if (isWeaveInteraction(event)) return;
      window.setTimeout(() => {
        const browserSelection = window.getSelection();
        if (!browserSelection || browserSelection.isCollapsed) return;
        const anchor = browserSelection.anchorNode instanceof Element ? browserSelection.anchorNode : browserSelection.anchorNode?.parentElement;
        if (anchor?.closest('input,textarea,select,[contenteditable="true"],pre,code')) return;
        const unit = containingContext(browserSelection, translatorRef.current?.snapshot ?? extractPage().snapshot);
        if (!unit) return;
        const rect = browserSelection.getRangeAt(0).getBoundingClientRect();
        setSelection({
          unit,
          x: Math.min(window.innerWidth - 54, Math.max(12, rect.right + 6)),
          y: Math.min(window.innerHeight - 54, Math.max(12, rect.bottom + 8)),
          loading: false,
        });
      }, 10);
    };
    document.addEventListener('pointerup', onPointerUp);
    return () => document.removeEventListener('pointerup', onPointerUp);
  }, [settings?.selectionEnabled, siteRule.paused]);

  const selectionCardVisible = Boolean(selection && (selection.result || selection.loading || selection.error));
  useEffect(() => {
    if (!selectionCardVisible) return;
    const keepInViewport = () => {
      const card = selectionCardRef.current;
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const next = clampFloatingPosition(
        { x: rect.left, y: rect.top },
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
      );
      setSelection((current) => {
        if (!current || (Math.abs(current.x - next.x) < 0.5 && Math.abs(current.y - next.y) < 0.5)) return current;
        return { ...current, ...next };
      });
    };
    const frame = window.requestAnimationFrame(keepInViewport);
    window.addEventListener('resize', keepInViewport);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', keepInViewport);
    };
  }, [selectionCardVisible, selection?.unit.id]);

  useEffect(() => {
    const listener = (message: unknown) => {
      if ((message as { type?: string })?.type === 'TOGGLE_PAGE_TRANSLATION') void togglePage();
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  });

  const persistSettings = useCallback(async (patch: Partial<WeaveSettings>) => {
    const next = await sendRuntimeMessage<WeaveSettings>({ type: 'SAVE_SETTINGS', patch });
    setSettings(next);
    translatorRef.current?.updateSettings(next);
    videoRef.current?.updateSettings(next);
    return next;
  }, []);

  const saveSiteRule = useCallback(
    async (patch: Partial<SiteRule>) => {
      const next = await sendRuntimeMessage<WeaveSettings>({ type: 'SAVE_SITE_RULE', host, patch });
      setSettings(next);
      translatorRef.current?.updateSettings(next);
      videoRef.current?.updateSettings(next);
    },
    [host],
  );

  const togglePage = useCallback(async () => {
    if (!translatorRef.current || siteRule.paused) return;
    setNotice('');
    if (translatorRef.current.currentStatus.state !== 'idle' && translatorRef.current.currentStatus.state !== 'error') {
      translatorRef.current.stop();
      return;
    }
    try {
      await translatorRef.current.start();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '翻译失败');
    }
  }, [siteRule.paused]);

  const setPageMode = async (mode: PageMode) => {
    if (!settings) return;
    translatorRef.current?.setMode(mode);
    await persistSettings({ dock: { ...settings.dock, pageMode: mode } });
  };

  const toggleVideo = async () => {
    if (!settings || !videoRef.current) return;
    setNotice('');
    if (videoStatus.enabled) {
      videoRef.current.disable();
      await persistSettings({ video: { ...settings.video, enabled: false } });
      return;
    }
    try {
      await videoRef.current.enable();
      await persistSettings({ video: { ...settings.video, enabled: true } });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '字幕翻译失败');
    }
  };

  const translateSelection = async () => {
    if (!selection || !settings) return;
    const { error: _error, ...withoutError } = selection;
    const needsContext = settings.contextEnabled && !translatorRef.current?.currentContext;
    setSelection({ ...withoutError, loading: true, loadingStage: needsContext ? 'context' : 'translation' });
    try {
      const context: ContextBrief | undefined = settings.contextEnabled ? await translatorRef.current?.ensureContext() : undefined;
      setSelection((current) => current?.unit.id === selection.unit.id ? { ...current, loadingStage: 'translation' } : current);
      const result = await sendRuntimeMessage<TranslationResult>({
        type: 'TRANSLATE',
        task: {
          id: crypto.randomUUID(),
          kind: 'selection',
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          units: [selection.unit],
          ...(context ? { context } : {}),
          stream: true,
        },
      });
      setSelection((current) => (current ? { ...current, loading: false, loadingStage: undefined, result: result.items[0]?.text ?? '' } : current));
    } catch (error) {
      setSelection((current) => (current ? { ...current, loading: false, loadingStage: undefined, error: error instanceof Error ? error.message : '划词翻译失败' } : current));
    }
  };

  const explainSelection = async () => {
    if (!selection?.result || !settings) return;
    setSelection({ ...selection, loading: true, loadingStage: 'explanation' });
    try {
      const result = await sendRuntimeMessage<TranslationResult>({
        type: 'TRANSLATE',
        task: {
          id: crypto.randomUUID(),
          kind: 'explain',
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          units: [{ ...selection.unit, text: `原文：${selection.unit.text}\n译文：${selection.result}` }],
          ...(translatorRef.current?.currentContext ? { context: translatorRef.current.currentContext } : {}),
        },
      });
      setSelection((current) => (current ? { ...current, loading: false, loadingStage: undefined, explanation: result.items[0]?.text ?? '' } : current));
    } catch (error) {
      setSelection((current) => (current ? { ...current, loading: false, loadingStage: undefined, error: error instanceof Error ? error.message : '语境解释失败' } : current));
    }
  };

  const dragDock = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!settings) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const originalY = settings.dock.yRatio;
    let side: DockSide = settings.dock.side;
    let yRatio = originalY;
    const move = (pointer: PointerEvent) => {
      side = pointer.clientX < window.innerWidth / 2 ? 'left' : 'right';
      yRatio = Math.max(0.08, Math.min(0.92, originalY + (pointer.clientY - startY) / window.innerHeight));
      setSettings((current) => (current ? { ...current, dock: { ...current.dock, side, yRatio } } : current));
    };
    const up = async () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const current = await sendRuntimeMessage<WeaveSettings>({ type: 'SAVE_DOCK_STATE', patch: { side, yRatio } });
      setSettings(current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  const dragSelectionCard = (event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as Element).closest('button')) return;
    const card = selectionCardRef.current;
    if (!card) return;
    selectionCardDraggingRef.current = true;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = card.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY };
    const origin = { x: rect.left, y: rect.top };
    const size = { width: rect.width, height: rect.height };
    const move = (pointer: PointerEvent) => {
      const next = clampFloatingPosition(
        { x: origin.x + pointer.clientX - start.x, y: origin.y + pointer.clientY - start.y },
        size,
        { width: window.innerWidth, height: window.innerHeight },
      );
      setSelection((current) => (current ? { ...current, ...next } : current));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      selectionCardDraggingRef.current = false;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', up, { once: true });
  };

  const moveSelectionCardWithKeyboard = (event: React.KeyboardEvent<HTMLElement>) => {
    const directions: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
    };
    const direction = directions[event.key];
    const card = selectionCardRef.current;
    if (!direction || !card || !selection) return;
    event.preventDefault();
    const rect = card.getBoundingClientRect();
    const step = event.shiftKey ? 48 : 16;
    const next = clampFloatingPosition(
      { x: selection.x + direction.x * step, y: selection.y + direction.y * step },
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setSelection({ ...selection, ...next });
  };

  if (!settings || siteRule.hidden) return null;
  const active = pageStatus.state !== 'idle' && pageStatus.state !== 'error';
  const side = settings.dock.side;
  const progress = pageStatus.total ? Math.round((pageStatus.completed / pageStatus.total) * 100) : 0;
  const selectionCardPosition = selection
    ? clampFloatingPosition(
        { x: selection.x, y: selection.y },
        { width: Math.min(348, window.innerWidth - 24), height: Math.min(310, window.innerHeight - 24) },
        { width: window.innerWidth, height: window.innerHeight },
      )
    : undefined;

  return (
    <div className="weave-shell" data-weave-root="true">
      <aside
        className={`weave-dock weave-dock--${side} ${expanded || settings.dock.pinned ? 'is-open' : ''} ${isFullscreen ? 'is-fullscreen' : ''}`}
        style={{ '--weave-y': `${settings.dock.yRatio * 100}vh` } as React.CSSProperties}
        onPointerEnter={() => {
          if (retractTimer.current) window.clearTimeout(retractTimer.current);
          setExpanded(true);
        }}
        onPointerLeave={() => {
          if (!settings.dock.pinned) retractTimer.current = window.setTimeout(() => setExpanded(false), 600);
        }}
      >
        <button className="weave-grip" onPointerDown={dragDock} onClick={() => setExpanded((value) => !value)} aria-label="拖动或展开织语">
          <span className="weave-mark">织</span>
        </button>

        <section className="weave-panel" aria-label="织语快捷设置">
          <header className="weave-panel__header">
            <div>
              <span className="weave-kicker">WEAVE / 织语</span>
              <strong>{siteRule.paused ? '本站已暂停' : pageStatusLabel(pageStatus)}</strong>
            </div>
            <button
              className={`weave-icon-button ${settings.dock.pinned ? 'is-active' : ''}`}
              title={settings.dock.pinned ? '取消固定' : '固定展开'}
              onClick={() => void persistSettings({ dock: { ...settings.dock, pinned: !settings.dock.pinned } })}
            >
              ◇
            </button>
          </header>

          {(pageStatus.state === 'analyzing' || pageStatus.state === 'translating') && (
            <div className="weave-progress"><span style={{ width: `${Math.max(8, progress)}%` }} /></div>
          )}

          <button className={`weave-primary ${active ? 'is-stop' : ''}`} onClick={() => void togglePage()} disabled={siteRule.paused}>
            <span>{active ? '停止翻译' : pageStatus.state === 'error' ? '重试本页' : '翻译本页'}</span>
            <span aria-hidden="true">{active ? '■' : '↗'}</span>
          </button>

          <div className="weave-segment" aria-label="页面显示模式">
            {(['original', 'bilingual', 'translated'] as PageMode[]).map((mode) => (
              <button key={mode} className={settings.dock.pageMode === mode ? 'is-active' : ''} onClick={() => void setPageMode(mode)}>
                {{ original: '原文', bilingual: '双语', translated: '译文' }[mode]}
              </button>
            ))}
          </div>

          <div className="weave-field-row">
            <label>
              <span>译为</span>
              <select value={settings.targetLanguage} onChange={(event) => void persistSettings({ targetLanguage: event.target.value })}>
                <option value="zh-CN">简体中文</option>
                <option value="zh-TW">繁體中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
              </select>
            </label>
            <label>
              <span>思考</span>
              <select value={settings.provider.reasoningMode} onChange={(event) => void persistSettings({ provider: { ...settings.provider, reasoningMode: event.target.value as WeaveSettings['provider']['reasoningMode'] } })}>
                <option value="compatible">兼容</option>
                <option value="fast">快速</option>
                <option value="balanced">均衡</option>
                <option value="deep">深入</option>
              </select>
            </label>
            <span className={`weave-model-dot ${settings.provider.hasApiKey ? 'is-ready' : ''}`} title={settings.provider.hasApiKey ? '模型已配置' : '需要 API Key'} />
          </div>

          <div className="weave-switch-list">
            <label><span>智能上下文<small>页面摘要与邻近段落</small></span><input type="checkbox" checked={settings.contextEnabled} onChange={(event) => void persistSettings({ contextEnabled: event.target.checked })} /></label>
            <label><span>划词翻译<small>选中文本后显示小圆点</small></span><input type="checkbox" checked={settings.selectionEnabled} onChange={(event) => void persistSettings({ selectionEnabled: event.target.checked })} /></label>
            <label><span>本站自动翻译<small>仅在下次访问时触发</small></span><input type="checkbox" checked={siteRule.autoTranslate} onChange={(event) => void saveSiteRule({ autoTranslate: event.target.checked })} /></label>
          </div>

          {videoStatus.supported && (
            <div className="weave-video-card">
              <div className="weave-card-title"><span>VIDEO / 字幕</span><i>{videoStatus.state === 'ready' ? 'SYNC' : 'LOCAL'}</i></div>
              <button className="weave-secondary" onClick={() => void toggleVideo()}>{videoStatus.enabled ? '关闭字幕翻译' : '开启字幕翻译'}</button>
              <div className="weave-segment weave-segment--small">
                <button className={settings.video.mode === 'bilingual' ? 'is-active' : ''} onClick={() => void persistSettings({ video: { ...settings.video, mode: 'bilingual' } })}>双语</button>
                <button className={settings.video.mode === 'translated' ? 'is-active' : ''} onClick={() => void persistSettings({ video: { ...settings.video, mode: 'translated' } })}>仅译文</button>
              </div>
              <label className="weave-slider"><span>字号</span><input type="range" min="0.75" max="1.6" step="0.05" value={settings.video.fontScale} onChange={(event) => void persistSettings({ video: { ...settings.video, fontScale: Number(event.target.value) } })} /></label>
            </div>
          )}

          {(notice || pageStatus.message || videoStatus.message) && <p className="weave-notice">{notice || pageStatus.message || videoStatus.message}</p>}

          <footer>
            <button onClick={() => void saveSiteRule({ paused: !siteRule.paused })}>{siteRule.paused ? '恢复本站' : '暂停本站'}</button>
            <button onClick={() => void saveSiteRule({ hidden: true })}>隐藏本站</button>
            <span>{settings.provider.label} · {settings.provider.model}</span>
            <button onClick={() => void sendRuntimeMessage({ type: 'OPEN_OPTIONS' })}>设置</button>
          </footer>
        </section>
      </aside>

      {selection && !selection.result && !selection.loading && !selection.error && (
        <button className="weave-selection-dot" style={{ left: selection.x, top: selection.y }} onPointerDown={(event) => event.stopPropagation()} onClick={() => void translateSelection()} aria-label="翻译所选文本">译</button>
      )}

      {selection && (selection.result || selection.loading || selection.error) && (
        <section ref={selectionCardRef} className="weave-selection-card" style={{ left: selectionCardPosition?.x, top: selectionCardPosition?.y }} aria-busy={selection.loading}>
          <header onPointerDown={dragSelectionCard} onKeyDown={moveSelectionCardWithKeyboard} tabIndex={0} aria-label="拖动划词翻译卡片">
            <span><i aria-hidden="true">⠿</i> 上下文划词</span><button onClick={() => setSelection(undefined)} aria-label="关闭划词翻译">×</button>
          </header>
          <blockquote>{selection.unit.text}</blockquote>
          {selection.loading && <div className="weave-loading-state" role="status" aria-live="polite">
            <span>{{ context: '正在理解页面语境…', translation: '正在翻译所选文本…', explanation: '正在解释翻译语境…' }[selection.loadingStage ?? 'translation']}</span>
            <div className="weave-loading" aria-hidden="true"><i /><i /><i /></div>
            <small>{settings.provider.reasoningMode === 'deep' ? '当前为深入思考，复杂内容可能需要更长时间' : '结果会直接显示在这张卡片中'}</small>
          </div>}
          {selection.result && <p className="weave-selection-result">{selection.result}</p>}
          {selection.explanation && <p className="weave-explanation">{selection.explanation}</p>}
          {selection.error && <p className="weave-notice">{selection.error}</p>}
          <div className="weave-card-actions">
            {selection.result && !selection.explanation && <button onClick={() => void explainSelection()}>解释语境</button>}
            {selection.error && <button onClick={() => void translateSelection()}>重试</button>}
            {selection.result && <button onClick={() => void navigator.clipboard.writeText(selection.result!)}>复制译文</button>}
          </div>
        </section>
      )}
    </div>
  );
}
