import { estimateTextTokens, IMAGE_TOKEN_RESERVE, PROMPT_RESERVE } from './protocol';

export interface PdfBox { x: number; y: number; width: number; height: number }
export interface PdfTextItem extends PdfBox { str: string; hasEOL?: boolean }
export interface PdfBlock { page: number; index: number; text: string; box: PdfBox; heading: boolean }

export function unionBoxes(boxes: PdfBox[]): PdfBox {
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return { x, y, width: Math.max(...boxes.map((box) => box.x + box.width)) - x, height: Math.max(...boxes.map((box) => box.y + box.height)) - y };
}
export function normalizeText(text: string): string {
  const ligatures: Record<string, string> = { 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl' };
  // NFKC would turn x² into x2: preserve mathematical superscripts/subscripts.
  return text.normalize('NFC').replace(/[ﬁﬂﬀﬃﬄ]/g, (char) => ligatures[char]!)
    .replace(/([a-z])[-\u00ad]\n([a-z])/g, '$1$2').replace(/\s+/g, ' ').trim();
}
export function blocksFromItems(items: PdfTextItem[], page: number): PdfBlock[] {
  const lines: Array<{ text: string; box: PdfBox; font: number }> = [];
  let run: PdfTextItem[] = [];
  const flush = () => {
    if (run.length) lines.push({ text: normalizeText(run.map((item, index) => {
      const before = run[index - 1];
      return (before && item.x - (before.x + before.width) > 1.5 ? ' ' : '') + item.str;
    }).join('')), box: unionBoxes(run), font: Math.max(...run.map((item) => item.height)) });
    run = [];
  };
  for (const item of items) {
    const last = run.at(-1);
    if (last && (Math.abs(item.y - last.y) > Math.max(3, item.height * .5) || item.x < last.x - 3 || item.x - last.x - last.width > 35)) flush();
    if (item.str.trim()) run.push(item);
    if (item.hasEOL) flush();
  }
  flush();
  const fonts = lines.map((line) => line.font).sort((a, b) => a - b);
  const median = fonts[Math.floor(fonts.length / 2)] ?? 12;
  const blocks: PdfBlock[] = [];
  for (const line of lines) {
    if (!line.text) continue;
    const heading = line.font > median * 1.22 || /^(?:\d+(?:\.\d+)*\s+|abstract\b|references\b|摘要)/i.test(line.text) && line.text.length < 100;
    const previous = blocks.at(-1);
    const lastLine = lines[lines.indexOf(line) - 1];
    if (previous && !heading && !previous.heading && lastLine
      && Math.abs(previous.box.x - line.box.x) < 18
      && line.box.y - lastLine.box.y > 0 && line.box.y - lastLine.box.y < median * 1.9
      && previous.text.length < 1600) {
      previous.text = normalizeText(previous.text + '\n' + line.text);
      previous.box = unionBoxes([previous.box, line.box]);
    } else blocks.push({ page, index: blocks.length, text: line.text, box: line.box, heading });
  }
  return blocks;
}
export function needsVision(text: string): boolean {
  return text.trim().length < 3 || /[�∫∑√∂∞≈≠≤≥∇]|\b(?:matrix|equation|figure|table)\b|[A-Za-z]\s*[=^_]\s*\S/i.test(text);
}

export function contextWindow(selected: string, page: number, blocks: PdfBlock[], budget: number, imageCount: number, summary = '') {
  const selection = normalizeText(selected);
  const remaining = budget - PROMPT_RESERVE - imageCount * IMAGE_TOKEN_RESERVE - estimateTextTokens(selection + summary);
  if (remaining < 0) throw new Error('选区超出预算，请缩小选区或选择 16k。');
  const terms = new Set(selection.toLowerCase().match(/[a-z]{4,}|[\p{Script=Han}]{2,6}/gu) ?? []);
  const here = blocks.filter((block) => block.page === page);
  const containing = here.find((block) => selection && normalizeText(block.text).includes(selection));
  const rank = (block: PdfBlock) => {
    const text = block.text.toLowerCase();
    const relevance = [...terms].filter((term) => text.includes(term)).length;
    return (block === containing ? 100 : 0) + (block.page === page ? 30 : Math.abs(block.page - page) === 1 ? 10 : 0) + relevance * 5;
  };
  const candidates = blocks.filter((block) => Math.abs(block.page - page) <= 1 || [...terms].some((term) => block.text.toLowerCase().includes(term)))
    .sort((a, b) => rank(b) - rank(a) || Math.abs(a.index - (containing?.index ?? 0)) - Math.abs(b.index - (containing?.index ?? 0)) || a.page - b.page);
  const picked: PdfBlock[] = [];
  const seen = new Set<string>();
  let used = 0;
  for (const block of candidates) {
    const normalized = normalizeText(block.text);
    if (seen.has(normalized) || normalized === selection) continue;
    const cost = estimateTextTokens(normalized) + 40;
    if (used + cost > remaining || picked.length >= 8) continue;
    picked.push(block); seen.add(normalized); used += cost;
  }
  const heading = here.filter((block) => block.heading && block.index <= (containing?.index ?? Infinity)).at(-1)?.text;
  return {
    text: picked.map((block) => `[page ${block.page}, block ${block.index}] ${block.text}`).join('\n\n'),
    pages: [...new Set([page, ...picked.map((block) => block.page)])].sort((a, b) => a - b),
    heading: heading ? [heading] : [],
    estimatedTokens: used + estimateTextTokens(selection + summary) + imageCount * IMAGE_TOKEN_RESERVE + PROMPT_RESERVE,
  };
}
