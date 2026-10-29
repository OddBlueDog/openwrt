import { ActivityIcon, CpuIcon, LayersIcon, RotateCcwIcon, TimerIcon, WifiIcon } from 'lucide-react';
import { type ReactElement, useCallback, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading, InfoRow } from '@/components/card-heading';
import { CpuLanes, RssTable } from '@/components/cpu-lanes';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { type NetworkLive, useNetworkLive } from '@/hooks/use-network-live';
import { usePoll } from '@/hooks/use-poll';
import { bool, type Change, getConfig, type Section, str } from '@/lib/api/uci';
import { formatNumber, formatPercent } from '@/lib/format';
import { cpuText, pathSentence } from '@/lib/network-text';
import { cn } from '@/lib/utils';
import { GSO, takesWhole, type Whole, wholeSetting, wholeValue, withOpts, words } from '../sqm/gso';
import { isVpnShaper } from '../vpn-client/sections';
import { isGuestShaper } from '../wifi-guest/guest';
import { type GroPort, getTuningStatus, type TuningStatus } from './api';

// The settings (router side: features/tuning/init puts them into effect):
// - milkflint.wifi.aql_be: the Wi-Fi queue's best-effort limits, "<low>
//   <high>" in µs or "off" (mac80211's own); unset is 2500/5000;
// - milkflint.steering.layout: "openwrt" for OpenWrt's packet steering
//   instead of MilkFlint's; milkflint.steering.rss "0" for MilkFlint's RPS
//   layout instead of RSS; network.globals.packet_steering "0" turns
//   steering off (LuCI's Packet Steering option);
// - milkflint.gro.mode ("fraglist", "plain", "off"), .udp_fwd ("1", "0"),
//   .max_size (bytes): the internet port's GRO, read by
//   /usr/libexec/milkflint/gro; unset is its automatic choice;
// - milkflint.gro.whole ("1", "0"): whether Smart Queue's download CAKE takes
//   GRO packets whole; unset goes with the speed (../sqm/gso.ts). The page
//   writes sqm's iqdisc_opts to match, as the Smart Queue page does.
//   The GRO card only shows while the firewall's flow offloading is off, or
//   once a GRO setting isn't automatic: with offloading on (MilkFlint's
//   default), automatic is plain GRO up to 16 KB when the download CAKE takes
//   GRO packets whole (fraglist GRO otherwise), which leaves nothing to pick.
// Unset everywhere is what the image does: Restore defaults unsets them.
// Moving to or from RSS can also switch Smart Queue's multi-queue CAKE
// (sqm's use_mq), which only spreads over CPUs when RSS does.

type Aql = 'default' | 'off' | 'custom';
type Steering = 'rss' | 'rps' | 'openwrt' | 'off';
type Gro = 'auto' | 'fraglist' | 'plain' | 'off';
type UdpFwd = 'auto' | 'on' | 'off';

interface TuningForm {
  aql: Aql;
  /** the custom AQL limits, µs */
  aqlLow: string;
  aqlHigh: string;
  steering: Steering;
  /** switch Smart Queue's multi-queue CAKE with the steering */
  followQueue: boolean;
  gro: Gro;
  udpFwd: UdpFwd;
  /** the largest plain GRO packet in bytes, "" for the kernel's 64 KB */
  groMax: string;
  whole: Whole;
}

interface TuningData {
  form: TuningForm;
  milkflint: Section[];
  /** network's globals section, and its packet_steering */
  globals: string | undefined;
  packetSteering: string | undefined;
  /** the firewall's software or hardware flow offloading is on */
  offload: boolean;
  /** Smart Queue's WAN queue section: multi-queue, download speed (kbit/s), CAKE's download options */
  sqm: { section: string; multiQueue: boolean; download: number; iqdiscOpts: string | undefined } | undefined;
}

const defaults: TuningForm = {
  aql: 'default',
  aqlLow: '2500',
  aqlHigh: '5000',
  steering: 'rss',
  followQueue: true,
  gro: 'auto',
  udpFwd: 'auto',
  groMax: '',
  whole: 'auto',
};

const groLabels: Record<Gro, string> = {
  auto: 'Automatic',
  fraglist: 'Fraglist GRO (OpenWrt’s)',
  plain: 'Plain GRO',
  off: 'Off',
};
// the largest plain GRO packet: the kernel's 64 KB and three smaller ones
const groSizes = ['', '32768', '16384', '8192'];

