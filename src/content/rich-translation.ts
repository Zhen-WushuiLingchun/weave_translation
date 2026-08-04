import katex, { type KatexOptions } from 'katex';
import type { MathFragment } from '../lib/contracts';

const KATEX_OPTIONS: KatexOptions = {
  output: 'mathml',
  throwOnError: true,
  strict: 'ignore',
  trust: false,
  maxExpand: 1_000,
  maxSize: 12,
  macros: {
    '\\RR': '\\mathbb{R}',
    '\\CC': '\\mathbb{C}',
    '\\NN': '\\mathbb{N}',
    '\\QQ': '\\mathbb{Q}',
    '\\ZZ': '\\mathbb{Z}',
    '\\dd': '\\,\\mathrm{d}',
    '\\ee': '\\mathrm{e}',
    '\\ii': '\\mathrm{i}',
  },
};

function style(element: HTMLElement, cssText: string): void {
  element.style.cssText = cssText;
}

function appendText(parent: Node, value: string): void {
  if (value) parent.appendChild(document.createTextNode(value));
}

function appendMath(parent: HTMLElement, latex: string, display: boolean, fallback = latex): void {
  const wrapper = document.createElement(display ? 'div' : 'span');
  wrapper.dataset.weaveMath = display ? 'display' : 'inline';
  style(wrapper, display
    ? 'display:block;max-width:100%;margin:.55em 0;overflow-x:auto;overflow-y:hidden;text-align:center;line-height:1.35'
    : 'display:inline-block;max-width:100%;margin:0 .08em;overflow-x:auto;overflow-y:hidden;vertical-align:-.16em;line-height:1.2');
  try {
    katex.render(latex, wrapper, { ...KATEX_OPTIONS, displayMode: display });
  } catch {
    wrapper.dataset.weaveMathError = 'true';
    wrapper.textContent = display ? `\\[${fallback}\\]` : fallback;
    wrapper.title = '该 LaTeX 暂无法渲染，已显示原始表达式';
    style(wrapper, `${wrapper.style.cssText};font-family:"Cascadia Mono",Consolas,monospace;color:inherit;opacity:.88`);
  }
  parent.append(wrapper);
}

function findUnescaped(value: string, target: string, start: number): number {
  let cursor = start;
  while (cursor < value.length) {
    const found = value.indexOf(target, cursor);
    if (found < 0) return -1;
    let slashes = 0;
    for (let index = found - 1; index >= 0 && value[index] === '\\'; index -= 1) slashes += 1;
    if (slashes % 2 === 0) return found;
    cursor = found + target.length;
  }
  return -1;
}

