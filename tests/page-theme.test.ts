import { describe, expect, it } from 'vitest';
import { colorTheme, resolvePageTheme } from '../src/content/page-theme';

describe('page theme adaptation', () => {
  it('classifies readable dark and light backgrounds', () => {
    expect(colorTheme('rgb(17, 24, 32)')).toBe('dark');
    expect(colorTheme('rgb(245, 240, 232)')).toBe('light');
    expect(colorTheme('rgba(0, 0, 0, 0)')).toBeUndefined();
  });

  it('honors an explicit site theme', () => {
    expect(resolvePageTheme('dark')).toBe('dark');
    expect(resolvePageTheme('light')).toBe('light');
  });
});
