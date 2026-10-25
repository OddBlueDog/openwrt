// SVG path helpers for the charts. Coordinates are in a 0..100 × 0..100 box
// that the SVG stretches to its size (preserveAspectRatio="none").

export interface Point {
  x: number;
  y: number;
}

/** Points for `values` (oldest first) spread over the box, scaled to `max`. */
export function toPoints(values: readonly (number | undefined)[], max: number, slots: number): (Point | undefined)[] {
  const step = slots > 1 ? 100 / (slots - 1) : 100;
  const offset = slots - values.length;
  return values.map((v, i) =>
    v === undefined ? undefined : { x: (offset + i) * step, y: 100 - (max > 0 ? Math.min(v / max, 1) : 0) * 100 },
  );
}

/** Line and filled-area paths; gaps (undefined) break both. */
export function paths(points: readonly (Point | undefined)[]): { line: string; area: string } {
  const runs: Point[][] = [];
  let run: Point[] = [];
  for (const p of points) {
    if (p === undefined) {
      if (run.length > 0) runs.push(run);
      run = [];
    } else {
      run.push(p);
    }
  }
  if (run.length > 0) runs.push(run);

  const fmt = (n: number): string => n.toFixed(2);
  let line = '';
  let area = '';
  for (const r of runs) {
    const first = r[0];
    const last = r[r.length - 1];
    if (first === undefined || last === undefined) continue;
    const seg = r.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`).join(' ');
    line += `${seg} `;
    area += `${seg} L${fmt(last.x)} 100 L${fmt(first.x)} 100 Z `;
  }
  return { line: line.trim(), area: area.trim() };
}

/** A round number at or above `value`, for the top of a chart's scale. */
export function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (value <= m * exp) return m * exp;
  }
  return 10 * exp;
}
