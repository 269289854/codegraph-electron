export type Viewport = {
  scale: number;
  x: number;
  y: number;
};

export function zoomViewportAtPoint(
  viewport: Viewport,
  point: { x: number; y: number },
  nextScale: number,
): Viewport {
  const graphX = (point.x - viewport.x) / viewport.scale;
  const graphY = (point.y - viewport.y) / viewport.scale;

  return {
    scale: nextScale,
    x: point.x - graphX * nextScale,
    y: point.y - graphY * nextScale,
  };
}

export function clampScale(scale: number): number {
  return Math.max(0.35, Math.min(2.5, scale));
}
