import type { ContextBrief, SubtitleSentence, TranslationResult, VideoSettings, WeaveSettings } from '../lib/contracts';
import { sendRuntimeMessage } from '../lib/message';
import { loadBilibiliSubtitles, loadYoutubeSubtitles } from './subtitles/adapters';
import { segmentCues, sentenceAt } from './subtitles/segmenter';

export interface VideoStatus {
  supported: boolean;
  enabled: boolean;
  state: 'idle' | 'loading' | 'ready' | 'error';
  message?: string;
}

export class VideoController {
  private settings: WeaveSettings;
  private sentences: SubtitleSentence[] = [];
  private translations = new Map<string, string>();
  private pending = new Set<string>();
  private overlay: HTMLDivElement | undefined;
  private video: HTMLVideoElement | undefined;
  private timer: number | undefined;
  private generation = 0;
  private context: ContextBrief | undefined;

  constructor(settings: WeaveSettings, private readonly onStatus: (status: VideoStatus) => void) {
    this.settings = settings;
  }

  get supported(): boolean {
    return /(^|\.)youtube\.com$/.test(location.hostname) || /(^|\.)bilibili\.com$/.test(location.hostname);
  }

  updateSettings(settings: WeaveSettings): void {
    this.settings = settings;
    this.applyOverlayStyle(settings.video);
    this.renderCurrent();
  }

  async enable(): Promise<void> {
    if (!this.supported) return;
    const generation = ++this.generation;
    this.onStatus({ supported: true, enabled: true, state: 'loading', message: '正在读取字幕…' });
    try {
      const result = location.hostname.includes('youtube.com') ? await loadYoutubeSubtitles() : await loadBilibiliSubtitles();
      if (generation !== this.generation) return;
      this.sentences = segmentCues(result.cues);
      if (!this.sentences.length) throw new Error('当前视频暂无可用字幕。');
      this.video = document.querySelector('video') ?? undefined;
      if (!this.video) throw new Error('暂未找到视频播放器。');
      this.mountOverlay();
      await this.buildContext(result.title, result.language);
      this.timer = window.setInterval(() => {
        this.renderCurrent();
        void this.prefetch();
      }, 240);
      this.video.addEventListener('seeked', this.onSeeked);
      this.onStatus({ supported: true, enabled: true, state: 'ready' });
      await this.prefetch();
    } catch (error) {
      this.disable(false);
      this.onStatus({
        supported: true,
        enabled: false,
        state: 'error',
        message: error instanceof Error ? error.message : '视频字幕初始化失败。',
      });
      throw error;
    }
  }

  disable(emit = true): void {
    this.generation += 1;
    if (this.timer) window.clearInterval(this.timer);
    this.video?.removeEventListener('seeked', this.onSeeked);
    this.overlay?.remove();
    this.overlay = undefined;
    this.sentences = [];
    this.translations.clear();
    this.pending.clear();
    this.context = undefined;
    if (emit) this.onStatus({ supported: this.supported, enabled: false, state: 'idle' });
  }

  private readonly onSeeked = () => {
    this.generation += 1;
    this.pending.clear();
    void this.prefetch();
  };

  private mountOverlay(): void {
    this.overlay?.remove();
    const overlay = document.createElement('div');
    overlay.dataset.weaveTranslation = 'video-overlay';
    overlay.setAttribute('aria-live', 'polite');
    overlay.style.cssText = 'position:absolute;left:8%;right:8%;z-index:2147483000;display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none;text-align:center;';
    const container = location.hostname.includes('youtube.com')
      ? document.querySelector<HTMLElement>('.html5-video-player')
      : document.querySelector<HTMLElement>('#bilibili-player, .bpx-player-container');
    if (!container) throw new Error('暂未找到受支持的播放器容器。');
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.append(overlay);
    this.overlay = overlay;
    this.applyOverlayStyle(this.settings.video);
  }

