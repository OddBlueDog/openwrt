// The zone and defaults sheets' forms (fw4 zone, forwarding and defaults
// sections): their schemas, the forms as the config holds them, and the
// changes they save. The sheets are in zones.tsx.
import { z } from 'zod';
import type { Change, Section } from '@/lib/api/uci';
import type { FirewallData } from './api';
import {
  editSection,
  enabledChange,
  type FirewallConfig,
  isInternetZone,
  synRateError,
  synRateText,
  synRateValues,
  type Values,
  type Zone,
} from './model';

const policy = z.enum(['ACCEPT', 'REJECT', 'DROP']);

const pairKey = (src: string, dest: string): string => `${src}>${dest}`;

/** Forwardings that are on, as "src>dest". */
function forwardingsOn(data: FirewallData): Set<string> {
  return new Set(data.cfg.forwardings.filter((f) => f.enabled).map((f) => pairKey(f.src, f.dest)));
}

/**
 * Turn forwardings on and off, as LuCI does: one that's no longer wanted is
 * deleted, one that's wanted is turned back on if it's there but off, or
 * added.
 */
function forwardingChanges(
  data: FirewallData,
  want: ReadonlySet<string>,
  scope: (src: string, dest: string) => boolean,
): Change[] {
  const on = forwardingsOn(data);
  const changes: Change[] = [];
  for (const f of data.cfg.forwardings) {
    if (scope(f.src, f.dest) && f.enabled && !want.has(pairKey(f.src, f.dest)))
      changes.push({ op: 'delete', config: 'firewall', section: f.section });
  }
  for (const p of want) {
    if (on.has(p)) continue;
    const [src = '', dest = ''] = p.split('>');
    const off = data.cfg.forwardings.find((f) => f.src === src && f.dest === dest);
    changes.push(
      off === undefined
        ? { op: 'add', config: 'firewall', type: 'forwarding', values: { src, dest } }
        : enabledChange(off.section, true),
    );
  }
  return changes;
}

const zoneFields = z.object({
  name: z.string(),
  networks: z.array(z.string()),
  input: policy,
  output: policy,
  forward: policy,
  masq: z.boolean(),
  mtuFix: z.boolean(),
  /** zones it may start connections to */
  to: z.array(z.string()),
  /** zones that may start connections to it */
  from: z.array(z.string()),
});

export type ZoneForm = z.infer<typeof zoneFields>;

/** A new zone needs a name fw4 takes that no zone has; an existing one keeps its own. */
export function zoneFormSchema(zone: Zone | undefined, cfg: FirewallConfig): z.ZodType<ZoneForm, ZoneForm> {
  return zoneFields.superRefine((f, ctx) => {
    if (zone !== undefined) return;
    const message = !/^[A-Za-z][A-Za-z0-9_]{0,10}$/.test(f.name)
      ? 'Up to 11 letters, digits and _, starting with a letter.'
      : cfg.zones.some((z) => z.name === f.name)
        ? 'There’s a zone with that name already.'
        : undefined;
    if (message !== undefined) ctx.addIssue({ code: 'custom', path: ['name'], message });
  });
}

export function zoneForm(zone: Zone | undefined, data: FirewallData): ZoneForm {
  const wan = data.cfg.zones.find(isInternetZone)?.name;
  if (zone === undefined) {
    return {
      name: '',
      networks: [],
      input: 'REJECT',
      output: 'ACCEPT',
      forward: 'REJECT',
      masq: false,
      mtuFix: false,
      to: wan === undefined ? [] : [wan],
      from: [],
    };
  }
  const on = data.cfg.forwardings.filter((f) => f.enabled);
  return {
    name: zone.name,
    networks: zone.networks,
    input: zone.input,
    output: zone.output,
    forward: zone.forward,
    masq: zone.masq,
    mtuFix: zone.mtuFix,
    to: on.filter((f) => f.src === zone.name).map((f) => f.dest),
    from: on.filter((f) => f.dest === zone.name).map((f) => f.src),
  };
}

export function zoneChanges(f: ZoneForm, zone: Zone | undefined, data: FirewallData): Change[] {
  const was = zoneForm(zone, data);
  const values: Values = {};
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  if (zone === undefined) values['name'] = f.name;
  if (zone === undefined || !same(f.networks, was.networks)) values['network'] = f.networks;
  if (zone === undefined || f.input !== was.input) values['input'] = f.input;
  if (zone === undefined || f.output !== was.output) values['output'] = f.output;
  if (zone === undefined || f.forward !== was.forward) values['forward'] = f.forward;
  if (f.masq !== was.masq) values['masq'] = f.masq ? '1' : undefined;
  if (f.mtuFix !== was.mtuFix) values['mtu_fix'] = f.mtuFix ? '1' : undefined;
  const section = zone === undefined ? undefined : data.sections.find((s) => s['.name'] === zone.section);
  const changes = Object.keys(values).length === 0 ? [] : editSection('zone', section, values);
  const want = new Set([...f.to.map((d) => pairKey(f.name, d)), ...f.from.map((s) => pairKey(s, f.name))]);
  changes.push(...forwardingChanges(data, want, (src, dest) => src === f.name || dest === f.name));
  return changes;
}

const defaultsFields = z.object({
  input: policy,
  output: policy,
  forward: policy,
  synFlood: z.boolean(),
  /** new connections a second per address, as typed; '' is fw4's own */
  synRate: z.string(),
  dropInvalid: z.boolean(),
  offload: z.boolean(),
  offloadHw: z.boolean(),
});

export type DefaultsForm = z.infer<typeof defaultsFields>;

export function defaultsFormOf(d: FirewallConfig['defaults']): DefaultsForm {
  return {
    input: d.input,
    output: d.output,
    forward: d.forward,
    synFlood: d.synFlood,
    synRate: synRateText(d.synRate),
    dropInvalid: d.dropInvalid,
    offload: d.offload,
    offloadHw: d.offloadHw,
  };
}

/** The SYN rate is checked only once it's changed from what the config has (`was`). */
export function defaultsFormSchema(was: DefaultsForm): z.ZodType<DefaultsForm, DefaultsForm> {
  return defaultsFields.superRefine((f, ctx) => {
    const message = f.synRate === was.synRate ? undefined : synRateError(f.synRate);
    if (message !== undefined) ctx.addIssue({ code: 'custom', path: ['synRate'], message });
  });
}

/** What changed from `was`, as the defaults section's options. */
export function defaultsChanges(
  f: DefaultsForm,
  was: DefaultsForm,
  d: FirewallConfig['defaults'],
  section: Section | undefined,
): Change[] {
  const bit = (on: boolean): string => (on ? '1' : '0');
  const values: Values = {};
  if (f.input !== was.input) values['input'] = f.input;
  if (f.output !== was.output) values['output'] = f.output;
  if (f.forward !== was.forward) values['forward'] = f.forward;
  if (f.synFlood !== was.synFlood) values[d.synFloodOption] = bit(f.synFlood);
  if (f.synRate !== was.synRate && synRateError(f.synRate) === undefined) Object.assign(values, synRateValues(f.synRate));
  if (f.dropInvalid !== was.dropInvalid) values['drop_invalid'] = bit(f.dropInvalid);
  if (f.offload !== was.offload) values['flow_offloading'] = bit(f.offload);
  if (f.offloadHw !== was.offloadHw) values['flow_offloading_hw'] = bit(f.offloadHw);
  return Object.keys(values).length === 0 ? [] : editSection('defaults', section, values);
}
