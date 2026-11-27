// The top of a chart's scale: a round number above its highest value.

/** A round number at or above `value`, for the top of a chart's scale. */
export function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (value <= m * exp) return m * exp;
  }
  return 10 * exp;
}
