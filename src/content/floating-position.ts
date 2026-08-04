export interface FloatingPosition {
  x: number;
  y: number;
}

export interface FloatingSize {
  width: number;
  height: number;
}

export function clampFloatingPosition(
  position: FloatingPosition,
  floating: FloatingSize,
  viewport: FloatingSize,
  margin = 12,
): FloatingPosition {
  const maxX = Math.max(margin, viewport.width - floating.width - margin);
  const maxY = Math.max(margin, viewport.height - floating.height - margin);
  return {
    x: Math.min(maxX, Math.max(margin, position.x)),
    y: Math.min(maxY, Math.max(margin, position.y)),
  };
}
