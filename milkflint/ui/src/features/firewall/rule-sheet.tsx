// The traffic rule editor: a side sheet in three tabs (what it matches, what
// it does, when), each field with the UCI option it sets, values as chips,
// conditions that include or exclude ("!" in fw4), and the section as it
// will be in /etc/config/firewall before saving. Options it doesn't show
// stay as they are.
import { BanIcon, CheckIcon, EarOffIcon, PlusIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { type KeyboardEvent, type ReactElement, useId, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { type Change, list, type Section, str } from '@/lib/api/uci';
import { cn } from '@/lib/utils';
import type { FirewallData } from './api';
import { bedtime, type RulePreset, type ScheduleForm, scheduleError, scheduleForm, scheduleValues } from './forms';
import { isGuestNetwork } from '../wifi-guest/guest';
import {
  builtInRules,
  editSection,
  type Family,
  type FirewallConfig,
  isAddress,
  isBuiltIn,
  isInternetZone,
  isMac,
  isShortName,
  logPrefixError,
  portError,
  type Rule,
  ruleVerb,
  type Values,
  wanZone,
  type Zone,
  zonePhrase,
} from './model';
import { Choice, ScheduleFields, Segmented, SwitchRow } from './parts';
import { FieldLabel, Opt, UciPreview } from './sheet-parts';

const ROUTER = '@router';
const ANY = '*';

type CondKey = 'dest_port' | 'src_port' | 'src_ip' | 'dest_ip' | 'src_mac' | 'icmp_type';

interface Cond {
  include: string[];
  exclude: string[];
  /** the exclude field is showing */
  excluding: boolean;
}

interface SheetForm {
  name: string;
  src: string;
  dest: string;
  proto: string[];
  family: Family;
  conds: Partial<Record<CondKey, Cond>>;
  target: string;
  enabled: boolean;
  limit: string;
  limitBurst: string;
  log: string;
  scheduled: boolean;
  schedule: ScheduleForm;
  /** ticked: open every port, as opensEverything describes */
  openAll: boolean;
}

const PORT_PROTOS = ['tcp', 'udp', 'sctp', 'udplite', 'dccp'];
const ICMP_PROTOS = ['icmp', 'icmpv6', 'ipv6-icmp'];

/** fw4 matches ports only with protocols that have them; no protocol is its default, TCP and UDP. */
const portsApply = (proto: readonly string[]): boolean => proto.length === 0 || proto.every((p) => PORT_PROTOS.includes(p));
const icmpApplies = (proto: readonly string[]): boolean => proto.some((p) => ICMP_PROTOS.includes(p));

const conditions: readonly {
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

const icmpTypes = [
  'echo-request',
  'echo-reply',
  'destination-unreachable',
  'packet-too-big',
  'time-exceeded',
  'parameter-problem',
  'router-solicitation',
  'router-advertisement',
  'neighbour-solicitation',
  'neighbour-advertisement',
];
const protocols = ['tcp', 'udp', 'icmp', 'all', 'esp', 'ah', 'gre', 'igmp', 'sctp'];

/** Values of one option: "!x" entries (fw4's "not") go to exclude. */
function cond(s: Section | undefined, option: string): Cond | undefined {
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

function formOf(rule: Rule | undefined, s: Section | undefined, preset: RulePreset | undefined): SheetForm {
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
function asStored(s: Section | undefined, option: string, values: string[]): string | string[] | undefined {
  if (values.length === 0) return undefined;
  return typeof s?.[option] === 'string' ? values.join(' ') : values;
}

function valuesOf(f: SheetForm, s: Section | undefined): Values {
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

type Errors = Partial<Record<'name' | 'path' | 'proto' | 'open' | 'limit' | 'log' | 'schedule' | CondKey, string>>;

/**
 * Who an accept with nothing narrowing it opens every port to: the internet,
 * any zone, or a guest network. A new rule starts as "from the internet to
 * the router, accept", so it takes ports, or a tick, before it opens every
 * one. Undefined when the rule names its ports or who it's from, or matches
 * only protocols without ports (icmp, esp…).
 */
function opensEverything(f: SheetForm, cfg: FirewallConfig): { from: string; to: string } | undefined {
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

function validate(f: SheetForm, cfg: FirewallConfig): Errors {
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
    else if ((c.key === 'dest_port' || c.key === 'src_port') && all.length > 0 && !portsApply(f.proto)) e[c.key] = 'Ports need TCP or UDP (or SCTP) as the protocol.';
    else if (c.key === 'icmp_type' && all.length > 0 && !icmpApplies(f.proto)) e[c.key] = 'ICMP types need icmp as the protocol.';
    else if (f.family !== 'any' && (c.key === 'src_ip' || c.key === 'dest_ip') && all.some((a) => a.includes(':') !== (f.family === 'ipv6'))) {
      e[c.key] = `Only ${f.family === 'ipv4' ? 'IPv4' : 'IPv6'} addresses: the rule is for that only.`;
    }
  }
  if (!f.openAll && opensEverything(f, cfg) !== undefined) e.open = 'Add the ports it needs, or tick to open every port.';
  if (f.limit.trim() !== '' && !/^\d+\/(s|sec|second|m|min|minute|h|hour|d|day)$/i.test(f.limit.trim())) e.limit = 'A rate like 10/second or 100/minute.';
  else if (f.limitBurst.trim() !== '' && !/^\d+$/.test(f.limitBurst.trim())) e.limit = 'The burst is a number of packets.';
  const log = logPrefixError(f.log, f.name);
  if (log !== undefined) e.log = log;
  if (f.scheduled) {
    const s = scheduleError(f.schedule);
    if (s !== undefined) e.schedule = s;
  }
  return e;
}

/** Values as chips: Enter, a space or a comma adds what's typed, Backspace in an empty box takes the last off. */
function TokenInput({
  id,
  values,
  onChange,
  placeholder,
  check,
  suggestions = [],
}: {
  id: string;
  values: readonly string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  check?: (v: string) => boolean;
  suggestions?: readonly { value: string; label?: string }[];
}): ReactElement {
  const [text, setText] = useState('');
  const add = (tokens: readonly string[]): void => {
    const fresh = [...new Set(tokens.map((x) => x.trim()).filter((x) => x !== '' && !values.includes(x)))];
    if (fresh.length > 0) onChange([...values, ...fresh]);
  };
  const commit = (): void => {
    add(text.split(/[\s,]+/));
    setText('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      if (text.trim() !== '') {
        e.preventDefault();
        commit();
      } else if (e.key !== 'Enter') {
        e.preventDefault();
      }
    } else if (e.key === 'Backspace' && text === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1 shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
      {values.map((v) => {
        const bad = check !== undefined && !check(v);
        return (
          <span
            key={v}
            className={cn(
              'inline-flex items-center gap-1 rounded border bg-muted px-1.5 py-0.5 font-mono text-xs',
              bad && 'border-destructive/50 bg-destructive/10 text-destructive',
            )}
          >
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                onChange(values.filter((x) => x !== v));
              }}
            >
              <XIcon className="size-3" />
            </button>
          </span>
        );
      })}
      <input
        id={id}
        list={suggestions.length > 0 ? `${id}-list` : undefined}
        className="h-7 min-w-28 flex-1 bg-transparent font-mono text-sm outline-none placeholder:font-sans placeholder:text-muted-foreground"
        value={text}
        placeholder={values.length === 0 ? placeholder : 'Add…'}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          // a separator typed or pasted ends the values before it; what follows is still being typed
          const parts = e.target.value.split(/[\s,]+/);
          const rest = parts.pop() ?? '';
          add(parts);
          setText(rest);
        }}
        onKeyDown={onKeyDown}
        onBlur={commit}
      />
      {suggestions.length > 0 && (
        <datalist id={`${id}-list`}>
          {suggestions.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </datalist>
      )}
    </div>
  );
}

function PathSelect({ id, value, onChange, options, label }: { id: string; value: string; onChange: (v: string) => void; options: readonly { value: string; label: string }[]; label: string }): ReactElement {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label={label} className="w-auto min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const tabs = [
  { id: 'match', label: 'Match' },
  { id: 'action', label: 'Action' },
  { id: 'when', label: 'When' },
] as const;
type TabId = (typeof tabs)[number]['id'];

const tabOf: Record<keyof Errors, TabId> = {
  name: 'match',
  path: 'match',
  proto: 'match',
  open: 'match',
  dest_port: 'match',
  src_port: 'match',
  src_ip: 'match',
  dest_ip: 'match',
  src_mac: 'match',
  icmp_type: 'match',
  limit: 'action',
  log: 'action',
  schedule: 'when',
};

/** Services people open on the router itself. */
const routerServices: readonly { label: string; name: string; proto: string; port: string }[] = [
  { label: 'WireGuard', name: 'Allow-WireGuard', proto: 'udp', port: '51820' },
  { label: 'OpenVPN', name: 'Allow-OpenVPN', proto: 'udp', port: '1194' },
  { label: 'Tailscale', name: 'Allow-Tailscale', proto: 'udp', port: '41641' },
];

export function RuleSheet({
  rule,
  preset,
  data,
  onClose,
  onSave,
}: {
  rule: Rule | undefined;
  preset: RulePreset | undefined;
  data: FirewallData;
  onClose: () => void;
  onSave: (changes: Change[]) => void;
}): ReactElement {
  const id = useId();
  const section = rule === undefined ? undefined : data.sections.find((s) => s['.name'] === rule.section);
  const [f, setF] = useState(() => formOf(rule, section, preset));
  const [tab, setTab] = useState<TabId>('match');
  const [adding, setAdding] = useState(false);
  const set = <K extends keyof SheetForm>(key: K, value: SheetForm[K]): void => {
    setF((x) => ({ ...x, [key]: value }));
  };
  const setCond = (key: CondKey, value: Cond | undefined): void => {
    setF((x) => {
      const conds: Partial<Record<CondKey, Cond>> = Object.fromEntries(Object.entries(x.conds).filter(([k]) => k !== key));
      if (value !== undefined) conds[key] = value;
      return { ...x, conds };
    });
  };
  const errors = validate(f, data.cfg);
  const open = opensEverything(f, data.cfg);
  const wrong = new Set(Object.keys(errors).map((k) => tabOf[k as keyof Errors]));
  const values = valuesOf(f, section);
  const changes = editSection('rule', section, values);
  const standard = f.target === 'ACCEPT' || f.target === 'REJECT' || f.target === 'DROP';
  const wan = wanZone(data.cfg)?.name;
  const zones = data.cfg.zones.map((z) => ({ value: z.name, label: z.name }));
  const srcOptions = [...zones, { value: ANY, label: 'any zone' }, { value: ROUTER, label: 'The router itself' }];
  const destOptions = [{ value: ROUTER, label: 'The router itself' }, ...zones, { value: ANY, label: 'any zone' }];
  const unused = conditions.filter((c) => f.conds[c.key] === undefined);
  const deviceSuggestions = data.devices.map((d) => ({ value: d.mac, label: d.name ?? d.ip ?? d.mac }));

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent aria-describedby={`${id}-desc`}>
        <div className="border-b px-6 pt-4">
          <SheetTitle className="pr-8">{rule === undefined ? 'New rule' : (rule.name ?? rule.label)}</SheetTitle>
          <SheetDescription id={`${id}-desc`} className="mt-0.5 text-xs">
            {rule !== undefined && isBuiltIn(rule) ? builtInRules[rule.name ?? ''] : 'A traffic rule: the first in its chain that matches decides.'}
          </SheetDescription>
          <div role="tablist" aria-label="Rule" className="mt-3 flex gap-5">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`${id}-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`${id}-panel`}
                onClick={() => {
                  setTab(t.id);
                }}
                className={cn(
                  '-mb-px flex items-center gap-1.5 border-b-2 pb-2 text-sm transition-colors',
                  tab === t.id ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
                {wrong.has(t.id) && <span className="size-1.5 rounded-full bg-destructive" aria-label="has a problem" />}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`} className="flex flex-col gap-5 px-6 py-5">
            {tab === 'match' && (
              <>
                <h3 className="text-sm font-semibold">What this rule matches</h3>
                {rule === undefined && f.src === wan && f.dest === ROUTER && (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Common services">
                    {routerServices.map((s) => (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => {
                          setF((x) => ({
                            ...x,
                            name: s.name,
                            proto: [s.proto],
                            conds: { ...x.conds, dest_port: { include: [s.port], exclude: [], excluding: false } },
                          }));
                        }}
                        className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid gap-1.5">
                  <FieldLabel htmlFor={`${id}-name`} label="Name" opt="name" />
                  <Input
                    id={`${id}-name`}
                    value={f.name}
                    placeholder="Allow-WireGuard"
                    aria-invalid={f.name !== '' && errors.name !== undefined}
                    onChange={(e) => {
                      set('name', e.target.value);
                    }}
                  />
                  {f.name !== '' && errors.name !== undefined && <p className="text-xs text-destructive">{errors.name}</p>}
                </div>
                <div className="grid gap-1.5">
                  <FieldLabel label="Path" opt="src · dest" />
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <PathSelect
                      id={`${id}-src`}
                      label="From"
                      value={f.src}
                      options={srcOptions}
                      onChange={(v) => {
                        set('src', v);
                      }}
                    />
                    <span className="text-muted-foreground">to</span>
                    <PathSelect
                      id={`${id}-dest`}
                      label="To"
                      value={f.dest}
                      options={destOptions}
                      onChange={(v) => {
                        set('dest', v);
                      }}
                    />
                  </div>
                  {errors.path !== undefined && <p className="text-xs text-destructive">{errors.path}</p>}
                </div>
                <div className="grid gap-1.5">
                  <FieldLabel htmlFor={`${id}-proto`} label="Protocol" opt="proto" />
                  <TokenInput
                    id={`${id}-proto`}
                    values={f.proto}
                    onChange={(v) => {
                      set(
                        'proto',
                        v.map((p) => p.toLowerCase()),
                      );
                    }}
                    placeholder="tcp and udp (fw4’s default)"
                    check={(p) => /^[a-z0-9-]+$/.test(p)}
                    suggestions={protocols.map((p) => ({ value: p }))}
                  />
                  {errors.proto !== undefined && <p className="text-xs text-destructive">{errors.proto}</p>}
                </div>
                <fieldset className="grid gap-1.5">
                  <legend className="mb-1.5">
                    <FieldLabel label="Address family" opt="family" />
                  </legend>
                  {(
                    [
                      ['any', 'IPv4 and IPv6'],
                      ['ipv4', 'IPv4 only'],
                      ['ipv6', 'IPv6 only'],
                    ] as const
                  ).map(([v, l]) => (
                    <label key={v} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`${id}-family`}
                        className="accent-primary"
                        checked={f.family === v}
                        onChange={() => {
                          set('family', v);
                        }}
                      />
                      {l}
                    </label>
                  ))}
                </fieldset>
                <div className="flex flex-col gap-3 border-t pt-5">
                  <div>
                    <h3 className="text-sm font-semibold">Conditions</h3>
                    <p className="text-xs text-muted-foreground">Several values in one condition are alternatives; every condition must hold.</p>
                  </div>
                  {conditions
                    .filter((c) => f.conds[c.key] !== undefined)
                    .map((c) => {
                      const v = f.conds[c.key] ?? { include: [], exclude: [], excluding: false };
                      return (
                        <div key={c.key} className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
                          <div className="flex items-center justify-between">
                            <FieldLabel label={c.label} opt={c.key} />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              aria-label={`Remove ${c.label}`}
                              onClick={() => {
                                setCond(c.key, undefined);
                              }}
                            >
                              <XIcon />
                            </Button>
                          </div>
                          <label htmlFor={`${id}-${c.key}`} className="text-xs text-muted-foreground">
                            Include
                          </label>
                          <TokenInput
                            id={`${id}-${c.key}`}
                            values={v.include}
                            placeholder={c.placeholder}
                            check={c.check}
                            suggestions={c.key === 'src_mac' ? deviceSuggestions : c.key === 'icmp_type' ? icmpTypes.map((t) => ({ value: t })) : []}
                            onChange={(include) => {
                              setCond(c.key, { ...v, include });
                            }}
                          />
                          {v.excluding ? (
                            <>
                              <label htmlFor={`${id}-${c.key}-not`} className="text-xs text-muted-foreground">
                                Exclude (fw4’s <span className="font-mono">!</span>)
                              </label>
                              <TokenInput
                                id={`${id}-${c.key}-not`}
                                values={v.exclude}
                                placeholder={c.placeholder}
                                check={c.check}
                                onChange={(exclude) => {
                                  setCond(c.key, { ...v, exclude });
                                }}
                              />
                            </>
                          ) : (
                            <button
                              type="button"
                              className="flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline"
                              onClick={() => {
                                setCond(c.key, { ...v, excluding: true });
                              }}
                            >
                              <PlusIcon className="size-3.5" /> Exclude some
                            </button>
                          )}
                          {errors[c.key] !== undefined && <p className="text-xs text-destructive">{errors[c.key]}</p>}
                        </div>
                      );
                    })}
                  {unused.length > 0 &&
                    (adding ? (
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Add a condition">
                        {unused.map((c) => (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() => {
                              setCond(c.key, { include: [], exclude: [], excluding: false });
                              setAdding(false);
                            }}
                            className="rounded-md border bg-card px-2 py-1 text-xs hover:bg-accent"
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-fit"
                        onClick={() => {
                          setAdding(true);
                        }}
                      >
                        <PlusIcon /> Add a condition
                      </Button>
                    ))}
                </div>
                {open !== undefined && (
                  <Alert variant="destructive">
                    <TriangleAlertIcon />
                    <AlertTitle>Every port is open</AlertTitle>
                    <AlertDescription>
                      This lets {open.from} reach every port on {open.to}. Add the ports it needs as a condition (or the addresses it comes from).
                      <label className="mt-1 flex items-center gap-2 text-foreground">
                        <input
                          type="checkbox"
                          checked={f.openAll}
                          onChange={(e) => {
                            set('openAll', e.target.checked);
                          }}
                        />
                        Open every port anyway
                      </label>
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}
            {tab === 'action' && (
              <>
                <h3 className="text-sm font-semibold">What it does</h3>
                <div className="grid gap-1.5">
                  <FieldLabel label="Action" opt="target" />
                  {standard ? (
                    <Choice<'ACCEPT' | 'REJECT' | 'DROP'>
                      label="Action"
                      value={f.target as 'ACCEPT' | 'REJECT' | 'DROP'}
                      onChange={(v) => {
                        set('target', v);
                      }}
                      options={[
                        { value: 'ACCEPT', label: 'accept', icon: CheckIcon, tone: 'allow', hint: 'Let it through.' },
                        { value: 'REJECT', label: 'reject', icon: BanIcon, tone: 'block', hint: 'Block it with a reply: the sender knows at once.' },
                        { value: 'DROP', label: 'drop', icon: EarOffIcon, tone: 'block', hint: 'Block it silently: the sender waits, then gives up.' },
                      ]}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {ruleVerb(f.target).verb} (<span className="font-mono">{f.target}</span>, set in LuCI; kept as it is).
                    </p>
                  )}
                </div>
                <div className="grid gap-1.5">
                  <FieldLabel htmlFor={`${id}-limit`} label="Rate limit" opt="limit · limit_burst" />
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      id={`${id}-limit`}
                      className="w-40 font-mono"
                      value={f.limit}
                      placeholder="No limit"
                      aria-invalid={errors.limit !== undefined}
                      onChange={(e) => {
                        set('limit', e.target.value);
                      }}
                    />
                    <span className="text-xs text-muted-foreground">burst</span>
                    <Input
                      aria-label="Burst"
                      className="w-24 font-mono"
                      value={f.limitBurst}
                      placeholder="5"
                      disabled={f.limit.trim() === ''}
                      onChange={(e) => {
                        set('limitBurst', e.target.value);
                      }}
                    />
                  </div>
                  <p className={cn('text-xs', errors.limit === undefined ? 'text-muted-foreground' : 'text-destructive')}>
                    {errors.limit ?? 'Matches only this often, e.g. 10/second; the rest go on to the next rule.'}
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <FieldLabel htmlFor={`${id}-log`} label="Log prefix" opt="log" />
                  <Input
                    id={`${id}-log`}
                    className="font-mono"
                    value={f.log}
                    placeholder="Not logged"
                    aria-invalid={errors.log !== undefined}
                    onChange={(e) => {
                      set('log', e.target.value);
                    }}
                  />
                  <p className={cn('text-xs', errors.log === undefined ? 'text-muted-foreground' : 'text-destructive')}>
                    {errors.log ?? 'Logs what it matches to the kernel log (Logs page), each line starting with this.'}
                  </p>
                </div>
                <SwitchRow
                  id={`${id}-enabled`}
                  checked={f.enabled}
                  onChange={(v) => {
                    set('enabled', v);
                  }}
                  title={
                    <span className="flex items-center gap-2">
                      Rule on <Opt>enabled</Opt>
                    </span>
                  }
                  hint="Off keeps it here without it doing anything."
                />
              </>
            )}
            {tab === 'when' && (
              <>
                <h3 className="text-sm font-semibold">When it applies</h3>
                <div className="grid gap-1.5">
                  <FieldLabel label="Schedule" opt="start_time · stop_time · weekdays" />
                  <Segmented<'always' | 'times'>
                    label="Schedule"
                    value={f.scheduled ? 'times' : 'always'}
                    onChange={(v) => {
                      set('scheduled', v === 'times');
                    }}
                    options={[
                      { value: 'always', label: 'Always' },
                      { value: 'times', label: 'At set times' },
                    ]}
                  />
                </div>
                {f.scheduled && (
                  <ScheduleFields
                    id={`${id}-schedule`}
                    value={f.schedule}
                    onChange={(s) => {
                      set('schedule', s);
                    }}
                  />
                )}
              </>
            )}
            {rule !== undefined && rule.extra.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Also set, in LuCI or by hand, and kept as they are: <span className="font-mono">{rule.extra.join(', ')}</span>.
              </p>
            )}
          </div>
          <div className="border-t px-6 py-5">
            <UciPreview type="rule" original={section} changes={changes} />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-6 py-3">
          <p className="text-xs text-muted-foreground">
            {Object.keys(errors).length > 0 ? 'Fix what’s marked to save.' : changes.length === 0 ? 'No changes yet.' : `${String(changes.length)} change${changes.length === 1 ? '' : 's'} to apply.`}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={Object.keys(errors).length > 0 || changes.length === 0}
              onClick={() => {
                onSave(changes);
              }}
            >
              Save rule
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
