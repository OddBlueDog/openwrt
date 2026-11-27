// Busiest devices: all of them, those on the Wi-Fi or those on a cable,
// busiest first: what each is downloading and uploading now, and for the
// Wi-Fi ones their signal, link speeds and how long they've been connected.
// A table on a wide card, a list of cards on a narrow one, with the same
// figures. Which devices is a switch in its heading (busy.ts keeps it).
import { EthernetPortIcon, MonitorSmartphoneIcon } from 'lucide-react';
import { type ReactElement, useMemo } from 'react';
import { SignalBars, SNR_HINT } from '@/components/charts/signal-bars';
import { type Column, DataTable } from '@/components/data-table';
import { Segmented } from '@/components/ui/segmented';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatBitrate, formatBytes, formatDuration, formatNumber } from '@/lib/format';
import { pageLink } from '@/lib/router';
import { cn } from '@/lib/utils';
import { deviceLabel } from '../clients/model';
import { busyFilter, useBusyDevices } from './busy';
import type { BusyDevice, BusyFilter } from './model';
import type { Client, Dashboard } from './use-dashboard';
import { useFit } from './fit';
import { OffNote, Way, Widget, WidgetLink } from './widget';

/** At most how many devices it lists at one row tall, and at two (fewer where they don’t fit). */
const SHOWN = { 1: 4, 2: 8 } as const;

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

/** A wired device's tooltip: where its figures come from. */
function WiredDetails({ d }: { d: BusyDevice }): ReactElement {
  return (
    <TooltipContent side="bottom" align="start" className="max-w-sm text-pretty">
      <p className="font-medium">{deviceLabel(d.name)}</p>
      <p className="mt-0.5 opacity-80">
        On a cable. Its figures are what passes through the router, from its connections: traffic to another device on your
        network doesn’t count.
      </p>
      {d.key !== d.ip && (
        <p className="mt-2">
          <span className="opacity-70">MAC </span>
          <span className="font-mono">{d.key}</span>
        </p>
      )}
    </TooltipContent>
  );
}

/** The device's name, with what the row leaves out behind it (hover or focus). */
function Name({ d }: { d: BusyDevice }): ReactElement {
  const c = d.wifi;
  const details = c === undefined ? <WiredDetails d={d} /> : <Details c={c} />;
  const Icon = c === undefined ? EthernetPortIcon : MonitorSmartphoneIcon;
  const label = deviceLabel(d.name);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Tooltip>
        <TooltipTrigger
          aria-label={`About ${label}`}
          className="flex size-8 shrink-0 cursor-default items-center justify-center rounded-full bg-secondary"
        >
          {/* the kind of device isn't known: a neutral one, not a phone for everything */}
          <Icon className="size-4 text-muted-foreground" />
        </TooltipTrigger>
        {details}
      </Tooltip>
      <div className="min-w-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                'block cursor-default truncate underline decoration-muted-foreground/50 decoration-dotted underline-offset-4',
                d.name === undefined ? 'text-muted-foreground' : 'font-medium',
              )}
            >
              {label}
            </span>
          </TooltipTrigger>
          {details}
        </Tooltip>
        <div className="truncate text-xs text-muted-foreground tabular">
          {c === undefined ? 'Cable' : (c.band ?? 'Wi-Fi')} · {d.ip ?? d.key}
        </div>
      </div>
    </div>
  );
}

