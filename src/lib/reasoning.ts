import type { ReasoningMode, TranslationTask, WeaveSettings } from './contracts';
import { routeKeyForTask } from '../background/routing';
import { resolveSiteRule } from './site-rules';

export function resolveReasoningMode(settings: WeaveSettings, task: TranslationTask, pageUrl?: string): ReasoningMode {
  const fallback = settings.taskRoutes[routeKeyForTask(task)].reasoningMode;
  if (task.scope !== 'page' || !pageUrl) return fallback;
  try {
    return resolveSiteRule(settings.siteRules, new URL(pageUrl).hostname).reasoningMode ?? fallback;
  } catch {
    return fallback;
  }
}