  private applyOverlayStyle(settings: VideoSettings): void {
    if (!this.overlay) return;
    this.overlay.style.bottom = `${settings.bottomOffset}%`;
    this.overlay.style.fontSize = `${Math.max(0.75, Math.min(1.6, settings.fontScale))}rem`;
  }

  private async buildContext(title: string, language: string): Promise<void> {
    if (!this.settings.contextEnabled) return;
    const sample = this.sentences.slice(0, 60).map((sentence) => sentence.text).join('\n');
    const result = await sendRuntimeMessage<TranslationResult>({
      type: 'TRANSLATE',
      task: {
        id: crypto.randomUUID(),
        kind: 'summary',
        scope: 'subtitle',
        sourceLanguage: language,
        targetLanguage: this.settings.targetLanguage,
        units: [{ id: 'video-summary', text: `Video title: ${title}\n\n${sample}` }],
      },
    });
    try {
      this.context = JSON.parse(result.items[0]?.text ?? '') as ContextBrief;
    } catch {
      this.context = { summary: title, terms: [] };
    }
  }

  private async prefetch(): Promise<void> {
    if (!this.video || !this.sentences.length) return;
    const generation = this.generation;
    const from = Math.max(0, this.video.currentTime - 2);
    const to = this.video.currentTime + 45;
    const candidates = this.sentences
      .filter((sentence) => sentence.end >= from && sentence.start <= to)
      .filter((sentence) => !this.translations.has(sentence.id) && !this.pending.has(sentence.id))
      .slice(0, 8);
    if (!candidates.length) return;
    candidates.forEach((sentence) => this.pending.add(sentence.id));
    try {
      const result = await sendRuntimeMessage<TranslationResult>({
        type: 'TRANSLATE',
        task: {
          id: crypto.randomUUID(),
          kind: 'subtitle',
          scope: 'subtitle',
          sourceLanguage: 'auto',
          targetLanguage: this.settings.targetLanguage,
          units: candidates.map((sentence, index) => ({
            id: sentence.id,
            text: sentence.text,
            ...(this.sentences[this.sentences.indexOf(sentence) - 1]?.text ? { before: this.sentences[this.sentences.indexOf(sentence) - 1]!.text } : {}),
            ...(this.sentences[this.sentences.indexOf(sentence) + 1]?.text ? { after: this.sentences[this.sentences.indexOf(sentence) + 1]!.text } : {}),
          })),
          ...(this.context ? { context: this.context } : {}),
        },
      });
      if (generation !== this.generation) return;
      result.items.forEach((item) => {
        if (item.text && !item.error) this.translations.set(item.id, item.text);
      });
    } catch (error) {
      this.onStatus({ supported: true, enabled: true, state: 'error', message: error instanceof Error ? error.message : '字幕翻译失败。' });
    } finally {
      candidates.forEach((sentence) => this.pending.delete(sentence.id));
      this.renderCurrent();
    }
  }

  private renderCurrent(): void {
    if (!this.video || !this.overlay) return;
    const sentence = sentenceAt(this.sentences, this.video.currentTime);
    this.overlay.replaceChildren();
    if (!sentence) return;
    const translated = this.translations.get(sentence.id) ?? '翻译中…';
    const lineStyle = [
      'max-width:100%',
      'padding:.2em .56em',
      'border-radius:4px',
      `background:rgba(17,24,32,${this.settings.video.backgroundOpacity})`,
      'color:#f8f1e6',
      'font-family:"Noto Sans SC","Source Han Sans SC","Microsoft YaHei",sans-serif',
      'font-weight:600',
      'line-height:1.45',
      'text-shadow:0 1px 2px rgba(0,0,0,.55)',
    ].join(';');
    if (this.settings.video.mode === 'bilingual') {
      const source = document.createElement('div');
      source.style.cssText = `${lineStyle};font-size:.88em;color:#f3ebdd`;
      source.textContent = sentence.text;
      this.overlay.append(source);
    }
    const target = document.createElement('div');
    target.style.cssText = `${lineStyle};border-bottom:2px solid #e85d4a`;
    target.textContent = translated;
    this.overlay.append(target);
  }
}
