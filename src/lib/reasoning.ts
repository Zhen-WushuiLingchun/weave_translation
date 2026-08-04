import type { ReasoningMode, TranslationTask, WeaveSettings } from './contracts';
import { resolveSiteRule } from './site-rules';

export function resolveReasoningMode(settings: WeaveSettings, task: TranslationTask, pageUrl?: string): ReasoningMode {
  const fallback = settings.reasoning[task.scope];
  if (task.scope !== 'page' || !pageUrl) return fallback;
  try {
    return resolveSiteRule(settings.siteRules, new URL(pageUrl).hostname).reasoningMode ?? fallback;
  } catch {
    return fallback;
  }
}
