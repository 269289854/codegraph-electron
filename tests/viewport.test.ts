import { describe, expect, it } from 'vitest';
import { clampScale, zoomViewportAtPoint } from '../src/shared/viewport.js';

describe('viewport zoom', () => {
  it('keeps graph coordinate under pointer stable while zooming', () => {
    const viewport = { scale: 1, x: -120, y: 40 };
    const point = { x: 300, y: 220 };
    const before = {
      x: (point.x - viewport.x) / viewport.scale,
      y: (point.y - viewport.y) / viewport.scale,
    };

    const next = zoomViewportAtPoint(viewport, point, 1.8);
    const after = {
      x: (point.x - next.x) / next.scale,
      y: (point.y - next.y) / next.scale,
    };

    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('clamps zoom scale to the supported range', () => {
    expect(clampScale(0.1)).toBe(0.25);
    expect(clampScale(9)).toBe(6);
    expect(clampScale(1.2)).toBe(1.2);
  });
});
