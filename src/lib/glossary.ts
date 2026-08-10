import type { GlossaryEntry, GlossaryMatch, GlossaryScope } from './contracts';
import { normalizeSitePattern } from './site-rules';

export interface GlossaryLookupContext {
  hostname: string;
  sourceLanguage: string;
  targetLanguage: string;
  domain?: string;
}

export function normalizeGlossaryTerm(value: string, caseSensitive = false): string {
  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return caseSensitive ? normalized : normalized.toLocaleLowerCase();
}

export function glossaryScopeMatches(scope: GlossaryScope, scopeValue: string, hostname: string): boolean {
  if (scope === 'global') return true;
  const expected = normalizeSitePattern(scopeValue);
  const host = normalizeSitePattern(hostname);
  if (!expected || !host) return false;
  return scope === 'host' ? host === expected : host === expected || host.endsWith(`.${expected}`);
}

function languageMatches(expected: string, actual: string): boolean {
  return !expected || expected === 'auto' || actual === 'auto' || expected.toLowerCase() === actual.toLowerCase();
}

export function matchGlossaryEntries(
  entries: GlossaryEntry[],
  text: string,
  context: GlossaryLookupContext,
  limit = 32,
  byteLimit = 4_096,
): GlossaryMatch[] {
  const candidates = entries
    .filter((entry) => entry.enabled && entry.status === 'approved')
    .filter((entry) => glossaryScopeMatches(entry.scope, entry.scopeValue, context.hostname))
    .filter((entry) => languageMatches(entry.sourceLanguage, context.sourceLanguage) && languageMatches(entry.targetLanguage, context.targetLanguage))
    .filter((entry) => !entry.domain || !context.domain || entry.domain.toLocaleLowerCase() === context.domain.toLocaleLowerCase())
    .flatMap((entry) => [entry.source, ...entry.aliases].map((term) => ({ entry, term })))
    .sort((left, right) => right.term.length - left.term.length || right.entry.priority - left.entry.priority);
  const seen = new Set<string>();
  const occupied: Array<{ start: number; end: number }> = [];
  const matches: GlossaryMatch[] = [];
  let bytes = 0;
  for (const candidate of candidates) {
    if (seen.has(candidate.entry.id)) continue;
    const haystack = normalizeGlossaryTerm(text, candidate.entry.caseSensitive);
    const needle = normalizeGlossaryTerm(candidate.term, candidate.entry.caseSensitive);
    if (!needle) continue;
    const latinBoundary = !/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(needle);
    let start = haystack.indexOf(needle);
    while (start >= 0) {
      const end = start + needle.length;
      const left = start === 0 ? '' : haystack[start - 1] ?? '';
      const right = end >= haystack.length ? '' : haystack[end] ?? '';
      const boundaryOkay = !latinBoundary || (!/[\p{L}\p{N}_]/u.test(left) && !/[\p{L}\p{N}_]/u.test(right));
      if (boundaryOkay && !occupied.some((span) => start < span.end && end > span.start)) break;
      start = haystack.indexOf(needle, start + 1);
    }
    if (start < 0) continue;
    const match: GlossaryMatch = {
      id: candidate.entry.id,
      source: candidate.entry.source,
      preferred: candidate.entry.preferred,
      note: candidate.entry.note,
      priority: candidate.entry.priority,
    };
    const size = new TextEncoder().encode(JSON.stringify(match)).byteLength;
    if (matches.length >= limit || bytes + size > byteLimit) break;
    matches.push(match);
    occupied.push({ start, end: start + needle.length });
    seen.add(candidate.entry.id);
    bytes += size;
  }
  return matches;
}

export function glossaryDigest(matches: GlossaryMatch[]): string {
  const serialized = matches
    .map((match) => `${match.id}:${match.source}:${match.preferred}:${match.priority}`)
    .sort()
    .join('|');
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
