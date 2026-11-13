import { ActivityIcon, ArrowDownIcon, ArrowUpIcon, CpuIcon, GaugeIcon, InfoIcon, SlidersHorizontalIcon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, useCallback, useEffect, useState } from 'react';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { type NetworkLive, queueKey, useNetworkLive } from '@/hooks/use-network-live';
import { getDevices, getInterfaces } from '@/lib/api/network';
import type { CakeQdisc, CakeTin } from '@/lib/api/stats';
import { getConfig } from '@/lib/api/uci';
import { formatBitrate, formatNumber } from '@/lib/format';
import { cpuText, pathSentence } from '@/lib/network-text';
import { cn } from '@/lib/utils';
import { isVpnShaper } from '../vpn-client/sections';
import { isGuestShaper } from '../wifi-guest/guest';
import { ACK_FILTER_RATIO, type AckFilter, suggestsAckFilter } from './ack-filter';
import { advancedData } from './advanced';
import { AdvancedSheet } from './advanced-sheet';
import {
  type LatencyTarget,
  type LinkGap,
  type LinkPreset,
  isPppoeDevice,
  latencyTargets,
  linkPresets,
  presetOverhead,
  type SqmData,
  type SqmErrors,
  type SqmForm,
  sqmData,
  toChanges,
  type UploadMemory,
  validate,
} from './model';
import { MULTI_QUEUE_KBIT, type MultiQueue, usesMultiQueue } from './multi-queue';
import { shapingProblems } from './running';

async function loadSqm(): Promise<SqmData> {
  const [sqm, firewall, interfaces, devices, milkflint] = await Promise.all([
    getConfig('sqm').catch(() => undefined),
    getConfig('firewall'),
    getInterfaces(),
    getDevices(),
    getConfig('milkflint').catch(() => undefined),
  ]);
  const wan = interfaces.find((i) => i.interface === 'wan');
  return sqmData({ sqm, firewall, milkflint, wanDevice: wan?.l3_device ?? wan?.device, wanProto: wan?.proto, devices: Object.keys(devices) });
}

/** What the Connection type's choice has instead, when it's near a preset (./model.ts), for a queue on this device */
function gapText(gap: LinkGap, device: string): string {
  switch (gap) {
    case 'mpu':
      return 'no smallest packet size';
    case 'ptm':
      return 'no PTM';
    case 'overhead':
      return isPppoeDevice(device) ? 'the internet port’s overhead, short on a PPPoE session' : 'a PPPoE session’s overhead';
    case 'mechanism':
      return 'tc’s size table instead of CAKE’s own (in LuCI)';
  }
}

/** a problem once it has lasted this long: a save restarts Smart Queue, which takes a few seconds */
const SETTLE_MS = 10_000;

