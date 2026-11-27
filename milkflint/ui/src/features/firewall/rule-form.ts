// A traffic rule's form (fw4 rule sections): its schema, made for the
// firewall as loaded, the form as a rule holds it, and the options it
// writes. The sheet that edits it is rule-sheet.tsx.
import { z } from 'zod';
import { list, type Section, str } from '@/lib/api/uci';
import { isGuestNetwork } from '../wifi-guest/guest';
import { bedtime, type RulePreset, scheduleError, scheduleForm, scheduleFormSchema, scheduleValues } from './forms';
import {
  type FirewallConfig,
  isAddress,
  isInternetZone,
  isMac,
  isShortName,
  logPrefixError,
  portError,
  type Rule,
  type Values,
  type Zone,
  zonePhrase,
} from './model';

/** The router itself, as a rule's source or destination (no src / dest option). */
export const ROUTER = '@router';
/** Any zone (fw4's '*'). */
export const ANY = '*';

export const condKeys = ['dest_port', 'src_port', 'src_ip', 'dest_ip', 'src_mac', 'icmp_type'] as const;
export type CondKey = (typeof condKeys)[number];

const condSchema = z.object({
  include: z.array(z.string()),
  exclude: z.array(z.string()),
  /** the exclude field is showing */
  excluding: z.boolean(),
});

export type Cond = z.infer<typeof condSchema>;

const ruleFields = z.object({
  name: z.string(),
  src: z.string(),
  dest: z.string(),
  proto: z.array(z.string()),
  family: z.enum(['any', 'ipv4', 'ipv6']),
  conds: z.partialRecord(z.enum(condKeys), condSchema),
  target: z.string(),
  enabled: z.boolean(),
  limit: z.string(),
  limitBurst: z.string(),
  log: z.string(),
  scheduled: z.boolean(),
  schedule: scheduleFormSchema,
  /** ticked: open every port, as opensEverything describes */
  openAll: z.boolean(),
});

export type SheetForm = z.infer<typeof ruleFields>;

export const PORT_PROTOS = ['tcp', 'udp', 'sctp', 'udplite', 'dccp'];
export const ICMP_PROTOS = ['icmp', 'icmpv6', 'ipv6-icmp'];

/** fw4 matches ports only with protocols that have them; no protocol is its default, TCP and UDP. */
export const portsApply = (proto: readonly string[]): boolean =>
  proto.length === 0 || proto.every((p) => PORT_PROTOS.includes(p));
export const icmpApplies = (proto: readonly string[]): boolean => proto.some((p) => ICMP_PROTOS.includes(p));

export const conditions: readonly {
  key: CondKey;
  label: string;
  placeholder: string;
  check: (v: string) => boolean;
}[] = [
  { key: 'dest_port', label: 'Destination ports', placeholder: 'Port or range', check: (v) => portError(v) === undefined },
  { key: 'src_port', label: 'Source ports', placeholder: 'Port or range', check: (v) => portError(v) === undefined },
  { key: 'src_ip', label: 'Source addresses', placeholder: 'Address or network', check: isAddress },
  { key: 'dest_ip', label: 'Destination addresses', placeholder: 'Address or network', check: isAddress },
  { key: 'src_mac', label: 'Source devices', placeholder: 'MAC address', check: isMac },
  { key: 'icmp_type', label: 'ICMP types', placeholder: 'e.g. echo-request', check: (v) => /^[a-z0-9-]+(\/\d+)?$/i.test(v) },
];

/** Values of one option: "!x" entries (fw4's "not") go to exclude. */
export function cond(s: Section | undefined, option: string): Cond | undefined {
  const include: string[] = [];
  const exclude: string[] = [];
  let not = false;
  for (const v of list(s, option)) {
    if (v === '!') {
      not = true;
      continue;
    }
    if (not || v.startsWith('!')) exclude.push(v.replace(/^!/, ''));
    else include.push(v);
    not = false;
  }
  if (include.length + exclude.length === 0) return undefined;
  return { include, exclude, excluding: exclude.length > 0 };
}

export function formOf(rule: Rule | undefined, s: Section | undefined, preset: RulePreset | undefined): SheetForm {
  const conds: Partial<Record<CondKey, Cond>> = {};
  for (const c of conditions) {
    const v = cond(s, c.key);
    if (v !== undefined) conds[c.key] = v;
  }
  if (rule === undefined) {
    const ports = preset?.ports.split(/\s+/).filter((p) => p !== '') ?? [];
    if (ports.length > 0) conds.dest_port = { include: ports, exclude: [], excluding: false };
    return {
      name: preset?.name ?? '',
      src: preset === undefined ? 'wan' : preset.src === '' ? ROUTER : preset.src,
      dest: preset === undefined || preset.dest === '' ? ROUTER : preset.dest,
      proto: preset === undefined || preset.proto === 'tcp udp' ? [] : preset.proto.split(' '),
      family: 'any',
      conds,
      target: preset?.target ?? 'ACCEPT',
      enabled: true,
      limit: '',
      limitBurst: '',
      log: '',
      scheduled: false,
      schedule: bedtime,
      openAll: false,
    };
  }
  return {
    name: rule.name ?? '',
    src: rule.src ?? ROUTER,
    dest: rule.dest ?? ROUTER,
    proto: list(s, 'proto').map((p) => p.toLowerCase()),
    family: rule.family,
    conds,
    target: rule.target,
    enabled: rule.enabled,
    limit: str(s, 'limit') ?? '',
    limitBurst: str(s, 'limit_burst') ?? '',
    log: str(s, 'log') ?? '',
    scheduled: rule.schedule !== undefined,
    schedule: scheduleForm(rule.schedule),
    openAll: false,
  };
}

