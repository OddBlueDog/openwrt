// Zones (fw4 zone, forwarding and defaults sections) as OpenWrt lays them
// out: one row per zone with the networks it covers, its three policies
// (input: connections to the router; output: from the router; forward:
// between its own networks), masquerading, MSS clamping and the zones it may
// forward to; the defaults for what no zone covers; then NAT rules. A zone or
// the defaults open in a side sheet that shows the section as it will be
// saved. Only what changed is written, so a policy a zone takes from the
// defaults stays unset.
import { pageLink } from '@/lib/router';
import { Link } from '@tanstack/react-router';
import { CheckIcon, ExternalLinkIcon, PlusIcon, ShieldIcon, SquarePenIcon, Trash2Icon } from 'lucide-react';
import { type ReactElement, useId, useMemo, useState } from 'react';
import { type Column, DataTable } from '@/components/data-table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import type { Change, Section } from '@/lib/api/uci';
import { formErrors } from '@/lib/form/errors';
import { useSheetForm } from '@/lib/form/use-sheet-form';
import { cn } from '@/lib/utils';
import { useWed } from '../tuning/use-wed';
import { WedNotice } from '../tuning/wed-notice';
import type { Counters, FirewallData } from './api';
import { type Actions, rowClick } from './forms';
import { defaultsChanges, defaultsFormOf, defaultsFormSchema, zoneChanges, zoneForm, zoneFormSchema } from './zone-form';
import {
  type FirewallConfig,
  managedBy,
  type Policy,
  SYN_RATE_FW4,
  SYN_RATE_MILKFLINT,
  synRateLabel,
  type Zone,
  zoneTitle,
  zoneUsers,
} from './model';
import { NatTable } from './nat';
import { Segmented, SwitchRow } from './parts';
import { FieldLabel, Opt, UciPreview } from './sheet-parts';
import { GroupHeader, RowButton, VerdictBadge } from './table-parts';

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
function PolicyField({
  label,
  opt,
  hint,
  value,
  onChange,
}: {
  label: string;
  opt: string;
  hint: string;
  value: Policy;
  onChange: (p: Policy) => void;
}): ReactElement {
  return (
    <div className="grid gap-1.5">
      <FieldLabel label={label} opt={opt} />
      <p className="-mt-1 text-xs text-muted-foreground">{hint}</p>
      <Segmented<Policy> label={label} value={value} options={policies} onChange={onChange} />
      <p className="text-xs text-muted-foreground">{policyHints[value]}</p>
    </div>
  );
}

