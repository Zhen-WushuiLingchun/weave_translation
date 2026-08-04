import { describe, expect, it } from 'vitest';
import type { TranslationTask } from '../src/lib/contracts';
import { DEFAULT_SETTINGS } from '../src/lib/defaults';
import { resolveReasoningMode } from '../src/lib/reasoning';

const task = (scope: TranslationTask['scope']): TranslationTask => ({
  id: scope, kind: scope === 'subtitle' ? 'subtitle' : scope, scope,
  sourceLanguage: 'auto', targetLanguage: 'zh-CN', units: [{ id: 'one', text: 'Hello' }],
});

describe('scene-specific reasoning', () => {
  it('uses independent defaults for page, selection and subtitle', () => {
    expect(resolveReasoningMode(DEFAULT_SETTINGS, task('page'))).toBe('balanced');
    expect(resolveReasoningMode(DEFAULT_SETTINGS, task('selection'))).toBe('fast');
    expect(resolveReasoningMode(DEFAULT_SETTINGS, task('subtitle'))).toBe('fast');
  });

  it('only applies a site override to page translation', () => {
    const settings = { ...DEFAULT_SETTINGS, siteRules: { '*.example.com': { reasoningMode: 'deep' as const } } };
    expect(resolveReasoningMode(settings, task('page'), 'https://docs.example.com/paper')).toBe('deep');
    expect(resolveReasoningMode(settings, task('selection'), 'https://docs.example.com/paper')).toBe('fast');
    expect(resolveReasoningMode(settings, task('subtitle'), 'https://docs.example.com/watch')).toBe('fast');
  });
});
