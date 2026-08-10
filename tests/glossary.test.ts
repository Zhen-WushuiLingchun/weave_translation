import { describe, expect, it } from 'vitest';
import type { GlossaryEntry } from '../src/lib/contracts';
import { glossaryDigest, glossaryScopeMatches, matchGlossaryEntries, normalizeGlossaryTerm } from '../src/lib/glossary';

const entry = (overrides: Partial<GlossaryEntry>): GlossaryEntry => ({
  id: 'one', collectionId: 'general', source: 'event horizon', preferred: '事件视界', aliases: ['horizon'],
  sourceLanguage: 'en', targetLanguage: 'zh-CN', domain: '', scope: 'global', scopeValue: '', caseSensitive: false,
  priority: 1, note: 'relativity', enabled: true, status: 'approved', createdAt: 1, updatedAt: 1, ...overrides,
});

describe('local glossary retrieval', () => {
  it('normalizes Unicode and whitespace and supports domain scope', () => {
    expect(normalizeGlossaryTerm('  Event   Horizon ')).toBe('event horizon');
    expect(glossaryScopeMatches('domain', 'example.com', 'docs.example.com')).toBe(true);
    expect(glossaryScopeMatches('host', 'example.com', 'docs.example.com')).toBe(false);
  });

  it('matches aliases longest-first while excluding suggestions and wrong sites', () => {
    const entries = [
      entry({ id: 'short', source: 'horizon', preferred: '地平线', priority: 0 }),
      entry({ id: 'long' }),
      entry({ id: 'site', source: 'metric', preferred: '度规', scope: 'domain', scopeValue: 'arxiv.org' }),
      entry({ id: 'suggested', source: 'universe', preferred: '宇宙', status: 'suggested' }),
    ];
    const result = matchGlossaryEntries(entries, 'The event horizon follows this metric in the universe.', {
      hostname: 'docs.example.com', sourceLanguage: 'en', targetLanguage: 'zh-CN',
    });
    expect(result.map((item) => item.id)).toEqual(['long']);
    expect(glossaryDigest(result)).toBe(glossaryDigest([...result].reverse()));
  });

  it('does not match a Latin term inside another word', () => {
    const result = matchGlossaryEntries([entry({ source: 'cat', preferred: '猫', aliases: [] })], 'educational categories', {
      hostname: 'example.com', sourceLanguage: 'en', targetLanguage: 'zh-CN',
    });
    expect(result).toEqual([]);
  });
});
