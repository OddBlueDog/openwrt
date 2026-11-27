// The LAN page's settings: the router's own address and network size, and
// the DHCP server's pool (first address, how many, lease time), with the UCI
// changes that make them. Plain functions, so ui/tests can run them.
import { z } from 'zod';
import { intToIp, ipToInt } from '@/lib/api/network';
import type { Change } from '@/lib/api/uci';
import { ipv4, isPrivateIpv4 } from '@/lib/schemas';

export const prefixes = ['24', '23', '22', '16'] as const;

export const leaseTimes = [
  { value: '1h', label: '1 hour' },
  { value: '12h', label: '12 hours' },
  { value: '24h', label: '1 day' },
  { value: '7d', label: '1 week' },
] as const;

/**
 * The form: the router's address and network size, and the DHCP pool. The
 * address must be a private one that's neither the network's nor its
 * broadcast address, and the pool has to fit in the network.
 */
export const lanFormSchema = z
  .object({
    ipaddr: ipv4('Enter an IPv4 address, e.g. 192.168.1.1.'),
    prefix: z.string(),
    dhcp: z.boolean(),
    start: z.string(),
    limit: z.string(),
    leasetime: z.string(),
    /** network.lan.ipaddr holds address/prefix (no netmask option) */
    cidrStyle: z.boolean(),
  })
  .superRefine((f, ctx) => {
    const size = 2 ** (32 - Number(f.prefix));
    const ip = ipToInt(f.ipaddr);
    if (ip !== undefined) {
      const host = ip % size;
      if (!isPrivateIpv4(ip))
        ctx.addIssue({ code: 'custom', path: ['ipaddr'], message: 'Use a private address (10.x, 172.16–31.x or 192.168.x).' });
      else if (host === 0 || host === size - 1)
        ctx.addIssue({
          code: 'custom',
          path: ['ipaddr'],
          message: 'That’s the network or broadcast address, not usable by the router.',
        });
    }
    const start = Number(f.start);
    const limit = Number(f.limit);
    if (!Number.isInteger(start) || start < 1 || start >= size - 1)
      ctx.addIssue({ code: 'custom', path: ['start'], message: `Use 1 to ${String(size - 2)}.` });
    if (!Number.isInteger(limit) || limit < 1 || start + limit > size - 1)
      ctx.addIssue({ code: 'custom', path: ['limit'], message: 'The range would run past the end of the network.' });
  });

export type LanForm = z.infer<typeof lanFormSchema>;

export function netmaskOf(prefix: number): string {
  return intToIp(prefix === 0 ? 0 : (2 ** 32 - 2 ** (32 - prefix)) >>> 0);
}

/** How many addresses a network of this prefix has for devices and the router. */
export function hostCount(prefix: number): number {
  return 2 ** (32 - prefix) - 2;
}

/** First and last address the DHCP server hands out. */
export function range(f: LanForm): { first: string; last: string } | undefined {
  const ip = ipToInt(f.ipaddr);
  const start = Number(f.start);
  const limit = Number(f.limit);
  if (ip === undefined || !Number.isInteger(start) || !Number.isInteger(limit)) return undefined;
  const size = 2 ** (32 - Number(f.prefix));
  const base = Math.floor(ip / size) * size;
  return { first: intToIp(base + start), last: intToIp(base + start + limit - 1) };
}

/** A lease time as words: the list's label, or what OpenWrt has ("2h") when it's another. */
export function leaseLabel(value: string): string {
  return leaseTimes.find((t) => t.value === value)?.label ?? value;
}

export function toChanges(f: LanForm, before: LanForm): Change[] {
  const changes: Change[] = [];
  if (f.ipaddr !== before.ipaddr || f.prefix !== before.prefix) {
    changes.push(
      f.cidrStyle
        ? { op: 'set', config: 'network', section: 'lan', values: { ipaddr: `${f.ipaddr}/${f.prefix}` } }
        : { op: 'set', config: 'network', section: 'lan', values: { ipaddr: f.ipaddr, netmask: netmaskOf(Number(f.prefix)) } },
    );
  }
  changes.push({
    op: 'set',
    config: 'dhcp',
    section: 'lan',
    values: { ignore: f.dhcp ? '0' : '1', start: f.start, limit: f.limit, leasetime: f.leasetime },
  });
  return changes;
}

/** Whether saving moves the router to another address (or network size): this page then loses it. */
export function moves(f: LanForm, before: LanForm): boolean {
  return f.ipaddr !== before.ipaddr || f.prefix !== before.prefix;
}

/** What's under More settings, as one line: the network size and, with DHCP on, the pool and lease time. */
export function moreSummary(f: LanForm): string {
  const size = `/${f.prefix} network`;
  if (!f.dhcp) return size;
  const r = range(f);
  return `${size} · ${f.limit} addresses${r === undefined ? '' : ` from ${r.first}`} · lease ${leaseLabel(f.leasetime)}`;
}
