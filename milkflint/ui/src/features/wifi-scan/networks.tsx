// Nearby networks' first tab: the answer for each band (how crowded its
// channel is, where it's quietest) with the scan and its cost, then the radar
// of what the router hears, each band's channels by how crowded they are, and
// every network heard, which opens in a side sheet.
import { InfoIcon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useMemo, useRef, useState } from 'react';
import { CardHeading } from '@/components/card-heading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePoll } from '@/hooks/use-poll';
import { getRegulatory } from '@/lib/api/wireless';
import { href } from '@/lib/router';
import { cn, errorMessage } from '@/lib/utils';
import { getScan, loadRadios, type ScanState, startScan } from './api';
import { ScanAnswer } from './answer';
import { ChannelCrowding } from './crowding';
import { NetworkSheet } from './detail';
import { NetworkList } from './list';
import { ago, allowedChannels, blockLabel, ownChannelsOf, quietestLabel, type Radio, scannedBands, STALE_AFTER_S } from './model';
import { type Blip, type OwnChannel, Radar } from './radar';
import { bandLabel, bandOrder, channelLoads, emptyNarrower, layoutSectors, overlapMhz, quietest, spanOf } from './spectrum';

function Legend({ swatch, children }: { swatch: string; children: ReactNode }): ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={swatch} aria-hidden="true" />
      {children}
    </span>
  );
}