/** Zone chips to pick from: other zones, each on or off. */
function ZoneChips({
  id,
  zones,
  value,
  onChange,
  label,
}: {
  id: string;
  zones: readonly string[];
  value: readonly string[];
  onChange: (v: string[]) => void;
  label: string;
}): ReactElement {
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

function ZoneSheet({
  zone,
  data,
  onClose,
  onSubmit,
}: {
  zone: Zone | undefined;
  data: FirewallData;
  onClose: () => void;
  /** applies the changes; the failure's message when that didn't go through */
  onSubmit: (c: Change[]) => Promise<string | undefined>;
}): ReactElement {
  const id = useId();
  const schema = useMemo(() => zoneFormSchema(zone, data.cfg), [zone, data.cfg]);
  const saved = useMemo(() => zoneForm(zone, data), [zone, data]);
  const {
    settings,
    values: f,
    failed,
    submitting,
  } = useSheetForm({ schema, saved, submit: (v) => onSubmit(zoneChanges(v, zone, data)) });
  const { form } = settings;
  const nameError = formErrors(schema, f)['name'];
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
                  form.setFieldValue('name', e.target.value.trim());
                }}
              />
              <p
                className={cn('text-xs', f.name !== '' && nameError !== undefined ? 'text-destructive' : 'text-muted-foreground')}
              >
                {f.name !== '' && nameError !== undefined
                  ? nameError
                  : zone === undefined
                    ? 'Rules and forwards refer to zones by name.'
                    : 'Rules and forwards refer to it by name, so it stays.'}
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
                        form.setFieldValue('networks', on ? f.networks.filter((x) => x !== n) : [...f.networks, n]);
                      }}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs transition-colors',
                        on ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent',
                        on && other !== undefined && 'border-warning/60 bg-warning/10 text-warning',
                      )}
                    >
                      <span
                        className={cn('size-1.5 rounded-full', live?.up === true ? 'bg-success' : 'bg-muted-foreground/40')}
                      />
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
                form.setFieldValue('input', p);
              }}
            />
            {internet && f.input === 'ACCEPT' && (
              <Alert variant="destructive">
                <AlertDescription>
                  Anyone on the internet could reach the router’s login and every service on it.
                </AlertDescription>
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
                form.setFieldValue('output', p);
              }}
            />
            <PolicyField
              label="Forward"
              opt="forward"
              hint="Between the zone’s own networks; only matters when it covers more than one. Other zones: forwarding, below."
              value={f.forward}
              onChange={(p) => {
                form.setFieldValue('forward', p);
              }}
            />
            <SwitchRow
              id={`${id}-masq`}
              checked={f.masq}
              onChange={(v) => {
                form.setFieldValue('masq', v);
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
                form.setFieldValue('mtuFix', v);
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
                <p className="text-xs text-muted-foreground">
                  Between zones, one way each: replies always come back. Anything else falls to the defaults.
                </p>
              </div>
              <div className="grid gap-1.5">
                <span className="text-sm">May start connections to</span>
                <ZoneChips
                  id={`${id}-to`}
                  label="May start connections to"
                  zones={others}
                  value={f.to}
                  onChange={(v) => {
                    form.setFieldValue('to', v);
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
                    form.setFieldValue('from', v);
                  }}
                />
              </div>
            </div>
          </div>
          <div className="border-t px-6 py-5">
            <UciPreview type="zone" original={section} changes={changes} />
            {forwardNotes.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">Forwarding: {forwardNotes.join('; ')}.</p>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-6 py-3">
          {failed !== undefined && <p className="text-xs font-medium text-destructive">{failed}</p>}
          <p className={cn('text-xs text-muted-foreground', failed !== undefined && 'sr-only')}>
            {nameError !== undefined
              ? 'Give it a name to save.'
              : changes.length === 0
                ? 'No changes yet.'
                : `${String(changes.length)} change${changes.length === 1 ? '' : 's'} to apply.`}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={nameError !== undefined || changes.length === 0 || submitting} onClick={settings.save}>
              Save zone
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DefaultsSheet({
  data,
  onClose,
  onSubmit,
}: {
  data: FirewallData;
  onClose: () => void;
  /** applies the changes; the failure's message when that didn't go through */
  onSubmit: (c: Change[]) => Promise<string | undefined>;
}): ReactElement {
  const id = useId();
  const d = data.cfg.defaults;
  const was = useMemo(() => defaultsFormOf(d), [d]);
  const schema = useMemo(() => defaultsFormSchema(was), [was]);
  const section: Section | undefined = data.sections.find((s) => s['.name'] === d.section);
  // hardware offloading with WED needs both kinds of flow offloading: either one off here turns WED off,
  // which puts back what it had turned off; the firewall's own options stay as this sheet sets them
  const wed = useWed();
  const {
    settings,
    values: f,
    failed,
    submitting,
  } = useSheetForm({
    schema,
    saved: was,
    submit: (v) =>
      onSubmit([
        ...(wed.on && (!v.offload || !v.offloadHw) ? wed.offChanges({ keepFirewall: true }) : []),
        ...defaultsChanges(v, was, d, section),
      ]),
  });
  const { form } = settings;
  const rateError = formErrors(schema, f)['synRate'];
  const wedOff = wed.on && (!f.offload || !f.offloadHw);
  const changes = defaultsChanges(f, was, d, section);
  const toggle = (
    key: 'synFlood' | 'dropInvalid' | 'offload' | 'offloadHw',
    label: string,
    opt: string,
    hint: string,
    disabled = false,
  ): ReactElement => (
    <SwitchRow
      id={`${id}-${key}`}
      checked={f[key]}
      disabled={disabled}
      onChange={(v) => {
        form.setFieldValue(key, v);
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
                form.setFieldValue('forward', p);
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
                form.setFieldValue('input', p);
              }}
            />
            <PolicyField
              label="Output"
              opt="output"
              hint="From the router to networks in no zone."
              value={f.output}
              onChange={(p) => {
                form.setFieldValue('output', p);
              }}
            />
            {toggle(
              'synFlood',
              'SYN flood protection',
              d.synFloodOption,
              'Limits how fast each address may open new connections to the router itself. Connections through the router to the internet aren’t counted.',
            )}
            <div className="grid gap-1.5">
              <FieldLabel htmlFor={`${id}-synrate`} label="New connections a second, per address" opt="synflood_rate" />
              <Input
                id={`${id}-synrate`}
                inputMode="numeric"
                className="tabular"
                value={f.synRate}
                placeholder={String(SYN_RATE_FW4)}
                disabled={!f.synFlood}
                aria-invalid={rateError !== undefined}
                onChange={(e) => {
                  form.setFieldValue('synRate', e.target.value.trim());
                }}
              />
              <p className={cn('text-xs', rateError === undefined ? 'text-muted-foreground' : 'text-destructive')}>
                {rateError ??
                  `Each device, and each address on the internet, may open this many to the router (its pages, SSH, DNS over TCP), and twice as many at once (synflood_burst); more wait a second to be sent again. Empty is OpenWrt’s ${String(SYN_RATE_FW4)}; MilkFlint sets ${String(SYN_RATE_MILKFLINT)}.`}
              </p>
            </div>
            {toggle(
              'dropInvalid',
              'Drop invalid packets',
              'drop_invalid',
              'Packets that belong to no known connection. Off is OpenWrt’s default.',
            )}
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
            {wed.on && (
              <WedNotice title="Hardware offloading runs with Wireless Ethernet Dispatch (WED)" turningOff={wedOff}>
                {wedOff
                  ? 'WED needs both software and hardware flow offloading.'
                  : 'Both kinds of flow offloading are on for it, and Smart Queue is off. Turning either off here turns WED off too, and Smart Queue comes back.'}
              </WedNotice>
            )}
            {f.offloadHw && !wed.on && (
              <Alert variant="warning">
                <AlertDescription>
                  Smart Queue can’t shape what bypasses the CPU: latency under load comes back (
                  <Link {...pageLink('sqm')} className="underline">
                    Smart Queue
                  </Link>
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
          {failed !== undefined ? (
            <p className="text-xs font-medium text-destructive">{failed}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {changes.length === 0 ? 'No changes yet.' : 'Applies to the whole firewall.'}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={changes.length === 0 || rateError !== undefined || submitting} onClick={settings.save}>
              Save defaults
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

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

/** A row of the zones table: a zone, or the defaults for what no zone covers. */
type ZoneRow = { kind: 'zone'; zone: Zone } | { kind: 'defaults' };

// (a section's name has no spaces, so no zone's key is this)
const DEFAULTS_KEY = 'the defaults';
const DEFAULTS: ZoneRow = { kind: 'defaults' };

function ZoneName({ z, cfg }: { z: Zone; cfg: FirewallConfig }): ReactElement {
  const managed = managedBy[z.section];
  const title = zoneTitle(z.name, cfg) === z.name ? '' : zoneTitle(z.name, cfg);
  return (
    <span className="flex flex-col">
      <span className="flex items-center gap-1.5">
        <ShieldIcon className="size-3.5 text-muted-foreground" />
        <span className="font-mono text-xs font-medium">{z.name}</span>
      </span>
      <span className="text-xs text-muted-foreground">
        {managed === undefined ? title : `${zoneTitle(z.name, cfg)} · ${managed.title} page`}
      </span>
    </span>
  );
}

function DefaultsName(): ReactElement {
  return (
    <span className="flex flex-col">
      <span className="font-mono text-xs font-medium">defaults</span>
      <span className="text-xs text-muted-foreground">what no zone covers</span>
    </span>
  );
}

/** What the zones table's cells and cards work with. */
interface ZoneCtx {
  data: FirewallData;
  actions: Actions;
  setOpen: (open: Open) => void;
}

/** The zones each zone may forward to (its forwardings that are on). */
function forwardsTo(z: Zone, cfg: FirewallConfig): string[] {
  return cfg.forwardings.filter((f) => f.enabled && f.src === z.name).map((f) => f.dest);
}

function removeZone({ data: { cfg }, actions }: ZoneCtx, z: Zone): void {
  const users = zoneUsers(cfg, z.name);
  actions.confirm({
    title: `Delete zone ${z.name}?`,
    body: `Its networks are left in no zone, so only the defaults apply to them, and its forwardings go too.${
      users.length === 0 ? '' : ` These still name it, and the firewall skips them until you change them: ${users.join(', ')}.`
    }`,
    action: 'Delete zone',
    changes: [
      { op: 'delete', config: 'firewall', section: z.section },
      ...cfg.forwardings
        .filter((f) => f.src === z.name || f.dest === z.name)
        .map((f): Change => ({ op: 'delete', config: 'firewall', section: f.section })),
    ],
  });
}

/** A row's edit and delete buttons; the defaults only edit. */
function RowActions({ row, ctx }: { row: ZoneRow; ctx: ZoneCtx }): ReactElement {
  if (row.kind === 'defaults') {
    return (
      <span className="flex justify-end">
        <RowButton
          label="Edit the defaults"
          icon={SquarePenIcon}
          onClick={() => {
            ctx.setOpen({ kind: 'defaults' });
          }}
        />
      </span>
    );
  }
  const z = row.zone;
  return (
    <span className="flex items-center justify-end">
      <RowButton
        label={`Edit zone ${z.name}`}
        icon={SquarePenIcon}
        onClick={() => {
          ctx.setOpen({ kind: 'zone', zone: z });
        }}
      />
      <RowButton
        label={`Delete zone ${z.name}`}
        icon={Trash2Icon}
        disabled={ctx.actions.applying}
        onClick={() => {
          removeZone(ctx, z);
        }}
      />
    </span>
  );
}

/** The defaults' notes: SYN flood protection, invalid packets, offloading. */
function defaultsNotes(cfg: FirewallConfig): string[] {
  return [
    cfg.defaults.synFlood ? `SYN flood protection ${synRateLabel(cfg.defaults.synRate)}` : 'no SYN flood protection',
    cfg.defaults.dropInvalid && 'drops invalid',
    cfg.defaults.offloadHw ? 'hardware offloading' : cfg.defaults.offload && 'software offloading',
  ].filter((x): x is string => typeof x === 'string');
}

function zoneColumns(ctx: ZoneCtx): Column<ZoneRow>[] {
  const { cfg } = ctx.data;
  // a zone's policies, or the defaults'
  const policy = (row: ZoneRow): Pick<Zone, 'input' | 'output' | 'forward'> => (row.kind === 'zone' ? row.zone : cfg.defaults);
  // the defaults have no masquerading, MSS clamping or forwardings: their notes go under their row instead
  const ofZone = (cell: (z: Zone) => ReactElement) => (row: ZoneRow) => (row.kind === 'zone' ? cell(row.zone) : null);
  return [
    { label: 'Zone', cell: (row) => (row.kind === 'zone' ? <ZoneName z={row.zone} cfg={cfg} /> : <DefaultsName />) },
    { label: 'Networks', cell: (row) => <Chips items={row.kind === 'zone' ? row.zone.networks : []} /> },
    { label: 'Input', cell: (row) => <VerdictBadge verdict={policy(row).input} /> },
    { label: 'Output', cell: (row) => <VerdictBadge verdict={policy(row).output} /> },
    { label: 'Forward', cell: (row) => <VerdictBadge verdict={policy(row).forward} /> },
    { label: 'Masq', cell: ofZone((z) => <Flag on={z.masq} />) },
    { label: 'MSS', cell: ofZone((z) => <Flag on={z.mtuFix} />) },
    { label: 'Forwards to', cell: ofZone((z) => <Chips items={forwardsTo(z, cfg)} />) },
    { label: 'Actions', className: 'w-24 py-1', hidden: true, cell: (row) => <RowActions row={row} ctx={ctx} /> },
  ];
}

/** A zone's card on a phone or in a narrow window, or the defaults'. */
function ZoneCard({ row, ctx }: { row: ZoneRow; ctx: ZoneCtx }): ReactElement {
  const { cfg } = ctx.data;
  const z = row.kind === 'zone' ? row.zone : undefined;
  const notes = defaultsNotes(cfg);
  const policy = (dt: string, verdict: string): ReactElement => (
    <>
      <dt className="text-muted-foreground">{dt}</dt>
      <dd>
        <VerdictBadge verdict={verdict} />
      </dd>
    </>
  );
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <span className="flex items-start justify-between gap-2">
        {z === undefined ? <DefaultsName /> : <ZoneName z={z} cfg={cfg} />}
        <RowActions row={row} ctx={ctx} />
      </span>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 text-xs">
        {z === undefined ? (
          <>
            {policy('To the router (input)', cfg.defaults.input)}
            {policy('From the router (output)', cfg.defaults.output)}
            {policy('Between zones (forward)', cfg.defaults.forward)}
            {notes.length > 0 && (
              <>
                <dt className="text-muted-foreground">Also</dt>
                <dd>{notes.join(' · ')}</dd>
              </>
            )}
          </>
        ) : (
          <>
            <dt className="text-muted-foreground">Networks</dt>
            <dd>
              <Chips items={z.networks} />
            </dd>
            {policy('To the router (input)', z.input)}
            {policy('From the router (output)', z.output)}
            {policy('Within the zone (forward)', z.forward)}
            <dt className="text-muted-foreground">Masquerading</dt>
            <dd>{z.masq ? 'On' : 'Off'}</dd>
            <dt className="text-muted-foreground">MSS clamping</dt>
            <dd>{z.mtuFix ? 'On' : 'Off'}</dd>
            <dt className="text-muted-foreground">Forwards to</dt>
            <dd>
              <Chips items={forwardsTo(z, cfg)} />
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

export function ZonesTab({
  data,
  counters,
  actions,
  onSubmit,
}: {
  data: FirewallData;
  counters: Counters | undefined;
  actions: Actions;
  /** applies a sheet's changes; the failure's message when that didn't go through */
  onSubmit: (changes: Change[]) => Promise<string | undefined>;
}): ReactElement {
  const [open, setOpen] = useState<Open>();
  const { cfg } = data;
  const on = cfg.forwardings.filter((f) => f.enabled);
  const close = (): void => {
    setOpen(undefined);
  };
  // a sheet closes once its save went through, and stays open with the failure when it didn't
  const submit = async (changes: Change[]): Promise<string | undefined> => {
    const failed = await onSubmit(changes);
    if (failed === undefined) setOpen(undefined);
    return failed;
  };
  const ctx = useMemo((): ZoneCtx => ({ data, actions, setOpen }), [data, actions]);
  const columns = useMemo(() => zoneColumns(ctx), [ctx]);
  const notes = defaultsNotes(cfg);
  const groups = [
    {
      key: 'zones',
      header: (
        <GroupHeader title={<span className="font-medium">Zones</span>} count={cfg.zones.length} noun={['zone', 'zones']} />
      ),
      rows: cfg.zones.map((zone): ZoneRow => ({ kind: 'zone', zone })),
    },
    { key: 'defaults', header: <GroupHeader title={<span className="font-medium">Defaults</span>} />, rows: [DEFAULTS] },
  ];

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
        <DataTable
          label="Zones"
          columns={columns}
          groups={groups}
          rowKey={(row) => (row.kind === 'zone' ? row.zone.section : DEFAULTS_KEY)}
          empty="No zones."
          wide="lg"
          card={(row) => <ZoneCard row={row} ctx={ctx} />}
          rowProps={(row) =>
            row.kind === 'zone'
              ? {
                  onClick: rowClick(() => {
                    setOpen({ kind: 'zone', zone: row.zone });
                  }),
                  className: 'cursor-pointer',
                }
              : {}
          }
          // the defaults' notes, across the columns a zone's flags and forwardings are in
          detail={(row) =>
            row.kind === 'defaults' && (
              <span className="text-xs text-muted-foreground">{notes.length === 0 ? '—' : notes.join(' · ')}</span>
            )
          }
        />
        <p className="text-xs text-muted-foreground lg:text-right">
          Input: connections to the router · Output: from the router · Forward: between a zone’s own networks · Forwards to: zones
          it may start connections to, one way; replies always come back.
        </p>
      </div>
      <NatTable data={data} counters={counters} actions={actions} />
      {cfg.ipsets + cfg.includes > 0 && (
        <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          Your firewall also has {cfg.ipsets > 0 && `${String(cfg.ipsets)} IP set${cfg.ipsets === 1 ? '' : 's'}`}
          {cfg.ipsets > 0 && cfg.includes > 0 && ' and '}
          {cfg.includes > 0 && `${String(cfg.includes)} custom include${cfg.includes === 1 ? '' : 's'}`}; they keep working.
          <a href="/cgi-bin/luci/admin/network/firewall" className="inline-flex items-center gap-1 link underline-offset-4">
            Edit in LuCI <ExternalLinkIcon className="size-3" />
          </a>
        </p>
      )}
      {open?.kind === 'zone' && <ZoneSheet zone={open.zone} data={data} onClose={close} onSubmit={submit} />}
      {open?.kind === 'defaults' && <DefaultsSheet data={data} onClose={close} onSubmit={submit} />}
    </div>
  );
}
