// Radar detection (DFS) on the 5 GHz band. Some 5 GHz channels are shared
// with weather and military radar: before using one the router listens for
// radar (a minute, longer on weather radar channels), and when it hears any
// it leaves those channels for 30 minutes. What it has heard and done, from
// hostapd's radar events (the router's radar-log service keeps them on its
// storage), and the radar channels' state now.
import { CheckCircle2Icon, LoaderCircleIcon, SatelliteDishIcon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePoll } from '@/hooks/use-poll';
import { getRadar, getWirelessStatus, type Radar, type RadarEvent } from '@/lib/api/wireless';
import { cn } from '@/lib/utils';
import { blockAround, describeChannels } from './channels';

/** How long a channel stays off limits after radar (the kernel's non-occupancy period). */
const NOP_S = 1800;
/** hostapd's events from the driver give the width as enum chan_width: 20 (no HT), 20, 40, 80, 80+80, 160. */
const DRIVER_WIDTHS = [20, 20, 40, 80, 80, 160];
const SHOWN = 8;

interface Band {
  radio: string;
  radar: Radar | undefined;
}

async function loadBands(): Promise<Band[]> {
  const status = await getWirelessStatus();
  const bands = Object.entries(status).filter(([, r]) => r.config?.band === '5g');
  return Promise.all(
    bands.map(async ([radio, r]): Promise<Band> => {
      const phy = r.iwinfo?.phy;
      return { radio, radar: phy === undefined ? undefined : await getRadar(phy).catch(() => undefined) };
    }),
  );
}

const channelOf = (mhz: number): number => (mhz - 5000) / 5;


/** The channels an event is about, and their width. */
function blockOfEvent(ev: RadarEvent): { block: number[]; width: number } | undefined {
  const f = ev.fields;
  // hostapd's own radar check: width 0 (20 or 40 MHz, by sec_chan), 1 (80), 2 (160), 3 (80+80); seg0 the centre channel
  if (f.sec_chan !== undefined && f.width !== undefined && f.seg0 !== undefined) {
    const chan = Number(f.chan);
    const sec = Number(f.sec_chan);
    if (f.width === '0') return sec === 0 ? { block: [chan], width: 20 } : { block: [chan, chan + 4 * sec].sort((a, b) => a - b), width: 40 };
    const width = f.width === '2' ? 160 : 80;
    return { block: blockAround(Number(f.seg0), width), width };
  }
  // from the driver: the width as enum chan_width, the centre in MHz (cf1, or seg0 for a check the driver runs)
  const centre = f.cf1 ?? f.seg0;
  const code = f.chan_width ?? f.width;
  if (centre !== undefined && code !== undefined && Number(centre) > 0) {
    const width = DRIVER_WIDTHS[Number(code)] ?? 20;
    return { block: blockAround(channelOf(Number(centre)), width), width };
  }
  if (f.chan !== undefined) return { block: [Number(f.chan)], width: 20 };
  if (f.freq !== undefined) return { block: [channelOf(Number(f.freq))], width: 20 };
  return undefined;
}

function where(ev: RadarEvent): string {
  const b = blockOfEvent(ev);
  if (b === undefined) return 'the channel';
  return `${describeChannels(b.block)}${b.width > 20 ? ` (${String(b.width)} MHz)` : ''}`;
}

/**
 * The channels radar put off limits: the radar channels of the block the
 * network was on (hostapd gives the control channel's frequency, the radar
 * counts for the whole block).
 */
function offLimits(ev: RadarEvent, dfs: ReadonlySet<number>): string {
  const hit = (blockOfEvent(ev)?.block ?? []).filter((c) => dfs.has(c));
  return hit.length > 0 ? describeChannels(hit) : 'its radar channels';
}

interface Row {
  ms: number;
  kind: 'radar' | 'ok' | 'stopped' | 'info';
  text: string;
}

/**
 * The log as rows, newest first: a check that ended without a result
 * (hostapd left its radar-check state other than for ENABLED, right after
 * starting one) gets a row of its own; channels usable again within a few
 * seconds of each other are one row.
 */
