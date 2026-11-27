// Rates from two byte counters read some time apart.

/** Two answers that arrive almost together (after a stalled poll) give no rate: over a near-zero interval it would be absurd. */
export const MIN_RATE_SECONDS = 0.5;

export function rate(prev: number | undefined, cur: number | undefined, seconds: number): number | undefined {
  if (prev === undefined || cur === undefined || seconds < MIN_RATE_SECONDS || cur < prev) return undefined;
  return ((cur - prev) * 8) / seconds;
}

/** What a device has sent and received so far, and where it was read: its Wi-Fi counters or its connections' sums. */
export interface ByteSample {
  kind: 'wifi' | 'wired';
  /** bytes the device has received */
  down: number;
  /** bytes the device has sent */
  up: number;
  /** when it was read, epoch ms */
  at: number;
}

/**
 * The rates (bit/s) between two samples. A change of kind (Wi-Fi to wired or back) restarts: the two counters
 * aren't the same count, so there's nothing to compare. A wired sum that falls (a connection ended) is 0, not unknown.
 */
export function ratesBetween(
  prev: ByteSample | undefined,
  cur: ByteSample,
  floorAtZero: boolean,
): { down?: number | undefined; up?: number | undefined } {
  if (prev?.kind !== cur.kind) return {};
  const seconds = (cur.at - prev.at) / 1000;
  const one = (a: number, b: number): number | undefined => {
    if (floorAtZero && seconds >= MIN_RATE_SECONDS && b < a) return 0;
    return rate(a, b, seconds);
  };
  return { down: one(prev.down, cur.down), up: one(prev.up, cur.up) };
}
