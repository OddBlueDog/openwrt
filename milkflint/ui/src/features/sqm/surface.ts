// What the Smart Queue page shows on its surface, from the form and the live
// figures, kept apart from the drawing so it can be tested: what's folded
// under More settings and not at its usual value, whether the connection
// type was ever chosen, and each direction's live rate against its limit.
import type { CakeQdisc } from '@/lib/api/stats';
import type { SqmData, SqmForm } from './model';

/**
 * Whether the page should ask for the connection type instead of showing
 * "No compensation" as chosen: OpenWrt's own queue comes with none, and
 * while Smart Queue has never shaped with it, nobody chose it.
 */
export function linkUnasked(data: SqmData): boolean {
  return data.form.link === 'none' && !data.form.enabled;
}

/**
 * What's under More settings that isn't at its usual value, in a few
 * words each; empty when it's all as usual.
 */
export function moreSummary(form: SqmForm, data: SqmData): string[] {
  const out: string[] = [];
  if (form.prioritise) out.push('Prioritise by traffic type');
  if (form.latency === 'low') out.push('Low latency target');
  else if (form.latency === 'custom') out.push('Custom latency target');
  if (form.perDevice) out.push('Fair share per device');
  if (form.restoreDscp) out.push('Devices’ priorities kept');
  if (data.wanDevice !== undefined && form.device !== data.wanDevice) out.push(`Shapes ${form.device}`);
  return out;
}

/** cake_mq's sub-queue number, from its parent (1:3 is 3); 0 for a plain CAKE */
export function queueNumber(q: CakeQdisc): number {
  const minor = parseInt(q.parent?.split(':')[1] ?? '0', 16);
  return Number.isNaN(minor) ? 0 : minor;
}

/** A direction's rate: the sum of its queues' that are known; undefined until one is. */
export function totalRate(rates: readonly (number | undefined)[]): number | undefined {
  return rates.every((r) => r === undefined) ? undefined : rates.reduce<number>((n, r) => n + (r ?? 0), 0);
}

/** The share of the shaped speed in use, 0 to 1; undefined without both. */
export function shareOfLimit(rate: number | undefined, limit: number | undefined): number | undefined {
  if (rate === undefined || limit === undefined || limit <= 0) return undefined;
  return Math.min(1, rate / limit);
}
