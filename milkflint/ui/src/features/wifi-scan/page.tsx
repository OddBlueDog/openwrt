import { CheckCircle2Icon, ClockIcon, InfoIcon, LoaderCircleIcon, RadarIcon, RadioTowerIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useMemo, useRef, useState } from 'react';
import { CardHeading, InfoRow } from '@/components/card-heading';
import { SignalBars } from '@/components/charts/signal-bars';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { usePoll } from '@/hooks/use-poll';
import { getIwinfo, getRegulatory, getWirelessStatus, type RegRule } from '@/lib/api/wireless';
import { formatPercent } from '@/lib/format';
import { href } from '@/lib/router';
import { cn, errorMessage } from '@/lib/utils';
import { widthOf } from '../wifi/channels';
import { getScan, type ScannedNetwork, type ScanState, startScan } from './api';
import { ChannelCrowding } from './crowding';
import { NetworkList } from './list';
import { type Blip, type OwnChannel, Radar } from './radar';
import {
  bandChannels,
  type BandId,
  bandLabel,
  bandOrder,
  channelLoads,
  channelMhz,
  channelRange,
  coveredChannels,
  coverLabel,
  emptyNarrower,
  layoutSectors,
  overlapMhz,
  quietest,
  securityOf,
  signalWord,
  spanOf,
  standardLabel,
} from './spectrum';

/** One of this router's radios, as it runs now. */
interface Radio {
  radio: string;
  band: BandId;
  phy: string | undefined;
  /** Its access point is up and on a channel: it can scan. */
  online: boolean;
  /** Set to Auto (it picked its channel at start-up). */
  auto: boolean;
  channel: number | undefined;
  span: [number, number] | undefined;
  width: number;
  country: string | undefined;
}

async function loadRadios(): Promise<Radio[]> {
  const status = await getWirelessStatus();
  const radios = await Promise.all(
    Object.entries(status).map(async ([radio, r]): Promise<Radio | undefined> => {
      const band = r.config?.band;
      if (band !== '2g' && band !== '5g' && band !== '6g') return undefined;
      const aps = (r.interfaces ?? []).filter((i) => (i.config?.mode ?? 'ap') === 'ap' && i.ifname !== undefined);
      // radios that are off with no access point aren't Wi-Fi networks here (as on Radios & SSIDs)
      if (r.disabled === true && aps.length === 0) return undefined;
      const ifname = aps[0]?.ifname;
      const info = r.disabled === true || ifname === undefined ? undefined : await getIwinfo(ifname).catch(() => undefined);
      const width = widthOf(info?.htmode ?? r.config?.htmode);
      const center =
        info?.center_chan1 !== undefined ? channelMhz(band, info.center_chan1) : info?.frequency;
      return {
        radio,
        band,
        phy: r.iwinfo?.phy,
        online: info?.frequency !== undefined,
        auto: String(r.config?.channel ?? 'auto') === 'auto',
        channel: info?.channel,
        span: center === undefined ? undefined : [center - width / 2, center + width / 2],
        width,
        country: r.config?.country,
      };
    }),
  );
  return radios.filter((r): r is Radio => r !== undefined).sort((a, b) => bandOrder.indexOf(a.band) - bandOrder.indexOf(b.band));
}

/** The 20 MHz channels a country lets a radio start a network on. */
function allowedChannels(band: BandId, rules: readonly RegRule[] | undefined): Set<number> | undefined {
  if (rules === undefined) return undefined;
  return new Set(
    bandChannels(band).filter((c) => {
      const mhz = channelMhz(band, c);
      return rules.some((r) => mhz - 10 >= r.start && mhz + 10 <= r.end && !r.no_ir);
    }),
  );
}

function dfsChannels(band: BandId, rules: readonly RegRule[] | undefined): Set<number> {
  return new Set(
    bandChannels(band).filter((c) => {
      const mhz = channelMhz(band, c);
      return rules?.some((r) => mhz - 10 >= r.start && mhz + 10 <= r.end && r.dfs) === true;
    }),
  );
}