/** Its download now as a bar against the busiest device's, with the figures. */
function Traffic({ c, most }: { c: BusyDevice; most: number }): ReactElement {
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

/** A Wi-Fi figure, or a dash for a device on a cable. */
const onWifi = (d: BusyDevice, show: (c: Client) => ReactElement | string): ReactElement | string =>
  d.wifi === undefined ? <span className="text-xs text-muted-foreground">—</span> : show(d.wifi);

/**
 * The table's columns, each bar against the busiest device's download
 * (`most`); the device column takes what the figures leave (and truncates).
 * On a cable there's no signal, link or connection time: LAN alone leaves them out.
 */
function columnsFor(most: number, filter: BusyFilter): Column<BusyDevice>[] {
  const all: Column<BusyDevice>[] = [
    { label: 'Device', cell: (d) => <Name d={d} />, className: 'w-full max-w-0' },
    { label: 'Now', cell: (d) => <Traffic c={d} most={most} />, className: 'w-32 min-w-32' },
  ];
  if (filter === 'lan') return all;
  return [
    ...all,
    { label: 'Signal', cell: (d) => onWifi(d, (c) => <Signal c={c} />) },
    {
      label: 'Link',
      header: (
        <>
          Link <Way dir="down" /> / <Way dir="up" />
        </>
      ),
      title: 'The link speeds the radios negotiated, to the device and from it',
      cell: (d) => onWifi(d, (c) => <Link c={c} />),
    },
    {
      label: 'Connected',
      cell: (d) => onWifi(d, connected),
      className: 'text-right text-xs whitespace-nowrap text-muted-foreground tabular',
    },
  ];
}

const devices = (n: number): string => `${formatNumber(n)} ${n === 1 ? 'device' : 'devices'}`;

/** The foot of the card: how many are online, on the Wi-Fi (by band) and on a cable, for the filter. */
function Totals({ d, filter }: { d: Dashboard; filter: BusyFilter }): ReactElement {
  const wifi = d.clients.length;
  const wired = d.wired;
  const lead =
    filter === 'wifi'
      ? `${devices(wifi)} on Wi-Fi now`
      : filter === 'lan'
        ? wired === undefined
          ? 'Wired devices'
          : `${devices(wired)} on a cable now`
        : wired === undefined
          ? `${devices(wifi)} on Wi-Fi now`
          : `${devices(wifi + wired)} online now`;
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 border-t px-5 pt-4 text-sm text-muted-foreground">
      <span className="font-medium text-foreground">{lead}</span>
      {filter !== 'lan' &&
        perBand(d.clients).map(([band, n]) => (
          <span key={band}>
            {band} · {formatNumber(n)}
          </span>
        ))}
      {filter === 'all' && wired !== undefined && <span>Cable · {formatNumber(wired)}</span>}
    </p>
  );
}

/** Devices per band, in band order. */
function perBand(clients: Dashboard['clients']): [string, number][] {
  const bands = new Map<string, number>();
  for (const c of clients) bands.set(c.band ?? 'Other', (bands.get(c.band ?? 'Other') ?? 0) + 1);
  return [...bands].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
}

const FILTERS: readonly { value: BusyFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'wifi', label: 'Wi-Fi' },
  { value: 'lan', label: 'LAN' },
];

const EMPTY: Readonly<Record<BusyFilter, string>> = {
  all: 'No devices are online right now.',
  wifi: 'No devices are connected to the Wi-Fi right now.',
  lan: 'No wired device has traffic through the router right now.',
};

export function BusiestCard({ d, rows }: { d: Dashboard; rows: 1 | 2 }): ReactElement {
  const busy = useBusyDevices(d);
  const shown = busy.rows.slice(0, SHOWN[rows]);
  const most = Math.max(1, ...shown.map((c) => c.down ?? 0));
  const columns = useMemo(() => columnsFor(most, busy.filter), [most, busy.filter]);
  // the list is as long as the widget has room for, above the total
  const list = useFit<HTMLDivElement>();
  return (
    <Widget
      description="Wi-Fi figures come from the radios every 2 s; wired ones from their connections through the router, every 10 s or so."
      aside={
        <>
          <Segmented
            size="xs"
            label="Which devices"
            value={busy.filter}
            options={FILTERS}
            onChange={(f) => {
              busyFilter.save(f);
            }}
          />
          <WidgetLink to={pageLink('clients')}>All devices</WidgetLink>
        </>
      }
    >
      {shown.length === 0 ? (
        <OffNote action={busy.filter === 'wifi' ? <WidgetLink to={pageLink('wifi')}>Wi-Fi settings</WidgetLink> : null}>
          {busy.waiting ? 'Reading the wired devices’ connections…' : EMPTY[busy.filter]}
        </OffNote>
      ) : (
        <>
          <div {...list} className="flex min-h-0 flex-1 flex-col">
            {/* a table on a wide card; on a narrow one (a phone), a card per device, every figure kept */}
            <DataTable
              label="Busiest devices"
              columns={columns}
              rows={shown}
              rowKey={(c) => c.key}
              // the widget says when there are none
              empty={null}
              fit
              framed={false}
              className="border-t"
              card={(c) => (
                <div className="flex flex-col gap-3 px-5 py-3">
                  <Name d={c} />
                  <Traffic c={c} most={most} />
                  {c.wifi !== undefined && (
                    <dl className="grid grid-cols-3 gap-x-3 gap-y-1">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <dt className="text-xs text-muted-foreground">Signal</dt>
                        <dd>
                          <Signal c={c.wifi} />
                        </dd>
                      </div>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <dt className="text-xs text-muted-foreground">Link</dt>
                        <dd className="leading-tight">
                          <Link c={c.wifi} stacked />
                        </dd>
                      </div>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <dt className="text-xs text-muted-foreground">Connected</dt>
                        <dd className="text-xs tabular">{connected(c.wifi)}</dd>
                      </div>
                    </dl>
                  )}
                </div>
              )}
            />
          </div>
          <Totals d={d} filter={busy.filter} />
        </>
      )}
    </Widget>
  );
}
