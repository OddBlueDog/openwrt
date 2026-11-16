// The radar scan, the second tab of Nearby networks: listen for radar on the
// 5 GHz radar channels for as long as you like, block by block, and see what
// the chip makes of what it hears. The router only listens (a monitor
// interface, which sends nothing), so it breaks no radar rule; but the radio
// can only listen where it's tuned, so the 5 GHz network is off for the whole
// scan. The scan runs on the router (radar-scan, with a watchdog that brings
// 5 GHz back), so a browser on 5 GHz losing the router meanwhile doesn't
// matter: the page catches up.
import {
  ChevronRightIcon,
  CircleStopIcon,
  LoaderCircleIcon,
  SatelliteDishIcon,
  TriangleAlertIcon,
  WifiOffIcon,
} from 'lucide-react';
import { type ReactElement, type ReactNode, useMemo, useRef, useState } from 'react';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { Note } from '@/components/note';
import { LoadError } from '@/components/page-states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { usePoll } from '@/hooks/use-poll';
import { getRadar, getWirelessStatus, type Radar } from '@/lib/api/wireless';
import { href } from '@/lib/router';
import { cn, errorMessage } from '@/lib/utils';
import { describeChannels } from '../wifi/channels';
import { type ChipReport, getChipReports, getScanStatus, type ScanBlock, startScan, stopScan } from './api';
import {
  blockLabel,
  blocksOf,
  capitalize,
  type ChannelState,
  channelState,
  durations,
  MAX_S,
  MIN_S,
  minutes,
  radarSummary,
  scanPlan,
} from './model';

interface Radio {
  radio: string;
  phy: string;
  radar: Radar | undefined;
}

async function loadRadio(): Promise<Radio | null> {
  const status = await getWirelessStatus();
  const entry = Object.entries(status).find(([, r]) => r.config?.band === '5g' && r.iwinfo?.phy !== undefined);
  if (entry === undefined) return null;
  const [radio, r] = entry;
  const phy = r.iwinfo?.phy ?? '';
  return { radio, phy, radar: await getRadar(phy).catch(() => undefined) };
}

