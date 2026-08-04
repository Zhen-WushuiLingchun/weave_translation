import type { MathFragment } from './contracts';

export const MATH_TOKEN_PATTERN = /⟦WEAVE_MATH_[A-F0-9]+_\d+⟧/g;

export function validateMathPlaceholders(text: string, math: MathFragment[] | undefined): string | undefined {
  const expected = new Set((math ?? []).map((fragment) => fragment.token));
  const counts = new Map<string, number>();
  for (const token of text.match(MATH_TOKEN_PATTERN) ?? []) counts.set(token, (counts.get(token) ?? 0) + 1);

  for (const token of counts.keys()) {
    if (!expected.has(token)) return `模型返回了未知公式占位符：${token}`;
  }
  for (const token of expected) {
    const count = counts.get(token) ?? 0;
    if (count === 0) return `模型遗漏了公式占位符：${token}`;
    if (count > 1) return `模型重复了公式占位符：${token}`;
  }
  return undefined;
}
