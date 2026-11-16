// The Nearby networks page's opening answer: for each of this router's bands,
// how crowded its channel is and where it's quietest, by the last scan; then
// the scan itself (every band, or one) and what it costs.
import { ChevronRightIcon, ClockIcon, InfoIcon, LoaderCircleIcon, RadarIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { CardHeading } from '@/components/card-heading';
import { Note } from '@/components/note';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { RegRule } from '@/lib/api/wireless';
import { href } from '@/lib/router';
import type { ScannedNetwork } from './api';
import { type BandAnswer, bandAnswer, type BandState, type Block, blockLabel, howLong, type Radio } from './model';
import { bandLabel } from './spectrum';

const stateBadge: Record<BandState, ReactElement> = {
  off: <Badge variant="outline">Off</Badge>,
  unscanned: <Badge variant="secondary">Not scanned</Badge>,
  clear: <Badge variant="success">Clear</Badge>,
  shared: <Badge variant="info">Shared</Badge>,
  quieter: <Badge variant="warning">Quieter elsewhere</Badge>,
};

const RADAR_NOTE = ' (radar channels: it listens for radar for a minute before it starts)';

function blocksText(blocks: readonly Block[]): string {
  return blocks.map((b) => `${blockLabel(b.channels)}${b.dfs ? RADAR_NOTE : ''}`).join(' or ');
}

function Link({ children }: { children: ReactNode }): ReactElement {
  return (
    <a href={href('wifi')} className="inline-flex items-center gap-0.5 font-medium link underline-offset-4">
      {children}
      <ChevronRightIcon className="size-4" aria-hidden />
    </a>
  );
}

/** What the scan says about the band, in sentences. */
function BandText({ radio, a }: { radio: Radio; a: BandAnswer }): ReactElement {
  const band = bandLabel(radio.band);
  const yours = radio.width > 20 ? 'your channels' : 'your channel';
  if (a.state === 'off')
    return (
      <p className="text-sm text-muted-foreground">
        Not on air now, so it has no channel to share. <Link>Networks &amp; radios</Link>
      </p>
    );
  if (a.state === 'unscanned') return <p className="text-sm text-muted-foreground">Scan it to see who shares {yours}.</p>;
  const loudest =
    a.loudest === undefined
      ? ''
      : `, the loudest ${a.loudest.ssid ?? 'a hidden one'}${a.loudest.signal === null ? '' : ` at ${String(a.loudest.signal)} dBm`}`;
  return (
    <>
      <p className="text-sm">
        {a.sharing === 0
          ? `No other network overlaps ${yours}.`
          : `${String(a.sharing)} other network${a.sharing === 1 ? ' overlaps' : 's overlap'} ${yours}${loudest}.`}{' '}
        <span className="text-muted-foreground">
          {a.heard === 0 ? `Nothing else heard on ${band}.` : `${String(a.heard)} heard on ${band} in all.`}
        </span>
      </p>
      {a.move !== undefined ? (
        <p className="text-sm">
          Quieter at {radio.width} MHz: channel {blockLabel(a.move.channels)}
          {a.move.dfs ? RADAR_NOTE : ''}. <Link>Change it</Link>
        </p>
      ) : (
        a.heard > 0 && (
          <p className="text-sm text-muted-foreground">
            As quiet as anywhere on {band} at {radio.width} MHz.
          </p>
        )
      )}
      {a.free !== undefined && (
        <Note tone="info" icon={<InfoIcon />} className="text-muted-foreground">
          No other network at all on channel {blocksText(a.free.blocks)}: room for {a.free.width === 80 ? 'an' : 'a'}{' '}
          {a.free.width} MHz network there. Yours is {radio.width} MHz, which no empty stretch here fits.
        </Note>
      )}
    </>
  );
}

function BandRow({
  radio,
  a,
  listening,
  scanOne,
}: {
  radio: Radio;
  a: BandAnswer;
  /** This band is being scanned now. */
  listening: boolean;
  /** The button that scans this band alone, where there's a choice. */
  scanOne: ReactNode;
}): ReactElement {
  return (
    <li className="flex flex-col gap-2 px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{bandLabel(radio.band)}</h3>
            {listening ? (
              <Badge variant="info">
                <LoaderCircleIcon className="motion-safe:animate-spin" aria-hidden />
                Listening
              </Badge>
            ) : (
              stateBadge[a.state]
            )}
          </div>
          {a.where !== undefined && (
            <p className="text-xs text-muted-foreground tabular">
              Yours: {a.where} · {radio.width} MHz{radio.auto ? ' · picked by Auto' : ''}
            </p>
          )}
        </div>
        {scanOne}
      </div>
      <BandText radio={radio} a={a} />
    </li>
  );
}

export function ScanAnswer({
  radios,
  networks,
  rules,
  scanned,
  listening,
  scanning,
  scannable,
  status,
  stale,
  onScan,
}: {
  /** Undefined while they load. */
  radios: readonly Radio[] | undefined;
  networks: readonly ScannedNetwork[];
  rules: readonly RegRule[] | undefined;
  /** The bands the last scan listened on. */
  scanned: ReadonlySet<string>;
  /** The radios (phys) being scanned now. */
  listening: ReadonlySet<string>;
  scanning: boolean;
  /** The radios that can scan: on air. */
  scannable: readonly Radio[];
  /** The last scan, in a line. */
  status: string;
  /** Seconds since the last scan, when it's old enough to say so. */
  stale: number | undefined;
  onScan: (radios: readonly Radio[]) => void;
}): ReactElement {
  const all =
    scannable.length === 2
      ? 'Scan both bands'
      : scannable.length > 2
        ? 'Scan every band'
        : scannable[0] === undefined
          ? 'Scan'
          : `Scan ${bandLabel(scannable[0].band)}`;
  return (
    <Card className="gap-0 pb-0">
      <CardHeading title="Your channels" description="How busy the air is where this router is, by the last scan." />
      {radios === undefined ? (
        <div className="flex flex-col gap-3 px-5 py-4">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
      ) : (
        <ul className="mt-2 divide-y border-t">
          {radios.map((r) => {
            const canScan = scannable.includes(r);
            return (
              <BandRow
                key={r.radio}
                radio={r}
                a={bandAnswer(r, networks, rules, scanned.has(r.band))}
                listening={scanning && r.phy !== undefined && listening.has(r.phy)}
                scanOne={
                  scannable.length > 1 &&
                  canScan && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={scanning}
                      aria-label={`Scan ${bandLabel(r.band)} only`}
                      onClick={() => {
                        onScan([r]);
                      }}
                    >
                      Scan this band
                    </Button>
                  )
                }
              />
            );
          })}
        </ul>
      )}
      <div className="flex flex-col gap-3 border-t px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <p className="text-sm font-medium tabular">{status}</p>
          {scannable.length > 0 && (
            <Button
              disabled={scanning}
              onClick={() => {
                onScan(scannable);
              }}
            >
              {scanning ? <LoaderCircleIcon className="motion-safe:animate-spin" /> : <RadarIcon />}
              {scanning ? 'Scanning…' : all}
            </Button>
          )}
        </div>
        {stale !== undefined && (
          <Note tone="warning" icon={<ClockIcon />}>
            It’s been {howLong(stale)} since that scan. Networks come and go, and change channel, so scan again for what’s there
            now.
          </Note>
        )}
        <p className="text-xs text-muted-foreground">
          While a band scans, its devices can’t send or receive: a second or a few, as it listens on every channel.
        </p>
      </div>
    </Card>
  );
}
