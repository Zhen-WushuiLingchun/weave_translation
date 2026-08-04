import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/lib/defaults';
import { normalizeSitePattern, pageSettingsForSite, resolveSiteRule, sitePatternMatches } from '../src/lib/site-rules';

describe('site translation profiles', () => {
  it('treats an exact host as all paths on that host', () => {
    expect(sitePatternMatches('example.com', new URL('https://example.com/papers/42?q=weave').hostname)).toBe(true);
    expect(sitePatternMatches('example.com', 'docs.example.com')).toBe(false);
  });

  it('matches an apex and every subdomain with a wildcard', () => {
    expect(sitePatternMatches('*.example.com', 'example.com')).toBe(true);
    expect(sitePatternMatches('*.example.com', 'docs.example.com')).toBe(true);
    expect(sitePatternMatches('*.example.com', 'deep.docs.example.com')).toBe(true);
    expect(sitePatternMatches('*.example.com', 'notexample.com')).toBe(false);
  });

  it('lets a more specific exact rule override a wildcard rule', () => {
    const rule = resolveSiteRule({
      '*.example.com': { autoTranslate: true, reasoningMode: 'fast', theme: 'dark' },
      'docs.example.com': { reasoningMode: 'deep', pageMode: 'translated' },
    }, 'docs.example.com');
    expect(rule).toMatchObject({ autoTranslate: true, reasoningMode: 'deep', theme: 'dark', pageMode: 'translated' });
    expect(rule.matchedPatterns).toEqual(['*.example.com', 'docs.example.com']);
  });

  it('applies resolved page-only overrides without changing selection defaults', () => {
    const rule = resolveSiteRule({ '*.example.com': { targetLanguage: 'ja', reasoningMode: 'deep', theme: 'dark' } }, 'www.example.com');
    const settings = pageSettingsForSite(DEFAULT_SETTINGS, rule);
    expect(settings.targetLanguage).toBe('ja');
    expect(settings.reasoning.page).toBe('deep');
    expect(settings.reasoning.selection).toBe(DEFAULT_SETTINGS.reasoning.selection);
    expect(settings.pageTheme).toBe('dark');
  });

  it('normalizes protocol, path, port and case to a host pattern', () => {
    expect(normalizeSitePattern(' HTTPS://Docs.Example.COM:8443/papers ')).toBe('docs.example.com');
  });
});
