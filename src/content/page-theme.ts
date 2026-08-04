import type { TranslationTheme } from '../lib/contracts';

export type ResolvedTranslationTheme = Exclude<TranslationTheme, 'auto'>;

export function colorTheme(color: string): ResolvedTranslationTheme | undefined {
  const match = color.match(/rgba?\(\s*(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)(?:\D+(\d+(?:\.\d+)?))?/i);
  if (!match) return undefined;
  const alpha = match[4] == null ? 1 : Number(match[4]);
  if (alpha < 0.12) return undefined;
  const channels = [Number(match[1]), Number(match[2]), Number(match[3])].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  return luminance > 0.34 ? 'light' : 'dark';
}

export function detectPageTheme(doc: Document = document): ResolvedTranslationTheme {
  for (const element of [doc.body, doc.documentElement]) {
    if (!element) continue;
    const detected = colorTheme(getComputedStyle(element).backgroundColor);
    if (detected) return detected;
  }
  const declared = getComputedStyle(doc.documentElement).colorScheme;
  if (/dark/i.test(declared) && !/light/i.test(declared)) return 'dark';
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolvePageTheme(preference: TranslationTheme, doc: Document = document): ResolvedTranslationTheme {
  return preference === 'auto' ? detectPageTheme(doc) : preference;
}
