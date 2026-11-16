import { RadioTowerIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { formatBitrate, formatNumber } from '@/lib/format';
import { href } from '@/lib/router';
import type { Dashboard } from './use-dashboard';
import { Dot, OffNote, Way, Widget, WidgetLink } from './widget';

export function RadiosCard({ d }: { d: Dashboard }): ReactElement {
  const radios = d.radios;
  const link = <WidgetLink href={href('wifi')}>Wi-Fi settings</WidgetLink>;
  return (
    <Widget
      icon={RadioTowerIcon}
      title="Radios"
      status={`${String(radios.length)} turned on`}
      aside={radios.length === 0 ? undefined : link}
    >
      {radios.length === 0 ? (
        <OffNote action={link}>No Wi-Fi band is turned on.</OffNote>
      ) : (
        <ul className="flex flex-col divide-y px-5">
          {radios.map((r) => (
            <li key={r.name} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{r.band ?? r.name}</span>
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Dot tone={r.off ? 'off' : r.up ? 'success' : 'warning'} />
                  {r.off ? 'Off' : r.up ? 'On' : 'Down'}
                </span>
              </div>
              <div className="truncate text-sm text-muted-foreground">
                {r.ssids.length > 0 ? r.ssids.join(', ') : 'No network'}
              </div>
              <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5 text-xs">
                {r.channel !== undefined && (
                  <>
                    <dt className="text-muted-foreground">Channel</dt>
                    <dd className="tabular">
                      {r.channel}
                      {r.htmode !== undefined && ` · ${r.htmode}`}
                    </dd>
                  </>
                )}
                {r.txpower !== undefined && (
                  <>
                    <dt className="text-muted-foreground">Power</dt>
                    <dd className="tabular">
                      {r.txpower} dBm{r.noise !== undefined && r.noise !== 0 && ` · noise ${String(r.noise)} dBm`}
                    </dd>
                  </>
                )}
                <dt className="text-muted-foreground">Devices</dt>
                <dd className="tabular">
                  {formatNumber(r.clients)}
                  {r.rateDown !== undefined && (
                    <>
                      {' · '}
                      <Way dir="down" /> {formatBitrate(r.rateDown)} <Way dir="up" /> {formatBitrate(r.rateUp ?? 0)}
                    </>
                  )}
                </dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}
