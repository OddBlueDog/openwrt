// What beamforming each band runs with now, from hostapd's config for each
// radio. OpenWrt turns on every kind the radio supports (wifi-scripts'
// defaults); each network's settings have switches for beamforming and
// MU-MIMO, which some Wi-Fi cards handle badly.
import { CheckIcon, MinusIcon, RadarIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePoll } from '@/hooks/use-poll';
import { type Beamforming, getBeamforming, getWirelessStatus } from '@/lib/api/wireless';
import { cn } from '@/lib/utils';

interface Band {
  radio: string;
  band: string;
  beamforming: Beamforming | undefined;
}

async function loadBands(): Promise<Band[]> {
  const status = await getWirelessStatus();
  return Promise.all(
    Object.entries(status).map(async ([radio, r]): Promise<Band> => {
      const phy = r.iwinfo?.phy;
      return {
        radio,
        band: r.config?.band ?? '',
        beamforming: phy === undefined ? undefined : await getBeamforming(phy).catch(() => undefined),
      };
    }),
  );
}

function bandLabel(band: string): string {
  return band === '2g' ? '2.4 GHz' : band === '5g' ? '5 GHz' : band === '6g' ? '6 GHz' : band;
}

function Item({ on, children }: { on: boolean; children: string }): ReactElement {
  return (
    <li className={cn('flex items-center gap-2 text-sm', !on && 'text-muted-foreground')}>
      {on ? <CheckIcon className="size-4 shrink-0 text-success" /> : <MinusIcon className="size-4 shrink-0" />}
      {children}
      {!on && <span className="sr-only">(off)</span>}
    </li>
  );
}

function Generation({
  title,
  su,
  mu,
  receives,
  antennas,
}: {
  title: string;
  su: boolean;
  mu: boolean;
  receives: boolean;
  antennas?: number | null | undefined;
}): ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      <ul className="flex flex-col gap-1">
        <Item on={su}>{`Aims at one device at a time${su && typeof antennas === 'number' ? `, with up to ${String(antennas)} antennas` : ''}`}</Item>
        <Item on={mu}>Aims at several devices at once (MU-MIMO)</Item>
        <Item on={receives}>Takes beamforming from devices that aim at it</Item>
      </ul>
    </div>
  );
}

export function BeamformingCard({ className }: { className?: string }): ReactElement | null {
  const bands = usePoll(loadBands, 30_000).data;
  if (bands === undefined || bands.length === 0) return null;

  return (
    <Card className={className}>
      <CardHeader className="items-center">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <RadarIcon className="size-4" />
        </div>
        <div className="flex flex-col gap-1">
          <CardTitle className="text-base">Beamforming</CardTitle>
          <CardDescription>
            Aims the signal at each device instead of spreading it evenly, for more speed and range. What each band runs with now; switch it
            in the band's settings. Devices need Wi-Fi 5 or newer to use it.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {bands.map((b) => {
          const bf = b.beamforming;
          return (
            <div key={b.radio} className="flex flex-col gap-3 rounded-lg border bg-background/60 p-3">
              <span className="text-sm font-medium">{bandLabel(b.band)}</span>
              {bf === undefined ? (
                <p className="text-sm text-muted-foreground">Unknown: this firmware doesn’t report it.</p>
              ) : !bf.running ? (
                <p className="text-sm text-muted-foreground">Off while this band’s network is off.</p>
              ) : bf.he === null && bf.vht === null ? (
                <p className="text-sm text-muted-foreground">None: the Wi-Fi mode is older than Wi-Fi 5, which beamforming needs.</p>
              ) : (
                <>
                  {bf.he !== null && (
                    <Generation
                      title="Wi-Fi 6 (802.11ax)"
                      su={bf.he.su_beamformer}
                      mu={bf.he.mu_beamformer}
                      receives={bf.he.su_beamformee}
                    />
                  )}
                  {bf.vht !== null && (
                    <Generation
                      title="Wi-Fi 5 (802.11ac), for Wi-Fi 5 devices"
                      su={bf.vht.su_beamformer}
                      mu={bf.vht.mu_beamformer}
                      receives={bf.vht.su_beamformee || bf.vht.mu_beamformee}
                      antennas={bf.vht.sounding_dimensions}
                    />
                  )}
                </>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
