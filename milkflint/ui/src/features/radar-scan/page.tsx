// DFS Radar Scan: listen for radar on the 5 GHz radar channels for as long
// as you like, block by block, and see what the chip makes of what it hears.
// The router only listens (a monitor interface, which sends nothing), so it
// breaks no radar rule; but the radio can only listen where it's tuned, so
// the 5 GHz network is off for the whole scan. The scan runs on the router
// (radar-scan, with a watchdog that brings 5 GHz back), so a browser on
// 5 GHz losing the router meanwhile doesn't matter: the page catches up.
import { CircleStopIcon, InfoIcon, SatelliteDishIcon, TriangleAlertIcon, WifiOffIcon } from 'lucide-react';
import { type ReactElement, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { LoadError } from '@/components/page-states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { usePoll } from '@/hooks/use-poll';
import { getRadar, getWirelessStatus, type Radar } from '@/lib/api/wireless';
import { cn, errorMessage } from '@/lib/utils';
import { describeChannels } from '../wifi/channels';
import { type BlockRequest, type ChipReport, getChipReports, getScanStatus, type ScanBlock, startScan, stopScan } from './api';

const MIN_S = 10;
const MAX_S = 3600;
const MAX_TOTAL_S = 7200;
const durations = [
  { value: '60', label: '1 minute (one radar check)' },
  { value: '120', label: '2 minutes' },
  { value: '300', label: '5 minutes' },
  { value: '600', label: '10 minutes (a weather radar check)' },
  { value: '1800', label: '30 minutes' },
  { value: 'custom', label: 'Custom…' },
];
/** Where 80 MHz blocks start on 5 GHz. */
const BLOCK_STARTS = [36, 52, 100, 116, 132, 149, 165];

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

const mhzOf = (channel: number): number => 5000 + 5 * channel;

interface BlockOption extends BlockRequest {
  key: string;
  channels: number[];
}

/** The radio's radar channels as blocks: 80 MHz where all four are radar channels, else 40, else 20. */
function blocksOf(radar: Radar | undefined): BlockOption[] {
  const dfs = new Set((radar?.channels ?? []).map((c) => c.channel));
  const out: BlockOption[] = [];
  const add = (channels: number[]): void => {
    const first = channels[0] ?? 0;
    const last = channels.at(-1) ?? first;
    out.push({ key: channels.join('-'), channels, freq: mhzOf(first), width: 20 * channels.length, center: (mhzOf(first) + mhzOf(last)) / 2 });
  };
  for (const s of BLOCK_STARTS) {
    const all = [s, s + 4, s + 8, s + 12];
    if (all.every((c) => dfs.has(c))) {
      add(all);
      continue;
    }
    for (const pair of [all.slice(0, 2), all.slice(2)]) {
      if (pair.every((c) => dfs.has(c))) add(pair);
      else for (const c of pair) if (dfs.has(c)) add([c]);
    }
  }
  return out;
}

function minutes(s: number): string {
  if (s < 90) return `${String(s)} seconds`;
  const m = Math.round(s / 60);
  return m === 1 ? 'a minute' : `${String(m)} minutes`;
}

function time(unixS: number): string {
  return new Date(unixS * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function blockLabel(b: { channels: readonly number[]; width: number }): string {
  return `${capitalize(describeChannels(b.channels))} (${String(b.width)} MHz)`;
}

/** The channels' state now, for a block option. */
function stateOf(radar: Radar | undefined, channels: readonly number[]): string {
  const states = (radar?.channels ?? []).filter((c) => channels.includes(c.channel));
  const off = states.filter((c) => c.state === 'unavailable');
  if (off.length > 0) {
    const left = Math.max(...off.map((c) => 1800 - (c.for_s ?? 0)));
    return `off limits after radar, ${String(Math.max(1, Math.ceil(left / 60)))} min left`;
  }
  if (states.length > 0 && states.every((c) => c.state === 'available')) return 'checked: no radar heard';
  return 'not checked yet';
}

function ReportDetails({ report }: { report: ChipReport }): ReactElement {
  const [open, setOpen] = useState(false);
  const pattern = [report.long === 1 && 'long pulses', report.constant === 1 && 'a fixed rate', report.staggered === 1 && 'staggered rates']
    .filter((p): p is string => typeof p === 'string')
    .join(', ');
  const pulses = (report.periodic_pulses ?? 0) + (report.long_pulses ?? 0);
  const powers = report.pulses.map((p) => p.power);
  const widths = report.pulses.map((p) => p.width);
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background/60 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">Radar pattern {String(report.type ?? '?')}</span>
        {report.time !== undefined && <span className="font-mono text-xs text-muted-foreground">{time(report.time)}</span>}
        {report.freq !== undefined && report.width !== undefined && report.center !== undefined && (
          <span className="text-muted-foreground">
            on {String((report.freq - 5000) / 5)} ({String(report.width)} MHz)
          </span>
        )}
      </div>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
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
          onClick={() => {
            setOpen((o) => !o);
          }}
        >
          {open ? 'Hide the pulses' : `Show the ${String(report.pulses.length)} pulses`}
        </Button>
      )}
      {open && (
        <table className="w-full max-w-md font-mono text-xs">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="font-normal">List</th>
              <th className="font-normal">Start</th>
              <th className="font-normal">Width</th>
              <th className="font-normal">Power</th>
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
      )}
    </div>
  );
}