/** A list option written as it was stored: one space-separated option stays one, a list stays a list. */
export function asStored(s: Section | undefined, option: string, values: string[]): string | string[] | undefined {
  if (values.length === 0) return undefined;
  return typeof s?.[option] === 'string' ? values.join(' ') : values;
}

export function valuesOf(f: SheetForm, s: Section | undefined): Values {
  const values: Values = {
    name: f.name.trim(),
    src: f.src === ROUTER ? undefined : f.src,
    dest: f.dest === ROUTER ? undefined : f.dest,
    proto: asStored(s, 'proto', f.proto),
    family: f.family === 'any' ? undefined : f.family,
    target: f.target,
    enabled: f.enabled ? undefined : '0',
    limit: f.limit.trim() === '' ? undefined : f.limit.trim(),
    limit_burst: f.limit.trim() === '' || f.limitBurst.trim() === '' ? undefined : f.limitBurst.trim(),
    log: f.log.trim() === '' ? undefined : f.log.trim(),
    ...scheduleValues(f.scheduled ? f.schedule : undefined),
  };
  for (const c of conditions) {
    const v = f.conds[c.key];
    values[c.key] = asStored(s, c.key, v === undefined ? [] : [...v.include, ...v.exclude.map((x) => `!${x}`)]);
  }
  return values;
}

export type Errors = Partial<Record<'name' | 'path' | 'proto' | 'open' | 'limit' | 'log' | 'schedule' | CondKey, string>>;

/**
 * Who an accept with nothing narrowing it opens every port to: the internet,
 * any zone, or a guest network. A new rule starts as "from the internet to
 * the router, accept", so it takes ports, or a tick, before it opens every
 * one. Undefined when the rule names its ports or who it's from, or matches
 * only protocols without ports (icmp, esp…).
 */
export function opensEverything(f: SheetForm, cfg: FirewallConfig): { from: string; to: string } | undefined {
  if (f.target !== 'ACCEPT' || f.src === ROUTER) return undefined;
  const zone = (name: string): Zone | undefined => cfg.zones.find((z) => z.name === name);
  const src = zone(f.src);
  const outside = f.src === ANY || (src !== undefined && (isInternetZone(src) || isGuestNetwork(src.name)));
  const dest = zone(f.dest);
  if (!outside || (dest !== undefined && isInternetZone(dest))) return undefined;
  if (f.proto.length > 0 && !f.proto.some((p) => p === 'all' || PORT_PROTOS.includes(p))) return undefined;
  if ((['dest_port', 'src_ip', 'src_mac'] as const).some((k) => (f.conds[k]?.include.length ?? 0) > 0)) return undefined;
  return {
    from: f.src === ANY ? 'every network, the internet included' : zonePhrase(f.src, 'src', cfg),
    to: f.dest === ROUTER ? 'the router, its login included' : `the devices on ${zonePhrase(f.dest, 'dest', cfg)}`,
  };
}

/** The rule's checks against the firewall as loaded: one message per field, keyed as Errors names them. */
export function ruleFormSchema(cfg: FirewallConfig): z.ZodType<SheetForm, SheetForm> {
  return ruleFields.superRefine((f, ctx) => {
    const e: Errors = {};
    if (!isShortName(f.name)) e.name = 'A short name, e.g. Allow-WireGuard.';
    if (f.src === ROUTER && f.dest === ROUTER) e.path = 'From the router to the router isn’t something a rule can match.';
    if (f.proto.some((p) => !/^[a-z0-9-]+$/.test(p))) e.proto = 'Protocol names or numbers, e.g. tcp, udp, icmp, all.';
    for (const c of conditions) {
      const v = f.conds[c.key];
      if (v === undefined) continue;
      const all = [...v.include, ...v.exclude];
      const bad = all.find((x) => !c.check(x));
      if (bad !== undefined) e[c.key] = `“${bad}” doesn’t fit here.`;
      else if ((c.key === 'dest_port' || c.key === 'src_port') && all.length > 0 && !portsApply(f.proto))
        e[c.key] = 'Ports need TCP or UDP (or SCTP) as the protocol.';
      else if (c.key === 'icmp_type' && all.length > 0 && !icmpApplies(f.proto))
        e[c.key] = 'ICMP types need icmp as the protocol.';
      else if (
        f.family !== 'any' &&
        (c.key === 'src_ip' || c.key === 'dest_ip') &&
        all.some((a) => a.includes(':') !== (f.family === 'ipv6'))
      ) {
        e[c.key] = `Only ${f.family === 'ipv4' ? 'IPv4' : 'IPv6'} addresses: the rule is for that only.`;
      }
    }
    if (!f.openAll && opensEverything(f, cfg) !== undefined) e.open = 'Add the ports it needs, or tick to open every port.';
    if (f.limit.trim() !== '' && !/^\d+\/(s|sec|second|m|min|minute|h|hour|d|day)$/i.test(f.limit.trim()))
      e.limit = 'A rate like 10/second or 100/minute.';
    else if (f.limitBurst.trim() !== '' && !/^\d+$/.test(f.limitBurst.trim())) e.limit = 'The burst is a number of packets.';
    const log = logPrefixError(f.log, f.name);
    if (log !== undefined) e.log = log;
    if (f.scheduled) {
      const s = scheduleError(f.schedule);
      if (s !== undefined) e.schedule = s;
    }
    for (const [path, message] of Object.entries(e)) ctx.addIssue({ code: 'custom', path: [path], message });
  });
}
