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
import { sendRuntimeMessage } from '../../lib/message';
import { pageSettingsForSite, resolveSiteRule } from '../../lib/site-rules';
import { containingContext, extractPage } from '../../content/context';
import { clampFloatingPosition } from '../../content/floating-position';
import { PageTranslator, type PageTranslationStatus } from '../../content/page-translator';
import { resolvePageTheme } from '../../content/page-theme';
import { renderRestrictedMarkdown } from '../../content/rich-translation';
import {
  selectionDotPosition,
  shouldDismissSelectionDot,
  type SelectionAnchorSnapshot,
} from '../../content/selection-anchor';
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

interface SelectionAnchor extends SelectionAnchorSnapshot {
  range: Range;
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

function hasSelectionCard(state: SelectionState | undefined): boolean {
  return Boolean(state && (state.result || state.loading || state.error));
}

function RichTranslation({ className, text, math }: { className?: string; text: string; math?: TranslationUnit['math'] }): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (ref.current) renderRestrictedMarkdown(ref.current, text, math);
  }, [text, math]);
  return <div ref={ref} className={className} />;
}

export default function App(): React.ReactElement | null {
  const [settings, setSettings] = useState<WeaveSettings>();
  const [expanded, setExpanded] = useState(false);
  const [pageStatus, setPageStatus] = useState<PageTranslationStatus>(IDLE_PAGE);
  const [videoStatus, setVideoStatus] = useState<VideoStatus>({ supported: false, enabled: false, state: 'idle' });
  const [selection, setSelection] = useState<SelectionState>();
  const [notice, setNotice] = useState('');
  const [isFullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [detectedTheme, setDetectedTheme] = useState(() => resolvePageTheme('auto'));
  const translatorRef = useRef<PageTranslator | undefined>(undefined);
  const videoRef = useRef<VideoController | undefined>(undefined);
  const selectionCardRef = useRef<HTMLElement | null>(null);
  const selectionAnchorRef = useRef<SelectionAnchor | undefined>(undefined);
  const selectionCardDraggingRef = useRef(false);
  const dockDraggedRef = useRef(false);
  const retractTimer = useRef<number | undefined>(undefined);
  const host = location.hostname;

  const siteRule = useMemo(() => resolveSiteRule(settings?.siteRules ?? {}, host), [host, settings?.siteRules]);
  const pageSettings = useMemo(() => settings ? pageSettingsForSite(settings, siteRule) : undefined, [settings, siteRule]);

  useEffect(() => {
    let frame = 0;
    let observedBody: HTMLElement | null = null;
    const observeBody = () => {
      if (!document.body || document.body === observedBody) return;
      observedBody = document.body;
      observer.observe(observedBody, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode'] });
    };
    const refresh = () => {
      observeBody();
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setDetectedTheme(resolvePageTheme(pageSettings?.pageTheme ?? 'auto'));
        translatorRef.current?.refreshTheme();
      });
    };
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, childList: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode'] });
    observeBody();
    const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', refresh);
    window.addEventListener('load', refresh);
    const refreshTimers = [window.setTimeout(refresh, 300), window.setTimeout(refresh, 1_600)];
    refresh();
    return () => {
      window.cancelAnimationFrame(frame);
      refreshTimers.forEach((timer) => window.clearTimeout(timer));
      observer.disconnect();
      media?.removeEventListener('change', refresh);
      window.removeEventListener('load', refresh);
    };
  }, [pageSettings?.pageTheme]);

  useEffect(() => {
    void sendRuntimeMessage<WeaveSettings>({ type: 'GET_SETTINGS' }).then((loaded) => {
      setSettings(loaded);
      const resolvedRule = resolveSiteRule(loaded.siteRules, host);
      translatorRef.current = new PageTranslator(pageSettingsForSite(loaded, resolvedRule), setPageStatus);
      videoRef.current = new VideoController(loaded, setVideoStatus);
      setVideoStatus({ supported: videoRef.current.supported, enabled: false, state: 'idle' });
      const rule = resolvedRule;
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
    if (!settings?.selectionEnabled || siteRule.paused) {
      selectionAnchorRef.current = undefined;
      setSelection((current) => hasSelectionCard(current) ? current : undefined);
      return;
    }
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
        const range = browserSelection.getRangeAt(0).cloneRange();
        const rect = range.getBoundingClientRect();
        const position = selectionDotPosition(rect, { width: window.innerWidth, height: window.innerHeight });
        selectionAnchorRef.current = {
          range,
          rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        };
        setSelection({
          unit,
          ...position,
          loading: false,
        });
      }, 10);
    };
    document.addEventListener('pointerup', onPointerUp);
    return () => document.removeEventListener('pointerup', onPointerUp);
  }, [settings?.selectionEnabled, siteRule.paused]);

  const selectionCardVisible = hasSelectionCard(selection);
  const selectionDotVisible = Boolean(selection && !selectionCardVisible);

  useEffect(() => {
    if (!selectionDotVisible) return;
    let frame = 0;
    const dismiss = () => {
      selectionAnchorRef.current = undefined;
      setSelection((current) => hasSelectionCard(current) ? current : undefined);
    };
    const updatePosition = () => {
      const anchor = selectionAnchorRef.current;
      if (!anchor) {
        dismiss();
        return;
      }
      const rect = anchor.range.getBoundingClientRect();
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      if (shouldDismissSelectionDot(
        anchor,
        { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        { x: window.scrollX, y: window.scrollY },
        viewport,
      )) {
        dismiss();
        return;
      }
      const next = selectionDotPosition(rect, viewport);
      setSelection((current) => {
        if (!current || hasSelectionCard(current)) return current;
        if (Math.abs(current.x - next.x) < 0.5 && Math.abs(current.y - next.y) < 0.5) return current;
        return { ...current, ...next };
      });
    };
    const schedulePositionUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updatePosition);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (isWeaveInteraction(event)) return;
      window.getSelection()?.removeAllRanges();
      dismiss();
    };
    const onSelectionChange = () => {
      const browserSelection = window.getSelection();
      const selectedText = browserSelection?.toString().replace(/\s+/g, ' ').trim() ?? '';
      if (!browserSelection || browserSelection.isCollapsed || selectedText !== selection?.unit.text) dismiss();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('scroll', schedulePositionUpdate, true);
    window.addEventListener('resize', schedulePositionUpdate);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('scroll', schedulePositionUpdate, true);
      window.removeEventListener('resize', schedulePositionUpdate);
    };
  }, [selectionDotVisible, selection?.unit.id, selection?.unit.text]);

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
    translatorRef.current?.updateSettings(pageSettingsForSite(next, resolveSiteRule(next.siteRules, host)));
    videoRef.current?.updateSettings(next);
    return next;
  }, [host]);

  const saveSiteRule = useCallback(
    async (patch: Partial<SiteRule>) => {
      const next = await sendRuntimeMessage<WeaveSettings>({ type: 'SAVE_SITE_RULE', host, patch });
      setSettings(next);
      translatorRef.current?.updateSettings(pageSettingsForSite(next, resolveSiteRule(next.siteRules, host)));
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
    await saveSiteRule({ pageMode: mode });
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
    selectionAnchorRef.current = undefined;
    const { error: _error, ...withoutError } = selection;
    const needsContext = settings.contextEnabled && !translatorRef.current?.contextFor('selection', settings.targetLanguage);
    setSelection({ ...withoutError, loading: true, loadingStage: needsContext ? 'context' : 'translation' });
    try {
      const context: ContextBrief | undefined = settings.contextEnabled ? await translatorRef.current?.ensureContext('selection', settings.targetLanguage) : undefined;
      setSelection((current) => current?.unit.id === selection.unit.id ? { ...current, loadingStage: 'translation' } : current);
      const result = await sendRuntimeMessage<TranslationResult>({
        type: 'TRANSLATE',
        task: {
          id: crypto.randomUUID(),
          kind: 'selection',
          scope: 'selection',
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
      const selectionContext = translatorRef.current?.contextFor('selection', settings.targetLanguage);
      const result = await sendRuntimeMessage<TranslationResult>({
        type: 'TRANSLATE',
        task: {
          id: crypto.randomUUID(),
          kind: 'explain',
          scope: 'selection',
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          units: [{ ...selection.unit, text: `原文：${selection.unit.text}\n译文：${selection.result}` }],
          ...(selectionContext ? { context: selectionContext } : {}),
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
    dockDraggedRef.current = false;
    const startX = event.clientX;
    const startY = event.clientY;
    const originalY = settings.dock.yRatio;
    let side: DockSide = settings.dock.side;
    let yRatio = originalY;
    const move = (pointer: PointerEvent) => {
      if (Math.hypot(pointer.clientX - startX, pointer.clientY - startY) > 5) dockDraggedRef.current = true;
      side = pointer.clientX < window.innerWidth / 2 ? 'left' : 'right';
      yRatio = Math.max(0.08, Math.min(0.92, originalY + (pointer.clientY - startY) / window.innerHeight));
      setSettings((current) => (current ? { ...current, dock: { ...current.dock, side, yRatio } } : current));
    };
    const up = async () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const current = await sendRuntimeMessage<WeaveSettings>({ type: 'SAVE_DOCK_STATE', patch: { side, yRatio } });
      setSettings(current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', up, { once: true });
  };

  const toggleDock = () => {
    if (dockDraggedRef.current) {
      dockDraggedRef.current = false;
      return;
    }
    setExpanded((value) => !value);
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

  if (!settings || !pageSettings || siteRule.hidden) return null;
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
    <div className={`weave-shell weave-theme-${detectedTheme}`} data-weave-root="true">
      <aside
        className={`weave-dock weave-dock--${side} ${expanded || settings.dock.pinned ? 'is-open' : ''} ${isFullscreen ? 'is-fullscreen' : ''}`}
        style={{ '--weave-y': `${settings.dock.yRatio * 100}vh` } as React.CSSProperties}
        onPointerEnter={() => {
          if (retractTimer.current) window.clearTimeout(retractTimer.current);
        }}
        onPointerLeave={() => {
          if (!settings.dock.pinned) retractTimer.current = window.setTimeout(() => setExpanded(false), 600);
        }}
      >
        <button className="weave-grip" onPointerDown={dragDock} onClick={toggleDock} aria-label="拖动位置或点击打开织语" aria-expanded={expanded || settings.dock.pinned}>
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
              <button key={mode} className={pageSettings.dock.pageMode === mode ? 'is-active' : ''} onClick={() => void setPageMode(mode)}>
                {{ original: '原文', bilingual: '双语', translated: '译文' }[mode]}
              </button>
            ))}
          </div>

          <div className="weave-field-row">
            <label>
              <span>译为</span>
              <select value={pageSettings.targetLanguage} onChange={(event) => void saveSiteRule({ targetLanguage: event.target.value })}>
                <option value="zh-CN">简体中文</option>
                <option value="zh-TW">繁體中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
              </select>
            </label>
            <label>
              <span>思考</span>
              <select value={pageSettings.reasoning.page} onChange={(event) => void saveSiteRule({ reasoningMode: event.target.value as WeaveSettings['reasoning']['page'] })}>
                <option value="compatible">兼容</option>
                <option value="fast">快速</option>
                <option value="balanced">均衡</option>
                <option value="deep">深入</option>
              </select>
            </label>
            <label>
              <span>主题</span>
              <select value={siteRule.theme ?? settings.pageTheme} onChange={(event) => void saveSiteRule({ theme: event.target.value as WeaveSettings['pageTheme'] })}>
                <option value="auto">自动</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
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
              <label className="weave-compact-field"><span>字幕思考</span><select value={settings.reasoning.subtitle} onChange={(event) => void persistSettings({ reasoning: { ...settings.reasoning, subtitle: event.target.value as WeaveSettings['reasoning']['subtitle'] } })}><option value="compatible">兼容</option><option value="fast">快速</option><option value="balanced">均衡</option><option value="deep">深入</option></select></label>
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

      {selectionDotVisible && selection && (
        <button className="weave-selection-dot" style={{ left: selection.x, top: selection.y }} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={() => void translateSelection()} aria-label="翻译所选文本">译</button>
      )}

      {selection && (selection.result || selection.loading || selection.error) && (
        <section ref={selectionCardRef} className="weave-selection-card" style={{ left: selectionCardPosition?.x, top: selectionCardPosition?.y }} aria-busy={selection.loading}>
          <header onPointerDown={dragSelectionCard} onKeyDown={moveSelectionCardWithKeyboard} tabIndex={0} aria-label="拖动划词翻译卡片">
            <span><i aria-hidden="true">⠿</i> 上下文划词</span><button onClick={() => setSelection(undefined)} aria-label="关闭划词翻译">×</button>
          </header>
          <blockquote><RichTranslation text={selection.unit.text} math={selection.unit.math} /></blockquote>
          {selection.loading && <div className="weave-loading-state" role="status" aria-live="polite">
            <span>{{ context: '正在理解页面语境…', translation: '正在翻译所选文本…', explanation: '正在解释翻译语境…' }[selection.loadingStage ?? 'translation']}</span>
            <div className="weave-loading" aria-hidden="true"><i /><i /><i /></div>
            <small>{settings.reasoning.selection === 'deep' ? '划词当前为深入思考，复杂内容可能需要更长时间' : `划词当前为${{ compatible: '兼容', fast: '快速', balanced: '均衡', deep: '深入' }[settings.reasoning.selection]}模式`}</small>
          </div>}
          {selection.result && <RichTranslation className="weave-selection-result" text={selection.result} math={selection.unit.math} />}
          {selection.explanation && <RichTranslation className="weave-explanation" text={selection.explanation} math={selection.unit.math} />}
          {selection.error && <p className="weave-notice">{selection.error}</p>}
          <label className="weave-selection-mode"><span>划词思考</span><select value={settings.reasoning.selection} onChange={(event) => void persistSettings({ reasoning: { ...settings.reasoning, selection: event.target.value as WeaveSettings['reasoning']['selection'] } })}><option value="compatible">兼容</option><option value="fast">快速</option><option value="balanced">均衡</option><option value="deep">深入</option></select></label>
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