function rowsOf(events: readonly RadarEvent[], dfs: ReadonlySet<number>): Row[] {
  const rows: Row[] = [];
  const last = new Map<string, string>();
  let nop: { row: Row; channels: number[]; ms: number } | undefined;
  for (const ev of events) {
    const f = ev.fields;
    const prev = last.get(ev.iface);
    if (ev.event !== 'NOP-FINISHED') nop = undefined;
    switch (ev.event) {
      case 'CAC-START':
        rows.push({ ms: ev.ms, kind: 'info', text: `Radar check started on ${where(ev)}${f.cac_time === undefined ? '' : `, ${f.cac_time.replace(/s$/, ' s')}`}` });
        break;
      case 'CAC-COMPLETED':
        if (f.success === '1') rows.push({ ms: ev.ms, kind: 'ok', text: `No radar heard: ${where(ev)} in use` });
        else if (f.radar_detected === '1') rows.push({ ms: ev.ms, kind: 'radar', text: `Radar heard during the check of ${where(ev)}` });
        else rows.push({ ms: ev.ms, kind: 'stopped', text: `The radar check of ${where(ev)} didn’t finish` });
        break;
      case 'LEFT':
        if (f.state !== 'ENABLED' && prev === 'CAC-START')
          rows.push({ ms: ev.ms, kind: 'stopped', text: 'The radar check stopped before it finished: the settings were reloaded, or the network stopped' });
        break;
      case 'RADAR-DETECTED':
        rows.push({
          ms: ev.ms,
          kind: 'radar',
          text:
            f.scan === '1'
              ? `Radar heard during a radar scan of ${where(ev)}, ${f.after ?? '?'} s in: ${offLimits(ev, dfs)} off limits for 30 minutes`
              : `Radar heard while on ${where(ev)}: ${offLimits(ev, dfs)} off limits for 30 minutes`,
        });
        break;
      case 'SCAN-START':
        rows.push({ ms: ev.ms, kind: 'info', text: `Radar scan of ${where(ev)} started, ${f.seconds ?? '?'} s (5 GHz off meanwhile)` });
        break;
      case 'SCAN-END':
        if (f.reason === 'watchdog') rows.push({ ms: ev.ms, kind: 'stopped', text: 'The radar scan stopped unexpectedly; its watchdog brought 5 GHz back' });
        else if (f.result === 'clear') rows.push({ ms: ev.ms, kind: 'ok', text: `Radar scan of ${where(ev)}: no radar heard in ${f.listened ?? '?'} s` });
        else if (f.result === 'stopped') rows.push({ ms: ev.ms, kind: 'stopped', text: `Radar scan of ${where(ev)} stopped after ${f.listened ?? '?'} s` });
        break;
      case 'NEW-CHANNEL':
        rows.push({ ms: ev.ms, kind: 'info', text: `Moved the network to channel ${f.chan ?? '?'}` });
        break;
      case 'NOP-FINISHED': {
        const chans = blockOfEvent(ev)?.block ?? [];
        if (nop !== undefined && ev.ms - nop.ms < 5000) {
          nop.channels.push(...chans);
          nop.ms = ev.ms;
          nop.row.text = `${describeChannels(nop.channels)} usable again, 30 minutes after radar`;
        } else {
          const row: Row = { ms: ev.ms, kind: 'ok', text: `${describeChannels(chans)} usable again, 30 minutes after radar` };
          rows.push(row);
          nop = { row, channels: [...chans], ms: ev.ms };
        }
        break;
      }
      case 'PRE-CAC-EXPIRED':
        rows.push({ ms: ev.ms, kind: 'info', text: `The earlier radar check of ${where(ev)} expired` });
        break;
      default:
        rows.push({ ms: ev.ms, kind: 'info', text: ev.event });
    }
    if (ev.event !== 'LEFT') last.set(ev.iface, ev.event);
  }
  return rows.reverse();
}