function sizeLabel(bytes: string | number): string {
  const n = Number(bytes === '' ? 65536 : bytes);
  return n % 1024 === 0 ? `${String(n / 1024)} KB` : `${formatNumber(n)} bytes`;
}

const steeringIds = ['rss', 'rps', 'openwrt', 'off'] as const;
const steeringOptions: Record<Steering, { label: string; description: string }> = {
  rss: {
    label: 'RSS: hardware receive rings',
    description:
      'The Ethernet hardware spreads flows over three receive rings, each with its own CPU (1–3), and nothing is handed between CPUs in software. With multi-queue Smart Queue, each ring feeds its own CAKE queue on the same CPU. The lightest on the CPUs.',
  },
  rps: {
    label: 'RPS: software steering',
    description:
      'Everything arrives on one ring on CPU 0, which hands each flow on to CPUs 1–3. Uses more CPU than RSS for the handing on.',
  },
  openwrt: {
    label: 'OpenWrt’s layout',
    description:
      'OpenWrt’s packet-steering.uc. On the Flint 2 it can leave everything the ports receive on one CPU, which may limit speed and add latency under heavy load. LuCI’s Packet Steering options apply to it.',
  },
  off: {
    label: 'Off',
    description: 'No steering: packets are handled on the CPU that received them, and the drivers’ threads run on any CPU.',
  },
};

async function loadTuning(): Promise<TuningData> {
  const [milkflint, network, sqm, firewall] = await Promise.all([
    getConfig('milkflint').catch((): Section[] => []),
    getConfig('network'),
    getConfig('sqm').catch((): Section[] => []),
    getConfig('firewall').catch((): Section[] => []),
  ]);
  const fwDefaults = firewall.find((s) => s['.type'] === 'defaults');
  const section = (name: string): Section | undefined => milkflint.find((s) => s['.name'] === name);
  const aqlBe = str(section('wifi'), 'aql_be');
  // as /usr/libexec/milkflint/wifi-aql reads it: anything else is the default
  const custom = /^(\d{1,6}) (\d{1,6})$/.exec(aqlBe ?? '');
  const globals = network.find((s) => s['.type'] === 'globals');
  const packetSteering = str(globals, 'packet_steering');
  const steering = section('steering');
  const gro = section('gro');
  const groMode = str(gro, 'mode');
  const udpFwd = str(gro, 'udp_fwd');
  const groMax = str(gro, 'max_size') ?? '';
  // the internet port's queue: Guest Wi-Fi's speed limit is one too
  const queue = sqm.find((s) => s['.type'] === 'queue' && !isGuestShaper(str(s, 'interface')) && !isVpnShaper(str(s, 'interface')));
  return {
    form: {
      aql: aqlBe === 'off' ? 'off' : custom === null ? 'default' : 'custom',
      aqlLow: custom?.[1] ?? defaults.aqlLow,
      aqlHigh: custom?.[2] ?? defaults.aqlHigh,
      steering:
        packetSteering === '0' ? 'off' : str(steering, 'layout') === 'openwrt' ? 'openwrt' : str(steering, 'rss') === '0' ? 'rps' : 'rss',
      followQueue: true,
      gro: groMode === 'fraglist' || groMode === 'plain' || groMode === 'off' ? groMode : 'auto',
      udpFwd: udpFwd === '1' ? 'on' : udpFwd === '0' ? 'off' : 'auto',
      groMax: /^\d{4,5}$/.test(groMax) ? groMax : '',
      whole: wholeSetting(str(gro, 'whole')),
    },
    milkflint,
    globals: globals?.['.name'],
    packetSteering,
    offload: bool(fwDefaults, 'flow_offloading') || bool(fwDefaults, 'flow_offloading_hw'),
    sqm:
      queue === undefined
        ? undefined
        : {
            section: queue['.name'],
            multiQueue: bool(queue, 'use_mq'),
            download: Number(str(queue, 'download') ?? '0'),
            iqdiscOpts: str(queue, 'iqdisc_opts'),
          },
  };
}

/** Any GRO setting other than automatic */
function groChanged(f: TuningForm): boolean {
  return f.gro !== defaults.gro || f.udpFwd !== defaults.udpFwd || f.groMax !== defaults.groMax || f.whole !== defaults.whole;
}

