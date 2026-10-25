// CAKE's statistics (milkflint.sqm_status) grouped by shaping direction,
// for the dashboard's Smart Queue card.
import type { CakeQdisc, CakeTin } from '@/lib/api/stats';
import { isVpnShaper } from '../vpn-client/sections';
import { isGuestShaper } from '../wifi-guest/guest';

// One direction of shaping: a plain cake, or a cake_mq root with its
// per-transmit-queue cakes.
export interface Direction {
  dev: string;
  download: boolean;
  root: CakeQdisc;
  queues: CakeQdisc[];
}

/** The internet port's directions, download first. Guest Wi-Fi's speed limits and the VPN's queue inside its tunnel are CAKE too, and are left out. */
export function directionsOf(qdiscs: readonly CakeQdisc[]): Direction[] {
  const out: Direction[] = [];
  for (const root of qdiscs) {
    if (isGuestShaper(root.dev) || isVpnShaper(root.dev)) continue;
    if (root.kind === 'cake_mq') {
      const major = root.handle ?? '';
      const queues = qdiscs.filter((q) => q.kind === 'cake' && q.dev === root.dev && q.parent?.startsWith(major) === true);
      out.push({ dev: root.dev, download: root.dev.startsWith('ifb'), root, queues });
    } else if (root.parent === undefined) {
      out.push({ dev: root.dev, download: root.dev.startsWith('ifb'), root, queues: [root] });
    }
  }
  return out.sort((a, b) => Number(b.download) - Number(a.download));
}

export function delayMs(us: number | undefined): string {
  return us === undefined ? '—' : `${(us / 1000).toFixed(1)} ms`;
}

export interface DirectionSummary {
  /** The shaped speed, bit/s; undefined when unlimited. */
  bandwidth: number | undefined;
  /** Bytes through all its queues, for the rate between two polls. */
  bytes: number;
  /** The busiest tin's delays, in the worst queue. */
  avgDelayUs: number | undefined;
  peakDelayUs: number | undefined;
  drops: number;
  ecnMarks: number;
  flows: number;
}

export function summarize(d: Direction): DirectionSummary {
  const tins = d.queues.flatMap((q) => q.tins ?? []);
  const sum = (key: 'drops' | 'ecn_mark' | 'sparse_flows' | 'bulk_flows'): number => tins.reduce((n, t) => n + (t[key] ?? 0), 0);
  const busiest = d.queues.map((q) =>
    (q.tins ?? []).reduce<CakeTin | undefined>((best, t) => ((t.sent_bytes ?? 0) > (best?.sent_bytes ?? -1) ? t : best), undefined),
  );
  const worst = (key: 'avg_delay_us' | 'peak_delay_us'): number | undefined =>
    busiest.reduce<number | undefined>((m, t) => (t?.[key] === undefined ? m : Math.max(m ?? 0, t[key])), undefined);
  return {
    bandwidth: typeof d.root.options?.bandwidth === 'number' ? d.root.options.bandwidth * 8 : undefined,
    bytes: d.queues.reduce((n, q) => n + (q.bytes ?? 0), 0),
    avgDelayUs: worst('avg_delay_us'),
    peakDelayUs: worst('peak_delay_us'),
    drops: sum('drops'),
    ecnMarks: sum('ecn_mark'),
    flows: sum('sparse_flows') + sum('bulk_flows'),
  };
}
