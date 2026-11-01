// What the time-axis charts (timeline chart, heat strip) share: where their
// plots start, so their times line up one above the other, and finding a
// time under the pointer and the point nearest it.
import type { PointerEvent } from 'react';

export const PLOT_LEFT = '5.5rem';

export type TimePoint = readonly [number, number | null];

/** The point nearest `t` with a value, if one is within `tol`. */
export function nearest(points: readonly TimePoint[], t: number, tol: number): TimePoint | undefined {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if ((points[m]?.[0] ?? 0) < t) lo = m + 1;
    else hi = m;
  }
  let best: TimePoint | undefined;
  for (const p of [points[lo - 1], points[lo]]) {
    if (p === undefined || p[1] === null || Math.abs(p[0] - t) > tol) continue;
    if (best === undefined || Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
  }
  return best;
}

/** The pointer's position over an element, as a time between `from` and `to`. */
export function pointerTime(e: PointerEvent<HTMLElement>, from: number, to: number): number | undefined {
  const r = e.currentTarget.getBoundingClientRect();
  if (r.width === 0) return undefined;
  return from + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (to - from);
}
