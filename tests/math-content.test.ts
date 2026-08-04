import { beforeEach, describe, expect, it, vi } from 'vitest';
import { containingContext, extractPage } from '../src/content/context';
import { extractDisplayMath, extractStructuredText } from '../src/content/math-content';

beforeEach(() => {
  document.body.innerHTML = '';
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, width: 500, height: 40, top: 0, right: 500, bottom: 40, left: 0, toJSON: () => ({}),
  });
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() { return this.textContent ?? ''; },
  });
});

describe('academic math extraction', () => {
  it('turns inline arXiv MathML into model-readable LaTeX placeholders', () => {
    document.body.innerHTML = `<p id="paper">In coordinates
      <math alttext="(ct,r,\\theta,\\phi)" class="ltx_Math" display="inline"><semantics><mrow><mi>c</mi><mi>t</mi></mrow><annotation encoding="application/x-tex">(ct,r,\\theta,\\phi)</annotation></semantics></math>,
      the line element follows.</p>`;
    const paragraph = document.querySelector<HTMLElement>('#paper')!;
    const structured = extractStructuredText(paragraph);

    expect(structured.mathOnly).toBe(false);
    expect(structured.math).toHaveLength(1);
    expect(structured.math[0]).toMatchObject({ latex: '(ct,r,\\theta,\\phi)', display: false });
    expect(structured.text).toContain(structured.math[0]!.token);
    expect(structured.text).not.toContain('ctrt');
  });

  it('excludes standalone equations and their arXiv equation numbers', () => {
    document.body.innerHTML = `<article><p>Readable prose before the equation.</p>
      <table class="ltx_equation ltx_eqn_table"><tbody><tr class="ltx_equation">
        <td class="ltx_eqn_cell ltx_align_center"><math alttext="d s^2=-c^2dt^2+a(t)^2dr^2" display="block"><semantics><mrow><mi>d</mi></mrow><annotation encoding="application/x-tex">d s^2=-c^2dt^2+a(t)^2dr^2</annotation></semantics></math></td>
        <td class="ltx_eqn_cell ltx_eqn_eqno"><span>(1)</span></td>
      </tr></tbody></table></article>`;

    const cells = document.querySelectorAll<HTMLElement>('td');
    expect(extractStructuredText(cells[0]!).mathOnly).toBe(true);
    expect(extractStructuredText(cells[1]!).mathOnly).toBe(true);
    const page = extractPage(document);
    expect(page.snapshot.blocks.map((block) => block.text)).toEqual(['Readable prose before the equation.']);
    expect(page.snapshot.blocks[0]?.contextMath?.[0]?.latex).toBe('d s^2=-c^2dt^2+a(t)^2dr^2');
  });

  it('preserves formula metadata in page and selection translation units', () => {
    document.body.innerHTML = `<p id="paper">The energy is <math alttext="E=mc^2" display="inline"><semantics><annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math> in this frame.</p>`;
    const extracted = extractPage(document);
    expect(extracted.snapshot.blocks[0]?.math?.[0]?.latex).toBe('E=mc^2');

    const paragraph = document.querySelector<HTMLElement>('#paper')!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const unit = containingContext(selection, extracted.snapshot);
    expect(unit?.math?.[0]?.latex).toBe('E=mc^2');
    expect(unit?.text).toContain(unit?.math?.[0]?.token ?? 'missing');
  });

  it('recognizes KaTeX, MathJax, and semantic math without site-specific rules', () => {
    document.body.innerHTML = `<article>
      <p id="katex">KaTeX energy
        <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>E</mi></mrow><annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math></span></span>
        remains invariant.</p>
      <p id="mathjax">MathJax state <script type="math/tex">\\psi(x,t)</script> evolves in time.</p>
      <p id="semantic">The norm <span role="math" data-latex="\\lVert x\\rVert_2">norm x</span> is bounded.</p>
      <p id="display"><mjx-container display="true" aria-label="\\int_0^1 x\\,dx"></mjx-container></p>
    </article>`;

    expect(extractStructuredText(document.querySelector<HTMLElement>('#katex')!).math[0]?.latex).toBe('E=mc^2');
    expect(extractStructuredText(document.querySelector<HTMLElement>('#mathjax')!).math[0]).toMatchObject({ latex: '\\psi(x,t)', display: false });
    expect(extractStructuredText(document.querySelector<HTMLElement>('#semantic')!).math[0]?.latex).toBe('\\lVert x\\rVert_2');
    expect(extractStructuredText(document.querySelector<HTMLElement>('#display')!).mathOnly).toBe(true);
    expect(extractDisplayMath(document).map((entry) => entry.math.latex)).toContain('\\int_0^1 x\\,dx');
  });

  it('detects legacy MathJax display scripts as standalone equations', () => {
    document.body.innerHTML = '<p id="equation"><script type="math/tex; mode=display">\\sum_{i=1}^n i</script></p>';
    const structured = extractStructuredText(document.querySelector<HTMLElement>('#equation')!);
    expect(structured.math[0]).toMatchObject({ latex: '\\sum_{i=1}^n i', display: true });
    expect(structured.mathOnly).toBe(true);
  });
});
