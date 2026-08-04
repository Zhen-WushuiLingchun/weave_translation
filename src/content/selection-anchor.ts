import type { FloatingPosition, FloatingSize } from './floating-position';

export interface SelectionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SelectionAnchorSnapshot {
  rect: SelectionRect;
  scrollX: number;
  scrollY: number;
}

const DOT_SIZE = 38;
const DOT_MARGIN = 12;
const DOT_GAP_X = 6;
const DOT_GAP_Y = 8;

export function selectionDotPosition(rect: SelectionRect, viewport: FloatingSize): FloatingPosition {
  const maxX = Math.max(DOT_MARGIN, viewport.width - DOT_SIZE - DOT_MARGIN);
  const maxY = Math.max(DOT_MARGIN, viewport.height - DOT_SIZE - DOT_MARGIN);
  return {
    x: Math.min(maxX, Math.max(DOT_MARGIN, rect.right + DOT_GAP_X)),
    y: Math.min(maxY, Math.max(DOT_MARGIN, rect.bottom + DOT_GAP_Y)),
  };
}

export function selectionDotDismissDistance(viewportHeight: number): number {
  return Math.min(360, Math.max(180, viewportHeight * 0.35));
}

export function shouldDismissSelectionDot(
  anchor: SelectionAnchorSnapshot,
  currentRect: SelectionRect,
  currentScroll: FloatingPosition,
  viewport: FloatingSize,
): boolean {
  const outsideViewport = currentRect.bottom < -DOT_MARGIN
    || currentRect.top > viewport.height + DOT_MARGIN
    || currentRect.right < -DOT_MARGIN
    || currentRect.left > viewport.width + DOT_MARGIN;
  if (outsideViewport) return true;

  const scrollDistance = Math.hypot(currentScroll.x - anchor.scrollX, currentScroll.y - anchor.scrollY);
  const anchorTravel = Math.hypot(currentRect.left - anchor.rect.left, currentRect.top - anchor.rect.top);
  return Math.max(scrollDistance, anchorTravel) >= selectionDotDismissDistance(viewport.height);
}
