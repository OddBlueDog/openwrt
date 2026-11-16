// The Wi-Fi devices, busiest first: what each is downloading and uploading
// now, its signal, its link speeds and how long it's been connected. A table
// on a wide card, a list of cards on a narrow one, with the same figures.
import { ChartBarDecreasingIcon, MonitorSmartphoneIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { SignalBars, SNR_HINT } from '@/components/charts/signal-bars';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatBitrate, formatBytes, formatDuration, formatNumber } from '@/lib/format';
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';
import { deviceLabel } from '../clients/model';
import { busiestFirst } from './model';
import type { Client, Dashboard } from './use-dashboard';
import { OffNote, Way, Widget, WidgetLink } from './widget';

const SHOWN = 8;

/** Its name, or "Unnamed device" as on every page that lists devices (its address is under it). */
const label = (c: Client): string => deviceLabel(c.name);

function whereTheNameIsFrom(c: Client): string {
  switch (c.nameFrom) {
    case 'you':
      return 'You named it on All devices.';
    case 'device':
      return 'It sent this name when it asked for an address.';
    case 'router':
      return 'The router knows it by this name.';
    case undefined:
      return c.privateMac
        ? 'It sent no name, and its private address doesn’t say who made it. You can name it on All devices.'
        : 'It sent no name. You can name it on All devices.';
  }
}

/** What the row doesn't already show. */
function Details({ c }: { c: Client }): ReactElement {
  return (
    <TooltipContent side="bottom" align="start" className="max-w-sm text-pretty">
      <p className="font-medium">{label(c)}</p>
      <p className="mt-0.5 opacity-80">{whereTheNameIsFrom(c)}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="opacity-70">MAC</dt>
        <dd>
          <span className="font-mono">{c.mac}</span>
          {c.privateMac && <span className="opacity-70"> · private</span>}
        </dd>
        {c.generation !== undefined && c.generation > 0 && (
          <>
            <dt className="opacity-70">Wi-Fi</dt>
            <dd>Wi-Fi {String(c.generation)}</dd>
          </>
        )}
        {c.ssid !== undefined && (
          <>
            <dt className="opacity-70">Network</dt>
            <dd>{c.ssid}</dd>
          </>
        )}
        {c.reservedIp !== undefined && (
          <>
            <dt className="opacity-70">Address</dt>
            <dd>Reserved: always gets {c.reservedIp}</dd>
          </>
        )}
        {c.ipv6.length > 0 && (
          <>
            <dt className="opacity-70">IPv6</dt>
            <dd className="font-mono break-all">
              {c.ipv6.map((a) => (
                <div key={a}>{a}</div>
              ))}
            </dd>
          </>
        )}
        {c.txBytes !== undefined && c.rxBytes !== undefined && (
          <>
            <dt className="opacity-70">Since joining</dt>
            <dd className="tabular">
              {formatBytes(c.txBytes)} down · {formatBytes(c.rxBytes)} up
            </dd>
          </>
        )}
      </dl>
    </TooltipContent>
  );
}

/** The device's name, with what the row leaves out behind it (hover or focus). */
function Name({ c }: { c: Client }): ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Tooltip>
        <TooltipTrigger
          aria-label={`About ${label(c)}`}
          className="flex size-8 shrink-0 cursor-default items-center justify-center rounded-full bg-secondary"
        >
          {/* the kind of device isn't known: a neutral one, not a phone for everything */}
          <MonitorSmartphoneIcon className="size-4 text-muted-foreground" />
        </TooltipTrigger>
        <Details c={c} />
      </Tooltip>
      <div className="min-w-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                'block cursor-default truncate underline decoration-muted-foreground/50 decoration-dotted underline-offset-4',
                c.name === undefined ? 'text-muted-foreground' : 'font-medium',
              )}
            >
              {label(c)}
            </span>
          </TooltipTrigger>
          <Details c={c} />
        </Tooltip>
        <div className="truncate text-xs text-muted-foreground tabular">
          {c.band ?? 'Wi-Fi'} · {c.ip ?? c.mac}
        </div>
      </div>
    </div>
  );
}

/** Its download now as a bar against the busiest device's, with the figures. */
function Traffic({ c, most }: { c: Client; most: number }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-chart-2" style={{ width: `${String(((c.down ?? 0) / most) * 100)}%` }} />
      </div>
      <span className="flex flex-wrap gap-x-2 text-xs tabular">
        <span className="font-medium whitespace-nowrap">
          <Way dir="down" /> {c.down === undefined ? '—' : formatBitrate(c.down)}
        </span>
        <span className="whitespace-nowrap text-muted-foreground">
          <Way dir="up" /> {c.up === undefined ? '—' : formatBitrate(c.up)}
        </span>
      </span>
    </div>
  );
}

function Signal({ c }: { c: Client }): ReactElement {
  return (
    <span className="flex items-center gap-2 tabular">
      <SignalBars dbm={c.signal} />
      <span className="flex flex-col text-xs leading-tight whitespace-nowrap">
        <span>{c.signal === undefined ? '—' : `${String(c.signal)} dBm`}</span>
        {c.snr !== undefined && (
          <span className="cursor-help text-muted-foreground" title={SNR_HINT}>
            SNR {String(c.snr)} dB
          </span>
        )}
      </span>
    </span>
  );
}