const statusBadge: Record<ScanBlock['status'], { label: string; variant: 'secondary' | 'outline' | 'success' | 'warning' | 'destructive' }> = {
  waiting: { label: 'Waiting', variant: 'outline' },
  listening: { label: 'Listening', variant: 'secondary' },
  clear: { label: 'No radar heard', variant: 'success' },
  radar: { label: 'Radar heard', variant: 'warning' },
  stopped: { label: 'Stopped', variant: 'outline' },
  skipped: { label: 'Skipped', variant: 'outline' },
  failed: { label: 'Failed', variant: 'destructive' },
};

function BlockRow({ block, seconds }: { block: ScanBlock; seconds: number }): ReactElement {
  const badge = statusBadge[block.status];
  const elapsed = block.elapsed ?? 0;
  return (
    <li className="flex flex-col gap-2 border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{blockLabel(block)}</span>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      {block.status === 'listening' && (
        <div className="flex items-center gap-3">
          <Progress value={(100 * elapsed) / seconds} className="flex-1" />
          <span className="font-mono text-xs text-muted-foreground">
            {String(elapsed)} / {String(seconds)} s
          </span>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        {block.status === 'clear' && `Listened for ${minutes(elapsed)}: nothing the chip took for radar.`}
        {block.heard_after !== undefined &&
          `Radar heard ${String(block.heard_after)} s in${
            (block.off_limits ?? []).length > 0 ? `: ${describeChannels(block.off_limits ?? [])} off limits for 30 minutes` : ''
          }. Listened for ${minutes(elapsed)} in all.`}
        {block.status === 'stopped' && block.heard_after === undefined && `Stopped after ${minutes(elapsed)}, no radar heard by then.`}
        {block.status === 'skipped' && 'Not listened to: the scan ended first.'}
        {block.status === 'failed' && `The radio couldn’t be tuned there (${block.error ?? 'unknown'}).`}
      </p>
      {(block.reports ?? []).map((r) => (
        <ReportDetails key={r.seq} report={r} />
      ))}
    </li>
  );
}

