import { describe, expect, it } from 'vitest';
import { clampFloatingPosition } from '../src/content/floating-position';

describe('floating card positioning', () => {
  it('keeps a card inside every viewport edge', () => {
    expect(clampFloatingPosition(
      { x: 1_000, y: -80 },
      { width: 348, height: 310 },
      { width: 1_200, height: 800 },
    )).toEqual({ x: 840, y: 12 });
  });

  it('pins oversized cards to the safe margin', () => {
    expect(clampFloatingPosition(
      { x: 200, y: 300 },
      { width: 900, height: 700 },
      { width: 600, height: 500 },
    )).toEqual({ x: 12, y: 12 });
  });
});