export function NearbyNetworks(): ReactElement {
  const radiosPoll = usePoll(loadRadios, 30_000);
  const radios = useMemo(() => radiosPoll.data ?? [], [radiosPoll.data]);
  // a scan asked for here, until the router has it: the start time of the scan it replaces, and its radios
  const [asked, setAsked] = useState<{ replaces: number | undefined; phys: string[] }>();
  const [fast, setFast] = useState(false);
  const starting = useRef(false);
  const scan = usePoll(getScan, fast ? 1000 : 60_000);
  const [startError, setStartError] = useState<string>();
  const [hover, setHover] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const country = radios.find((r) => r.country !== undefined)?.country;
  const rules = usePoll(
    () => (country === undefined ? Promise.resolve(undefined) : getRegulatory(country)),
    3_600_000,
    country ?? '',
  ).data?.rules;

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
  const scanned = useMemo(() => scannedBands(shown), [shown]);
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
  const listening = new Set(running ? (state.phys ?? []) : (asked?.phys ?? []));
  const selectedNetwork = networks.find((n) => n.bssid === selected);
  const failed = (shown?.radios ?? []).filter((r) => r.error !== null);
  const finishedAgo = shown?.finished === undefined || state === undefined ? undefined : state.now - shown.finished;
  const stale = !scanning && finishedAgo !== undefined && finishedAgo >= STALE_AFTER_S;
  const longest = Math.max(0, ...(shown?.radios ?? []).map((r) => r.duration_ms ?? 0));

  const onScan = async (chosen: readonly Radio[]): Promise<void> => {
    // two clicks before the page redraws (a fast double click) ask for one scan
    if (scanning || starting.current) return;
    starting.current = true;
    setStartError(undefined);
    setSelected(undefined);
    const phys = chosen.flatMap((r) => (r.phy === undefined ? [] : [r.phy]));
    setAsked({ replaces: state?.started, phys });
    try {
      await startScan(phys);
      scan.refresh();
    } catch (err) {
      setAsked(undefined);
      setStartError(errorMessage(err));
    } finally {
      starting.current = false;
    }
  };

  const elapsed = running ? Math.max(0, state.now - (state.started ?? state.now)) : undefined;
  const status = scanning
    ? `Listening…${elapsed === undefined ? '' : ` ${String(elapsed)} s`}`
    : finishedAgo === undefined
      ? state === undefined
        ? 'Reading the last scan…'
        : 'Not scanned yet.'
      : `Last scan ${ago(finishedAgo)}${longest > 0 ? ` (took ${(longest / 1000).toFixed(1)} s)` : ''}: ${String(networks.length)} network${networks.length === 1 ? '' : 's'} heard.`;
  const radarStatus = running
    ? `Listening… ${String(elapsed ?? 0)} s`
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
    <div className="flex flex-col gap-4">
      {startError !== undefined && (
        <Alert variant="destructive" role="alert">
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
          <AlertDescription>{failed.map((r) => `${bandLabel(r.band ?? r.phy)}: ${r.error ?? ''}`).join('. ')}</AlertDescription>
        </Alert>
      )}
      {radiosPoll.data !== undefined && scannable.length === 0 && (
        <Alert variant="info">
          <InfoIcon />
          <AlertTitle>No band is on air</AlertTitle>
          <AlertDescription>
            <p>
              A band scans from its own network, so turn one on in{' '}
              <a href={href('wifi')} className="font-medium text-primary underline underline-offset-4">
                Networks &amp; radios
              </a>{' '}
              first.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <ScanAnswer
            radios={radiosPoll.data}
            networks={networks}
            rules={rules}
            scanned={scanned}
            listening={listening}
            scanning={scanning}
            scannable={scannable}
            status={status}
            stale={stale ? finishedAgo : undefined}
            onScan={(chosen) => void onScan(chosen)}
          />
        </div>

        <Card className="lg:col-span-3">
          <CardHeading
            title="Around the router"
            description={
              finishedAgo === undefined || scanning ? 'This router in the middle, the Wi-Fi it hears around it.' : undefined
            }
            status={
              finishedAgo === undefined || scanning
                ? undefined
                : `${String(networks.length)} network${networks.length === 1 ? '' : 's'}, scanned ${ago(finishedAgo)}. Pick one for its details.`
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
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              <Legend swatch="size-2.5 rounded-full bg-primary">On your channels</Legend>
              <Legend swatch="size-2.5 rounded-full bg-foreground/50">Elsewhere</Legend>
              <Legend swatch="size-2.5 rounded-full border-[1.5px] border-muted-foreground">Hidden name</Legend>
              <Legend swatch="h-2.5 w-4 rounded-sm border-t-2 border-primary bg-primary/10">Your channels</Legend>
            </div>
            <p className="mx-auto max-w-md text-center text-xs text-balance text-muted-foreground">
              The nearer the middle, the stronger a network is here (the rings are dBm). Its place on the rim is its channel, and
              its arc the channels it covers.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeading title="Channel crowding" description="Each channel by the networks on it, loud ones counting most." />
        <CardContent>
          {shown === undefined ? (
            <p className="text-sm text-muted-foreground">
              {state === undefined ? 'Reading the last scan…' : 'Scan to see how crowded each channel is.'}
            </p>
          ) : (
            <div
              className={cn(
                'grid gap-6',
                bands.length > 1 && 'lg:grid-cols-[2fr_3fr]',
                bands.length > 2 && 'xl:grid-cols-[2fr_3fr_3fr]',
              )}
            >
              {bands.map((b) => {
                const radio = radios.find((r) => r.band === b);
                const here = networks.filter((n) => n.band === b);
                const allowed = allowedChannels(b, rules);
                const best = radio === undefined ? undefined : quietest(b, radio.width, here, allowed);
                const free = radio === undefined ? undefined : emptyNarrower(b, radio.width, here, allowed);
                return (
                  <section key={b} aria-label={bandLabel(b)} className="flex min-w-0 flex-col gap-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
                      <h3 className="shrink-0 text-sm font-semibold whitespace-nowrap">{bandLabel(b)}</h3>
                      <span className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                        <Legend swatch="size-2 rounded-sm bg-primary">Yours</Legend>
                        {best !== undefined && radio !== undefined && (
                          <Legend swatch="size-2 rounded-sm bg-success">{quietestLabel(b, radio.width, best.channels)}</Legend>
                        )}
                        {free !== undefined && (
                          <Legend swatch="size-2 rounded-sm bg-success/40">
                            Empty at {free.width} MHz: {free.blocks.map(blockLabel).join(', ')}
                          </Legend>
                        )}
                      </span>
                    </div>
                    {scanned.has(b) ? (
                      <ChannelCrowding
                        band={b}
                        loads={channelLoads(b, networks)}
                        own={new Set(radio?.span === undefined ? [] : ownChannelsOf(b, radio.span))}
                        quiet={best?.channels}
                        empty={free?.blocks}
                        marks={b === '5g' ? [36, 64, 100, 120, 144, 165] : [1, 61, 121, 181, 233]}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">The last scan didn’t listen on {bandLabel(b)}.</p>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="gap-0 pb-0">
        <CardHeading
          title="Networks"
          status={
            networks.length === 0
              ? 'What the scan hears shows here.'
              : `${String(networks.length)} heard. Pick one for its details.`
          }
        />
        <div className="pt-4">
          <NetworkList
            stale={stale}
            blips={blips}
            bands={bands}
            scanned={shown !== undefined}
            focused={hover}
            selected={selected}
            onFocus={setHover}
            onSelect={(b) => {
              setSelected((s) => (s === b ? undefined : b));
            }}
          />
        </div>
      </Card>

      {selectedNetwork !== undefined && (
        <NetworkSheet
          network={selectedNetwork}
          radios={radios}
          onClose={() => {
            setSelected(undefined);
            setHover(undefined);
          }}
        />
      )}
    </div>
  );
}
