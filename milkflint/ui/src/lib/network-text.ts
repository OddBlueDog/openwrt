// Words for where the network work runs (the CPU lanes on Performance
// Tuning and Smart Queue).
import type { NetworkLive } from '@/hooks/use-network-live';

/** [1, 2, 3] -> "CPUs 1–3" */
export function cpuText(cpus: readonly number[]): string {
  if (cpus.length === 0) return 'no CPU';
  const ranges: [number, number][] = [];
  for (const c of cpus) {
    const last = ranges.at(-1);
    if (last !== undefined && c === last[1] + 1) last[1] = c;
    else ranges.push([c, c]);
  }
  return `${cpus.length === 1 ? 'CPU' : 'CPUs'} ${ranges.map(([a, b]) => (a === b ? String(a) : `${String(a)}–${String(b)}`)).join(', ')}`;
}

/** One sentence on how a download flow travels through the CPUs now. */
export function pathSentence(live: NetworkLive): string {
  const multi = live.queues.some((q) => q.download && q.number > 0);
  const pinned = live.queues.some((q) => q.download && q.cpu !== undefined);
  if (live.rss?.spreading === true) {
    const rings = live.rings.filter((r) => r.share > 0);
    const where = cpuText([...new Set(rings.map((r) => r.cpu).filter((c) => c !== undefined))].sort((a, b) => a - b));
    if (multi && pinned) {
      return `RSS spreads downloads over ${String(rings.length)} rings on ${where}, and each ring feeds its own Smart Queue queue on the same CPU: a flow never changes CPU.`;
    }
    return `RSS spreads downloads over ${String(rings.length)} rings on ${where}; Smart Queue then shapes them in one CAKE, on one CPU at a time.`;
  }
  if (live.rps.length > 0) {
    return `What the Ethernet receives arrives on one ring, and packet steering (RPS) hands it on to ${cpuText(live.rps)} by flow.`;
  }
  return 'What the Ethernet receives is handled on the CPU it arrives on.';
}