/** milkflint.wifi.aql_be for the form; undefined: unset, the default */
function aqlValue(f: TuningForm): string | undefined {
  switch (f.aql) {
    case 'default':
      return undefined;
    case 'off':
      return 'off';
    case 'custom':
      return `${Number(f.aqlLow)} ${Number(f.aqlHigh)}`;
  }
}

/** Smart Queue's multi-queue setting the new steering asks for, when it should change */
function queueSwitch(f: TuningForm, data: TuningData): boolean | undefined {
  if (data.sqm === undefined || f.steering === data.form.steering) return undefined;
  const want = f.steering === 'rss';
  return want === data.sqm.multiQueue ? undefined : want;
}

/** What the form asks the router to do: forms that mean the same compare equal. */
function meaning(f: TuningForm, data: TuningData | undefined): string {
  const queue = data === undefined ? undefined : queueSwitch(f, data);
  return JSON.stringify([
    f.aql === 'custom' ? `${f.aqlLow} ${f.aqlHigh}` : f.aql,
    f.steering,
    queue === undefined ? null : f.followQueue,
    f.gro,
    f.udpFwd,
    f.groMax,
    f.whole,
  ]);
}

type Errors = Partial<Record<'aqlLow' | 'aqlHigh', string>>;

function validate(f: TuningForm): Errors {
  const e: Errors = {};
  if (f.aql !== 'custom') return e;
  const ok = (v: string): boolean => /^\d{1,6}$/.test(v) && Number(v) >= 500 && Number(v) <= 50_000;
  if (!ok(f.aqlLow)) e.aqlLow = 'Whole microseconds, 500 to 50,000.';
  if (!ok(f.aqlHigh)) e.aqlHigh = 'Whole microseconds, 500 to 50,000.';
  else if (e.aqlLow === undefined && Number(f.aqlHigh) < Number(f.aqlLow)) e.aqlHigh = 'At least the low limit.';
  return e;
}

/**
 * Set, or unset (undefined), options of one named section: adds the section
 * if it's missing, and deletes it when nothing would be left in it.
 */
function sectionChanges(config: string, sections: Section[], name: string, options: Record<string, string | undefined>): Change[] {
  const s = sections.find((x) => x['.name'] === name);
  const values: Record<string, string> = {};
  const unset: string[] = [];
  for (const [option, value] of Object.entries(options)) {
    if (value === undefined) {
      if (s?.[option] !== undefined) unset.push(option);
    } else if (str(s, option) !== value) {
      values[option] = value;
    }
  }
  const changes: Change[] = [];
  if (Object.keys(values).length > 0) {
    changes.push(s === undefined ? { op: 'add', config, type: name, name, values } : { op: 'set', config, section: name, values });
  }
  if (unset.length > 0) {
    const kept = Object.keys(s ?? {}).filter((k) => !k.startsWith('.') && !unset.includes(k));
    changes.push(
      kept.length === 0 && Object.keys(values).length === 0
        ? { op: 'delete', config, section: name }
        : { op: 'unset', config, section: name, options: unset },
    );
  }
  return changes;
}