/** value once it has stayed the same for ms; undefined until then */
function useLasting(value: string | undefined, ms: number): string | undefined {
  const [lasting, setLasting] = useState<string>();
  useEffect(() => {
    const t = window.setTimeout(
      () => {
        setLasting(value);
      },
      value === undefined ? 0 : ms,
    );
    return () => {
      window.clearTimeout(t);
    };
  }, [value, ms]);
  return value === lasting ? value : undefined;
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

function LiveStatus({ live, problems }: { live: { data: Live | undefined; error: unknown }; problems: string[] }): ReactElement {
  const { data, error } = live;
  const directions = data?.directions ?? [];
  return (
    <Card>
      <CardHeading
        icon={ActivityIcon}
        title="Live"
        description="CAKE's own statistics, every 2 s"
        action={
          problems.length > 0 ? (
            <Badge variant="destructive">Not as saved</Badge>
          ) : (
            <Badge variant={directions.length > 0 ? 'success' : 'secondary'}>{directions.length > 0 ? 'Shaping' : 'Not running'}</Badge>
          )
        }
      />
      <CardContent className="flex flex-col gap-3">
        {error !== undefined && data === undefined && (
          <p className="text-sm text-muted-foreground">Statistics aren&apos;t available on this router.</p>
        )}
        {problems.length > 0 && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Smart Queue isn&apos;t running as saved</AlertTitle>
            <AlertDescription>
              {problems.map((p) => (
                <span key={p}>{p}</span>
              ))}
              <span>
                sqm-scripts may have failed to start CAKE with these settings: the{' '}
                <a href="#/logs" className="font-medium text-foreground underline underline-offset-2">
                  Logs
                </a>{' '}
                have its messages.
              </span>
            </AlertDescription>
          </Alert>
        )}
        {directions.length === 0 && data !== undefined && problems.length === 0 && (
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

// The header's way into the advanced sheet; why it can't open, when it can't
function AdvancedButton({ why, onClick }: { why: string | undefined; onClick: () => void }): ReactElement {
  // aria-disabled rather than disabled: a disabled button gets no pointer events, so no tooltip
  const button = (
    <Button
      variant="outline"
      size="sm"
      aria-disabled={why !== undefined}
      className={cn(why !== undefined && 'cursor-not-allowed opacity-50')}
      onClick={() => {
        if (why === undefined) onClick();
      }}
    >
      <SlidersHorizontalIcon />
      Advanced
    </Button>
  );
  if (why === undefined) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{why}</TooltipContent>
    </Tooltip>
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
  const [advanced, setAdvanced] = useState(false);
  const live = useLive();
  const form = edit ?? data?.form;
  const errors: SqmErrors = form === undefined || data === undefined ? {} : validate(form, data);
  // what tc runs against what's saved, once it has lasted past a restart
  const running = live.data === undefined || data === undefined ? [] : shapingProblems(data.queue, live.data.net.qdiscs);
  const problems = useLasting(running.length === 0 ? undefined : running.join('\n'), SETTLE_MS)?.split('\n') ?? [];
  // Functional update: several edits in one render can't overwrite each other.
  const set = <K extends keyof SqmForm>(key: K, value: SqmForm[K]): void => {
    setEdit((current) => {
      const base = current ?? data?.form;
      return base === undefined ? undefined : { ...base, [key]: value };
    });
  };
  const dirty = edit !== undefined && JSON.stringify(edit) !== JSON.stringify(data?.form);
  // the download speed being edited, and whether it gets multi-queue CAKE
  const downloadKbit = Math.round(Number(form?.downloadMbit ?? '0') * 1000);
  const multiQueueOn = form !== undefined && usesMultiQueue(downloadKbit, form.multiQueue);
  // Hardware offloading forwards connections in the Ethernet's PPE, past CAKE. Software offloading's
  // fast path still goes through the qdiscs, and MilkFlint's kernel keeps CAKE's per-device fairness
  // with it.
  const offloadOn = data?.offloading?.hardware === true;
  // the suggestion's button: picks out the setting for a moment
  const [showAckFilter, setShowAckFilter] = useState(false);
  useEffect(() => {
    if (!showAckFilter) return undefined;
    const t = window.setTimeout(() => {
      setShowAckFilter(false);
    }, 2000);
    return () => {
      window.clearTimeout(t);
    };
  }, [showAckFilter]);

  return (
    <>
      <PageHeader
        title="Smart Queue"
        description="Keeps latency low when the line is busy: SQM with CAKE shapes traffic just below your line speed, so queues build on the router, where CAKE keeps them short and fair."
        actions={
          <AdvancedButton
            why={
              data === undefined
                ? 'Loading…'
                : data.queue === undefined
                  ? 'Turn Smart Queue on and save first.'
                  : dirty
                    ? 'Save or revert the changes on this page first.'
                    : state.phase === 'applying'
                      ? 'Saving…'
                      : undefined
            }
            onClick={() => {
              setAdvanced(true);
            }}
          />
        }
      />
      {advanced && data?.queue !== undefined && (
        <AdvancedSheet
          data={advancedData(data.queue, data.milkflint)}
          onClose={() => {
            setAdvanced(false);
          }}
          onSave={(changes) => {
            setAdvanced(false);
            void apply(changes);
          }}
        />
      )}
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
            {form.enabled && data.pppoe !== undefined && form.device !== data.pppoe && (
              <Alert variant="warning">
                <TriangleAlertIcon />
                <AlertTitle>Smart Queue shapes the port under PPPoE</AlertTitle>
                <AlertDescription>
                  Your internet connection is PPPoE, but Smart Queue shapes {form.device}, where CAKE sees only PPPoE frames and can&apos;t
                  read the packets inside them: Fair share per device, ECN marks, the upload ACK filter and priorities don&apos;t work there.
                  The session&apos;s own device, {data.pppoe}, carries the same traffic as plain IP packets.
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => {
                      if (data.pppoe !== undefined) set('device', data.pppoe);
                    }}
                  >
                    Shape {data.pppoe} instead
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
                  {form.enabled && form.ackFilter === 'off' && suggestsAckFilter(form.downloadMbit, form.uploadMbit) && (
                    <div className="py-3">
                      <Alert variant="info">
                        <InfoIcon />
                        <AlertTitle>Try the upload ACK filter</AlertTitle>
                        <AlertDescription>
                          Your download is over {ACK_FILTER_RATIO} times your upload, so the acknowledgements downloads send back can fill the upload and
                          hold them back.
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            onClick={() => {
                              const select = document.getElementById('ackFilter');
                              select?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              select?.focus({ preventScroll: true });
                              setShowAckFilter(true);
                            }}
                          >
                            Show the upload ACK filter
                          </Button>
                        </AlertDescription>
                      </Alert>
                    </div>
                  )}
                  <Field
                    id="mode"
                    label="Mode"
                    hint={
                      !form.prioritise
                        ? 'One fair queue for everything. Best for most homes.'
                        : form.restoreDscp || data.squash.squash_ingress === '0'
                          ? 'Calls and games go ahead of downloads and backups, both ways (CAKE diffserv tins).'
                          : 'Calls and games go ahead of other uploads (CAKE diffserv tins). Downloads arrive with your provider’s marks, which mean nothing here: they get tins with Keep devices’ priorities on downloads.'
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
                  <Field
                    id="link"
                    label="Connection type"
                    hint={
                      <>
                        So shaping accounts for each packet&apos;s overhead on your line.
                        {form.link === 'none' && (
                          <span className="mt-1 block text-warning">
                            No compensation counts every packet as smaller than the line carries it, small ones such as acknowledgements
                            most of all, so the queue builds up in your modem instead. Choose your connection type: Fibre / Ethernet if
                            you&apos;re not sure.
                          </span>
                        )}
                        {form.link === 'custom' && data.form.link === 'custom' && data.linkNear !== undefined && (
                          <span className="mt-1 block text-warning">
                            {linkPresets[data.linkNear.preset].label} with {data.linkNear.gaps.map((g) => gapText(g, data.form.device)).join(', ')}: choose{' '}
                            {linkPresets[data.linkNear.preset].label} again to set it as this page does.
                          </span>
                        )}
                      </>
                    }
                  >
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
                            {p.linklayer === 'none' ? `${p.label} (not recommended)` : `${p.label} · ${presetOverhead(p, form.device)} bytes`}
                          </SelectItem>
                        ))}
                        {form.link === 'custom' && (
                          <SelectItem value="custom">
                            {data.linkNear === undefined ? 'Custom: see Advanced' : `Custom: near ${linkPresets[data.linkNear.preset].label}`}
                          </SelectItem>
                        )}
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
                        {form.latency === 'custom' && <SelectItem value="custom">Custom: see Advanced</SelectItem>}
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
                        {form.uploadMemory === 'custom' && <SelectItem value="custom">Custom: see Advanced</SelectItem>}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field
                    id="ackFilter"
                    label="Upload ACK filter"
                    className={cn('rounded-md transition-colors duration-500', showAckFilter && 'bg-info/15')}
                    hint={`Drops acknowledgements a newer one has replaced, so they take less of the upload and downloads keep their speed. Helps when your download is over ${String(ACK_FILTER_RATIO)} times your upload (CAKE's ack-filter).`}
                  >
                    <Select
                      value={form.ackFilter}
                      onValueChange={(v) => {
                        set('ackFilter', v as AckFilter);
                      }}
                    >
                      <SelectTrigger id="ackFilter">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="off">Off</SelectItem>
                        <SelectItem value="on">On</SelectItem>
                        {form.ackFilter === 'custom' && <SelectItem value="custom">Aggressive: see Advanced</SelectItem>}
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
                    id="restoreDscp"
                    label="Keep devices’ priorities on downloads"
                    hint={
                      <>
                        Devices mark what they send as calls, video or background transfers (DSCP), but the marks don’t survive the
                        way back from the internet. This puts each connection’s mark back on its downloads, so Wi-Fi sends a
                        call’s ahead of other traffic and a backup’s behind it
                        {form.prioritise ? ', and Prioritise by traffic type applies to downloads as well' : ''}.
                        {!form.restoreDscp && data.squash.squash_dscp === '0' && (
                          <span className="mt-1 block">
                            Downloads keep your provider&apos;s marks now (set in LuCI). This needs CAKE to clear them, so they&apos;re
                            cleared, and stay so if you turn it off again.
                          </span>
                        )}
                        {!form.enabled && <span className="mt-1 block">Needs Smart Queue on.</span>}
                      </>
                    }
                  >
                    <Switch
                      id="restoreDscp"
                      checked={form.restoreDscp}
                      disabled={!form.enabled}
                      onCheckedChange={(v) => {
                        set('restoreDscp', v);
                      }}
                    />
                  </Field>
                  <Field
                    id="multiQueue"
                    label="Multi-queue"
                    error={errors.multiQueue}
                    hint={
                      <>
                        Splits CAKE into one queue per network-card queue, sharing your speeds by what each needs, so more than one CPU can
                        shape at once (cake_mq). With RSS (Performance Tuning), each receive ring feeds its own download queue on its own
                        CPU. Each queue holds its packets to its own share of the speed, so a packet can wait a little longer than in one
                        CAKE, and more so on a slower line, which one CPU shapes easily: Automatic uses it from{' '}
                        {MULTI_QUEUE_KBIT / 1000} Mbit/s of download. Upload stays one CAKE on the Flint 2: its Ethernet sends everything on
                        one queue.
                        {live.data !== undefined && live.data.net.rss?.spreading !== true && multiQueueOn && (
                          <span className="mt-1 block text-warning">
                            RSS isn’t spreading downloads now, so they all use one queue
                            {live.data.net.rps.length > 0 ? `, and packet steering spreads the rest over ${cpuText(live.data.net.rps)}` : ''}.
                          </span>
                        )}
                      </>
                    }
                  >
                    <Select
                      value={form.multiQueue}
                      onValueChange={(v) => {
                        set('multiQueue', v as MultiQueue);
                      }}
                    >
                      <SelectTrigger id="multiQueue">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Automatic: {usesMultiQueue(downloadKbit, 'auto') ? 'on' : 'off'} at this speed</SelectItem>
                        <SelectItem value="on">On</SelectItem>
                        <SelectItem value="off">Off</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field
                    id="device"
                    label="Interface"
                    hint={
                      data.pppoe === undefined
                        ? 'Where to shape: your internet (WAN) port.'
                        : `Where to shape: with PPPoE, the session’s own device (${data.pppoe}), where CAKE reads the packets inside it.`
                    }
                  >
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
                        {/* the WAN's device even while a PPPoE session's is down */}
                        {[...new Set([form.device, ...(data.wanDevice === undefined ? [] : [data.wanDevice]), ...data.devices])].map((d) => (
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
                <LiveStatus live={live} problems={problems} />
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
