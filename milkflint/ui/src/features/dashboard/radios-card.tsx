import type { ReactElement } from 'react';
import { formatBitrate, formatNumber } from '@/lib/format';
import { pageLink } from '@/lib/router';
import type { Dashboard } from './use-dashboard';
import { cn } from '@/lib/utils';
import { Dot, OffNote, Way, Widget, WidgetLink } from './widget';
import { useWidgetInfo } from './widget-info';

// Each Wi-Fi band: on or off, its networks, channel, power and devices. A band
// that's off is its name and "Off" (it has no network to show); the bands that
// are on share the height. Their details go, the last first, when the widget
// is short of room (fit.ts).
export function RadiosCard({ d }: { d: Dashboard }): ReactElement {
  const radios = d.radios;
  const on = radios.filter((r) => !r.off).length;
  // one column: each band's channel and devices on a line; wider: the bands side by side, in full
  const narrow = useWidgetInfo().size.w === 1;
  const link = <WidgetLink to={pageLink('wifi')}>Wi-Fi settings</WidgetLink>;
  return (
    <Widget
      status={on === radios.length ? `${String(on)} turned on` : `${String(on)} of ${String(radios.length)} turned on`}
      aside={radios.length === 0 ? undefined : link}
    >
      {radios.length === 0 ? (
        <OffNote action={link}>No Wi-Fi band is turned on.</OffNote>
      ) : (
        // each band an equal share of the widget's height (or width), however big its cell
        <ul
          className={cn(
            'flex flex-1 px-5',
            narrow ? 'flex-col divide-y' : 'flex-col divide-y @sm:flex-row @sm:divide-x @sm:divide-y-0',
          )}
        >
          {radios.map((r) => (
            <li
              key={r.name}
              className={cn(
                // side by side, a band's long network names are cut short rather than push it wider
                'flex min-w-0 flex-col gap-1',
                !r.off && 'flex-1',
                narrow ? 'py-2 first:pt-0 last:pb-0' : 'py-3 first:pt-0 last:pb-0 @sm:px-4 @sm:py-0 @sm:first:pl-0 @sm:last:pr-0',
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{r.band ?? r.name}</span>
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Dot tone={r.off ? 'off' : r.up ? 'success' : 'warning'} />
                  {r.off ? 'Off' : r.up ? 'On' : 'Down'}
                </span>
              </div>
              {!r.off && (
                <div data-fit className="truncate text-sm text-muted-foreground" title={r.ssids.join(', ')}>
                  {r.ssids.length > 0 ? r.ssids.join(', ') : 'No network'}
                </div>
              )}
              {r.off ? null : narrow ? (
                <p data-fit="2" className="truncate text-xs text-muted-foreground tabular">
                  {r.channel === undefined ? '' : `Channel ${String(r.channel)} · `}
                  {formatNumber(r.clients)} device{r.clients === 1 ? '' : 's'}
                </p>
              ) : (
                <dl data-fit="2" className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5 text-xs">
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
              )}
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}