function time(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** What's happening now: radar heard (channels off limits), a check running, or the last radar heard. */
function Status({ radar }: { radar: Radar }): ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(t);
    };
  }, []);
  const blocked = radar.channels.filter((c) => c.state === 'unavailable');
  const left = Math.max(0, ...blocked.map((c) => NOP_S - (c.for_s ?? 0)));
  // a check still running: the last event is its start, and its time isn't up
  const latest = radar.events.at(-1);
  const cac = latest?.event === 'CAC-START' ? latest : undefined;
  const cacS = Number(cac?.fields.cac_time?.replace(/s$/, '') ?? 60);
  const checking = cac !== undefined && now < cac.ms + (cacS + 5) * 1000 ? cac : undefined;
  const heard = radar.events.findLast((e) => e.event === 'RADAR-DETECTED');
  const first = radar.events[0];
  return (
    <div className="flex flex-col gap-2">
      {blocked.length > 0 && (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertTitle>Radar heard{heard === undefined ? '' : ` ${time(heard.ms)}`}</AlertTitle>
          <AlertDescription>
            {capitalize(describeChannels(blocked.map((c) => c.channel)))} {blocked.length === 1 ? 'is' : 'are'} off limits for about{' '}
            {String(Math.max(1, Math.ceil(left / 60)))} more minutes.
          </AlertDescription>
        </Alert>
      )}
      {checking !== undefined && (
        <Alert variant="info">
          <LoaderCircleIcon className="animate-spin" />
          <AlertTitle>Listening for radar</AlertTitle>
          <AlertDescription>
            Checking {where(checking)}: about {String(Math.max(1, Math.ceil((checking.ms + cacS * 1000 - now) / 1000)))} s left. The 5 GHz
            network is off until it&apos;s done.
          </AlertDescription>
        </Alert>
      )}
      {blocked.length === 0 && checking === undefined && (
        <Alert variant="success">
          <CheckCircle2Icon />
          <AlertTitle>{heard === undefined ? 'No radar heard' : `Last radar heard ${time(heard.ms)}`}</AlertTitle>
          <AlertDescription>
            {heard === undefined
              ? first === undefined
                ? radar.logging === false
                  ? 'Nothing logged: the radar log is off.'
                  : 'Nothing logged yet: the router keeps its radar events from now on.'
                : `Since ${time(first.ms)}, when the log starts.`
              : `While on ${where(heard)}. Its radar channels were off limits for 30 minutes and are usable again.`}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/** The radar channels by state now. */
function Channels({ radar }: { radar: Radar }): ReactElement | null {
  const groups = [
    { state: 'available', label: 'Checked, usable at once' },
    { state: 'usable', label: 'Need a radar check first' },
    { state: 'unavailable', label: 'Off limits after radar' },
  ]
    .map((g) => ({ ...g, channels: radar.channels.filter((c) => c.state === g.state).map((c) => c.channel) }))
    .filter((g) => g.channels.length > 0);
  if (groups.length === 0) return null;
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
      {groups.map((g) => (
        <div key={g.state} className="contents">
          <dt className="text-muted-foreground">{g.label}</dt>
          <dd>{capitalize(describeChannels(g.channels))}</dd>
        </div>
      ))}
    </dl>
  );
}

const dot: Record<Row['kind'], string> = {
  radar: 'bg-warning',
  ok: 'bg-success',
  stopped: 'bg-muted-foreground',
  info: 'bg-info',
};

function Log({ radar }: { radar: Radar }): ReactElement {
  const [all, setAll] = useState(false);
  const rows = rowsOf(radar.events, new Set(radar.channels.map((c) => c.channel)));
  const off =
    radar.logging === false ? (
      <p className="text-sm text-muted-foreground">
        The radar log is off, so new radar checks and radar aren&apos;t kept. Turn it on on the{' '}
        <a href="#/logs" className="font-medium text-foreground underline underline-offset-2">
          Logs
        </a>{' '}
        page.
      </p>
    ) : undefined;
  if (rows.length === 0) return off ?? <p className="text-sm text-muted-foreground">No radar checks or radar logged yet.</p>;
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <div className="flex flex-col gap-2">
      {off}
      <ol className="flex flex-col gap-1.5">
        {shown.map((r) => (
          <li key={`${String(r.ms)}-${r.text}`} className="flex items-start gap-2 text-sm">
            <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', dot[r.kind])} aria-hidden />
            <span className="w-36 shrink-0 font-mono text-xs leading-5 text-muted-foreground">{time(r.ms)}</span>
            <span>{r.text}</span>
          </li>
        ))}
      </ol>
      {rows.length > SHOWN && (
        <Button
          variant="link"
          size="sm"
          className="self-start px-0"
          onClick={() => {
            setAll((a) => !a);
          }}
        >
          {all ? 'Show fewer' : `Show all ${String(rows.length)}`}
        </Button>
      )}
    </div>
  );
}

export function RadarCard({ className }: { className?: string }): ReactElement | null {
  const bands = usePoll(loadBands, 15_000).data;
  if (bands === undefined || bands.length === 0) return null;

  return (
    <Card className={className}>
      <CardHeader className="items-center">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <SatelliteDishIcon className="size-4" />
        </div>
        <div className="flex flex-col gap-1">
          <CardTitle className="text-base">Radar detection</CardTitle>
          <CardDescription>
            Some 5 GHz channels are shared with weather and military radar. Before using them the router listens for radar (about a minute,
            with 5 GHz off), and if it hears any it leaves them for 30 minutes. What it has heard and done, kept on the router.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {bands.map((b) =>
          b.radar === undefined ? (
            <p key={b.radio} className="text-sm text-muted-foreground">
              Unknown: this firmware doesn’t report it.
            </p>
          ) : (
            <div key={b.radio} className="flex flex-col gap-4">
              <Status radar={b.radar} />
              <Channels radar={b.radar} />
              <Log radar={b.radar} />
            </div>
          ),
        )}
      </CardContent>
    </Card>
  );
}
