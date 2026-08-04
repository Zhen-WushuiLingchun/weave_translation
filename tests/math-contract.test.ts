import { describe, expect, it } from 'vitest';
import { validateMathPlaceholders } from '../src/lib/math';

describe('math placeholder response contract', () => {
  const math = [{ token: '⟦WEAVE_MATH_ABCDEF12_0⟧', latex: 'E=mc^2', display: false, fallback: 'E=mc²' }];

  it('accepts each expected token exactly once', () => {
    expect(validateMathPlaceholders(`能量满足 ${math[0]!.token}。`, math)).toBeUndefined();
  });

  it('rejects missing, duplicate, and invented tokens', () => {
    expect(validateMathPlaceholders('能量满足该关系。', math)).toContain('遗漏');
    expect(validateMathPlaceholders(`${math[0]!.token} ${math[0]!.token}`, math)).toContain('重复');
    expect(validateMathPlaceholders('⟦WEAVE_MATH_DEADBEEF_9⟧', math)).toContain('未知');
  });
});
