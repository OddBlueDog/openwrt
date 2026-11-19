// What the CPU lanes (Performance Tuning, Smart Queue) put where, and how
// their chips read: a download sub-queue's CPU, a receive ring's summary.
import type { RingNow } from '@/hooks/use-network-live';
import { formatNumber, formatPercent } from '@/lib/format';

/** Interrupts a second below which a ring counts as idle: stray packets, not traffic. */
const RING_BUSY = 20;

/** 5,700 -> "5.7k/s" */
export function perSecond(n: number | undefined): string {
  if (n === undefined) return '—/s';
  return n >= 1000 ? `${formatNumber(n / 1000, 1)}k/s` : `${formatNumber(n)}/s`;
}

/** a thread's CPU use: 0.13 -> "13% CPU" */
export function load(n: number | undefined): string {
  return n === undefined ? '— CPU' : `${formatPercent(n)} CPU`;
}

/**
 * The CPU a download sub-queue runs on: the one its transmit queue's XPS
 * gives it (sqm-scripts sets one per CPU on a PPPoE line's ifb), else the
 * CPU of the RSS ring that feeds it. XPS over several CPUs pins it nowhere.
 */
export function queueCpu(xps: readonly number[] | undefined, ringCpu: number | undefined): number | undefined {
  if (xps !== undefined && xps.length > 0) return xps.length === 1 ? xps[0] : undefined;
  return ringCpu;
}

/**
 * A receive ring's chip: its share of the RSS table's flows with its rates,
 * idle when (almost) nothing arrives. Ring 0, outside the table, still gets
 * what the hash can't spread: the switch's ports, and PPPoE.
 */
export function ringSummary(r: RingNow): { detail: string; idle: boolean } {
  const busy = r.irqRate !== undefined && r.irqRate >= RING_BUSY;
  const rates = `${perSecond(r.irqRate)} · ${load(r.load)}`;
  if (r.share > 0) return { detail: `${formatPercent(r.share)} of flows · ${rates}`, idle: r.irqRate !== undefined && !busy };
  return busy ? { detail: `not hashed · ${rates}`, idle: false } : { detail: 'no flows', idle: true };
}
