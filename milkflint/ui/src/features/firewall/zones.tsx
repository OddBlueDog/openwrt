// Zones (fw4 zone, forwarding and defaults sections) as OpenWrt lays them
// out: one row per zone with the networks it covers, its three policies
// (input: connections to the router; output: from the router; forward:
// between its own networks), masquerading, MSS clamping and the zones it may
// forward to; the defaults for what no zone covers; then NAT rules. A zone or
// the defaults open in a side sheet that shows the section as it will be
// saved. Only what changed is written, so a policy a zone takes from the
// defaults stays unset.
import { CheckIcon, ExternalLinkIcon, PlusIcon, SettingsIcon, ShieldIcon, SquarePenIcon, Trash2Icon } from 'lucide-react';
import { type ReactElement, useId, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import type { Change, Section } from '@/lib/api/uci';
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';
import type { Counters, FirewallData } from './api';
import type { Actions } from './forms';
import { editSection, enabledChange, isInternetZone, managedBy, type Policy, type Values, type Zone, zoneTitle, zoneUsers } from './model';
import { NatTable } from './nat';
import { Segmented, SwitchRow } from './parts';
import { FieldLabel, Opt, UciPreview } from './sheet-parts';
import { GroupHeader, HeadRow, HeaderButton, RowButton, VerdictBadge } from './table-parts';

const policies = [
  { value: 'ACCEPT', label: 'accept' },
  { value: 'REJECT', label: 'reject' },
  { value: 'DROP', label: 'drop' },
] as const;

const policyHints: Record<Policy, string> = {
  ACCEPT: 'Let it through.',
  REJECT: 'Block it with a reply, so the other end knows at once.',
  DROP: 'Block it silently: the other end hears nothing.',
};

/** A policy as three choices, with what the chosen one does under it. */
function PolicyField({ label, opt, hint, value, onChange }: { label: string; opt: string; hint: string; value: Policy; onChange: (p: Policy) => void }): ReactElement {
  return (
    <div className="grid gap-1.5">
      <FieldLabel label={label} opt={opt} />
      <p className="-mt-1 text-xs text-muted-foreground">{hint}</p>
      <Segmented<Policy> label={label} value={value} options={policies} onChange={onChange} />
      <p className="text-xs text-muted-foreground">{policyHints[value]}</p>
    </div>
  );
}

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
function forwardingChanges(data: FirewallData, want: ReadonlySet<string>, scope: (src: string, dest: string) => boolean): Change[] {
  const on = forwardingsOn(data);
  const changes: Change[] = [];
  for (const f of data.cfg.forwardings) {
    if (scope(f.src, f.dest) && f.enabled && !want.has(pairKey(f.src, f.dest))) changes.push({ op: 'delete', config: 'firewall', section: f.section });
  }
  for (const p of want) {
    if (on.has(p)) continue;
    const [src = '', dest = ''] = p.split('>');
    const off = data.cfg.forwardings.find((f) => f.src === src && f.dest === dest);
    changes.push(off === undefined ? { op: 'add', config: 'firewall', type: 'forwarding', values: { src, dest } } : enabledChange(off.section, true));
  }
  return changes;
}

interface ZoneForm {
  name: string;
  networks: string[];
  input: Policy;
  output: Policy;
  forward: Policy;
  masq: boolean;
  mtuFix: boolean;
  /** zones it may start connections to */
  to: string[];
  /** zones that may start connections to it */
  from: string[];
}

function zoneForm(zone: Zone | undefined, data: FirewallData): ZoneForm {
  const wan = data.cfg.zones.find(isInternetZone)?.name;
  if (zone === undefined) {
    return { name: '', networks: [], input: 'REJECT', output: 'ACCEPT', forward: 'REJECT', masq: false, mtuFix: false, to: wan === undefined ? [] : [wan], from: [] };
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

function zoneChanges(f: ZoneForm, zone: Zone | undefined, data: FirewallData): Change[] {
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

/** Zone chips to pick from: other zones, each on or off. */
function ZoneChips({ id, zones, value, onChange, label }: { id: string; zones: readonly string[]; value: readonly string[]; onChange: (v: string[]) => void; label: string }): ReactElement {
  if (zones.length === 0) return <p className="text-xs text-muted-foreground">No other zones.</p>;
  return (
    <div id={id} className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {zones.map((z) => {
        const on = value.includes(z);
        return (
          <button
            key={z}
            type="button"
            aria-pressed={on}
            onClick={() => {
              onChange(on ? value.filter((x) => x !== z) : [...value, z]);
            }}
            className={cn(
              'flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-xs transition-colors',
              on ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {on && <CheckIcon className="size-3" />}
            {z}
          </button>
        );
      })}
    </div>
  );
}

function ZoneSheet({ zone, data, onClose, onSave }: { zone: Zone | undefined; data: FirewallData; onClose: () => void; onSave: (c: Change[]) => void }): ReactElement {
  const id = useId();
  const [f, setF] = useState(() => zoneForm(zone, data));
  const set = <K extends keyof ZoneForm>(key: K, value: ZoneForm[K]): void => {
    setF((x) => ({ ...x, [key]: value }));
  };
  const nameError =
    zone !== undefined
      ? undefined
      : !/^[A-Za-z][A-Za-z0-9_]{0,10}$/.test(f.name)
        ? 'Up to 11 letters, digits and _, starting with a letter.'
        : data.cfg.zones.some((z) => z.name === f.name)
          ? 'There’s a zone with that name already.'
          : undefined;
  const changes = nameError === undefined ? zoneChanges(f, zone, data) : [];
  const section = zone === undefined ? undefined : data.sections.find((s) => s['.name'] === zone.section);
  const others = data.cfg.zones.filter((z) => z.name !== zone?.name).map((z) => z.name);
  const elsewhere = new Map<string, string>();
  for (const z of data.cfg.zones) if (z.name !== zone?.name) for (const n of z.networks) elsewhere.set(n, z.name);
  const networks = [...new Set([...data.networks.map((n) => n.name), ...f.networks])];
  const internet = f.name === 'wan' || f.networks.includes('wan') || f.networks.includes('wan6');
  const forwardNotes = changes.flatMap((c) => {
    if (c.op === 'add' && c.type === 'forwarding') return [`adds ${String(c.values['src'])} → ${String(c.values['dest'])}`];
    if (c.op === 'delete') {
      const fw = data.cfg.forwardings.find((x) => x.section === c.section);
      return fw === undefined ? [] : [`removes ${fw.src} → ${fw.dest}`];
    }
    if (c.op === 'unset' && c.options.includes('enabled')) {
      const fw = data.cfg.forwardings.find((x) => x.section === c.section);
      return fw === undefined ? [] : [`turns on ${fw.src} → ${fw.dest}`];
    }
    return [];
  });
  const managed = zone === undefined ? undefined : managedBy[zone.section];

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent aria-describedby={`${id}-desc`}>
        <div className="border-b px-6 py-4">
          <SheetTitle className="pr-8">{zone === undefined ? 'New zone' : `Zone ${zone.name}`}</SheetTitle>
          <SheetDescription id={`${id}-desc`} className="mt-0.5 text-xs">
            {zone === undefined
              ? 'A group of networks with the same rules, e.g. one for smart-home gadgets. It starts locked down.'
              : managed !== undefined
                ? `${zoneTitle(zone.name, data.cfg)}, made by the ${managed.title} page.`
                : zoneTitle(zone.name, data.cfg) === zone.name
                  ? 'A firewall zone: networks that share these rules.'
                  : `${zoneTitle(zone.name, data.cfg)}: networks that share these rules.`}
          </SheetDescription>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5 px-6 py-5">
            <div className="grid gap-1.5">
              <FieldLabel htmlFor={`${id}-name`} label="Name" opt="name" />
              <Input
                id={`${id}-name`}
                className="font-mono"
                value={f.name}
                placeholder="iot"
                disabled={zone !== undefined}
                aria-invalid={f.name !== '' && nameError !== undefined}
                onChange={(e) => {
                  set('name', e.target.value.trim());
                }}
              />
              <p className={cn('text-xs', f.name !== '' && nameError !== undefined ? 'text-destructive' : 'text-muted-foreground')}>
                {f.name !== '' && nameError !== undefined ? nameError : zone === undefined ? 'Rules and forwards refer to zones by name.' : 'Rules and forwards refer to it by name, so it stays.'}
              </p>
            </div>
            <div className="grid gap-1.5">
              <FieldLabel label="Networks" opt="network" />
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Networks">
                {networks.map((n) => {
                  const on = f.networks.includes(n);
                  const live = data.networks.find((x) => x.name === n);
                  const other = elsewhere.get(n);
                  return (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={on}
                      title={other === undefined ? undefined : `Also in zone ${other}`}
                      onClick={() => {
                        set('networks', on ? f.networks.filter((x) => x !== n) : [...f.networks, n]);
                      }}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs transition-colors',
                        on ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent',
                        on && other !== undefined && 'border-warning/60 bg-warning/10 text-warning',
                      )}
                    >
                      <span className={cn('size-1.5 rounded-full', live?.up === true ? 'bg-success' : 'bg-muted-foreground/40')} />
                      {n}
                      {live?.device !== undefined && <span className="opacity-60">{live.device}</span>}
                    </button>
                  );
                })}
              </div>
              <p className={cn('text-xs', f.networks.some((n) => elsewhere.has(n)) ? 'text-warning' : 'text-muted-foreground')}>
                {f.networks.some((n) => elsewhere.has(n))
                  ? `${f.networks
                      .filter((n) => elsewhere.has(n))
                      .map((n) => `${n} is also in ${elsewhere.get(n) ?? ''}`)
                      .join('; ')}: a network belongs in one zone only.`
                  : 'The interfaces it covers (LuCI: Network → Interfaces). A green dot is up.'}
              </p>
            </div>
            <PolicyField
              label="Input"
              opt="input"
              hint="Connections from this zone to the router itself: its web page, DNS, DHCP."
              value={f.input}
              onChange={(p) => {
                set('input', p);
              }}
            />
            {internet && f.input === 'ACCEPT' && (
              <Alert variant="destructive">
                <AlertDescription>Anyone on the internet could reach the router’s login and every service on it.</AlertDescription>
              </Alert>
            )}
            {f.name === 'lan' && f.input !== 'ACCEPT' && (
              <Alert variant="warning">
                <AlertDescription>Devices at home lose this page, DNS and DHCP unless rules allow them.</AlertDescription>
              </Alert>
            )}
            <PolicyField
              label="Output"
              opt="output"
              hint="Connections from the router into this zone. Usually accept."
              value={f.output}
              onChange={(p) => {
                set('output', p);
              }}
            />
            <PolicyField
              label="Forward"
              opt="forward"
              hint="Between the zone’s own networks; only matters when it covers more than one. Other zones: forwarding, below."
              value={f.forward}
              onChange={(p) => {
                set('forward', p);
              }}
            />
            <SwitchRow
              id={`${id}-masq`}
              checked={f.masq}
              onChange={(v) => {
                set('masq', v);
              }}
              title={
                <span className="flex items-center gap-2">
                  Masquerading <Opt>masq</Opt>
                </span>
              }
              hint="Traffic leaving through this zone takes the router’s address (NAT): how your devices share one internet address. On for the internet zone."
            />
            <SwitchRow
              id={`${id}-mtu`}
              checked={f.mtuFix}
              onChange={(v) => {
                set('mtuFix', v);
              }}
              title={
                <span className="flex items-center gap-2">
                  MSS clamping <Opt>mtu_fix</Opt>
                </span>
              }
              hint="Fits TCP to links that carry smaller packets, like PPPoE or a VPN. On for the internet zone."
            />
            <div className="flex flex-col gap-3 border-t pt-5">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  Forwarding <Opt>forwarding</Opt>
                </h3>
                <p className="text-xs text-muted-foreground">Between zones, one way each: replies always come back. Anything else falls to the defaults.</p>
              </div>
              <div className="grid gap-1.5">
                <span className="text-sm">May start connections to</span>
                <ZoneChips
                  id={`${id}-to`}
                  label="May start connections to"
                  zones={others}
                  value={f.to}
                  onChange={(v) => {
                    set('to', v);
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <span className="text-sm">Accepts connections from</span>
                <ZoneChips
                  id={`${id}-from`}
                  label="Accepts connections from"
                  zones={others}
                  value={f.from}
                  onChange={(v) => {
                    set('from', v);
                  }}
                />
              </div>
            </div>
          </div>
          <div className="border-t px-6 py-5">
            <UciPreview type="zone" original={section} changes={changes} />
            {forwardNotes.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Forwarding: {forwardNotes.join('; ')}.</p>}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-6 py-3">
          <p className="text-xs text-muted-foreground">
            {nameError !== undefined ? 'Give it a name to save.' : changes.length === 0 ? 'No changes yet.' : `${String(changes.length)} change${changes.length === 1 ? '' : 's'} to apply.`}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={nameError !== undefined || changes.length === 0}
              onClick={() => {
                onSave(changes);
              }}
            >
              Save zone
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface DefaultsForm {
  input: Policy;
  output: Policy;
  forward: Policy;
  synFlood: boolean;
  dropInvalid: boolean;
  offload: boolean;
  offloadHw: boolean;
}

function DefaultsSheet({ data, onClose, onSave }: { data: FirewallData; onClose: () => void; onSave: (c: Change[]) => void }): ReactElement {
  const id = useId();
  const d = data.cfg.defaults;
  const was: DefaultsForm = {
    input: d.input,
    output: d.output,
    forward: d.forward,
    synFlood: d.synFlood,
    dropInvalid: d.dropInvalid,
    offload: d.offload,
    offloadHw: d.offloadHw,
  };
  const [f, setF] = useState(was);
  const set = <K extends keyof DefaultsForm>(key: K, value: DefaultsForm[K]): void => {
    setF((x) => ({ ...x, [key]: value }));
  };
  const bit = (on: boolean): string => (on ? '1' : '0');
  const values: Values = {};
  if (f.input !== was.input) values['input'] = f.input;
  if (f.output !== was.output) values['output'] = f.output;
  if (f.forward !== was.forward) values['forward'] = f.forward;
  if (f.synFlood !== was.synFlood) values[d.synFloodOption] = bit(f.synFlood);
  if (f.dropInvalid !== was.dropInvalid) values['drop_invalid'] = bit(f.dropInvalid);
  if (f.offload !== was.offload) values['flow_offloading'] = bit(f.offload);
  if (f.offloadHw !== was.offloadHw) values['flow_offloading_hw'] = bit(f.offloadHw);
  const section: Section | undefined = data.sections.find((s) => s['.name'] === d.section);
  const changes = Object.keys(values).length === 0 ? [] : editSection('defaults', section, values);
  const toggle = (key: 'synFlood' | 'dropInvalid' | 'offload' | 'offloadHw', label: string, opt: string, hint: string, disabled = false): ReactElement => (
    <SwitchRow
      id={`${id}-${key}`}
      checked={f[key]}
      disabled={disabled}
      onChange={(v) => {
        set(key, v);
      }}
      title={
        <span className="flex items-center gap-2">
          {label} <Opt>{opt}</Opt>
        </span>
      }
      hint={hint}
    />
  );

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent aria-describedby={`${id}-desc`}>
        <div className="border-b px-6 py-4">
          <SheetTitle className="pr-8">Defaults</SheetTitle>
          <SheetDescription id={`${id}-desc`} className="mt-0.5 text-xs">
            For whatever no zone, forwarding or rule decides, and settings for the whole firewall.
          </SheetDescription>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5 px-6 py-5">
            <PolicyField
              label="Forward"
              opt="forward"
              hint="Between zones when no forwarding allows it, the internet to your devices’ IPv6 addresses included. MilkFlint’s default, drop, keeps them silent."
              value={f.forward}
              onChange={(p) => {
                set('forward', p);
              }}
            />
            {f.forward === 'ACCEPT' && (
              <Alert variant="destructive">
                <AlertDescription>Every zone could reach every other, the internet included.</AlertDescription>
              </Alert>
            )}
            <PolicyField
              label="Input"
              opt="input"
              hint="To the router from networks in no zone."
              value={f.input}
              onChange={(p) => {
                set('input', p);
              }}
            />
            <PolicyField
              label="Output"
              opt="output"
              hint="From the router to networks in no zone."
              value={f.output}
              onChange={(p) => {
                set('output', p);
              }}
            />
            {toggle('synFlood', 'SYN flood protection', d.synFloodOption, 'Limits how fast new connections to the router may arrive.')}
            {toggle('dropInvalid', 'Drop invalid packets', 'drop_invalid', 'Packets that belong to no known connection. Off is OpenWrt’s default.')}
            {toggle(
              'offload',
              'Software flow offloading',
              'flow_offloading',
              'Established connections take a shortcut through the router: less CPU at high speeds. Smart Queue still shapes them. MilkFlint turns it on.',
            )}
            {toggle(
              'offloadHw',
              'Hardware flow offloading',
              'flow_offloading_hw',
              'The Ethernet chip forwards established connections by itself: no CPU at all, but Smart Queue can’t shape them. Needs software offloading.',
              !f.offload && !f.offloadHw,
            )}
            {f.offloadHw && (
              <Alert variant="warning">
                <AlertDescription>
                  Smart Queue can’t shape what bypasses the CPU: latency under load comes back (
                  <a href={href('sqm')} className="underline">
                    Smart Queue
                  </a>
                  ).
                </AlertDescription>
              </Alert>
            )}
          </div>
          <div className="border-t px-6 py-5">
            <UciPreview type="defaults" original={section} changes={changes} />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-6 py-3">
          <p className="text-xs text-muted-foreground">{changes.length === 0 ? 'No changes yet.' : 'Applies to the whole firewall.'}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={changes.length === 0}
              onClick={() => {
                onSave(changes);
              }}
            >
              Save defaults
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const columns = [
  { label: 'Zone' },
  { label: 'Networks' },
  { label: 'Input' },
  { label: 'Output' },
  { label: 'Forward' },
  { label: 'Masq' },
  { label: 'MSS' },
  { label: 'Forwards to' },
  { label: 'Actions', className: 'w-24', hidden: true },
] as const;

function Flag({ on }: { on: boolean }): ReactElement {
  return on ? <CheckIcon className="size-4 text-success" aria-label="on" /> : <span className="text-muted-foreground">—</span>;
}

function Chips({ items }: { items: readonly string[] }): ReactElement {
  if (items.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((x) => (
        <span key={x} className="rounded border bg-muted px-1.5 py-px font-mono text-xs">
          {x}
        </span>
      ))}
    </span>
  );
}

type Open = { kind: 'zone'; zone: Zone | undefined } | { kind: 'defaults' };

export function ZonesTab({ data, counters, actions }: { data: FirewallData; counters: Counters | undefined; actions: Actions }): ReactElement {
  const [open, setOpen] = useState<Open>();
  const { cfg } = data;
  const on = cfg.forwardings.filter((f) => f.enabled);
  const close = (): void => {
    setOpen(undefined);
  };
  const save = (changes: Change[]): void => {
    setOpen(undefined);
    actions.apply(changes);
  };
  const remove = (z: Zone): void => {
    const users = zoneUsers(cfg, z.name);
    actions.confirm({
      title: `Delete zone ${z.name}?`,
      body: `Its networks are left in no zone, so only the defaults apply to them, and its forwardings go too.${
        users.length === 0 ? '' : ` These still name it, and the firewall skips them until you change them: ${users.join(', ')}.`
      }`,
      action: 'Delete zone',
      changes: [
        { op: 'delete', config: 'firewall', section: z.section },
        ...cfg.forwardings.filter((f) => f.src === z.name || f.dest === z.name).map((f): Change => ({ op: 'delete', config: 'firewall', section: f.section })),
      ],
    });
  };
  const editDefaults = (
    <HeaderButton
      onClick={() => {
        setOpen({ kind: 'defaults' });
      }}
    >
      <SettingsIcon /> Edit
    </HeaderButton>
  );
  const defaultsNotes = [cfg.defaults.synFlood && 'SYN flood protection', cfg.defaults.dropInvalid && 'drops invalid', cfg.defaults.offloadHw ? 'hardware offloading' : cfg.defaults.offload && 'software offloading'].filter(
    (x): x is string => typeof x === 'string',
  );
  const zoneActions = (z: Zone): ReactElement => (
    <span className="flex items-center justify-end">
      <RowButton
        label={`Edit zone ${z.name}`}
        icon={SquarePenIcon}
        onClick={() => {
          setOpen({ kind: 'zone', zone: z });
        }}
      />
      <RowButton
        label={`Delete zone ${z.name}`}
        icon={Trash2Icon}
        disabled={actions.applying}
        onClick={() => {
          remove(z);
        }}
      />
    </span>
  );
  const zoneName = (z: Zone): ReactElement => {
    const managed = managedBy[z.section];
    const title = zoneTitle(z.name, cfg) === z.name ? '' : zoneTitle(z.name, cfg);
    return (
      <span className="flex flex-col">
        <span className="flex items-center gap-1.5">
          <ShieldIcon className="size-3.5 text-muted-foreground" />
          <span className="font-mono text-xs font-medium">{z.name}</span>
        </span>
        <span className="text-xs text-muted-foreground">{managed === undefined ? title : `${zoneTitle(z.name, cfg)} · ${managed.title} page`}</span>
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {cfg.zones.length} zone{cfg.zones.length === 1 ? '' : 's'}, {on.length} forwarding{on.length === 1 ? '' : 's'}
        </p>
        <Button
          size="sm"
          disabled={actions.applying}
          onClick={() => {
            setOpen({ kind: 'zone', zone: undefined });
          }}
        >
          <PlusIcon /> Add zone
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        <Card className="gap-0 overflow-hidden py-0">
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead>
                <HeadRow columns={columns} />
              </thead>
              <tbody>
                <GroupHeader title={<span className="font-medium">Zones</span>} count={cfg.zones.length} noun={['zone', 'zones']} colSpan={columns.length} />
                {cfg.zones.map((z) => (
                  <tr key={z.section} className="border-b last:border-b-0 hover:bg-accent/30">
                    <td className="px-3 py-2">{zoneName(z)}</td>
                    <td className="px-3 py-2">
                      <Chips items={z.networks} />
                    </td>
                    <td className="px-3 py-2">
                      <VerdictBadge verdict={z.input} />
                    </td>
                    <td className="px-3 py-2">
                      <VerdictBadge verdict={z.output} />
                    </td>
                    <td className="px-3 py-2">
                      <VerdictBadge verdict={z.forward} />
                    </td>
                    <td className="px-3 py-2">
                      <Flag on={z.masq} />
                    </td>
                    <td className="px-3 py-2">
                      <Flag on={z.mtuFix} />
                    </td>
                    <td className="px-3 py-2">
                      <Chips items={on.filter((f) => f.src === z.name).map((f) => f.dest)} />
                    </td>
                    <td className="px-2 py-1">{zoneActions(z)}</td>
                  </tr>
                ))}
              </tbody>
              <tbody>
                <GroupHeader title={<span className="font-medium">Defaults</span>} colSpan={columns.length} />
                <tr>
                  <td className="px-3 py-2">
                    <span className="flex flex-col">
                      <span className="font-mono text-xs font-medium">defaults</span>
                      <span className="text-xs text-muted-foreground">what no zone covers</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">—</td>
                  <td className="px-3 py-2">
                    <VerdictBadge verdict={cfg.defaults.input} />
                  </td>
                  <td className="px-3 py-2">
                    <VerdictBadge verdict={cfg.defaults.output} />
                  </td>
                  <td className="px-3 py-2">
                    <VerdictBadge verdict={cfg.defaults.forward} />
                  </td>
                  <td colSpan={3} className="px-3 py-2 text-xs text-muted-foreground">
                    {defaultsNotes.length === 0 ? '—' : defaultsNotes.join(' · ')}
                  </td>
                  <td className="px-2 py-1">
                    <span className="flex justify-end">
                      <RowButton
                        label="Edit the defaults"
                        icon={SquarePenIcon}
                        onClick={() => {
                          setOpen({ kind: 'defaults' });
                        }}
                      />
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="lg:hidden">
            <GroupHeader title={<span className="font-medium">Zones</span>} count={cfg.zones.length} noun={['zone', 'zones']} />
            <ul className="divide-y">
              {cfg.zones.map((z) => (
                <li key={z.section} className="flex flex-col gap-2 px-4 py-3">
                  <span className="flex items-start justify-between gap-2">
                    {zoneName(z)}
                    {zoneActions(z)}
                  </span>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                    <dt className="text-muted-foreground">Networks</dt>
                    <dd>
                      <Chips items={z.networks} />
                    </dd>
                    <dt className="text-muted-foreground">Input · output · forward</dt>
                    <dd className="flex flex-wrap gap-1">
                      <VerdictBadge verdict={z.input} />
                      <VerdictBadge verdict={z.output} />
                      <VerdictBadge verdict={z.forward} />
                    </dd>
                    <dt className="text-muted-foreground">Masq · MSS</dt>
                    <dd className="flex gap-2">
                      <Flag on={z.masq} />
                      <Flag on={z.mtuFix} />
                    </dd>
                    <dt className="text-muted-foreground">Forwards to</dt>
                    <dd>
                      <Chips items={on.filter((f) => f.src === z.name).map((f) => f.dest)} />
                    </dd>
                  </dl>
                </li>
              ))}
            </ul>
            <GroupHeader title={<span className="font-medium">Defaults</span>} action={editDefaults} />
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
              <span className="text-muted-foreground">Input · output · forward</span>
              <VerdictBadge verdict={cfg.defaults.input} />
              <VerdictBadge verdict={cfg.defaults.output} />
              <VerdictBadge verdict={cfg.defaults.forward} />
              {defaultsNotes.length > 0 && <span className="text-muted-foreground">· {defaultsNotes.join(' · ')}</span>}
            </div>
          </div>
        </Card>
        <p className="text-right text-xs text-muted-foreground">
          Input: connections to the router · Output: from the router · Forward: between a zone’s own networks · Forwards to: zones it may start
          connections to, one way; replies always come back.
        </p>
      </div>
      <NatTable data={data} counters={counters} actions={actions} />
      {cfg.ipsets + cfg.includes > 0 && (
        <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          Your firewall also has {cfg.ipsets > 0 && `${String(cfg.ipsets)} IP set${cfg.ipsets === 1 ? '' : 's'}`}
          {cfg.ipsets > 0 && cfg.includes > 0 && ' and '}
          {cfg.includes > 0 && `${String(cfg.includes)} custom include${cfg.includes === 1 ? '' : 's'}`}; they keep working.
          <a href="/cgi-bin/luci/admin/network/firewall" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
            Edit in LuCI <ExternalLinkIcon className="size-3" />
          </a>
        </p>
      )}
      {open?.kind === 'zone' && <ZoneSheet zone={open.zone} data={data} onClose={close} onSave={save} />}
      {open?.kind === 'defaults' && <DefaultsSheet data={data} onClose={close} onSave={save} />}
    </div>
  );
}
