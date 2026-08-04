import type { ContextBlock, ContextBrief, ContextSnapshot, TranslationUnit } from '../lib/contracts';

const BLOCK_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,td,th,dd,dt';
const EXCLUDED_SELECTOR = [
  'script',
  'style',
  'noscript',
  'textarea',
  'input',
  'select',
  'option',
  'button',
  'pre',
  'code',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[aria-hidden="true"]',
  '[data-weave-root]',
  '[data-weave-translation]',
].join(',');

export interface ExtractedPage {
  snapshot: ContextSnapshot;
  elements: Map<string, HTMLElement>;
}

export function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizedText(element: HTMLElement): string {
  return element.innerText.replace(/\s+/g, ' ').trim();
}

function isVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function shouldInclude(element: HTMLElement): boolean {
  if (element.closest(EXCLUDED_SELECTOR)) return false;
  const text = normalizedText(element);
  if (text.length < 2 || text.length > 4_000) return false;
  if (element.querySelector(BLOCK_SELECTOR) && !/^H[1-6]$/.test(element.tagName)) return false;
  return isVisible(element);
}

export function extractPage(root: ParentNode = document): ExtractedPage {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
  const blocks: ContextBlock[] = [];
  const elements = new Map<string, HTMLElement>();
  const headings: Array<{ level: number; text: string }> = [];

  for (const element of nodes) {
    if (!shouldInclude(element)) continue;
    const text = normalizedText(element);
    const headingMatch = element.tagName.match(/^H([1-6])$/);
    if (headingMatch) {
      const level = Number(headingMatch[1]);
      while (headings.length && headings[headings.length - 1]!.level >= level) headings.pop();
      headings.push({ level, text });
    }
    const index = blocks.length;
    const id = `b-${index}-${hashText(text.slice(0, 320))}`;
    const block: ContextBlock = {
      id,
      text,
      tag: element.tagName.toLowerCase(),
      headingPath: headings.map((heading) => heading.text),
      index,
    };
    blocks.push(block);
    elements.set(id, element);
    if (blocks.length >= 800) break;
  }

  const signature = `${location.href}|${document.title}|${blocks.map((block) => block.text).join('\n').slice(0, 80_000)}`;
  return {
    snapshot: {
      url: location.href,
      title: document.title,
      language: document.documentElement.lang || 'auto',
      contentHash: hashText(signature),
      blocks,
    },
    elements,
  };
}

export function contextSample(snapshot: ContextSnapshot, maxCharacters = 10_000): TranslationUnit {
  const parts: string[] = [];
  let count = 0;
  for (const block of snapshot.blocks) {
    if (count + block.text.length > maxCharacters) break;
    parts.push(`${block.headingPath.join(' > ')}\n${block.text}`.trim());
    count += block.text.length;
  }
  return { id: `summary-${snapshot.contentHash}`, text: `Title: ${snapshot.title}\n\n${parts.join('\n\n')}` };
}

export function buildTranslationUnits(blocks: ContextBlock[]): TranslationUnit[] {
  return blocks.map((block, index) => {
    const before = blocks[index - 1]?.text;
    const after = blocks[index + 1]?.text;
    return {
      id: block.id,
      text: block.text,
      headingPath: block.headingPath,
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
    };
  });
}

export function parseContextBrief(raw: string): ContextBrief {
  try {
    const parsed = JSON.parse(raw) as Partial<ContextBrief>;
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      terms: Array.isArray(parsed.terms)
        ? parsed.terms
            .filter((term): term is ContextBrief['terms'][number] => Boolean(term && typeof term.source === 'string' && typeof term.preferred === 'string'))
            .slice(0, 20)
        : [],
    };
  } catch {
    return { summary: '', terms: [] };
  }
}

export function containingContext(selection: Selection, snapshot: ContextSnapshot): TranslationUnit | undefined {
  const text = selection.toString().replace(/\s+/g, ' ').trim();
  if (!text || text.length > 5_000) return undefined;
  const node = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement;
  const container = node?.closest<HTMLElement>(BLOCK_SELECTOR);
  const block = snapshot.blocks.find((candidate) => container?.innerText.replace(/\s+/g, ' ').trim() === candidate.text);
  const before = block ? snapshot.blocks[block.index - 1]?.text : container?.innerText;
  const after = block ? snapshot.blocks[block.index + 1]?.text : undefined;
  return {
    id: `selection-${hashText(text)}`,
    text,
    ...(block?.headingPath ? { headingPath: block.headingPath } : {}),
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
  };
}
