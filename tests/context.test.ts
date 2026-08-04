import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTranslationUnits, extractPage, hashText, parseContextBrief } from '../src/content/context';

beforeEach(() => {
  document.body.innerHTML = '';
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, width: 300, height: 40, top: 0, right: 300, bottom: 40, left: 0, toJSON: () => ({}),
  });
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() { return this.textContent ?? ''; },
  });
});

describe('page context extraction', () => {
  it('tracks heading paths and excludes sensitive/editable/code content', () => {
    document.body.innerHTML = `
      <article><h1>Research note</h1><p>Visible paragraph.</p><h2>Methods</h2><p>Second paragraph.</p></article>
      <pre><code>secretToken = 123</code></pre>
      <div contenteditable="true"><p>Draft text</p></div>
      <div aria-hidden="true"><p>Hidden text</p></div>
      <input type="password" value="secret" />`;
    const extracted = extractPage(document);
    expect(extracted.snapshot.blocks.map((block) => block.text)).toEqual([
      'Research note', 'Visible paragraph.', 'Methods', 'Second paragraph.',
    ]);
    expect(extracted.snapshot.blocks[3]?.headingPath).toEqual(['Research note', 'Methods']);
    expect(extracted.snapshot.blocks.some((block) => block.text.includes('secret'))).toBe(false);
  });

  it('builds neighboring translation units without undefined fields', () => {
    const blocks = [
      { id:'1', text:'a', tag:'p', headingPath:[], index:0 },
      { id:'2', text:'b', tag:'p', headingPath:['H'], index:1 },
    ];
    expect(buildTranslationUnits(blocks)).toEqual([
      { id:'1', text:'a', headingPath:[], after:'b' },
      { id:'2', text:'b', headingPath:['H'], before:'a' },
    ]);
  });

  it('parses bounded context briefs and has stable hashes', () => {
    const raw = JSON.stringify({ summary:'topic', terms:Array.from({length:25},(_,index)=>({source:`s${index}`,preferred:`t${index}`})) });
    expect(parseContextBrief(raw).terms).toHaveLength(20);
    expect(parseContextBrief('not json')).toEqual({ summary:'', terms:[] });
    expect(hashText('same')).toBe(hashText('same'));
    expect(hashText('same')).not.toBe(hashText('different'));
  });
});
