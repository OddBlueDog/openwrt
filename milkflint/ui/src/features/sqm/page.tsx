import { ActivityIcon, ArrowDownIcon, ArrowUpIcon, CpuIcon, GaugeIcon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, useCallback, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { CpuLanes } from '@/components/cpu-lanes';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { type NetworkLive, queueKey, useNetworkLive } from '@/hooks/use-network-live';
import { getDevices, getInterfaces } from '@/lib/api/network';
import type { CakeQdisc, CakeTin } from '@/lib/api/stats';
import { bool, type Change, getConfig, type Section, str } from '@/lib/api/uci';
import { formatBitrate, formatNumber } from '@/lib/format';
import { cpuText, pathSentence } from '@/lib/network-text';
import { cn } from '@/lib/utils';
import { isVpnShaper } from '../vpn-client/sections';
import { isGuestShaper } from '../wifi-guest/guest';
import { GSO, optValue, takesWhole, type Whole, wholeSetting, withOpts, words } from './gso';

// Link-layer presets: how much each packet grows on the wire, so CAKE's
// shaping matches what the line really carries. mpu (sqm's tcMPU) is the
// smallest frame the line sends, as in CAKE's own ethernet and docsis
// keywords; ATM's cells already set ADSL's. VDSL2 adds CAKE's ptm keyword
// (sqm has no option for it) for its 64/65 encoding.
interface LinkPresetDef {
  label: string;
  linklayer: string;
  overhead: string;
  mpu?: string;
  ptm?: boolean;
}
const linkPresets = {
  none: { label: 'No compensation', linklayer: 'none', overhead: '0' },
  ethernet: { label: 'Fibre / Ethernet', linklayer: 'ethernet', overhead: '44', mpu: '84' },
  docsis: { label: 'Cable (DOCSIS)', linklayer: 'ethernet', overhead: '18', mpu: '64' },
  vdsl: { label: 'VDSL2 (PTM)', linklayer: 'ethernet', overhead: '34', mpu: '68', ptm: true },
  adsl: { label: 'ADSL (ATM)', linklayer: 'atm', overhead: '44' },
} satisfies Record<string, LinkPresetDef>;
type LinkPreset = keyof typeof linkPresets;

// CAKE's rtt, the round trip it tunes for: its queues aim for a twentieth
// of it, and it marks or drops sooner when it's shorter. Senders that slow
// down for that keep shorter queues, for some speed; small flows go first
// either way. Other values (LuCI) show as Custom. Set in both directions'
// opts.
const latencyTargets = {
  standard: { label: 'Standard (100 ms)', rtt: undefined },
  low: { label: 'Low (50 ms)', rtt: '50ms' },
} as const;
type LatencyTarget = keyof typeof latencyTargets;
// rtt, and CAKE's named rtt presets
const RTT = ['rtt', 'datacentre', 'lan', 'metro', 'regional', 'internet', 'oceanic', 'satellite', 'interplanetary'];

/** a direction's rtt setting: "50ms" for rtt 50ms, a preset's name, or undefined for CAKE's default */
function rttOf(opts: string | undefined): string | undefined {
  return optValue(opts, 'rtt') ?? words(opts).find((w) => RTT.includes(w));
}

// The upload queue's memory limit (CAKE's memlimit in eqdisc_opts). CAKE's
// own is four round trips at the upload rate, at least 4 MiB: a fast
// device starting an upload can fill that before CAKE drops anything.
// Low allows one 100 ms round trip of the rate, at least 1 MiB, so the
// burst is cut sooner; the drops land on the flow that overshot.
type UploadMemory = 'auto' | 'low';
const LOW_MEMLIMIT_FLOOR = 1 << 20;

/** Low's memlimit in bytes for an upload speed in kbit/s */
function lowMemlimit(uploadKbit: number): number {
  return Math.max(Math.round((uploadKbit * 1000) / 8 / 10), LOW_MEMLIMIT_FLOOR);
}

// CAKE keywords this page manages in SQM's extra options for each direction
// (iqdisc_opts, eqdisc_opts); any others, set in LuCI, are kept.
const FAIR_INGRESS = ['nat', 'dual-dsthost', 'ingress'];
const FAIR_EGRESS = ['nat', 'dual-srchost'];
// Whether CAKE takes GRO packets whole (no-split-gso) goes with the speed,
// unless Performance Tuning sets it (milkflint.gro.whole): ./gso.ts.

interface SqmForm {
  section: string | undefined;
  enabled: boolean;
  device: string;
  downloadMbit: string;
  uploadMbit: string;
  prioritise: boolean;
  link: LinkPreset | 'custom';
  latency: LatencyTarget | 'custom';
  uploadMemory: UploadMemory | 'custom';
  perDevice: boolean;
  multiQueue: boolean;
  offloadOff: boolean;
}

interface SqmData {
  form: SqmForm;
  devices: string[];
  wanDevice: string | undefined;
  offloading: { section: string; software: boolean; hardware: boolean } | undefined;
  installed: boolean;
  iqdiscOpts: string | undefined;
  eqdiscOpts: string | undefined;
  /** sqm's tcMPU, unset when a preset doesn't use one */
  mpu: string | undefined;
  /** Performance Tuning's choice of whether CAKE takes GRO packets whole */
  whole: Whole;
}

function presetOf(queue: Section | undefined): LinkPreset | 'custom' {
  const linklayer = str(queue, 'linklayer') ?? 'none';
  const overhead = str(queue, 'overhead') ?? '0';
  const mpu = str(queue, 'tcMPU');
  const iq = words(str(queue, 'iqdisc_opts'));
  const eq = words(str(queue, 'eqdisc_opts'));
  const ptm = iq.includes('ptm') && eq.includes('ptm');
  if (ptm !== (iq.includes('ptm') || eq.includes('ptm'))) return 'custom';
  for (const [key, p] of Object.entries(linkPresets) as [LinkPreset, LinkPresetDef][]) {
    if (p.linklayer !== linklayer) continue;
    if (p.linklayer === 'none') return ptm ? 'custom' : key;
    if (p.overhead !== overhead) continue;
    // the presets used to set only these two: a section without mpu and
    // ptm still counts as its preset, and saving adds them
    if (mpu === undefined && !ptm) return key;
    if ((mpu ?? '0') === (p.mpu ?? '0') && ptm === (p.ptm === true)) return key;
  }
  return 'custom';
}

function latencyOf(iqdiscOpts: string | undefined, eqdiscOpts: string | undefined): LatencyTarget | 'custom' {
  const rtt = rttOf(iqdiscOpts);
  if (rtt !== rttOf(eqdiscOpts)) return 'custom';
  const found = Object.entries(latencyTargets).find(([, t]) => t.rtt === rtt);
  return found === undefined ? 'custom' : (found[0] as LatencyTarget);
}

function uploadMemoryOf(eqdiscOpts: string | undefined, uploadKbit: number): UploadMemory | 'custom' {
  const limit = optValue(eqdiscOpts, 'memlimit');
  if (limit === undefined) return 'auto';
  return limit === String(lowMemlimit(uploadKbit)) ? 'low' : 'custom';
}

async function loadSqm(): Promise<SqmData> {
  const [sqm, firewall, interfaces, devices, milkflint] = await Promise.all([
    getConfig('sqm').catch(() => undefined),
    getConfig('firewall'),
    getInterfaces(),
    getDevices(),
    getConfig('milkflint').catch(() => undefined),
  ]);
  const wan = interfaces.find((i) => i.interface === 'wan');
  const wanDevice = wan?.l3_device ?? wan?.device;
  // the internet port's queue: Guest Wi-Fi's speed limit is one too
  const queue = sqm?.find((s) => s['.type'] === 'queue' && !isGuestShaper(str(s, 'interface')) && !isVpnShaper(str(s, 'interface')));
  const defaults = firewall.find((s) => s['.type'] === 'defaults');

  const form: SqmForm = {
    section: queue?.['.name'],
    enabled: bool(queue, 'enabled'),
    device: str(queue, 'interface') ?? wanDevice ?? 'eth1',
    downloadMbit: String(Number(str(queue, 'download') ?? '0') / 1000),
    uploadMbit: String(Number(str(queue, 'upload') ?? '0') / 1000),
    prioritise: str(queue, 'script') === 'layer_cake.qos',
    link: presetOf(queue),
    latency: latencyOf(str(queue, 'iqdisc_opts'), str(queue, 'eqdisc_opts')),
    uploadMemory: uploadMemoryOf(str(queue, 'eqdisc_opts'), Number(str(queue, 'upload') ?? '0')),
    perDevice: words(str(queue, 'iqdisc_opts')).includes('dual-dsthost') && words(str(queue, 'eqdisc_opts')).includes('dual-srchost'),
    // on unless turned off: MilkFlint's default (uci-defaults sets use_mq once)
    multiQueue: queue === undefined || bool(queue, 'use_mq'),
    offloadOff: false,
  };
  return {
    form,
    devices: Object.keys(devices).filter((d) => d !== 'lo' && !d.startsWith('ifb') && !d.startsWith('br-') && !d.startsWith('phy')),
    wanDevice,
    offloading:
      defaults === undefined
        ? undefined
        : {
            section: defaults['.name'],
            software: bool(defaults, 'flow_offloading'),
            hardware: bool(defaults, 'flow_offloading_hw'),
          },
    installed: sqm !== undefined,
    iqdiscOpts: str(queue, 'iqdisc_opts'),
    eqdiscOpts: str(queue, 'eqdisc_opts'),
    mpu: str(queue, 'tcMPU'),
    whole: wholeSetting(str(milkflint?.find((s) => s['.name'] === 'gro'), 'whole')),
  };
}

function validate(f: SqmForm): Partial<Record<'downloadMbit' | 'uploadMbit', string>> {
  const e: Partial<Record<'downloadMbit' | 'uploadMbit', string>> = {};
  if (!f.enabled) return e;
  for (const key of ['downloadMbit', 'uploadMbit'] as const) {
    const v = Number(f[key]);
    if (!Number.isFinite(v) || v <= 0) e[key] = 'Enter your line speed in Mbit/s, e.g. 450.';
    else if (v > 10_000) e[key] = 'That’s more than 10 Gbit/s.';
  }
  return e;
}

function toChanges(f: SqmForm, data: SqmData): Change[] {
  const preset: LinkPresetDef | undefined = f.link === 'custom' ? undefined : linkPresets[f.link];
  const download = Math.round(Number(f.downloadMbit) * 1000);
  const upload = Math.round(Number(f.uploadMbit) * 1000);
  const values: Record<string, string> = {
    enabled: f.enabled ? '1' : '0',
    interface: f.device,
    download: String(download),
    upload: String(upload),
    qdisc: 'cake',
    script: f.prioritise ? 'layer_cake.qos' : 'piece_of_cake.qos',
    use_mq: f.multiQueue ? '1' : '0',
    ...(preset === undefined ? {} : { linklayer: preset.linklayer, overhead: preset.overhead }),
    // LuCI keeps tcMPU only in its advanced link-layer mode
    ...(preset?.mpu === undefined ? {} : { tcMPU: preset.mpu, linklayer_advanced: '1' }),
  };
  // the keywords this page sets in both directions' opts; Custom keeps LuCI's
  const both = { managed: [] as string[], wanted: [] as string[] };
  if (preset !== undefined) {
    both.managed.push('ptm');
    if (preset.ptm === true) both.wanted.push('ptm');
  }
  if (f.latency !== 'custom') {
    both.managed.push(...RTT);
    const rtt = latencyTargets[f.latency].rtt;
    if (rtt !== undefined) both.wanted.push('rtt', rtt);
  }
  const memory = { managed: f.uploadMemory === 'custom' ? [] : ['memlimit'], wanted: [] as string[] };
  if (f.uploadMemory === 'low') memory.wanted.push('memlimit', String(lowMemlimit(upload)));
  const opts = {
    iqdisc_opts: withOpts(
      data.iqdiscOpts,
      [...FAIR_INGRESS, ...GSO, ...both.managed],
      [...(f.perDevice ? FAIR_INGRESS : []), ...(takesWhole(download, data.whole) ? ['no-split-gso'] : []), ...both.wanted],
    ),
    eqdisc_opts: withOpts(
      data.eqdiscOpts,
      [...FAIR_EGRESS, ...both.managed, ...memory.managed],
      [...(f.perDevice ? FAIR_EGRESS : []), ...both.wanted, ...memory.wanted],
    ),
  };
  const unset: string[] = [];
  for (const [key, value] of Object.entries(opts)) {
    if (value !== '') values[key] = value;
    else unset.push(key);
  }
  // LuCI shows these options only in its advanced mode
  if (unset.length < 2) Object.assign(values, { qdisc_advanced: '1', qdisc_really_really_advanced: '1' });
  const changes: Change[] =
    f.section === undefined
      ? [{ op: 'add', config: 'sqm', type: 'queue', name: 'wan', values }]
      : [{ op: 'set', config: 'sqm', section: f.section, values }];
  const wasSet = unset.filter((key) => (key === 'iqdisc_opts' ? data.iqdiscOpts : data.eqdiscOpts) !== undefined);
  // a preset without an mpu: sqm's default (none)
  if (preset !== undefined && preset.mpu === undefined && data.mpu !== undefined) wasSet.push('tcMPU');
  if (wasSet.length > 0 && f.section !== undefined) {
    changes.push({ op: 'unset', config: 'sqm', section: f.section, options: wasSet });
  }
  // hardware offloading only: CAKE still shapes software-offloaded packets
  if (f.offloadOff && data.offloading !== undefined) {
    changes.push({
      op: 'set',
      config: 'firewall',
      section: data.offloading.section,
      values: { flow_offloading_hw: '0' },
    });
  }
  return changes;
}

const tinNames: Record<string, string[]> = {
  besteffort: ['All traffic'],
  diffserv3: ['Bulk', 'Best effort', 'Voice'],
  diffserv4: ['Bulk', 'Best effort', 'Video', 'Voice'],
  diffserv8: ['Tin 0', 'Tin 1', 'Tin 2', 'Tin 3', 'Tin 4', 'Tin 5', 'Tin 6', 'Tin 7'],
};

// One direction of shaping: a plain cake, or a cake_mq root with its
// per-transmit-queue cakes. `rates` is each queue's current bit rate, and
// `cpus` the CPU each one runs on when an RSS ring feeds it.
interface Direction {
  dev: string;
  download: boolean;
  root: CakeQdisc;
  queues: CakeQdisc[];
  rates: (number | undefined)[];
  cpus: (number | undefined)[];
}

interface Live {
  directions: Direction[];
  net: NetworkLive;
}

function directionsOf(qdiscs: CakeQdisc[]): Omit<Direction, 'rates' | 'cpus'>[] {
  const out: Omit<Direction, 'rates' | 'cpus'>[] = [];
  for (const root of qdiscs) {
    if (root.kind === 'cake_mq') {
      const major = root.handle ?? '';
      const minor = (q: CakeQdisc): number => parseInt(q.parent?.split(':')[1] ?? '0', 16);
      const queues = qdiscs
        .filter((q) => q.kind === 'cake' && q.dev === root.dev && q.parent?.startsWith(major) === true)
        .sort((a, b) => minor(a) - minor(b));
      out.push({ dev: root.dev, download: root.dev.startsWith('ifb'), root, queues });
    } else if (root.parent === undefined) {
      out.push({ dev: root.dev, download: root.dev.startsWith('ifb'), root, queues: [root] });
    }
  }
  return out.sort((a, b) => Number(b.download) - Number(a.download));
}

function delayMs(us: number | undefined): string {
  return us === undefined ? '—' : `${(us / 1000).toFixed(1)} ms`;
}

/** a cake's busiest tin: its delays are the queue's */
function busiestTin(q: CakeQdisc): CakeTin | undefined {
  return (q.tins ?? []).reduce<CakeTin | undefined>((best, t) => ((t.sent_bytes ?? 0) > (best?.sent_bytes ?? -1) ? t : best), undefined);
}

function QueueStats({ d }: { d: Direction }): ReactElement {
  const bandwidth = typeof d.root.options?.bandwidth === 'number' ? d.root.options.bandwidth * 8 : undefined;
  const names = tinNames[d.root.options?.diffserv ?? 'besteffort'] ?? [];
  const tins = d.queues.flatMap((q) => q.tins ?? []);
  const sum = (key: 'drops' | 'ecn_mark' | 'sparse_flows' | 'bulk_flows'): number =>
    tins.reduce((n, t) => n + (t[key] ?? 0), 0);
  // the delays of each queue's busiest tin; the worst queue's are shown
  const busiest = d.queues.map(busiestTin);
  const worst = (key: 'avg_delay_us' | 'peak_delay_us'): number | undefined =>
    busiest.reduce<number | undefined>((m, t) => (t?.[key] === undefined ? m : Math.max(m ?? 0, t[key])), undefined);
  const multi = d.root.kind === 'cake_mq';
  const total = d.rates.reduce<number>((n, r) => n + (r ?? 0), 0);
  const inUse = d.rates.filter((r) => r !== undefined && r > 0).length;
  // per-tin delays, for layer_cake: a single queue's own
  const tinRow = d.queues.length === 1 ? (d.queues[0]?.tins ?? []) : [];

  return (
    <div className="rounded-lg border bg-background/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium">
          {d.download ? <ArrowDownIcon className="size-4 text-chart-2" /> : <ArrowUpIcon className="size-4 text-chart-1" />}
          {d.download ? 'Download' : 'Upload'}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {d.dev} · {bandwidth === undefined ? 'unlimited' : formatBitrate(bandwidth)}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Avg queue delay</dt>
          <dd className="font-medium tabular">{delayMs(worst('avg_delay_us'))}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Peak delay</dt>
          <dd className="font-medium tabular">{delayMs(worst('peak_delay_us'))}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Dropped / ECN-marked</dt>
          <dd className="font-medium tabular">
            {formatNumber(sum('drops'))} / {formatNumber(sum('ecn_mark'))}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Active flows</dt>
          <dd className="font-medium tabular">{formatNumber(sum('sparse_flows') + sum('bulk_flows'))}</dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-col gap-1.5">
        <div className="flex justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {multi
              ? `${String(d.queues.length)} queues · ${d.rates.every((r) => r === undefined) ? '—' : String(inUse)} carrying traffic`
              : 'One queue'}
          </span>
          <span className="tabular">{d.rates.every((r) => r === undefined) ? '—' : formatBitrate(total)}</span>
        </div>
        {multi && d.queues.length <= 8 ? (
          <div className="flex flex-col gap-1">
            {d.queues.map((q, i) => {
              const rate = d.rates[i];
              const share = rate === undefined || total <= 0 ? 0 : (rate / total) * 100;
              const cpu = d.cpus[i];
              const delay = busiestTin(q)?.avg_delay_us;
              return (
                <div key={queueKey(q)} className="grid grid-cols-[5.5rem_1fr_5.5rem] items-center gap-x-3 text-xs">
                  <span className="flex flex-col leading-tight">
                    <span>Queue {parseInt(q.parent?.split(':')[1] ?? '0', 16)}</span>
                    <span className="text-muted-foreground">{cpu === undefined ? 'any CPU' : `CPU ${String(cpu)}`}</span>
                  </span>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('h-full rounded-full transition-all duration-500', d.download ? 'bg-chart-2' : 'bg-chart-1')}
                      style={{ width: `${String(share)}%` }}
                    />
                  </div>
                  <span className="flex flex-col text-right leading-tight tabular">
                    <span>{rate === undefined ? '—' : formatBitrate(rate)}</span>
                    <span className="text-muted-foreground">{delayMs(delay)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex gap-1">
            {d.queues.map((q, i) => {
              const rate = d.rates[i];
              const share = rate === undefined || total <= 0 ? 0 : (rate / total) * 100;
              const label = multi ? `Queue ${String(parseInt(q.parent?.split(':')[1] ?? '0', 16))}` : 'Queue';
              return (
                <div
                  key={queueKey(q)}
                  title={`${label}: ${rate === undefined ? '—' : formatBitrate(rate)}`}
                  className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className={cn('h-full rounded-full', d.download ? 'bg-chart-2' : 'bg-chart-1')}
                    style={{ width: `${String(share)}%` }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
      {tinRow.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tinRow.map((t, i) => (
            <Badge key={i} variant="secondary" className="font-normal tabular">
              {names[i] ?? `Tin ${String(i)}`}: {delayMs(t.avg_delay_us)}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function useLive(): { data: Live | undefined; error: unknown } {
  const { data, error } = useNetworkLive(2000);
  if (data === undefined) return { data: undefined, error };
  const cpuOf = new Map(data.queues.map((q) => [q.key, q.cpu]));
  const directions = directionsOf(data.qdiscs.filter((q) => !isGuestShaper(q.dev) && !isVpnShaper(q.dev))).map((d) => ({
    ...d,
    rates: d.queues.map((q) => data.rates.get(queueKey(q))),
    cpus: d.queues.map((q) => cpuOf.get(queueKey(q))),
  }));
  return { data: { directions, net: data }, error };
}

function LiveStatus({ live }: { live: { data: Live | undefined; error: unknown } }): ReactElement {
  const { data, error } = live;
  const directions = data?.directions ?? [];
  return (
    <Card>
      <CardHeading
        icon={ActivityIcon}
        title="Live"
        description="CAKE's own statistics, every 2 s"
        action={
          <Badge variant={directions.length > 0 ? 'success' : 'secondary'}>{directions.length > 0 ? 'Shaping' : 'Not running'}</Badge>
        }
      />
      <CardContent className="flex flex-col gap-3">
        {error !== undefined && data === undefined && (
          <p className="text-sm text-muted-foreground">Statistics aren&apos;t available on this router.</p>
        )}
        {directions.length === 0 && data !== undefined && (
          <p className="text-sm text-muted-foreground">
            No CAKE queue is installed. Turn Smart Queue on and save to start shaping.
          </p>
        )}
        {directions.map((d) => (
          <QueueStats key={d.dev} d={d} />
        ))}
      </CardContent>
    </Card>
  );
}

// What each CPU is doing: the Ethernet's rings, Smart Queue's queues and
// the Wi-Fi driver, lane by lane (the same view as Performance Tuning).
function Processors({ live }: { live: { data: Live | undefined; error: unknown } }): ReactElement | null {
  const net = live.data?.net;
  if (net === undefined) return null;
  const working = net.cpus.filter((c) => c.network !== undefined && c.network >= 0.05).length;
  return (
    <Card>
      <CardHeading
        icon={CpuIcon}
        title="Processors"
        description="Which CPU runs each queue, every 2 s"
        action={
          net.cpus.some((c) => c.network !== undefined) && (
            <Badge variant="secondary" className="tabular">
              {working} of {net.cpus.length} on network work
            </Badge>
          )
        }
      />
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{pathSentence(net)}</p>
        <CpuLanes live={net} />
      </CardContent>
    </Card>
  );
}

export function SqmPage(): ReactElement {
  const { data, error, loading, reload } = useLoad(loadSqm);
  const [edit, setEdit] = useState<SqmForm>();
  const onApplied = useCallback(() => {
    setEdit(undefined);
    reload();
  }, [reload]);
  const { state, apply } = useApply(onApplied);
  const live = useLive();
  const form = edit ?? data?.form;
  const errors = form === undefined ? {} : validate(form);
  // Functional update: several edits in one render can't overwrite each other.
  const set = <K extends keyof SqmForm>(key: K, value: SqmForm[K]): void => {
    setEdit((current) => {
      const base = current ?? data?.form;
      return base === undefined ? undefined : { ...base, [key]: value };
    });
  };
  const dirty = edit !== undefined && JSON.stringify(edit) !== JSON.stringify(data?.form);
  // Hardware offloading forwards connections in the Ethernet's PPE, past CAKE. Software offloading's
  // fast path still goes through the qdiscs, and MilkFlint's kernel keeps CAKE's per-device fairness
  // with it.
  const offloadOn = data?.offloading?.hardware === true;

  return (
    <>
      <PageHeader
        title="Smart Queue"
        description="Keeps latency low when the line is busy: SQM with CAKE shapes traffic just below your line speed, so queues build on the router, where CAKE keeps them short and fair."
      />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading || form === undefined || data === undefined ? (
          <FormSkeleton />
        ) : (
          <>
            {!data.installed && (
              <Alert variant="warning">
                <TriangleAlertIcon />
                <AlertTitle>SQM isn&apos;t installed</AlertTitle>
                <AlertDescription>The sqm-scripts package is missing from this firmware image.</AlertDescription>
              </Alert>
            )}
            {offloadOn && form.enabled && !form.offloadOff && (
              <Alert variant="warning">
                <TriangleAlertIcon />
                <AlertTitle>Hardware flow offloading bypasses Smart Queue</AlertTitle>
                <AlertDescription>
                  Hardware flow offloading is on: once a connection is offloaded, the Ethernet forwards its packets
                  itself and CAKE never sees them, so shaping won&apos;t work. Software offloading is fine with Smart
                  Queue. Turn hardware offloading off to use Smart Queue.
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => {
                      set('offloadOff', true);
                    }}
                  >
                    Turn hardware offloading off when I save
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <div className="grid items-start gap-4 xl:grid-cols-[1fr_28rem]">
              <Card>
                <CardHeader className="items-center">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <GaugeIcon className="size-4" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <CardTitle className="text-base">Smart Queue</CardTitle>
                    <CardDescription>
                      Set about 90% of your line&apos;s measured speeds, tested with Smart Queue off.
                    </CardDescription>
                  </div>
                  <Switch
                    className="ml-auto"
                    checked={form.enabled}
                    onCheckedChange={(v) => {
                      set('enabled', v);
                    }}
                    aria-label="Smart Queue on"
                  />
                </CardHeader>
                <CardContent className="divide-y">
                  <Field id="downloadMbit" label="Download speed" hint="Mbit/s" error={errors.downloadMbit}>
                    <Input
                      id="downloadMbit"
                      inputMode="decimal"
                      className="font-mono"
                      value={form.downloadMbit}
                      aria-invalid={errors.downloadMbit !== undefined}
                      onChange={(e) => {
                        set('downloadMbit', e.target.value.trim());
                      }}
                    />
                  </Field>
                  <Field id="uploadMbit" label="Upload speed" hint="Mbit/s" error={errors.uploadMbit}>
                    <Input
                      id="uploadMbit"
                      inputMode="decimal"
                      className="font-mono"
                      value={form.uploadMbit}
                      aria-invalid={errors.uploadMbit !== undefined}
                      onChange={(e) => {
                        set('uploadMbit', e.target.value.trim());
                      }}
                    />
                  </Field>
                  <Field
                    id="mode"
                    label="Mode"
                    hint={
                      form.prioritise
                        ? 'Calls and games go ahead of downloads and backups (CAKE diffserv tins).'
                        : 'One fair queue for everything. Best for most homes.'
                    }
                  >
                    <Select
                      value={form.prioritise ? 'layer' : 'simple'}
                      onValueChange={(v) => {
                        set('prioritise', v === 'layer');
                      }}
                    >
                      <SelectTrigger id="mode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="simple">Simple (piece_of_cake)</SelectItem>
                        <SelectItem value="layer">Prioritise by traffic type (layer_cake)</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field id="link" label="Connection type" hint="So shaping accounts for each packet's overhead on your line.">
                    <Select
                      value={form.link}
                      onValueChange={(v) => {
                        set('link', v as LinkPreset | 'custom');
                      }}
                    >
                      <SelectTrigger id="link">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(linkPresets).map(([key, p]) => (
                          <SelectItem key={key} value={key}>
                            {p.label}
                            {p.linklayer !== 'none' && ` · ${p.overhead} bytes`}
                          </SelectItem>
                        ))}
                        {form.link === 'custom' && <SelectItem value="custom">Custom (set in LuCI)</SelectItem>}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field
                    id="latency"
                    label="Latency target"
                    hint="Calls, games and other small flows go first at any setting. Low asks big downloads and uploads to slow down sooner, so their queues stay shorter, for a little less speed (CAKE's rtt)."
                  >
                    <Select
                      value={form.latency}
                      onValueChange={(v) => {
                        set('latency', v as LatencyTarget | 'custom');
                      }}
                    >
                      <SelectTrigger id="latency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(latencyTargets).map(([key, t]) => (
                          <SelectItem key={key} value={key}>
                            {t.label}
                          </SelectItem>
                        ))}
                        {form.latency === 'custom' && <SelectItem value="custom">Custom (set in LuCI)</SelectItem>}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field
                    id="uploadMemory"
                    label="Upload queue memory"
                    hint={
                      form.uploadMemory === 'low'
                        ? 'A device starting a fast upload fills less of the queue before CAKE drops some of its packets, so that upload waits less (CAKE’s memlimit).'
                        : 'How much an upload can queue before CAKE drops packets. Automatic is CAKE’s own limit (CAKE’s memlimit).'
                    }
                  >
                    <Select
                      value={form.uploadMemory}
                      onValueChange={(v) => {
                        set('uploadMemory', v as UploadMemory | 'custom');
                      }}
                    >
                      <SelectTrigger id="uploadMemory">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Automatic</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                        {form.uploadMemory === 'custom' && <SelectItem value="custom">Custom (set in LuCI)</SelectItem>}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field
                    id="perDevice"
                    label="Fair share per device"
                    hint="One device's downloads can't crowd out the others (CAKE's per-host isolation behind NAT)."
                  >
                    <Switch
                      id="perDevice"
                      checked={form.perDevice}
                      onCheckedChange={(v) => {
                        set('perDevice', v);
                      }}
                    />
                  </Field>
                  <Field
                    id="multiQueue"
                    label="Multi-queue"
                    hint={
                      <>
                        Splits CAKE into one queue per network-card queue, sharing your speeds by what each needs, so more than one CPU can
                        shape at once (cake_mq). With RSS (Performance Tuning), each receive ring feeds its own download queue on its own
                        CPU. Upload stays one CAKE on the Flint 2: its Ethernet sends everything on one queue.
                        {live.data !== undefined && live.data.net.rss?.spreading !== true && form.multiQueue && (
                          <span className="mt-1 block text-warning">
                            RSS isn’t spreading downloads now, so they all use one queue
                            {live.data.net.rps.length > 0 ? `, and packet steering spreads the rest over ${cpuText(live.data.net.rps)}` : ''}.
                          </span>
                        )}
                      </>
                    }
                  >
                    <Switch
                      id="multiQueue"
                      checked={form.multiQueue}
                      onCheckedChange={(v) => {
                        set('multiQueue', v);
                      }}
                    />
                  </Field>
                  <Field id="device" label="Interface" hint="Where to shape: your internet (WAN) port.">
                    <Select
                      value={form.device}
                      onValueChange={(v) => {
                        set('device', v);
                      }}
                    >
                      <SelectTrigger id="device">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[...new Set([form.device, ...data.devices])].map((d) => (
                          <SelectItem key={d} value={d}>
                            {d}
                            {d === data.wanDevice && ' (WAN)'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </CardContent>
              </Card>
              <div className="flex flex-col gap-4">
                <LiveStatus live={live} />
                <Processors live={live} />
              </div>
            </div>
          </>
        )}
      </div>
      <SaveBar
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={Object.keys(errors).length > 0}
        onSave={() => {
          if (form !== undefined && data !== undefined) void apply(toChanges(form, data));
        }}
        onRevert={() => {
          setEdit(undefined);
        }}
      />
    </>
  );
}