// Only what changed is written, so Restore defaults leaves alone what's
// already the default (a LuCI Packet Steering "Enabled" stays as it is).
function toChanges(f: TuningForm, data: TuningData): Change[] {
  const was = data.form;
  const changes: Change[] = [];
  if (aqlValue(f) !== aqlValue(was)) {
    changes.push(...sectionChanges('milkflint', data.milkflint, 'wifi', { aql_be: aqlValue(f) }));
  }
  if (f.steering !== was.steering) {
    changes.push(
      ...sectionChanges('milkflint', data.milkflint, 'steering', {
        layout: f.steering === 'openwrt' ? 'openwrt' : undefined,
        rss: f.steering === 'rps' ? '0' : undefined,
      }),
    );
    // on or off is OpenWrt's own option: "0" is off, unset (its default) on
    if (f.steering === 'off') {
      changes.push(
        data.globals === undefined
          ? { op: 'add', config: 'network', type: 'globals', name: 'globals', values: { packet_steering: '0' } }
          : { op: 'set', config: 'network', section: data.globals, values: { packet_steering: '0' } },
      );
    } else if (data.packetSteering === '0' && data.globals !== undefined) {
      changes.push({ op: 'unset', config: 'network', section: data.globals, options: ['packet_steering'] });
    }
    const queue = queueSwitch(f, data);
    if (queue !== undefined && f.followQueue && data.sqm !== undefined) {
      changes.push({ op: 'set', config: 'sqm', section: data.sqm.section, values: { use_mq: queue ? '1' : '0' } });
    }
  }
  if (f.gro !== was.gro || f.udpFwd !== was.udpFwd || f.groMax !== was.groMax || f.whole !== was.whole) {
    changes.push(
      ...sectionChanges('milkflint', data.milkflint, 'gro', {
        mode: f.gro === 'auto' ? undefined : f.gro,
        udp_fwd: f.udpFwd === 'auto' ? undefined : f.udpFwd === 'on' ? '1' : '0',
        max_size: f.groMax === '' ? undefined : f.groMax,
        whole: wholeValue(f.whole),
      }),
    );
  }
  // CAKE's own option, as the Smart Queue page writes it: when the setting
  // changed and CAKE doesn't already do what it asks
  const q = data.sqm;
  const whole = q !== undefined && takesWhole(q.download, f.whole);
  if (q !== undefined && f.whole !== was.whole && whole !== words(q.iqdiscOpts).includes('no-split-gso')) {
    const opts = withOpts(q.iqdiscOpts, GSO, whole ? ['no-split-gso'] : []);
    if (opts !== '') {
      // LuCI shows the option only in its advanced mode
      const values = { iqdisc_opts: opts, qdisc_advanced: '1', qdisc_really_really_advanced: '1' };
      changes.push({ op: 'set', config: 'sqm', section: q.section, values });
    } else if (q.iqdiscOpts !== undefined) {
      changes.push({ op: 'unset', config: 'sqm', section: q.section, options: ['iqdisc_opts'] });
    }
  }
  return changes;
}

function aqlLabel(f: TuningForm): string {
  switch (f.aql) {
    case 'default':
      return '2,500 / 5,000 µs';
    case 'off':
      return '5,000 / 12,000 µs (mac80211’s own)';
    case 'custom':
      return `${formatNumber(Number(f.aqlLow))} / ${formatNumber(Number(f.aqlHigh))} µs`;
  }
}

/** A short name for how received packets are spread right now. */
function spreadBadge(live: NetworkLive): { text: string; variant: 'success' | 'secondary' } {
  if (live.rss?.spreading === true) {
    const rings = live.rings.filter((r) => r.share > 0).map((r) => r.ring);
    return { text: `RSS · ring${rings.length === 1 ? '' : 's'} ${rings.join(', ')}`, variant: 'success' };
  }
  if (live.rps.length > 0) return { text: `RPS · ${cpuText(live.rps)}`, variant: 'secondary' };
  return { text: 'Not spread', variant: 'secondary' };
}

