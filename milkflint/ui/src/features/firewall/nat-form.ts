// A NAT rule's form (fw4 nat sections): its schema, the form as a rule holds
// it, and the changes it saves. The sheet that edits it is in nat.tsx.
import { z } from 'zod';
import type { Change, Section } from '@/lib/api/uci';
import { splitList } from './forms';
import { editSection, type FirewallConfig, isAddress, isIpv4, isShortName, type NatRule, portError } from './model';

const natTargets = ['MASQUERADE', 'SNAT', 'ACCEPT'] as const;
const natProtos = ['all', 'tcp udp', 'tcp', 'udp'] as const;
export type NatTarget = (typeof natTargets)[number];
export type NatProto = (typeof natProtos)[number];

const natFields = z.object({
  name: z.string(),
  target: z.enum(natTargets),
  src: z.string(),
  srcIp: z.string(),
  destIp: z.string(),
  proto: z.enum(natProtos),
  destPort: z.string(),
  snatIp: z.string(),
  snatPort: z.string(),
  family: z.enum(['any', 'ipv4', 'ipv6']),
});

export type NatForm = z.infer<typeof natFields>;

// one address or network each: fw4 takes no lists in NAT rules
function addrError(v: string): string | undefined {
  const a = splitList(v);
  if (a.length > 1) return 'One address or network.';
  return a[0] !== undefined && !isAddress(a[0]) ? `“${a[0]}” isn’t an address or network.` : undefined;
}

/** A NAT rule's checks: one message per field. */
export const natFormSchema: z.ZodType<NatForm, NatForm> = natFields.superRefine((f, ctx) => {
  const e: Partial<Record<keyof NatForm, string>> = {};
  const ports = f.proto !== 'all';
  if (!isShortName(f.name)) e.name = 'A short name.';
  const bs = addrError(f.srcIp);
  if (bs !== undefined) e.srcIp = bs;
  const bd = addrError(f.destIp);
  if (bd !== undefined) e.destIp = bd;
  const portProblem = ports && f.destPort !== '' ? portError(f.destPort) : undefined;
  if (portProblem !== undefined) e.destPort = portProblem;
  if (f.target === 'SNAT' && !isIpv4(f.snatIp)) e.snatIp = 'The address to send from, e.g. 203.0.113.9.';
  const snatPortProblem = f.target === 'SNAT' && ports && f.snatPort !== '' ? portError(f.snatPort) : undefined;
  if (snatPortProblem !== undefined) e.snatPort = snatPortProblem;
  for (const [path, message] of Object.entries(e)) ctx.addIssue({ code: 'custom', path: [path], message });
});

export function natTarget(t: string): NatTarget {
  return t === 'SNAT' || t === 'ACCEPT' ? t : 'MASQUERADE';
}

export function natProto(p: readonly string[]): NatProto {
  const j = p.join(' ');
  return j === 'tcp' || j === 'udp' || j === 'tcp udp' ? j : 'all';
}

/** The form for a rule (undefined: a new one, sending from an address through the internet zone). */
export function natFormOf(nat: NatRule | undefined, cfg: FirewallConfig): NatForm {
  return {
    name: nat?.name ?? '',
    target: natTarget(nat?.target ?? 'SNAT'),
    src: nat?.src ?? cfg.zones.find((z) => z.name === 'wan')?.name ?? cfg.zones[0]?.name ?? 'wan',
    srcIp: nat?.srcIp.join(' ') ?? '',
    destIp: nat?.destIp.join(' ') ?? '',
    proto: natProto(nat?.proto ?? ['all']),
    destPort: nat?.destPort ?? '',
    snatIp: nat?.snatIp ?? '',
    snatPort: nat?.snatPort ?? '',
    family: nat?.family ?? 'ipv4',
  };
}

export function natChanges(f: NatForm, section: Section | undefined): Change[] {
  const ports = f.proto !== 'all';
  return editSection('nat', section, {
    name: f.name.trim(),
    target: f.target,
    src: f.src,
    src_ip: f.srcIp.trim() === '' ? undefined : f.srcIp.trim(),
    dest_ip: f.destIp.trim() === '' ? undefined : f.destIp.trim(),
    proto: f.proto,
    dest_port: ports && f.destPort !== '' ? f.destPort : undefined,
    snat_ip: f.target === 'SNAT' ? f.snatIp : undefined,
    snat_port: f.target === 'SNAT' && ports && f.snatPort !== '' ? f.snatPort : undefined,
    family: f.family === 'any' ? undefined : f.family,
  });
}