export function RadarScanPage(): ReactElement {
  const radioPoll = usePoll(loadRadio, 30_000);
  const radio = radioPoll.data;
  const [fast, setFast] = useState(false);
  const status = usePoll(getScanStatus, fast ? 1000 : 15_000);
  const reports = usePoll(() => (radio === null || radio === undefined ? Promise.resolve(null) : getChipReports(radio.phy)), 15_000, radio?.phy ?? '');
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
  const secondsValid = Number.isFinite(seconds) && seconds >= MIN_S && seconds <= MAX_S;
  const chosen = options.filter((o) => picked.has(o.key));
  const total = chosen.length * (secondsValid ? seconds : 0);
  const canStart = radio !== null && radio !== undefined && chosen.length > 0 && secondsValid && total <= MAX_TOTAL_S && !active;

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

  return (
    <>
      <PageHeader
        title="DFS Radar Scan"
        description="Listen for radar on the 5 GHz radar channels for as long as you like, and see what the Wi-Fi chip makes of it."
      />
      <div className="flex flex-col gap-4">
        <Alert variant="info">
          <InfoIcon />
          <AlertTitle>Only listening</AlertTitle>
          <AlertDescription>
            The router sends nothing on these channels while it scans, so it keeps to the radar rules. But its 5 GHz radio can only listen
            where it&apos;s tuned: the 5 GHz network is off for the whole scan, and devices on it reconnect afterwards (or use 2.4 GHz
            meanwhile). Radar near homes is rare, and Wi-Fi radar detectors sometimes take noise for radar: the chip&apos;s details help
            tell.
          </AlertDescription>
        </Alert>

        {radioPoll.error !== undefined && radio === undefined ? (
          <LoadError error={radioPoll.error} retry={radioPoll.refresh} />
        ) : radio === null ? (
          <Alert>
            <WifiOffIcon />
            <AlertTitle>No 5 GHz radio</AlertTitle>
          </Alert>
        ) : null}

        {unreachable && (
          <Alert variant="warning">
            <WifiOffIcon />
            <AlertTitle>Can&apos;t reach the router right now</AlertTitle>
            <AlertDescription>
              If you&apos;re on its 5 GHz network, that&apos;s the scan: it&apos;s off until the scan ends. The scan carries on by itself and
              this page catches up when the router is back.
            </AlertDescription>
          </Alert>
        )}

        {s !== undefined && s.state !== 'none' && (s.blocks ?? []).length > 0 && (
          <Card>
            <CardHeader className="items-center">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <SatelliteDishIcon className="size-4" />
              </div>
              <div className="flex flex-col gap-1">
                <CardTitle className="text-base">{active ? 'Scanning' : 'Last scan'}</CardTitle>
                <CardDescription>
                  {s.started === undefined ? '' : `Started ${time(s.started)}`}
                  {s.seconds === undefined ? '' : `, ${minutes(s.seconds)} per block`}
                  {s.ended === undefined ? '' : `; ended ${time(s.ended)}`}
                  {active ? '. The 5 GHz network is off until it ends.' : '.'}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {s.error !== undefined && s.error !== null && (
                <Alert variant="warning">
                  <TriangleAlertIcon />
                  <AlertDescription>{capitalize(s.error)}.</AlertDescription>
                </Alert>
              )}
              <ul>
                {(s.blocks ?? []).map((b) => (
                  <BlockRow key={`${String(b.freq)}-${String(b.width)}`} block={b} seconds={s.seconds ?? 60} />
                ))}
              </ul>
              {active && (
                <Button
                  variant="outline"
                  className="self-start"
                  onClick={() => {
                    void stopScan().then(() => {
                      status.refresh();
                    });
                  }}
                >
                  <CircleStopIcon />
                  Stop and bring 5 GHz back
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {radio !== null && radio !== undefined && !active && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">New scan</CardTitle>
              <CardDescription>Which radar channels to listen on, and for how long each.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {options.length === 0 ? (
                <p className="text-sm text-muted-foreground">This radio has no radar channels in this country.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {options.map((o) => (
                    <li key={o.key} className="flex items-center justify-between gap-3">
                      <label htmlFor={`block-${o.key}`} className="flex flex-col">
                        <span className="text-sm font-medium">{blockLabel(o)}</span>
                        <span className="text-xs text-muted-foreground">{capitalize(stateOf(radio.radar, o.channels))}</span>
                      </label>
                      <Switch
                        id={`block-${o.key}`}
                        aria-label={`Scan ${blockLabel(o)}`}
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
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="scan-duration" className="text-sm font-medium">
                    Listen on each for
                  </label>
                  <Select value={duration} onValueChange={setDuration}>
                    <SelectTrigger id="scan-duration" className="w-64">
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
                </div>
                {duration === 'custom' && (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="scan-seconds" className="text-sm font-medium">
                      Seconds ({String(MIN_S)}–{String(MAX_S)})
                    </label>
                    <Input
                      id="scan-seconds"
                      type="number"
                      min={MIN_S}
                      max={MAX_S}
                      className="w-32"
                      value={custom}
                      onChange={(e) => {
                        setCustom(e.target.value);
                      }}
                    />
                  </div>
                )}
              </div>
              <p className={cn('text-sm', total > MAX_TOTAL_S ? 'text-destructive' : 'text-muted-foreground')}>
                {chosen.length === 0
                  ? 'Pick at least one block.'
                  : !secondsValid
                    ? `Choose between ${String(MIN_S)} and ${String(MAX_S)} seconds.`
                    : total > MAX_TOTAL_S
                      ? 'At most two hours in all: pick fewer blocks or a shorter time.'
                      : `The 5 GHz network will be off for about ${minutes(total)}.`}
              </p>
              {startError !== undefined && (
                <Alert variant="destructive">
                  <TriangleAlertIcon />
                  <AlertDescription>{startError}</AlertDescription>
                </Alert>
              )}
              <Button
                className="self-start"
                disabled={!canStart || busy}
                onClick={() => {
                  setConfirming(true);
                }}
              >
                <SatelliteDishIcon />
                Start scan
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">The chip&apos;s radar reports</CardTitle>
            <CardDescription>
              What the Wi-Fi chip said each time it heard radar, in scans and in normal use: which of its radar patterns matched, and the
              pulses it measured. Its numbers are in its own units. The log of radar events is on Radios &amp; SSIDs.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {reports.data === undefined ? null : reports.data === null ? (
              <p className="text-sm text-muted-foreground">
                This Wi-Fi driver doesn&apos;t keep them (MilkFlint&apos;s own driver does): radar is still detected and logged, without the
                details.
              </p>
            ) : reports.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">None since the driver last started.</p>
            ) : (
              [...reports.data].reverse().map((r) => <ReportDetails key={r.seq} report={r} />)
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Turn 5 GHz off for about {minutes(total)}?</DialogTitle>
            <DialogDescription>
              The router listens for radar on {chosen.length === 1 ? 'one block' : `${String(chosen.length)} blocks`},{' '}
              {minutes(secondsValid ? seconds : 0)} each, with the 5 GHz network off. Devices on it lose it until the scan ends; if this
              browser is one of them, the page catches up afterwards. You can stop the scan early.
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
    </>
  );
}