function time(unixS: number): string {
  return new Date(unixS * 1000).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function StateBadge({ state }: { state: ChannelState }): ReactElement {
  switch (state.kind) {
    case 'off-limits':
      return <Badge variant="warning">Off limits, {state.minutesLeft} min left</Badge>;
    case 'checked':
      return <Badge variant="success">No radar heard</Badge>;
    case 'unchecked':
      return <Badge variant="secondary">Not checked yet</Badge>;
  }
}

/** One of the chip's radar reports: the pattern it matched and the pulses it measured, in its own units. */
function ReportDetails({ report }: { report: ChipReport }): ReactElement {
  const [open, setOpen] = useState(false);
  const pattern = [
    report.long === 1 && 'long pulses',
    report.constant === 1 && 'a fixed rate',
    report.staggered === 1 && 'staggered rates',
  ]
    .filter((p): p is string => typeof p === 'string')
    .join(', ');
  const pulses = (report.periodic_pulses ?? 0) + (report.long_pulses ?? 0);
  const powers = report.pulses.map((p) => p.power);
  const widths = report.pulses.map((p) => p.width);
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium">Radar pattern {String(report.type ?? '?')}</span>
        {report.time !== undefined && <span className="text-xs text-muted-foreground tabular">{time(report.time)}</span>}
        {report.freq !== undefined && report.width !== undefined && report.center !== undefined && (
          <span className="text-muted-foreground">
            on {String((report.freq - 5000) / 5)} ({String(report.width)} MHz)
          </span>
        )}
      </div>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">Pulses</dt>
        <dd>
          {String(pulses)} counted{pattern === '' ? '' : `, ${pattern}`}
          {(report.hw_pulses ?? 0) > 0 ? ` (${String(report.hw_pulses)} raw)` : ''}
        </dd>
        {(report.pri_const ?? 0) > 0 && (
          <>
            <dt className="text-muted-foreground">Interval between pulses</dt>
            <dd>{String(report.pri_const)} (chip units)</dd>
          </>
        )}
        {powers.length > 0 && (
          <>
            <dt className="text-muted-foreground">Strength (pulse power)</dt>
            <dd>
              {String(Math.min(...powers))} to {String(Math.max(...powers))} (chip units, not calibrated)
            </dd>
            <dt className="text-muted-foreground">Pulse width</dt>
            <dd>
              {String(Math.min(...widths))} to {String(Math.max(...widths))} (chip units)
            </dd>
          </>
        )}
      </dl>
      {report.pulses.length > 0 && (
        <Button
          variant="link"
          size="sm"
          className="self-start px-0"
          aria-expanded={open}
          onClick={() => {
            setOpen((o) => !o);
          }}
        >
          {open ? 'Hide the pulses' : `Show the ${String(report.pulses.length)} pulses`}
        </Button>
      )}
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full max-w-md text-xs tabular">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 font-normal">List</th>
                <th className="py-1 font-normal">Start</th>
                <th className="py-1 font-normal">Width</th>
                <th className="py-1 font-normal">Power</th>
              </tr>
            </thead>
            <tbody>
              {report.pulses.map((p, i) => (
                <tr key={`${p.kind}-${String(p.start)}-${String(i)}`}>
                  <td>{p.kind}</td>
                  <td>{String(p.start)}</td>
                  <td>{String(p.width)}</td>
                  <td>{String(p.power)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const statusBadge: Record<
  ScanBlock['status'],
  { label: string; variant: 'secondary' | 'outline' | 'info' | 'success' | 'warning' | 'destructive' }
> = {
  waiting: { label: 'Waiting', variant: 'outline' },
  listening: { label: 'Listening', variant: 'info' },
  clear: { label: 'No radar heard', variant: 'success' },
  radar: { label: 'Radar heard', variant: 'warning' },
  stopped: { label: 'Stopped', variant: 'outline' },
  skipped: { label: 'Skipped', variant: 'outline' },
  failed: { label: 'Failed', variant: 'destructive' },
};

function BlockRow({ block, seconds }: { block: ScanBlock; seconds: number }): ReactElement {
  const badge = statusBadge[block.status];
  const elapsed = block.elapsed ?? 0;
  const text =
    block.status === 'clear'
      ? `Listened for ${minutes(elapsed)}: nothing the chip took for radar.`
      : block.heard_after !== undefined
        ? `Radar heard ${String(block.heard_after)} s in${
            (block.off_limits ?? []).length > 0 ? `: ${describeChannels(block.off_limits ?? [])} off limits for 30 minutes` : ''
          }. Listened for ${minutes(elapsed)} in all.`
        : block.status === 'stopped'
          ? `Stopped after ${minutes(elapsed)}, no radar heard by then.`
          : block.status === 'skipped'
            ? 'Not listened to: the scan ended first.'
            : block.status === 'failed'
              ? `The radio couldn’t be tuned there (${block.error ?? 'unknown'}).`
              : undefined;
  return (
    <li className="flex flex-col gap-2 px-5 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{blockLabel(block)}</span>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      {block.status === 'listening' && (
        <div className="flex items-center gap-3">
          <Progress value={(100 * elapsed) / seconds} className="flex-1" aria-label={`${blockLabel(block)}: listened so far`} />
          <span className="text-xs text-muted-foreground tabular">
            {String(elapsed)} / {String(seconds)} s
          </span>
        </div>
      )}
      {text !== undefined && <p className="text-sm text-muted-foreground">{text}</p>}
      {(block.reports ?? []).length > 0 && (
        <div className="flex flex-col gap-3 border-l-2 pl-3">
          {(block.reports ?? []).map((r) => (
            <ReportDetails key={r.seq} report={r} />
          ))}
        </div>
      )}
    </li>
  );
}

function LinkOn({ children }: { children: ReactNode }): ReactElement {
  return (
    <a href={href('wifi')} className="inline-flex items-center gap-0.5 font-medium link underline-offset-4">
      {children}
      <ChevronRightIcon className="size-4" aria-hidden />
    </a>
  );
}

export function RadarScanPanel(): ReactElement {
  const radioPoll = usePoll(loadRadio, 30_000);
  const radio = radioPoll.data;
  const [fast, setFast] = useState(false);
  const status = usePoll(getScanStatus, fast ? 1000 : 15_000);
  const reports = usePoll(
    () => (radio === null || radio === undefined ? Promise.resolve(null) : getChipReports(radio.phy)),
    15_000,
    radio?.phy ?? '',
  );
  const options = useMemo(() => blocksOf(radio?.radar), [radio]);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [duration, setDuration] = useState('60');
  const [custom, setCustom] = useState('90');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string>();
  const starting = useRef(false);

  const s = status.data;
  const active = s?.state === 'starting' || s?.state === 'running';
  // poll quickly while a scan runs (or the router can't be reached, which a scan can cause)
  const wantFast = active || busy || (status.error !== undefined && s !== undefined && s.state !== 'done');
  if (wantFast !== fast) setFast(wantFast);

  const seconds = duration === 'custom' ? Math.round(Number(custom)) : Number(duration);
  const chosen = options.filter((o) => picked.has(o.key));
  const plan = scanPlan(chosen.length, seconds);
  const canStart = radio !== null && radio !== undefined && plan.ok && !active;

  const start = async (): Promise<void> => {
    if (starting.current || radio === null || radio === undefined) return;
    starting.current = true;
    setBusy(true);
    setStartError(undefined);
    setConfirming(false);
    try {
      await startScan(
        radio.radio,
        radio.phy,
        chosen.map((o) => ({ freq: o.freq, width: o.width, center: o.center })),
        seconds,
      );
      status.refresh();
    } catch (err) {
      setStartError(errorMessage(err));
    } finally {
      starting.current = false;
      setBusy(false);
    }
  };

  const unreachable = status.error !== undefined && s !== undefined && s.state !== 'done';
  const blocks = s !== undefined && s.state !== 'none' ? (s.blocks ?? []) : [];

  const scanCard = blocks.length > 0 && s !== undefined && (
    <Card className="gap-0 pb-0">
      <CardHeading
        title={active ? 'Scanning' : 'Last scan'}
        status={
          <>
            {s.started === undefined ? '' : `Started ${time(s.started)}`}
            {s.seconds === undefined ? '' : `, ${minutes(s.seconds)} per block`}
            {s.ended === undefined ? '' : `; ended ${time(s.ended)}`}
            {active ? '. The 5 GHz network is off until it ends.' : '.'}
          </>
        }
        {...(active
          ? {
              action: (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void stopScan().then(() => {
                      status.refresh();
                    });
                  }}
                >
                  <CircleStopIcon />
                  Stop and bring 5 GHz back
                </Button>
              ),
            }
          : {})}
      />
      {s.error !== undefined && s.error !== null && (
        <div className="px-5 pt-3">
          <Note tone="warning" icon={<TriangleAlertIcon />}>
            {capitalize(s.error)}.
          </Note>
        </div>
      )}
      <ul className="mt-4 divide-y border-t">
        {blocks.map((b) => (
          <BlockRow key={`${String(b.freq)}-${String(b.width)}`} block={b} seconds={s.seconds ?? 60} />
        ))}
      </ul>
    </Card>
  );

  return (
    <div className="flex flex-col gap-4">
      {radioPoll.error !== undefined && radio === undefined && <LoadError error={radioPoll.error} retry={radioPoll.refresh} />}
      {radio === null && (
        <Alert>
          <WifiOffIcon />
          <AlertTitle>No 5 GHz radio</AlertTitle>
          <AlertDescription>
            <p>
              Radar channels are on 5 GHz, so the scan needs the 5 GHz radio. <LinkOn>Networks &amp; radios</LinkOn>
            </p>
          </AlertDescription>
        </Alert>
      )}
      {unreachable && (
        <Alert variant="warning" role="status">
          <WifiOffIcon />
          <AlertTitle>Can’t reach the router right now</AlertTitle>
          <AlertDescription>
            If you’re on its 5 GHz network, that’s the scan: it’s off until the scan ends. The scan carries on by itself and this
            page catches up when the router is back.
          </AlertDescription>
        </Alert>
      )}

      {/* while it runs, the scan is the answer */}
      {active && scanCard}

      {radio !== null && !active && (
        <Card className="gap-0">
          <CardHeading
            title="5 GHz radar channels"
            status={radio === undefined ? 'Reading the radio…' : radarSummary(radio.radar, options)}
          />
          {radio === undefined ? (
            <div className="px-5 pt-4">
              <Skeleton className="h-40 rounded-lg" />
            </div>
          ) : (
            <>
              {options.length > 0 && (
                <ul className="mt-4 divide-y border-y" aria-label="Blocks to listen on">
                  {options.map((o) => (
                    <li key={o.key} className="flex items-center gap-3 px-5 py-3">
                      <Switch
                        id={`block-${o.key}`}
                        aria-label={`Listen on ${blockLabel(o)}`}
                        checked={picked.has(o.key)}
                        onCheckedChange={(on) => {
                          setPicked((p) => {
                            const next = new Set(p);
                            if (on) next.add(o.key);
                            else next.delete(o.key);
                            return next;
                          });
                        }}
                      />
                      <label
                        htmlFor={`block-${o.key}`}
                        className="flex min-w-0 flex-1 cursor-pointer flex-wrap items-center justify-between gap-x-3 gap-y-1.5 sm:justify-start"
                      >
                        <span className="text-sm font-medium sm:w-56">{blockLabel(o)}</span>
                        <StateBadge state={channelState(radio.radar, o.channels)} />
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <CardContent className="flex flex-col">
                <div className="divide-y">
                  <Field id="scan-duration" label="Listen on each for">
                    <Select value={duration} onValueChange={setDuration}>
                      <SelectTrigger id="scan-duration">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {durations.map((d) => (
                          <SelectItem key={d.value} value={d.value}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  {duration === 'custom' && (
                    <Field id="scan-seconds" label="Seconds" hint={`${String(MIN_S)} to ${String(MAX_S)}.`}>
                      <Input
                        id="scan-seconds"
                        type="number"
                        inputMode="numeric"
                        min={MIN_S}
                        max={MAX_S}
                        className="w-32"
                        value={custom}
                        onChange={(e) => {
                          setCustom(e.target.value);
                        }}
                      />
                    </Field>
                  )}
                </div>
                <div className="flex flex-col gap-3 border-t pt-4">
                  {plan.ok ? (
                    <Note tone="warning" icon={<WifiOffIcon />} title={plan.text}>
                      Its devices lose it until the scan ends, then reconnect (or use 2.4 GHz meanwhile). The router only listens
                      there, sending nothing, so it keeps to the radar rules.
                    </Note>
                  ) : (
                    <p className={cn('text-sm', chosen.length > 0 ? 'text-destructive' : 'text-muted-foreground')}>{plan.text}</p>
                  )}
                  {startError !== undefined && (
                    <Note tone="destructive" icon={<TriangleAlertIcon />} title="The scan didn’t start">
                      {startError}
                    </Note>
                  )}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Button
                      disabled={!canStart || busy}
                      onClick={() => {
                        setConfirming(true);
                      }}
                    >
                      {busy ? <LoaderCircleIcon className="motion-safe:animate-spin" /> : <SatelliteDishIcon />}
                      Start scan
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Radar near homes is rare, and Wi-Fi radar detectors sometimes take noise for radar: the chip’s reports help
                      tell.
                    </p>
                  </div>
                </div>
              </CardContent>
            </>
          )}
        </Card>
      )}

      {!active && scanCard}

      <Card className="gap-0">
        <CardHeading
          title="The chip’s radar reports"
          description="Each time the Wi-Fi chip heard radar, in scans and in normal use: which of its radar patterns matched, and the pulses it measured, in its own units."
        />
        <CardContent className="flex flex-col gap-3 pt-4">
          {reports.data === undefined ? (
            <p className="text-sm text-muted-foreground">Reading them…</p>
          ) : reports.data === null ? (
            <p className="text-sm text-muted-foreground">
              This Wi-Fi driver doesn’t keep them (MilkFlint’s own driver does): radar is still detected and logged, without the
              details.
            </p>
          ) : reports.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">None since the driver last started.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {[...reports.data].reverse().map((r) => (
                <li key={r.seq} className="py-3 first:pt-0 last:pb-0">
                  <ReportDetails report={r} />
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-muted-foreground">
            The log of radar events is on <LinkOn>Networks &amp; radios</LinkOn>
          </p>
        </CardContent>
      </Card>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Turn 5 GHz off for about {minutes(plan.total)}?</DialogTitle>
            <DialogDescription>
              The router listens for radar on {chosen.length === 1 ? 'one block' : `${String(chosen.length)} blocks`},{' '}
              {minutes(plan.ok ? seconds : 0)} each, with the 5 GHz network off. Devices on it lose it until the scan ends; if
              this browser is one of them, the page catches up afterwards. You can stop the scan early.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => void start()}>Start scan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
