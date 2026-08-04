import type { ResolvedSiteRule, SiteRule, WeaveSettings } from './contracts';
import { DEFAULT_SITE_RULE } from './defaults';

export function normalizeSitePattern(input: string): string {
  let value = input.trim().toLowerCase();
  if (!value) return '';
  value = value.replace(/^https?:\/\//, '').split('/')[0] ?? '';
  value = value.replace(/:\d+$/, '').replace(/^\.+|\.+$/g, '');
  return value;
}

export function sitePatternMatches(pattern: string, hostname: string): boolean {
  const normalized = normalizeSitePattern(pattern);
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!normalized || !host) return false;
  if (normalized.startsWith('*.')) {
    const base = normalized.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }
  return host === normalized;
}

function specificity(pattern: string): number {
  const normalized = normalizeSitePattern(pattern);
  return normalized.replace(/^\*\./, '').split('.').length * 100 + (normalized.startsWith('*.') ? 0 : 10);
}

export function resolveSiteRule(siteRules: Record<string, SiteRule>, hostname: string): ResolvedSiteRule {
  const matches = Object.entries(siteRules)
    .filter(([pattern]) => sitePatternMatches(pattern, hostname))
    .sort(([left], [right]) => specificity(left) - specificity(right));
  const merged = Object.assign({}, DEFAULT_SITE_RULE, ...matches.map(([, rule]) => rule));
  return { ...merged, matchedPatterns: matches.map(([pattern]) => pattern) };
}

export function pageSettingsForSite(settings: WeaveSettings, rule: ResolvedSiteRule): WeaveSettings {
  return {
    ...settings,
    targetLanguage: rule.targetLanguage ?? settings.targetLanguage,
    pageTheme: rule.theme ?? settings.pageTheme,
    reasoning: {
      ...settings.reasoning,
      page: rule.reasoningMode ?? settings.reasoning.page,
    },
    dock: {
      ...settings.dock,
      pageMode: rule.pageMode ?? settings.dock.pageMode,
    },
  };
}
