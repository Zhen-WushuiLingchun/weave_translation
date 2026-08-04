import { beforeEach, describe, expect, it } from 'vitest';
import { renderRestrictedMarkdown } from '../src/content/rich-translation';

describe('restricted Markdown and LaTeX rendering', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.replaceChildren(container);
  });

  it('renders safe Markdown and local MathML without interpreting model HTML', () => {
    const token = '⟦WEAVE_MATH_A1B2C3D4_0⟧';
    renderRestrictedMarkdown(
      container,
      `**能量关系**为 ${token}。\n\n$$\\int_0^1 x^2 \\, \\mathrm{d}x$$\n\n<script>alert(1)</script>`,
      [{ token, latex: 'E=mc^2', display: false, fallback: 'E=mc²' }],
    );

    expect(container.dataset.weaveFormat).toBe('markdown-latex-v1');
    expect(container.querySelector('strong')?.textContent).toBe('能量关系');
    expect(container.querySelectorAll('[data-weave-math]')).toHaveLength(2);
    expect(container.querySelectorAll('math').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('falls back to readable LaTeX when KaTeX rejects a command', () => {
    renderRestrictedMarkdown(container, '$\\definitelyUnknownCommand{x}$');
    const math = container.querySelector<HTMLElement>('[data-weave-math-error="true"]');
    expect(math?.textContent).toContain('definitelyUnknownCommand');
  });
});
