import { describe, expect, it } from 'vitest';
import {
  selectionDotDismissDistance,
  selectionDotPosition,
  shouldDismissSelectionDot,
} from '../src/content/selection-anchor';

describe('selection translation anchor', () => {
  const viewport = { width: 1200, height: 800 };
  const anchor = {
    rect: { left: 300, top: 320, right: 560, bottom: 350 },
    scrollX: 0,
    scrollY: 100,
  };

  it('keeps the dot beside the selected range and inside the viewport', () => {
    expect(selectionDotPosition(anchor.rect, viewport)).toEqual({ x: 566, y: 358 });
    expect(selectionDotPosition({ left: 1180, top: 780, right: 1220, bottom: 820 }, viewport)).toEqual({ x: 1150, y: 750 });
  });

  it('uses a bounded viewport-relative dismissal distance', () => {
    expect(selectionDotDismissDistance(300)).toBe(180);
    expect(selectionDotDismissDistance(800)).toBe(280);
    expect(selectionDotDismissDistance(1600)).toBe(360);
  });

  it('allows a short scroll but dismisses after substantial movement', () => {
    const nearby = { left: 300, top: 270, right: 560, bottom: 300 };
    expect(shouldDismissSelectionDot(anchor, nearby, { x: 0, y: 150 }, viewport)).toBe(false);

    const farAway = { left: 300, top: 20, right: 560, bottom: 50 };
    expect(shouldDismissSelectionDot(anchor, farAway, { x: 0, y: 400 }, viewport)).toBe(true);
  });

  it('dismisses as soon as the selected range leaves the viewport', () => {
    expect(shouldDismissSelectionDot(
      anchor,
      { left: 300, top: -80, right: 560, bottom: -20 },
      { x: 0, y: 150 },
      viewport,
    )).toBe(true);
  });
});
