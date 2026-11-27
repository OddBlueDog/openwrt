// About this router: each core's load between two samples of the CPU
// counters (/proc/stat via the stats call).
import type { Stats } from '@/lib/api/stats';

/** Each core's share busy since `before` (0–1); undefined until there are two samples. */
export function coreLoads(before: Stats['cpu'] | undefined, now: Stats['cpu']): number[] | undefined {
  if (before === undefined) return undefined;
  const prev = new Map(before.map((c) => [c.name, c]));
  return now
    .filter((c) => c.name !== 'cpu')
    .map((c) => {
      const p = prev.get(c.name);
      const total = c.total - (p?.total ?? c.total);
      return total > 0 ? 1 - (c.idle - (p?.idle ?? c.idle)) / total : 0;
    });
}
