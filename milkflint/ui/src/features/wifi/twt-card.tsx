// Target Wake Time on each band now: which devices can ask for it, the agreements
// the radio has, and how requests have gone. Its settings are in each band's
// settings.
import { MoonIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePoll } from '@/hooks/use-poll';
import { getLeases } from '@/lib/api/network';
import { endTwt, getTwt, getWirelessStatus, type TwtStatus } from '@/lib/api/wireless';
import { twtScheduleLabel } from './twt';

interface Band {
  radio: string;
  band: string;
  device: string | undefined;
  twt: TwtStatus | undefined;
}

interface Loaded {
  bands: Band[];
  names: Map<string, string>;
}

async function load(): Promise<Loaded> {
  const [status, leases] = await Promise.all([getWirelessStatus(), getLeases().catch(() => [])]);
  const bands = await Promise.all(
    Object.entries(status).map(async ([radio, r]): Promise<Band> => {
      const device = r.iwinfo?.phy;
      return {
        radio,
        band: r.config?.band ?? '',
        device,
        twt: device === undefined ? undefined : await getTwt(device).catch(() => undefined),
      };
    }),
  );
  return {
    bands,
    names: new Map(leases.flatMap((l) => (l.hostname === undefined ? [] : [[l.macaddr.toLowerCase(), l.hostname]]))),
  };
}

function bandLabel(band: string): string {
  return band === '2g' ? '2.4 GHz' : band === '5g' ? '5 GHz' : band === '6g' ? '6 GHz' : band;
}

function requests(t: TwtStatus): string | undefined {
  const c = t.counters;
  if (c === null) return undefined;
  const offered = c.alternate + c.dictate;
  const parts = [
    c.accepted > 0 ? `${String(c.accepted)} agreed` : undefined,
    offered > 0 ? `${String(offered)} offered other terms` : undefined,
    c.rejected > 0 ? `${String(c.rejected)} turned down` : undefined,
    c.lost > 0 ? `${String(c.lost)} ended by a radio restart` : undefined,
  ].filter((p) => p !== undefined);
  return parts.length === 0 ? 'No device has asked since the radio started.' : `Since the radio started: ${parts.join(', ')}.`;
}

function BandStatus({
  band,
  names,
  reload,
}: {
  band: Band;
  names: ReadonlyMap<string, string>;
  reload: () => void;
}): ReactElement {
  const [error, setError] = useState<string>();
  const t = band.twt;

  if (t === undefined || band.device === undefined) {
    return <p className="text-sm text-muted-foreground">Unknown: this firmware doesn’t report it.</p>;
  }
  if (!t.running) return <p className="text-sm text-muted-foreground">Off while this band’s network is off.</p>;
  if (!t.offered) return <p className="text-sm text-muted-foreground">Not offered: it’s off in this band’s settings, or the Wi-Fi mode is older than Wi-Fi 6.</p>;

  const device = band.device;
  const end = (mac: string, flow: number): void => {
    setError(undefined);
    endTwt(device, mac, String(flow)).then(reload, (e: unknown) => {
      setError(e instanceof Error ? e.message : 'The radio didn’t end it.');
    });
  };
  const line = requests(t);

  return (
    <>
      <p className="text-sm">
        {t.stations === 0
          ? 'No devices connected.'
          : `${String(t.capable.length)} of ${String(t.stations)} connected ${t.stations === 1 ? 'device says it' : 'devices say they'} can ask for it.`}
      </p>
      {t.agreements.length > 0 && (
        <ul className="flex flex-col gap-2">
          {t.agreements.map((a) => (
            <li key={`${a.sta}-${String(a.id)}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{names.get(a.sta) ?? a.sta}</span>
                <span className="text-xs text-muted-foreground">
                  {twtScheduleLabel(a.interval_us, a.wake_us)}
                  {a.announced === 1 ? ', says when it’s awake' : ''}
                  {a.trigger === 1 ? ', sends when asked' : ''}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  end(a.sta, a.id);
                }}
              >
                End
              </Button>
            </li>
          ))}
        </ul>
      )}
      {line !== undefined && <p className="text-xs text-muted-foreground">{line}</p>}
      {error !== undefined && <p className="text-xs text-destructive">{error}</p>}
    </>
  );
}

export function TwtCard({ className }: { className?: string }): ReactElement | null {
  const { data, refresh } = usePoll(load, 15_000);
  if (data === undefined || data.bands.length === 0) return null;

  return (
    <Card className={className}>
      <CardHeader className="items-center">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <MoonIcon className="size-4" />
        </div>
        <div className="flex flex-col gap-1">
          <CardTitle className="text-base">Target Wake Time</CardTitle>
          <CardDescription>
            A Wi-Fi 6 device can agree a schedule with the router and sleep between wake times, saving battery. The device asks and chooses; each band’s settings
            say what the router agrees to. Few devices ask yet, and most only when their battery matters.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {data.bands.map((b) => (
          <div key={b.radio} className="flex flex-col gap-3 rounded-lg border bg-background/60 p-3">
            <span className="text-sm font-medium">{bandLabel(b.band)}</span>
            <BandStatus band={b} names={data.names} reload={refresh} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