function ownChannelsOf(band: BandId, span: readonly [number, number]): number[] {
  return bandChannels(band).filter((c) => {
    const mhz = channelMhz(band, c);
    return mhz - 10 >= span[0] - 1 && mhz + 10 <= span[1] + 1;
  });
}

function blockLabel(channels: readonly number[]): string {
  const first = channels[0];
  const last = channels.at(-1);
  if (first === undefined || last === undefined) return '';
  return first === last ? String(first) : `${String(first)}–${String(last)}`;
}

/** "Quietest 160 MHz block: 100–128": for this router's width (2.4 GHz and 20 MHz: a channel). */
function quietestLabel(band: BandId, width: number, channels: readonly number[]): string {
  return band === '2g' || width <= 20 ? `Quietest channel: ${blockLabel(channels)}` : `Quietest ${String(width)} MHz block: ${blockLabel(channels)}`;
}

/** Results older than this are shown fainter, with a nudge to scan again: networks come and go. */
const STALE_AFTER_S = 5 * 60;

/** "5 minutes", "2 hours", "3 days". */
function howLong(seconds: number): string {
  const [n, unit] = seconds < 3600 ? [Math.floor(seconds / 60), 'minute'] : seconds < 86400 ? [Math.floor(seconds / 3600), 'hour'] : [Math.floor(seconds / 86400), 'day'];
  return `${String(n)} ${unit}${n === 1 ? '' : 's'}`;
}

