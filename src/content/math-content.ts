import type { MathContext, MathFragment } from '../lib/contracts';
import { MATH_TOKEN_PATTERN } from '../lib/math';

const MATH_SELECTOR = [
  'math',
  'mjx-container',
  '.katex',
  '.MathJax',
  '.ltx_Math',
  '[role="math"]',
  'script[type^="math/tex"]',
  '[data-tex]',
  '[data-latex]',
].join(',');

const BLOCK_MATH_CONTAINER_SELECTOR = [
  '.ltx_equation',
  '.ltx_eqn_cell',
  '.katex-display',
  '.MathJax_Display',
  'mjx-container[display="true"]',
  '[role="math"][display="block"]',
  '[role="math"][data-display="true"]',
].join(',');

export interface StructuredText {
  text: string;
  math: MathFragment[];
  mathOnly: boolean;
}

export interface DisplayMathEntry {
  element: Element;
  math: MathContext;
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

function stripLatexDelimiters(value: string): string {
  const trimmed = value.trim();
  const pairs: Array<[string, string]> = [['$$', '$$'], ['\\[', '\\]'], ['\\(', '\\)'], ['$', '$']];
  for (const [open, close] of pairs) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close) && trimmed.length > open.length + close.length) {
      return trimmed.slice(open.length, -close.length).trim();
    }
  }
  return trimmed;
}

function latexFor(node: Element): string {
  const annotation = node.matches('annotation[encoding="application/x-tex"]')
    ? node
    : node.querySelector<Element>('annotation[encoding="application/x-tex"]');
  const script = node.matches('script[type^="math/tex"]')
    ? node
    : node.querySelector<Element>('script[type^="math/tex"]');
  return stripLatexDelimiters(
    node.getAttribute('data-tex')
      ?? node.getAttribute('data-latex')
      ?? node.getAttribute('alttext')
      ?? annotation?.textContent
      ?? script?.textContent
      ?? node.getAttribute('aria-label')
      ?? node.textContent
      ?? '',
  );
}

function isDisplayMath(node: Element): boolean {
  return node.getAttribute('display') === 'block'
    || node.getAttribute('display') === 'true'
    || node.getAttribute('data-display') === 'true'
    || (node.matches('script[type^="math/tex"]') && /mode\s*=\s*display/i.test(node.getAttribute('type') ?? ''))
    || Boolean(node.closest(BLOCK_MATH_CONTAINER_SELECTOR));
}

function topLevelMathNodes(root: ParentNode): Element[] {
  const rootNode = root as Node;
  return Array.from(root.querySelectorAll<Element>(MATH_SELECTOR)).filter((node) => {
    const parentMath = node.parentElement?.closest(MATH_SELECTOR);
    return !parentMath || !rootNode.contains(parentMath);
  });
}

function mathValues(node: Element): MathContext {
  const latex = latexFor(node);
  const fallback = (node.getAttribute('alttext') ?? node.getAttribute('aria-label') ?? node.textContent ?? latex).replace(/\s+/g, ' ').trim();
  return { latex, display: isDisplayMath(node), fallback };
}

function normalizedCloneText(element: HTMLElement): string {
  return (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
}

export function extractStructuredText(element: HTMLElement): StructuredText {
  const clone = element.cloneNode(true) as HTMLElement;
  const math: MathFragment[] = [];

  for (const node of topLevelMathNodes(clone)) {
    const { latex, display, fallback } = mathValues(node);
    const token = `⟦WEAVE_MATH_${shortHash(`${latex}|${fallback}`)}_${math.length}⟧`;
    math.push({ token, latex, display, fallback });
    node.replaceWith(document.createTextNode(` ${token} `));
  }

  const text = normalizedCloneText(clone);
  const prose = text.replace(MATH_TOKEN_PATTERN, '').replace(/[\p{P}\p{S}\p{N}\s]/gu, '');
  const insideKnownBlockMath = Boolean(element.closest(BLOCK_MATH_CONTAINER_SELECTOR));
  return { text, math, mathOnly: insideKnownBlockMath || (math.length > 0 && prose.length === 0) };
}

export function extractDisplayMath(root: ParentNode = document): DisplayMathEntry[] {
  const entries: DisplayMathEntry[] = [];
  const seen = new Set<string>();
  for (const element of topLevelMathNodes(root)) {
    const math = mathValues(element);
    if (!math.display || (!math.latex && !math.fallback)) continue;
    const identity = `${math.latex}|${math.fallback}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    entries.push({ element, math });
    if (entries.length >= 80) break;
  }
  return entries;
}
