import type {
  ContextBrief,
  PageMode,
  TranslationScope,
  TranslationResult,
  WeaveSettings,
} from '../lib/contracts';
import { sendRuntimeMessage } from '../lib/message';
import { resolvePageTheme } from './page-theme';
import {
  buildTranslationUnits,
  contextSample,
  extractPage,
  parseContextBrief,
  type ExtractedPage,
} from './context';

export interface PageTranslationStatus {
  state: 'idle' | 'analyzing' | 'translating' | 'translated' | 'error';
  completed: number;
  total: number;
  message?: string;
}

type StatusListener = (status: PageTranslationStatus) => void;

function batchUnits<T extends { text: string }>(items: T[], maxItems = 8, maxCharacters = 2_000): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let characters = 0;
  for (const item of items) {
    if (current.length && (current.length >= maxItems || characters + item.text.length > maxCharacters)) {
      batches.push(current);
      current = [];
      characters = 0;
    }
    current.push(item);
    characters += item.text.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

function isNearViewport(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.bottom >= -window.innerHeight && rect.top <= window.innerHeight * 2;
}

export class PageTranslator {
  private extracted: ExtractedPage | undefined;
  private contexts = new Map<string, ContextBrief>();
  private activeRun = 0;
  private processed = new WeakSet<HTMLElement>();
  private translations = new Map<HTMLElement, HTMLElement>();
  private previousDisplays = new WeakMap<HTMLElement, string>();
  private observer: MutationObserver | undefined;
  private mutationTimer: number | undefined;
  private status: PageTranslationStatus = { state: 'idle', completed: 0, total: 0 };

  constructor(
    private settings: WeaveSettings,
    private readonly onStatus: StatusListener,
  ) {}

  updateSettings(settings: WeaveSettings): void {
    this.settings = settings;
    this.refreshTheme();
    this.setMode(settings.dock.pageMode);
  }

  refreshTheme(): void {
    for (const translated of this.translations.values()) this.applyTranslationStyle(translated);
  }

  contextFor(scope: TranslationScope, targetLanguage = this.settings.targetLanguage): ContextBrief | undefined {
    return this.contexts.get(`${scope}:${targetLanguage}`);
  }

  get snapshot() {
    this.extracted ??= extractPage();
    return this.extracted.snapshot;
  }

  get currentStatus(): PageTranslationStatus {
    return this.status;
  }

  private emit(next: PageTranslationStatus): void {
    this.status = next;
    this.onStatus(next);
  }

  async ensureContext(scope: TranslationScope = 'page', targetLanguage = this.settings.targetLanguage): Promise<ContextBrief> {
    if (!this.settings.contextEnabled) return { summary: '', terms: [] };
    const contextKey = `${scope}:${targetLanguage}`;
    const existing = this.contexts.get(contextKey);
    if (existing) return existing;
    this.extracted ??= extractPage();
    this.emit({ state: 'analyzing', completed: 0, total: this.extracted.snapshot.blocks.length });
    const result = await sendRuntimeMessage<TranslationResult>({
      type: 'TRANSLATE',
      task: {
        id: crypto.randomUUID(),
        kind: 'summary',
        scope,
        sourceLanguage: this.settings.sourceLanguage,
        targetLanguage,
        units: [contextSample(this.extracted.snapshot)],
      },
    });
    const context = parseContextBrief(result.items[0]?.text ?? '');
    this.contexts.set(contextKey, context);
    return context;
  }

  async start(): Promise<void> {
    const run = ++this.activeRun;
    this.extracted = extractPage();
    const blocks = this.extracted.snapshot.blocks.filter((block) => {
      const element = this.extracted?.elements.get(block.id);
      return element && !this.processed.has(element);
    });
    if (!blocks.length) {
      this.emit({ state: 'translated', completed: this.translations.size, total: this.translations.size });
      return;
    }

    try {
      const context = await this.ensureContext();
      if (run !== this.activeRun) return;
      const ordered = [...blocks].sort((left, right) => {
        const leftElement = this.extracted?.elements.get(left.id);
        const rightElement = this.extracted?.elements.get(right.id);
        return Number(!leftElement || !isNearViewport(leftElement)) - Number(!rightElement || !isNearViewport(rightElement));
      });
      const units = buildTranslationUnits(ordered);
      const batches = batchUnits(units);
      let completed = 0;
      this.emit({ state: 'translating', completed, total: units.length });

      let cursor = 0;
      const worker = async () => {
        while (cursor < batches.length && run === this.activeRun) {
          const batch = batches[cursor++]!;
          const result = await sendRuntimeMessage<TranslationResult>({
            type: 'TRANSLATE',
            task: {
              id: crypto.randomUUID(),
              kind: 'page',
              scope: 'page',
              sourceLanguage: this.settings.sourceLanguage,
              targetLanguage: this.settings.targetLanguage,
              units: batch,
              ...(this.settings.contextEnabled ? { context } : {}),
            },
          });
          if (run !== this.activeRun) return;
          for (const item of result.items) {
            if (!item.text || item.error) continue;
            const element = this.extracted?.elements.get(item.id);
            if (element) this.renderTranslation(element, item.text);
          }
          completed += batch.length;
          this.emit({ state: 'translating', completed, total: units.length });
        }
      };
      await Promise.all([worker(), worker()]);
      if (run !== this.activeRun) return;
      this.setMode(this.settings.dock.pageMode);
      this.observeDynamicContent();
      this.emit({ state: 'translated', completed: units.length, total: units.length });
    } catch (error) {
      if (run !== this.activeRun) return;
      this.emit({
        state: 'error',
        completed: 0,
        total: blocks.length,
        message: error instanceof Error ? error.message : '整页翻译失败。',
      });
      throw error;
    }
  }

  private renderTranslation(original: HTMLElement, text: string): void {
    let translated = this.translations.get(original);
    if (!translated) {
      translated = document.createElement(original.tagName === 'LI' ? 'div' : 'div');
      translated.dataset.weaveTranslation = 'true';
      translated.setAttribute('lang', this.settings.targetLanguage);
      this.applyTranslationStyle(translated);
      original.insertAdjacentElement('afterend', translated);
      this.translations.set(original, translated);
      this.processed.add(original);
    }
    translated.textContent = text;
  }

  private applyTranslationStyle(translated: HTMLElement): void {
    const theme = resolvePageTheme(this.settings.pageTheme);
    translated.dataset.weaveTheme = theme;
    translated.style.cssText = [
      'box-sizing:border-box',
      'margin:.36em 0 .72em',
      'padding:.56em .78em .62em',
      `border-left:3px solid ${theme === 'dark' ? '#54aaa1' : '#2a7f78'}`,
      `background:${theme === 'dark' ? 'rgba(22,32,40,.94)' : 'rgba(243,235,221,.94)'}`,
      `color:${theme === 'dark' ? '#f3ebdd' : '#172027'}`,
      `box-shadow:${theme === 'dark' ? 'inset 0 0 0 1px rgba(243,235,221,.1)' : 'inset 0 0 0 1px rgba(17,24,32,.07)'}`,
      'font:inherit',
      'line-height:1.72',
      'white-space:pre-wrap',
    ].join(';');
  }

  setMode(mode: PageMode): void {
    for (const [original, translated] of this.translations) {
      if (!this.previousDisplays.has(original)) this.previousDisplays.set(original, original.style.display);
      original.style.display = mode === 'translated' ? 'none' : this.previousDisplays.get(original) ?? '';
      translated.style.display = mode === 'original' ? 'none' : '';
    }
  }

  stop(): void {
    this.activeRun += 1;
    this.observer?.disconnect();
    if (this.mutationTimer) window.clearTimeout(this.mutationTimer);
    for (const [original, translated] of this.translations) {
      original.style.display = this.previousDisplays.get(original) ?? '';
      translated.remove();
    }
    this.translations.clear();
    this.processed = new WeakSet();
    this.extracted = undefined;
    this.contexts.clear();
    this.emit({ state: 'idle', completed: 0, total: 0 });
  }

  private observeDynamicContent(): void {
    this.observer?.disconnect();
    this.observer = new MutationObserver((mutations) => {
      const hasNewContent = mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) => node instanceof HTMLElement && !node.closest('[data-weave-translation]')));
      if (!hasNewContent) return;
      if (this.mutationTimer) window.clearTimeout(this.mutationTimer);
      this.mutationTimer = window.setTimeout(() => void this.start(), 700);
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }
}