function Link({ c, stacked = false }: { c: Client; stacked?: boolean }): ReactElement {
  const down = c.txRate === undefined ? '—' : formatBitrate(c.txRate);
  const up = c.rxRate === undefined ? '—' : formatBitrate(c.rxRate);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default text-xs whitespace-nowrap tabular underline decoration-muted-foreground/50 decoration-dotted underline-offset-4">
          {stacked ? (
            <>
              <Way dir="down" /> {down}
              <br />
              <Way dir="up" /> {up}
            </>
          ) : (
            `${down} / ${up}`
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div>To device: {c.txDescription ?? 'unknown'}</div>
        <div>From device: {c.rxDescription ?? 'unknown'}</div>
      </TooltipContent>
    </Tooltip>
  );
}

const connected = (c: Client): string => (c.connectedSeconds === undefined ? '—' : formatDuration(c.connectedSeconds));

/** "1 device on Wi-Fi now", "9 devices on Wi-Fi now". */
function onWifi(count: number): string {
  return `${formatNumber(count)} ${count === 1 ? 'device' : 'devices'} on Wi-Fi now`;
}

/** Devices per band, in band order. */
function perBand(clients: Dashboard['clients']): [string, number][] {
  const bands = new Map<string, number>();
  for (const c of clients) bands.set(c.band ?? 'Other', (bands.get(c.band ?? 'Other') ?? 0) + 1);
  return [...bands].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
}

export function ClientsCard({ d }: { d: Dashboard }): ReactElement {
  const shown = busiestFirst(d.clients).slice(0, SHOWN);
  const most = Math.max(1, ...shown.map((c) => c.down ?? 0));
  const count = d.clients.length;
  return (
    <Widget
      icon={ChartBarDecreasingIcon}
      title="Busiest Wi-Fi devices"
      status={
        count === 0 ? undefined : count > SHOWN ? `${String(SHOWN)} of ${formatNumber(count)}, busiest first` : 'Busiest first'
      }
      aside={<WidgetLink href={href('clients')}>All devices</WidgetLink>}
    >
      {count === 0 ? (
        <OffNote action={<WidgetLink href={href('wifi')}>Wi-Fi settings</WidgetLink>}>
          No devices are connected to the Wi-Fi right now.
        </OffNote>
      ) : (
        <>
          {/* a wide card: a table */}
          <div className="hidden @2xl:block">
            {/* the device column takes what the figures leave (and truncates); the figures never wrap */}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y bg-muted/50 text-left text-xs text-muted-foreground">
                  <th scope="col" className="h-9 w-full py-0 pr-3 pl-5 font-medium">
                    Device
                  </th>
                  <th scope="col" className="px-3 font-medium whitespace-nowrap">
                    Now
                  </th>
                  <th scope="col" className="px-3 font-medium whitespace-nowrap">
                    Signal
                  </th>
                  <th scope="col" className="px-3 font-medium whitespace-nowrap">
                    <span title="The link speeds the radios negotiated, to the device and from it">
                      Link <Way dir="down" /> / <Way dir="up" />
                    </span>
                  </th>
                  <th scope="col" className="py-0 pr-5 pl-3 text-right font-medium whitespace-nowrap">
                    Connected
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {shown.map((c) => (
                  <tr key={c.mac}>
                    <td className="max-w-0 py-2.5 pr-3 pl-5">
                      <Name c={c} />
                    </td>
                    <td className="w-32 min-w-32 px-3 py-2.5">
                      <Traffic c={c} most={most} />
                    </td>
                    <td className="px-3 py-2.5">
                      <Signal c={c} />
                    </td>
                    <td className="px-3 py-2.5">
                      <Link c={c} />
                    </td>
                    <td className="py-2.5 pr-5 pl-3 text-right text-xs whitespace-nowrap text-muted-foreground tabular">
                      {connected(c)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* a narrow card (a phone): one card per device, every figure kept */}
          <ul className="flex flex-col divide-y border-t @2xl:hidden">
            {shown.map((c) => (
              <li key={c.mac} className="flex flex-col gap-3 px-5 py-3">
                <Name c={c} />
                <Traffic c={c} most={most} />
                <dl className="grid grid-cols-3 gap-x-3 gap-y-1">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">Signal</dt>
                    <dd>
                      <Signal c={c} />
                    </dd>
                  </div>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">Link</dt>
                    <dd className="leading-tight">
                      <Link c={c} stacked />
                    </dd>
                  </div>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">Connected</dt>
                    <dd className="text-xs tabular">{connected(c)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          {/* the bottom of the card: how many are on Wi-Fi and where, however tall its row is */}
          <p className="mt-auto flex flex-wrap gap-x-3 gap-y-1 border-t px-5 pt-4 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{onWifi(count)}</span>
            {perBand(d.clients).map(([band, n]) => (
              <span key={band}>
                {band} · {formatNumber(n)}
              </span>
            ))}
          </p>
        </>
      )}
    </Widget>
  );
}
