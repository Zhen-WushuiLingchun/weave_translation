import { describe, expect, it } from 'vitest';
import { effectiveRoutes, profilesWithCapability, resolveChatRoute, routeKeyForTask } from '../src/background/routing';
import type { TranslationTask } from '../src/lib/contracts';
import { DEFAULT_SETTINGS } from '../src/lib/defaults';

const task = (kind: TranslationTask['kind'], scope: TranslationTask['scope']): TranslationTask => ({
  id: `${kind}-${scope}`, kind, scope, sourceLanguage: 'en', targetLanguage: 'zh-CN', units: [{ id: 'one', text: 'hello' }],
});

describe('task model routing', () => {
  it('maps each translation task to a stable route', () => {
    expect(routeKeyForTask(task('summary', 'page'))).toBe('pageContext');
    expect(routeKeyForTask(task('summary', 'subtitle'))).toBe('videoContext');
    expect(routeKeyForTask(task('explain', 'selection'))).toBe('selectionExplanation');
    expect(routeKeyForTask(task('subtitle', 'subtitle'))).toBe('subtitleTranslation');
  });

  it('uses tab override before site override before task default', () => {
    const extra = { ...DEFAULT_SETTINGS.models[0]!, id: 'second', label: 'Second' };
    const third = { ...DEFAULT_SETTINGS.models[0]!, id: 'third', label: 'Third' };
    const settings = {
      ...DEFAULT_SETTINGS,
      models: [...DEFAULT_SETTINGS.models, extra, third],
      siteRules: { 'example.com': { pageProfileId: 'second' } },
    };
    const pageTask = task('page', 'page');
    expect(resolveChatRoute(settings, pageTask, 'https://docs.example.com/x').model.id).toBe('second');
    expect(resolveChatRoute(settings, pageTask, 'https://docs.example.com/x', { pageTranslation: 'third' }).model.id).toBe('third');
    expect(effectiveRoutes(settings, 'https://docs.example.com/x', { pageTranslation: 'third' }).find((item) => item.route === 'pageTranslation')?.source).toBe('tab');
  });

  it('filters models by declared capability and rejects disabled routes', () => {
    expect(profilesWithCapability(DEFAULT_SETTINGS, 'audioTranscription')).toEqual([]);
    const settings = { ...DEFAULT_SETTINGS, models: DEFAULT_SETTINGS.models.map((model) => ({ ...model, enabled: false })) };
    expect(() => resolveChatRoute(settings, task('page', 'page'))).toThrow('尚未配置可用模型');
  });
});
