// Whether CAKE runs as the Smart Queue page saved it: tc's qdiscs
// (milkflint.sqm_status) against the internet's queue. sqm-scripts reports a
// start as done even when tc refused a CAKE (downloads then pass unshaped),
// and a save it didn't pick up leaves the old CAKE running, so the page
// compares, per direction: a CAKE where there should be one and none where
// there shouldn't, its kind (one CAKE or multi-queue) and its speed.
import type { CakeQdisc } from '@/lib/api/stats';
import { bool, type Section, str } from '@/lib/api/uci';
import { formatBitrate } from '@/lib/format';
import { words } from './gso';

/** sqm-scripts' name for a device's download ifb */
export function ifbOf(device: string): string {
  return `ifb4${device}`.slice(0, 15);
}

/** A device's CAKE: a plain one at its root, or multi-queue CAKE's root. */
function rootCake(qdiscs: readonly CakeQdisc[], device: string): CakeQdisc | undefined {
  return qdiscs.find((q) => q.dev === device && (q.kind === 'cake_mq' || q.parent === undefined));
}

const kindName = (kind: CakeQdisc['kind']): string => (kind === 'cake_mq' ? 'multi-queue CAKE' : 'one CAKE');

/**
 * What's not as saved, as sentences; none when it all is. A queue without
 * an interface isn't started by sqm, so nothing is expected of it.
 */
export function shapingProblems(queue: Section | undefined, qdiscs: readonly CakeQdisc[]): string[] {
  const device = str(queue, 'interface');
  if (queue === undefined || device === undefined) return [];
  const on = bool(queue, 'enabled');
  const useMq = bool(queue, 'use_mq');
  const egress = str(queue, 'use_mq_egress');
  const directions = [
    {
      name: 'Downloads',
      dev: ifbOf(device),
      kbit: Number(str(queue, 'download') ?? '0'),
      // sqm makes the ifb with a queue per CPU for multi-queue
      kind: useMq ? 'cake_mq' : 'cake',
      // autorate-ingress: CAKE sets its own speed
      autorate: words(str(queue, 'iqdisc_opts')).includes('autorate-ingress'),
    },
    {
      name: 'Uploads',
      dev: device,
      kbit: Number(str(queue, 'upload') ?? '0'),
      // multi-queue only where the device sends on several queues (pppoe-wan has one): either then
      kind: (egress === undefined ? useMq : egress === '1') ? undefined : 'cake',
      autorate: false,
    },
  ] as const;

  const problems: string[] = [];
  for (const d of directions) {
    // sqm shapes a direction whose speed isn't 0
    const want = on && Number.isFinite(d.kbit) && d.kbit > 0;
    const cake = rootCake(qdiscs, d.dev);
    if (want && cake === undefined) {
      problems.push(`${d.name} aren’t shaped: there’s no CAKE on ${d.dev}.`);
    } else if (!want && cake !== undefined) {
      problems.push(`CAKE still shapes ${d.name.toLowerCase()} on ${d.dev}, though ${on ? 'their speed is 0' : 'Smart Queue is off'}.`);
    } else if (cake !== undefined) {
      if (d.kind !== undefined && cake.kind !== d.kind) problems.push(`${d.name} run ${kindName(cake.kind)}, not ${kindName(d.kind)} as saved.`);
      const bandwidth = cake.options?.bandwidth;
      const bits = typeof bandwidth === 'number' ? bandwidth * 8 : 0;
      if (!d.autorate && Math.round(bits / 1000) !== d.kbit) {
        problems.push(`${d.name} are shaped at ${bits === 0 ? 'no limit' : formatBitrate(bits)}, not the ${formatBitrate(d.kbit * 1000)} saved.`);
      }
    }
  }
  return problems;
}