/** Whole minutes, hours or days, as the stale notice counts them. */
function ago(seconds: number): string {
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${String(Math.floor(seconds / 60))} min ago`;
  if (seconds < 86400) return `${String(Math.floor(seconds / 3600))} h ago`;
  return `${String(Math.floor(seconds / 86400))} d ago`;
}

function Legend({ color, ring, children }: { color: string; ring?: boolean; children: ReactNode }): ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('size-2.5 rounded-full', ring === true ? `border-[1.5px] ${color}` : color)} aria-hidden="true" />
      {children}
    </span>
  );
}

/** What the scan says about one of this router's bands. */
function BandSummary({ radio, networks, rules }: { radio: Radio; networks: readonly ScannedNetwork[]; rules: readonly RegRule[] | undefined }): ReactElement {
  const span = radio.span;
  const here = networks.filter((n) => n.band === radio.band);
  const sharing = span === undefined ? [] : here.filter((n) => overlapMhz(spanOf(n), span) > 0);
  const loudest = sharing.reduce<ScannedNetwork | undefined>((a, n) => (a === undefined || (n.signal ?? -200) > (a.signal ?? -200) ? n : a), undefined);
  const best = quietest(radio.band, radio.width, here, allowedChannels(radio.band, rules));
  const mine = span === undefined ? [] : ownChannelsOf(radio.band, span);
  const current = span === undefined ? undefined : quietest(radio.band, radio.width, here, new Set(mine));
  const isCurrent = best !== undefined && mine.length > 0 && best.channels.every((c) => mine.includes(c));
  // worth moving only for a clearly quieter place (a loud neighbour or two)
  const better = best !== undefined && current !== undefined && !isCurrent && current.load - best.load > 0.35;
  const dfs = dfsChannels(radio.band, rules);
  const free = emptyNarrower(radio.band, radio.width, here, allowedChannels(radio.band, rules));
  const where = radio.channel === undefined ? undefined : `channel ${radio.band === '2g' ? String(radio.channel) : blockLabel(mine)}`;

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{bandLabel(radio.band)}</span>
        <span className="text-xs text-primary tabular">
          {where === undefined ? 'Off' : `You: ${where}`}
          {radio.auto && where !== undefined ? ' (Auto)' : ''}
        </span>
      </div>
      {span === undefined ? (
        <p className="text-xs text-muted-foreground">Turn this band on to see who shares its channels.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {sharing.length === 0
              ? `No other network overlaps your ${radio.width > 20 ? 'channels' : 'channel'}.`
              : `${String(sharing.length)} other network${sharing.length === 1 ? '' : 's'} overlap${sharing.length === 1 ? 's' : ''} your ${radio.width > 20 ? 'channels' : 'channel'}, the loudest ${loudest?.ssid ?? 'a hidden one'} at ${String(loudest?.signal ?? '?')} dBm.`}{' '}
            {here.length} on {bandLabel(radio.band)} in all.
          </p>
          {better ? (
            <p className="flex items-start gap-1.5 text-xs">
              <InfoIcon className="mt-px size-3.5 shrink-0 text-success" />
              <span>
                Quieter at {radio.width} MHz: channel {blockLabel(best.channels)}
                {best.channels.some((c) => dfs.has(c)) ? ' (DFS: it listens for radar for a minute before it starts)' : ''}.{' '}
                <a href={href('wifi')} className="font-medium text-primary hover:underline">
                  Change it
                </a>
              </span>
            </p>
          ) : (
            here.length > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-success">
                <CheckCircle2Icon className="size-3.5" />
                As quiet as anywhere on this band at {radio.width} MHz.
              </p>
            )
          )}
          {free !== undefined && (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <InfoIcon className="mt-px size-3.5 shrink-0" />
              <span>
                No other network at all on channel{' '}
                {free.blocks
                  .map((blk) => `${blockLabel(blk)}${blk.some((c) => dfs.has(c)) ? ' (DFS: a minute of listening for radar before it starts)' : ''}`)
                  .join(' or ')}
                : room for {free.width === 80 ? 'an' : 'a'} {free.width} MHz network there. Yours is {radio.width} MHz, which no empty stretch here
                fits.
              </span>
            </p>
          )}
        </>
      )}
    </div>
  );
}

function NetworkDetail({
  network: n,
  radios,
  onClose,
}: {
  network: ScannedNetwork;
  radios: readonly Radio[];
  onClose: () => void;
}): ReactElement {
  const security = securityOf(n);
  const mine = radios.find((r) => r.band === n.band)?.span;
  const shared = mine === undefined ? 0 : overlapMhz(spanOf(n), mine);
  const exact = mine !== undefined && shared > 0 && spanOf(n)[0] === mine[0] && spanOf(n)[1] === mine[1];
  const device = [n.wps?.manufacturer, n.wps?.model ?? n.wps?.name].filter((x) => x !== undefined).join(' ');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className={cn('truncate text-base font-semibold', n.ssid === null && 'text-muted-foreground italic')}>{n.ssid ?? 'Hidden network'}</h3>
          <p className="font-mono text-xs text-muted-foreground">{n.bssid}</p>
        </div>
        <Button variant="ghost" size="icon" className="-mt-1 -mr-2 size-8" onClick={onClose} aria-label="Close">
          <XIcon />
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <SignalBars dbm={n.signal ?? undefined} className="h-6 gap-[3px] [&>span]:w-[5px]" />
        <div>
          <div className="text-xl font-semibold tabular">{n.signal === null ? '—' : `${String(n.signal)} dBm`}</div>
          <div className="text-xs text-muted-foreground">{signalWord(n.signal)} here</div>
        </div>
      </div>
      {shared > 0 && (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertDescription>
            {exact
              ? 'It’s on exactly your channels: your devices and its take turns to use the air.'
              : `It overlaps ${String(shared)} MHz of your ${String(mine === undefined ? 0 : mine[1] - mine[0])} MHz. Partly overlapping networks can’t take turns cleanly, so they get in each other’s way.`}
          </AlertDescription>
        </Alert>
      )}
      <div className="divide-y">
        <InfoRow label="Band">{bandLabel(n.band)}</InfoRow>
        <InfoRow label="Channel">
          {channelRange(n)} · {n.width} MHz{n.width > 20 ? ` (main ${String(n.channel)})` : ''}
        </InfoRow>
        <InfoRow label="Covers">
          {coveredChannels(n).length > 1 ? 'Channels' : 'Channel'} {coverLabel(n)} ({spanOf(n)[0]}–{spanOf(n)[1]} MHz)
        </InfoRow>
        <InfoRow label="Standard">{standardLabel(n.standard)}</InfoRow>
        <InfoRow label="Security">
          <span className={security.weak ? 'text-warning' : undefined}>{security.label}</span>
          {n.security.rsn?.mfp === 'required' ? ' · PMF' : ''}
        </InfoRow>
        {n.stations !== undefined && n.stations !== null && <InfoRow label="Devices on it">{n.stations}</InfoRow>}
        {n.utilization !== undefined && n.utilization !== null && <InfoRow label="Its channel busy">{formatPercent(n.utilization)}</InfoRow>}
        {device !== '' && <InfoRow label="Device">{device}</InfoRow>}
        {n.country !== undefined && n.country !== null && <InfoRow label="Country">{n.country}</InfoRow>}
      </div>
    </div>
  );
}

export function NearbyPage(): ReactElement {
  const radiosPoll = usePoll(loadRadios, 30_000);
  const radios = useMemo(() => radiosPoll.data ?? [], [radiosPoll.data]);
  // a scan asked for here, until the router has it: the start time of the scan it replaces
  const [asked, setAsked] = useState<{ replaces: number | undefined }>();
  const [fast, setFast] = useState(false);
  const starting = useRef(false);
  const scan = usePoll(getScan, fast ? 1000 : 60_000);
  const [startError, setStartError] = useState<string>();
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [hover, setHover] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const country = radios.find((r) => r.country !== undefined)?.country;
  const rules = usePoll(() => (country === undefined ? Promise.resolve(undefined) : getRegulatory(country)), 3_600_000, country ?? '').data?.rules;

  const state = scan.data;
  const running = state?.state === 'running';
  // from the click on: a real scan can be over before a poll sees it running
  const waiting = asked !== undefined && state?.started === asked.replaces;
  const scanning = running || waiting;
  // keep polling quickly until the scan is over
  if (scanning !== fast) setFast(scanning);
  // while a new scan runs, the last one's results stay up
  const [lastDone, setLastDone] = useState<ScanState>();
  if (state?.state === 'done' && state !== lastDone) setLastDone(state);
  const shown = state?.state === 'done' ? state : lastDone;

  const networks = useMemo(() => shown?.networks ?? [], [shown]);
  const bands = useMemo(
    () => bandOrder.filter((b) => radios.some((r) => r.band === b) || networks.some((n) => n.band === b)),
    [radios, networks],
  );
  const sectors = useMemo(() => layoutSectors(bands), [bands]);
  const blips = useMemo(
    (): Blip[] =>
      networks.map((n) => {
        const span = radios.find((r) => r.band === n.band)?.span;
        return { network: n, shares: span !== undefined && overlapMhz(spanOf(n), span) > 0 };
      }),
    [networks, radios],
  );
  const own = useMemo(
    (): OwnChannel[] => radios.flatMap((r) => (r.span === undefined ? [] : [{ band: r.band, span: r.span, label: 'YOU' }])),
    [radios],
  );

  const scannable = radios.filter((r) => r.online && r.phy !== undefined);
  const chosen = scannable.filter((r) => !unchecked.has(r.radio));
  const selectedNetwork = networks.find((n) => n.bssid === selected);
  const failed = (shown?.radios ?? []).filter((r) => r.error !== null);
  const finishedAgo = shown?.finished === undefined || state === undefined ? undefined : state.now - shown.finished;
  const stale = !scanning && finishedAgo !== undefined && finishedAgo >= STALE_AFTER_S;
  const longest = Math.max(0, ...(shown?.radios ?? []).map((r) => r.duration_ms ?? 0));

  const onScan = async (): Promise<void> => {
    // two clicks before the page redraws (a fast double click) ask for one scan
    if (scanning || starting.current) return;
    starting.current = true;
    setStartError(undefined);
    setSelected(undefined);
    setAsked({ replaces: state?.started });
    try {
      await startScan(chosen.flatMap((r) => (r.phy === undefined ? [] : [r.phy])));
      scan.refresh();
    } catch (err) {
      setAsked(undefined);
      setStartError(errorMessage(err));
    } finally {
      starting.current = false;
    }
  };

  const radarStatus = running
    ? `Listening… ${String(Math.max(0, state.now - (state.started ?? state.now)))} s`
    : waiting
      ? 'Listening…'
      : state === undefined
      ? undefined
      : state.state === 'none'
        ? 'Not scanned yet'
        : networks.length === 0 && state.state === 'done'
          ? 'Nothing heard'
          : undefined;

  return (
    <>
      <PageHeader
        title="Nearby Networks"
        description="The Wi-Fi around the router: who shares your channels, and which are quietest."
        actions={
          <>
            {scannable.length > 1 && (
              <div className="flex gap-1.5" role="group" aria-label="Bands to scan">
                {scannable.map((r) => {
                  const on = !unchecked.has(r.radio);
                  return (
                    <button
                      key={r.radio}
                      type="button"
                      aria-pressed={on}
                      disabled={scanning}
                      onClick={() => {
                        setUnchecked((s) => {
                          const next = new Set(s);
                          if (on) next.add(r.radio);
                          else next.delete(r.radio);
                          return next;
                        });
                      }}
                      className={cn(
                        'h-9 rounded-md border px-3 text-sm font-medium transition-colors disabled:opacity-50',
                        on ? 'border-primary/50 bg-primary/10 text-primary' : 'bg-card text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {bandLabel(r.band)}
                    </button>
                  );
                })}
              </div>
            )}
            <Button onClick={() => void onScan()} disabled={scanning || chosen.length === 0}>
              {scanning ? <LoaderCircleIcon className="animate-spin" /> : <RadarIcon />}
              {scanning ? 'Scanning…' : 'Scan now'}
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-4">
        {startError !== undefined && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>The scan didn’t start</AlertTitle>
            <AlertDescription>{startError}</AlertDescription>
          </Alert>
        )}
        {state?.state === 'failed' && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>The scan didn’t finish</AlertTitle>
            <AlertDescription>The router gave up on it. Try again in a moment.</AlertDescription>
          </Alert>
        )}
        {!scanning && failed.length > 0 && (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>Not every band scanned</AlertTitle>
            <AlertDescription>
              {failed.map((r) => `${bandLabel(r.band ?? r.phy)}: ${r.error ?? ''}`).join('. ')}
            </AlertDescription>
          </Alert>
        )}
        {stale && (
          <Alert>
            <ClockIcon />
            <AlertTitle>It’s been {howLong(finishedAgo)} since the last scan</AlertTitle>
            <AlertDescription>
              Networks come and go, and change channel, so what’s below may be out of date.
              {chosen.length > 0 && (
                <Button variant="outline" size="sm" className="mt-2" onClick={() => void onScan()}>
                  <RadarIcon />
                  Scan again
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
        {radiosPoll.data !== undefined && scannable.length === 0 && (
          <Alert variant="info">
            <InfoIcon />
            <AlertTitle>No band is on</AlertTitle>
            <AlertDescription>
              A band scans from its own network, so turn one on in{' '}
              <a href={href('wifi')} className="font-medium text-primary underline">
                Radios &amp; SSIDs
              </a>{' '}
              first.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid items-start gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeading
              icon={RadarIcon}
              title="Around the router"
              description={
                finishedAgo === undefined || scanning
                  ? 'This router in the middle, the Wi-Fi it hears around it.'
                  : `${String(networks.length)} network${networks.length === 1 ? '' : 's'} · scanned ${ago(finishedAgo)}${longest > 0 ? ` in ${(longest / 1000).toFixed(1)} s` : ''}`
              }
            />
            <CardContent className="flex flex-col gap-4">
              {sectors.length === 0 ? (
                <Skeleton className="mx-auto aspect-square w-full max-w-[34rem] rounded-full" />
              ) : (
                <Radar
                  sectors={sectors}
                  blips={blips}
                  own={own}
                  scanning={scanning}
                  stale={stale}
                  focused={hover ?? selected}
                  onFocus={setHover}
                  onSelect={(b) => {
                    setSelected((s) => (s === b ? undefined : b));
                  }}
                  status={radarStatus}
                />
              )}
              <p className="mx-auto max-w-md text-center text-xs text-balance text-muted-foreground">
                Each dot is a network: the nearer the middle, the stronger it is here (the rings are dBm). Its place on the rim is its channel, and
                its arc the channels it covers.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                <Legend color="bg-primary">On your channels</Legend>
                <Legend color="bg-foreground/50">Elsewhere</Legend>
                <Legend color="border-muted-foreground" ring>
                  Hidden name
                </Legend>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-4 rounded-sm border-t-2 border-primary bg-primary/10" aria-hidden="true" />
                  Your channels
                </span>
              </div>
              <p className="text-center text-xs text-muted-foreground/80">
                While a band scans, its devices can’t send or receive: a second or a few, as it listens on every channel.
              </p>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            {selectedNetwork !== undefined ? (
              <CardContent>
                <NetworkDetail
                  network={selectedNetwork}
                  radios={radios}
                  onClose={() => {
                    setSelected(undefined);
                  }}
                />
              </CardContent>
            ) : (
              <>
                <CardHeading icon={RadioTowerIcon} title="Your channels" description="How busy the air is where this router is." />
                <CardContent className="flex flex-col gap-3">
                  {radiosPoll.data === undefined ? (
                    <Skeleton className="h-40 rounded-lg" />
                  ) : (
                    radios.map((r) => <BandSummary key={r.radio} radio={r} networks={networks} rules={rules} />)
                  )}
                  {state?.state === 'none' && (
                    <p className="text-xs text-muted-foreground">Scan to see what shares them. Pick a network on the radar or in the list for its details.</p>
                  )}
                </CardContent>
              </>
            )}
          </Card>
        </div>

        {networks.length > 0 && (
          <Card>
            <CardHeading icon={RadioTowerIcon} title="Channel crowding" description="Each channel by the networks on it, loud ones counting most." />
            <CardContent className="grid gap-6 lg:grid-cols-[2fr_3fr]">
              {bands.map((b) => {
                const radio = radios.find((r) => r.band === b);
                const here = networks.filter((n) => n.band === b);
                const allowed = allowedChannels(b, rules);
                const best = radio === undefined ? undefined : quietest(b, radio.width, here, allowed);
                const free = radio === undefined ? undefined : emptyNarrower(b, radio.width, here, allowed);
                return (
                  <div key={b} className="flex min-w-0 flex-col gap-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-xs">
                      <span className="shrink-0 text-sm font-semibold whitespace-nowrap">{bandLabel(b)}</span>
                      <span className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <span className="size-2 rounded-[2px] bg-primary" />
                          Yours
                        </span>
                        {best !== undefined && radio !== undefined && (
                          <span className="inline-flex items-center gap-1">
                            <span className="size-2 rounded-[2px] bg-success" />
                            {quietestLabel(b, radio.width, best.channels)}
                          </span>
                        )}
                        {free !== undefined && (
                          <span className="inline-flex items-center gap-1">
                            <span className="size-2 rounded-[2px] bg-success/40" />
                            Empty at {free.width} MHz: {free.blocks.map(blockLabel).join(', ')}
                          </span>
                        )}
                      </span>
                    </div>
                    <ChannelCrowding
                      band={b}
                      loads={channelLoads(b, networks)}
                      own={new Set(radio?.span === undefined ? [] : ownChannelsOf(b, radio.span))}
                      quiet={best?.channels}
                      empty={free?.blocks}
                      marks={b === '5g' ? [36, 64, 100, 120, 144, 165] : [1, 61, 121, 181, 233]}
                    />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        <Card className="pb-0">
          <CardHeading
            icon={RadarIcon}
            title="Networks"
            description={networks.length === 0 ? 'What the scan hears shows here.' : `${String(networks.length)} heard, strongest first.`}
          />
          <Separator />
          <NetworkList
            stale={stale}
            blips={blips}
            bands={bands}
            focused={hover}
            selected={selected}
            onFocus={setHover}
            onSelect={(b) => {
              setSelected((s) => (s === b ? undefined : b));
            }}
          />
        </Card>
      </div>
    </>
  );
}