function WorkCard({ live }: { live: { data: NetworkLive | undefined; error: unknown } }): ReactElement {
  const { data, error } = live;
  const badge = data === undefined ? undefined : spreadBadge(data);
  return (
    <Card>
      <CardHeading
        icon={ActivityIcon}
        title="Where the work runs"
        description="Live, every 2 s: each CPU and the network work it does. Hover an item for what it is."
        action={badge !== undefined && <Badge variant={badge.variant}>{badge.text}</Badge>}
      />
      <CardContent className="flex flex-col gap-4">
        {data === undefined ? (
          <p className="text-sm text-muted-foreground">{error === undefined ? 'Loading…' : 'Not available on this router.'}</p>
        ) : (
          <>
            <p className="text-sm">{pathSentence(data)}</p>
            <RssTable live={data} />
            <CpuLanes live={data} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SteeringCard({
  form,
  data,
  live,
  set,
}: {
  form: TuningForm;
  data: TuningData;
  live: NetworkLive | undefined;
  set: <K extends keyof TuningForm>(key: K, value: TuningForm[K]) => void;
}): ReactElement {
  // RSS needs an image whose Ethernet has the four rings; without them the
  // script keeps the RPS layout
  const rssMissing = live !== undefined && live.rss === undefined;
  const queue = queueSwitch(form, data);
  return (
    <Card>
      <CardHeading icon={CpuIcon} title="Packet steering" description="How what the ports receive is spread over the CPUs." />
      <CardContent className="flex flex-col gap-3">
        <div role="radiogroup" aria-label="Packet steering" className="flex flex-col gap-2">
          {steeringIds.map((id) => {
            const selected = form.steering === id;
            const unavailable = id === 'rss' && rssMissing;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-labelledby={`steering-${id}`}
                aria-describedby={`steering-${id}-hint`}
                disabled={unavailable && !selected}
                onClick={() => {
                  set('steering', id);
                }}
                className={cn(
                  'flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-60',
                  selected && 'border-primary bg-primary/5 ring-1 ring-primary',
                )}
              >
                <span id={`steering-${id}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                  {steeringOptions[id].label}
                  {id === defaults.steering && <Badge variant="outline">Default</Badge>}
                </span>
                <span id={`steering-${id}-hint`} className="text-xs text-muted-foreground">
                  {unavailable
                    ? 'Needs an image whose Ethernet has its four receive rings (MilkFlint’s RSS patches). This one doesn’t, so the RPS layout is used.'
                    : steeringOptions[id].description}
                </span>
              </button>
            );
          })}
        </div>
        {queue !== undefined && (
          <div className="flex items-start gap-3 rounded-lg border border-dashed p-3 text-sm">
            <Switch
              id="followQueue"
              className="mt-0.5"
              checked={form.followQueue}
              onCheckedChange={(v) => {
                set('followQueue', v);
              }}
            />
            <label htmlFor="followQueue" className="flex flex-col gap-0.5">
              <span className="font-medium">{queue ? 'Also turn on multi-queue CAKE' : 'Also switch Smart Queue to single-queue CAKE'}</span>
              <span className="text-xs text-muted-foreground">
                {queue
                  ? 'Smart Queue then runs one CAKE queue per ring, each on its ring’s CPU, sharing your speed (cake_mq). It restarts for a moment.'
                  : 'Without RSS every download arrives on one ring, so multi-queue CAKE would run as one queue anyway. Smart Queue restarts for a moment.'}
              </span>
            </label>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** "0.66 ms": how long a 64 KB GRO packet holds a queue shaped to kbit/s */
function holdMs(bytes: number, kbit: number): string {
  const ms = (bytes * 8) / kbit;
  return `${ms < 1 ? ms.toFixed(2) : ms.toFixed(1)} ms`;
}

function groReason(port: GroPort): string {
  if (port.offload) return 'flow offloading is on';
  return port.whole ? 'flow offloading is off and Smart Queue takes GRO packets whole' : 'Smart Queue splits GRO packets';
}

function groNow(port: GroPort): string {
  const { gro, list, udp, max } = port.now;
  if (gro === false) return 'GRO off';
  const kind = list === null ? 'GRO' : list ? 'Fraglist GRO' : 'Plain GRO';
  const parts = [kind];
  if (udp !== null) parts.push(`UDP forwarding ${udp ? 'on' : 'off'}`);
  if (list === false && max !== null) parts.push(`up to ${sizeLabel(max)}`);
  return parts.join(', ');
}

function GroCard({
  form,
  data,
  port,
  set,
}: {
  form: TuningForm;
  data: TuningData;
  port: GroPort | undefined;
  set: <K extends keyof TuningForm>(key: K, value: TuningForm[K]) => void;
}): ReactElement {
  const dev = port?.dev ?? 'the internet port';
  const q = data.sqm;
  const plain = form.gro === 'plain' || (form.gro === 'auto' && port?.auto === 'plain');
  const groHint: Record<Gro, string> = {
    auto: `Fraglist GRO while the firewall’s flow offloading is on, plain GRO when it’s off and Smart Queue takes GRO packets whole.${
      port === undefined ? '' : ` Now ${port.auto === 'plain' ? 'plain' : 'fraglist'}: ${groReason(port)}.`
    }`,
    fraglist:
      'OpenWrt’s default: a group keeps its packets, so the Wi-Fi port only has to unchain them again. The cheapest with flow offloading on, for TCP and UDP alike.',
    plain:
      'The packets are merged into one. May save CPU with flow offloading off. With it on: no saving for TCP, and more CPU for UDP, which the Wi-Fi port has to copy and checksum apart.',
    off: 'Every packet goes through Smart Queue and the firewall on its own: far more CPU. For troubleshooting.',
  };
  return (
    <Card>
      <CardHeading
        icon={LayersIcon}
        title="Receive grouping (GRO)"
        description={`How ${dev} groups the packets of each download before Smart Queue and the firewall handle them.`}
      />
      <CardContent className="divide-y">
        <Field id="gro" label="GRO" hint={groHint[form.gro]}>
          <Select
            value={form.gro}
            onValueChange={(v) => {
              set('gro', v as Gro);
            }}
          >
            <SelectTrigger id="gro">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatic (default)</SelectItem>
              <SelectItem value="fraglist">{groLabels.fraglist}</SelectItem>
              <SelectItem value="plain">{groLabels.plain}</SelectItem>
              <SelectItem value="off">{groLabels.off}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field
          id="udpFwd"
          label="UDP GRO forwarding"
          hint="Lets plain GRO group forwarded UDP too (QUIC, games, VPNs); fraglist GRO groups it anyway. With flow offloading on it costs a Wi-Fi client more than it saves."
        >
          <Select
            value={form.udpFwd}
            onValueChange={(v) => {
              set('udpFwd', v as UdpFwd);
            }}
          >
            <SelectTrigger id="udpFwd">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatic: on with plain GRO (default)</SelectItem>
              <SelectItem value="on">On</SelectItem>
              <SelectItem value="off">Off</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field
          id="whole"
          label="Smart Queue takes GRO packets whole"
          hint={
            q === undefined || q.download <= 0
              ? 'Smart Queue isn’t shaping downloads.'
              : `Whole saves CPU; split lets a ping overtake sooner. A 64 KB group holds the download queue ${holdMs(65536, q.download)} at your ${formatNumber(
                  q.download / 1000,
                )} Mbit/s${q.multiQueue ? ', longer in each multi-queue CAKE queue, which share the speed' : ''}. Smart Queue restarts for a moment when this changes.`
          }
        >
          <Select
            value={form.whole}
            disabled={q === undefined}
            onValueChange={(v) => {
              set('whole', v as Whole);
            }}
          >
            <SelectTrigger id="whole">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatic: from 500 Mbit/s (default)</SelectItem>
              <SelectItem value="on">Always</SelectItem>
              <SelectItem value="off">Never: split each one</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field
          id="groMax"
          label="Largest GRO packet"
          hint={`Plain GRO only: fraglist GRO always groups up to 64 KB.${
            plain ? '' : ' Not in use now.'
          } Smaller groups hold a Smart Queue queue for less time when it takes them whole, for a little more CPU.`}
        >
          <Select
            value={form.groMax === '' ? 'default' : form.groMax}
            onValueChange={(v) => {
              set('groMax', v === 'default' ? '' : v);
            }}
          >
            <SelectTrigger id="groMax">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...groSizes, ...(groSizes.includes(form.groMax) ? [] : [form.groMax])].map((v) => (
                <SelectItem key={v === '' ? 'default' : v} value={v === '' ? 'default' : v}>
                  {v === '' ? '64 KB (default)' : sizeLabel(v)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {port !== undefined && (
          <>
            <InfoRow label={`In use now on ${port.dev}`}>{groNow(port)}</InfoRow>
            <InfoRow label="Smart Queue">{port.whole ? 'takes GRO packets whole' : 'splits GRO packets'}</InfoRow>
            <InfoRow label="Flow offloading">{port.offload ? 'on (Firewall)' : 'off (Firewall)'}</InfoRow>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AqlCard({
  form,
  errors,
  status,
  set,
}: {
  form: TuningForm;
  errors: Errors;
  status: TuningStatus | undefined;
  set: <K extends keyof TuningForm>(key: K, value: TuningForm[K]) => void;
}): ReactElement {
  const radios = status?.radios ?? [];
  const first = radios[0];
  const same = first !== undefined && radios.every((r) => r.low === first.low && r.high === first.high);
  return (
    <Card>
      <CardHeading
        icon={WifiIcon}
        title="Wi-Fi queue (AQL)"
        description="How much airtime of best-effort traffic each device may have waiting in the Wi-Fi driver."
      />
      <CardContent className="divide-y">
        <Field
          id="aql"
          label="Limit"
          hint="Shorter keeps latency down when a device’s Wi-Fi is slower than the download. Every radio takes it at once."
        >
          <Select
            value={form.aql}
            onValueChange={(v) => {
              set('aql', v as Aql);
            }}
          >
            <SelectTrigger id="aql">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">2,500 / 5,000 µs (default)</SelectItem>
              <SelectItem value="off">5,000 / 12,000 µs (mac80211’s own)</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {form.aql === 'custom' && (
          <>
            <Field id="aqlLow" label="Low limit" hint="µs per device, while the radio has 24 ms or more waiting in all." error={errors.aqlLow}>
              <Input
                id="aqlLow"
                inputMode="numeric"
                className="w-28 font-mono"
                value={form.aqlLow}
                aria-invalid={errors.aqlLow !== undefined}
                onChange={(e) => {
                  set('aqlLow', e.target.value.trim());
                }}
              />
            </Field>
            <Field id="aqlHigh" label="High limit" hint="µs per device, the rest of the time: with one busy device, always." error={errors.aqlHigh}>
              <Input
                id="aqlHigh"
                inputMode="numeric"
                className="w-28 font-mono"
                value={form.aqlHigh}
                aria-invalid={errors.aqlHigh !== undefined}
                onChange={(e) => {
                  set('aqlHigh', e.target.value.trim());
                }}
              />
            </Field>
          </>
        )}
        {status !== undefined &&
          (same || first === undefined ? (
            <InfoRow label={radios.length > 1 ? `In use now, ${String(radios.length)} radios` : 'In use now'}>
              {first === undefined ? 'no radios' : `${formatNumber(first.low)} / ${formatNumber(first.high)} µs`}
            </InfoRow>
          ) : (
            radios.map((r) => (
              <InfoRow key={r.phy} label={`In use now, ${r.phy}`}>
                {formatNumber(r.low)} / {formatNumber(r.high)} µs
              </InfoRow>
            ))
          ))}
      </CardContent>
    </Card>
  );
}

/** "85 µs", "1.2 ms" */
function usText(us: number): string {
  return us < 1000 ? `${formatNumber(us)} µs` : `${formatNumber(us / 1000, us < 10_000 ? 1 : 0)} ms`;
}

/** ms of waiting per second */
function waitingText(share: number): string {
  const ms = share * 1000;
  return `${formatNumber(ms, ms < 10 ? 1 : 0)} ms/s`;
}

/**
 * How long each network thread waits for a CPU while other work holds it
 * (the kernel's scheduler statistics, /proc/<pid>/schedstat), live. Read
 * only: the kernel is built without preemption, as OpenWrt's.
 */
function WaitsCard({ status, live }: { status: TuningStatus | undefined; live: NetworkLive | undefined }): ReactElement {
  const kernel = status?.kernel;
  const threads = live?.threads ?? [];
  return (
    <Card>
      <CardHeading
        icon={TimerIcon}
        title="Waiting for a CPU"
        description="Live, every 2 s: how long each network thread was ready to run while other work held its CPU."
      />
      <CardContent className="flex flex-col gap-3">
        {kernel !== undefined && !kernel.waits ? (
          <p className="text-sm text-muted-foreground">This image’s kernel doesn’t record how long threads wait for a CPU.</p>
        ) : live === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : threads.length === 0 ? (
          <p className="text-sm text-muted-foreground">No network driver threads on this router.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Thread</TableHead>
                  <TableHead className="text-right">Busy</TableHead>
                  <TableHead className="text-right">Waiting</TableHead>
                  <TableHead className="text-right">Per wake</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {threads.map((t) => (
                  <TableRow key={t.name}>
                    <TableCell>
                      <span className="flex flex-col">
                        <span>{t.role}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {t.name} · {cpuText(t.cpus)}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular">{t.load === undefined ? '…' : formatPercent(t.load)}</TableCell>
                    <TableCell className="text-right tabular">{t.waiting === undefined ? '…' : waitingText(t.waiting)}</TableCell>
                    <TableCell className="text-right tabular">{t.waitPerRunUs === undefined ? '…' : usText(t.waitPerRunUs)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">
              Busy is its share of one CPU; waiting, the time it was ready to run but another thread or softirq work held its CPU; per wake, how
              long that took on average each time it got the CPU.
            </p>
          </>
        )}
        {kernel?.hz !== null && kernel?.hz !== undefined && (
          <div className="border-t">
            <InfoRow label="Kernel ticks">{`${String(kernel.hz)} a second, fixed in the image`}</InfoRow>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TuningPage(): ReactElement {
  const { data, error, loading, reload } = useLoad(loadTuning);
  const status = usePoll(getTuningStatus, 5000);
  const live = useNetworkLive(2000);
  const refreshStatus = status.refresh;
  const [edit, setEdit] = useState<TuningForm>();
  const [restoring, setRestoring] = useState(false);
  const onApplied = useCallback(() => {
    setEdit(undefined);
    reload();
    refreshStatus();
  }, [reload, refreshStatus]);
  const { state, apply } = useApply(onApplied);
  const form = edit ?? data?.form;
  const errors = form === undefined ? {} : validate(form);
  // Functional update: several edits in one render can't overwrite each other.
  const set = <K extends keyof TuningForm>(key: K, value: TuningForm[K]): void => {
    setEdit((current) => {
      const base = current ?? data?.form;
      return base === undefined ? undefined : { ...base, [key]: value };
    });
  };
  const dirty = edit !== undefined && data !== undefined && meaning(edit, data) !== meaning(data.form, data);
  const atDefaults = data !== undefined && meaning(data.form, data) === meaning(defaults, data);
  // GRO settings beat the default only without flow offloading
  const showGro = data !== undefined && (!data.offload || groChanged(data.form));
  const applying = state.phase === 'applying';

  const restore = (): void => {
    setRestoring(false);
    setEdit(undefined);
    if (data !== undefined && !atDefaults) void apply(toChanges(defaults, data));
  };

  return (
    <>
      <PageHeader
        title="Performance Tuning"
        description={`How the router handles heavy traffic: which CPUs do the network work${
          showGro ? ', how the internet port groups what it receives,' : ''
        } and the Wi-Fi driver’s queue. Changes apply at once; Wi-Fi and the internet stay up.`}
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={data === undefined || applying || (atDefaults && !dirty)}
            onClick={() => {
              setRestoring(true);
            }}
          >
            <RotateCcwIcon /> Restore defaults
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        <WorkCard live={live} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading || form === undefined || data === undefined ? (
          <FormSkeleton />
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <SteeringCard form={form} data={data} live={live.data} set={set} />
            {showGro && <GroCard form={form} data={data} port={status.data?.gro[0]} set={set} />}
            <AqlCard form={form} errors={errors} status={status.data} set={set} />
            <WaitsCard status={status.data} live={live.data} />
          </div>
        )}
      </div>
      <SaveBar
        visible={dirty}
        busy={applying}
        invalid={Object.keys(errors).length > 0}
        onSave={() => {
          if (form !== undefined && data !== undefined) void apply(toChanges(form, data));
        }}
        onRevert={() => {
          setEdit(undefined);
        }}
      />
      <Dialog open={restoring} onOpenChange={setRestoring}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore the defaults?</DialogTitle>
            <DialogDescription>
              They go back to what MilkFlint ships with, and the router applies them straight away. Wi-Fi and the internet stay up.
            </DialogDescription>
          </DialogHeader>
          {data !== undefined && (
            <ul className="flex flex-col gap-2 text-sm">
              <RestoreItem label="Wi-Fi queue" to={aqlLabel(defaults)} from={data.form.aql === 'default' ? undefined : aqlLabel(data.form)} />
              <RestoreItem
                label="Packet steering"
                to={steeringOptions[defaults.steering].label}
                from={data.form.steering === defaults.steering ? undefined : steeringOptions[data.form.steering].label}
              />
              {queueSwitch(defaults, data) !== undefined && (
                <RestoreItem label="Smart Queue" to="multi-queue CAKE" from="single-queue CAKE" />
              )}
              {groChanged(data.form) && (
                <>
                  <RestoreItem
                    label="GRO"
                    to={groLabels[defaults.gro]}
                    from={data.form.gro === defaults.gro ? undefined : groLabels[data.form.gro]}
                  />
                  <RestoreItem
                    label="UDP GRO forwarding"
                    to="Automatic"
                    from={data.form.udpFwd === defaults.udpFwd ? undefined : data.form.udpFwd === 'on' ? 'On' : 'Off'}
                  />
                  <RestoreItem label="Largest GRO packet" to="64 KB" from={data.form.groMax === '' ? undefined : sizeLabel(data.form.groMax)} />
                  <RestoreItem
                    label="Smart Queue takes GRO packets whole"
                    to="Automatic: from 500 Mbit/s"
                    from={data.form.whole === defaults.whole ? undefined : data.form.whole === 'on' ? 'Always' : 'Never'}
                  />
                </>
              )}
            </ul>
          )}
          {dirty && <p className="text-sm text-muted-foreground">Your unsaved changes on this page are dropped.</p>}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRestoring(false);
              }}
            >
              Cancel
            </Button>
            <Button onClick={restore}>Restore defaults</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RestoreItem({ label, to, from }: { label: string; to: string; from: string | undefined }): ReactElement {
  return (
    <li className="flex flex-col">
      <span>
        <span className="font-medium">{label}:</span> {to}
      </span>
      <span className="text-xs text-muted-foreground">{from === undefined ? 'already the default' : `now ${from}`}</span>
    </li>
  );
}