function appendInline(parent: HTMLElement, value: string, fragments: Map<string, MathFragment>): void {
  const tokens = [...fragments.keys()].sort((left, right) => right.length - left.length);
  let cursor = 0;
  let plainStart = 0;
  const flush = (end: number) => {
    appendText(parent, value.slice(plainStart, end).replace(/\\([\\`*$])/g, '$1'));
  };

  while (cursor < value.length) {
    const token = tokens.find((candidate) => value.startsWith(candidate, cursor));
    if (token) {
      flush(cursor);
      const fragment = fragments.get(token)!;
      appendMath(parent, fragment.latex || fragment.fallback, fragment.display, fragment.fallback);
      cursor += token.length;
      plainStart = cursor;
      continue;
    }

    const inlineLatex = value.startsWith('\\(', cursor)
      ? { close: '\\)', start: cursor + 2 }
      : value[cursor] === '$' && value[cursor + 1] !== '$'
        ? { close: '$', start: cursor + 1 }
        : undefined;
    if (inlineLatex) {
      const end = findUnescaped(value, inlineLatex.close, inlineLatex.start);
      if (end > inlineLatex.start) {
        flush(cursor);
        appendMath(parent, value.slice(inlineLatex.start, end).trim(), false);
        cursor = end + inlineLatex.close.length;
        plainStart = cursor;
        continue;
      }
    }

    const markdown = value.startsWith('**', cursor)
      ? { delimiter: '**', tag: 'strong' as const }
      : value[cursor] === '*'
        ? { delimiter: '*', tag: 'em' as const }
        : value[cursor] === '`'
          ? { delimiter: '`', tag: 'code' as const }
          : undefined;
    if (markdown) {
      const start = cursor + markdown.delimiter.length;
      const end = findUnescaped(value, markdown.delimiter, start);
      if (end > start) {
        flush(cursor);
        const child = document.createElement(markdown.tag);
        child.textContent = value.slice(start, end);
        if (markdown.tag === 'code') style(child, 'padding:.08em .3em;border-radius:3px;background:rgba(127,127,127,.14);font-family:"Cascadia Mono",Consolas,monospace;font-size:.9em');
        parent.append(child);
        cursor = end + markdown.delimiter.length;
        plainStart = cursor;
        continue;
      }
    }
    cursor += 1;
  }
  flush(value.length);
}

function displayMathStart(line: string): { open: string; close: string } | undefined {
  const trimmed = line.trim();
  if (trimmed.startsWith('$$')) return { open: '$$', close: '$$' };
  if (trimmed.startsWith('\\[')) return { open: '\\[', close: '\\]' };
  return undefined;
}

function isBlockStart(line: string): boolean {
  const trimmed = line.trim();
  return !trimmed
    || trimmed.startsWith('```')
    || Boolean(displayMathStart(trimmed))
    || /^#{1,6}\s+/.test(trimmed)
    || /^>\s?/.test(trimmed)
    || /^[-+*]\s+/.test(trimmed)
    || /^\d+[.)]\s+/.test(trimmed);
}

export function renderRestrictedMarkdown(container: HTMLElement, markdown: string, math: MathFragment[] = []): void {
  container.replaceChildren();
  container.dataset.weaveFormat = 'markdown-latex-v1';
  const fragments = new Map(math.map((fragment) => [fragment.token, fragment]));
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
      const content: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.trim().startsWith('```')) content.push(lines[index++]!);
      if (index < lines.length) index += 1;
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      if (language) code.dataset.language = language;
      code.textContent = content.join('\n');
      pre.append(code);
      style(pre, 'max-width:100%;margin:.55em 0;padding:.65em .75em;overflow:auto;border-radius:4px;background:rgba(127,127,127,.12);white-space:pre-wrap;font-family:"Cascadia Mono",Consolas,monospace;font-size:.88em');
      container.append(pre);
      continue;
    }

    const mathBlock = displayMathStart(trimmed);
    if (mathBlock) {
      let body = trimmed.slice(mathBlock.open.length);
      const sameLineEnd = body.endsWith(mathBlock.close) && body.length > mathBlock.close.length;
      if (sameLineEnd) {
        body = body.slice(0, -mathBlock.close.length);
        index += 1;
      } else {
        const content = [body];
        index += 1;
        while (index < lines.length && !lines[index]!.trim().endsWith(mathBlock.close)) content.push(lines[index++]!);
        if (index < lines.length) {
          content.push(lines[index]!.trim().slice(0, -mathBlock.close.length));
          index += 1;
        }
        body = content.join('\n');
      }
      appendMath(container, body.trim(), true);
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const element = document.createElement(`h${Math.min(6, heading[1]!.length)}`);
      appendInline(element, heading[2]!, fragments);
      style(element, 'margin:.7em 0 .35em;font:700 1.08em/1.45 inherit;color:inherit');
      container.append(element);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index]!.trim())) quoteLines.push(lines[index++]!.trim().replace(/^>\s?/, ''));
      const quote = document.createElement('blockquote');
      appendInline(quote, quoteLines.join(' '), fragments);
      style(quote, 'margin:.55em 0;padding:.15em 0 .15em .75em;border-left:2px solid currentColor;opacity:.86');
      container.append(quote);
      continue;
    }

    const listMatch = trimmed.match(/^([-+*]|\d+[.)])\s+(.+)$/);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1]!);
      const list = document.createElement(ordered ? 'ol' : 'ul');
      style(list, 'margin:.45em 0;padding-left:1.45em');
      while (index < lines.length) {
        const item = lines[index]!.trim().match(ordered ? /^\d+[.)]\s+(.+)$/ : /^[-+*]\s+(.+)$/);
        if (!item) break;
        const li = document.createElement('li');
        appendInline(li, item[1]!, fragments);
        style(li, 'margin:.18em 0');
        list.append(li);
        index += 1;
      }
      container.append(list);
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;
    while (index < lines.length && !isBlockStart(lines[index]!)) paragraphLines.push(lines[index++]!.trim());
    const paragraph = document.createElement('p');
    appendInline(paragraph, paragraphLines.join(' '), fragments);
    style(paragraph, 'margin:0 0 .45em;line-height:inherit;white-space:normal');
    container.append(paragraph);
  }
}
