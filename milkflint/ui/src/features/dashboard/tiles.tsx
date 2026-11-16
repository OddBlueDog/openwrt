// The status tiles: the internet, the Wi-Fi and the devices, each its icon
// and state in a word, a line or two of detail, and the whole tile a link to
// its page.
import { ChevronRightIcon, GlobeIcon, type LucideIcon, MonitorSmartphoneIcon, WifiIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Sparkline } from '@/components/charts/sparkline';
import { globalIpv6, ipv4 } from '@/lib/api/network';
import { formatBitrate, formatDurationShort, formatNumber } from '@/lib/format';
import { href, type Route } from '@/lib/router';
import { cn } from '@/lib/utils';
import type { Tone } from './model';
import { type Dashboard, HISTORY } from './use-dashboard';
import { Dot, Way } from './widget';
import { useDecorativeIcons } from '@/lib/presentation';
import { devicesGlance, internetGlance, mainRouter, wifiGlance } from './glance';

interface Spark {
  values: readonly (number | undefined)[];
  max: number;
  color: string;
  label: string;
  format: (value: number) => string;
}

function Tile({
  icon: Icon,
  title,
  route,
  tone,
  value,
  lines,
  spark,
  times,
  footer,
}: {
  icon: LucideIcon;
  title: string;
  route: Route;
  tone: Tone | 'off' | undefined;
  value: ReactNode;
  lines: readonly ReactNode[];
  /** the last two minutes along the tile's foot */
  spark?: Spark | undefined;
  times: readonly number[];
  /** a line across the tile under the rest (the internet's addresses) */
  footer?: ReactNode;
}): ReactElement {
  const icons = useDecorativeIcons();
  return (
    <a
      href={href(route)}
      // its own height: beside a taller widget it doesn't stretch into an empty band
      className="group @container flex min-w-0 flex-col rounded-xl border bg-card text-card-foreground shadow-xs transition-colors duration-fast hover:border-rule hover:bg-accent/40"
    >
      <div className={cn('flex min-w-0 items-center gap-3 px-5 pt-4', spark === undefined ? 'pb-4' : 'pb-2')}>
        {/* narrow (a grid column): the details under the headline; wide (a phone): one row, each side as wide as
            it needs, so neither the state nor a detail is cut short */}
        <div className="grid min-w-0 flex-1 gap-x-4 gap-y-2 @2xs:grid-cols-[auto_minmax(0,1fr)] @2xs:items-center">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="flex items-center justify-between gap-2 text-sm font-medium text-muted-foreground">
              <span className="flex min-w-0 items-center gap-2">
                {icons && <Icon className="size-4 shrink-0" aria-hidden="true" />}
                {title}
              </span>
              <ChevronRightIcon
                className="size-4 transition-transform duration-fast group-hover:translate-x-0.5 @2xs:hidden"
                aria-hidden="true"
              />
            </h2>
            <p className="flex items-center gap-2 text-xl font-semibold tracking-tight whitespace-nowrap tabular">
              {tone !== undefined && <Dot tone={tone} className="size-2.5" />}
              {value}
            </p>
          </div>
          {/* each detail keeps to one line, so a tile's height is set by how many it has, never by
              live values wrapping as they change (which would push the whole page down) */}
          <ul className="flex min-w-0 flex-col gap-0.5 text-sm text-muted-foreground tabular @2xs:items-end @2xs:text-right">
            {lines.map((l, i) => (
              <li key={i} className="max-w-full truncate" title={typeof l === 'string' ? l : undefined}>
                {l}
              </li>
            ))}
          </ul>
        </div>
        <ChevronRightIcon className="hidden size-4 shrink-0 text-muted-foreground @2xs:block" aria-hidden="true" />
      </div>
      {footer !== undefined && <div className="px-5 pb-2">{footer}</div>}
      {spark !== undefined && (
        <Sparkline
          values={spark.values}
          max={spark.max}
          slots={HISTORY}
          color={spark.color}
          // the graph follows the tile's rounded foot; the tile itself doesn't clip, so the hover card can rise above it
          className="h-10 [&>svg]:rounded-b-[calc(var(--mf-radius-xl)-1px)]"
          label={spark.label}
          format={spark.format}
          timeOf={(slot) => times[slot - (HISTORY - times.length)]}
        />
      )}
    </a>
  );
}

/** Room above a line's highest point, so a steady value doesn't draw along the tile's top edge. */
const headroom = (values: readonly (number | undefined)[]): number => Math.max(1, ...values.map((v) => v ?? 0)) * 1.2;

export function InternetTile({ d, ap }: { d: Dashboard; ap: boolean }): ReactElement {
  const latest = d.history[d.history.length - 1];
  const times = d.history.map((s) => s.t);
  const g = internetGlance(d, ap);
  if (ap) {
    // in access point mode the way out is the LAN, to the main router
    const gateway = mainRouter(d.lan);
    const online = g.tone === 'success';
    return (
      <Tile
        icon={GlobeIcon}
        title={g.title}
        route={g.route}
        tone={g.tone}
        value={g.value}
        lines={
          online ? [`Via ${gateway}`, `This router ${ipv4(d.lan)?.split('/')[0] ?? 'has no IPv4'}`] : ['No address from it yet']
        }
        times={times}
      />
    );
  }
  const online = d.wan?.up === true;
  const v4 = ipv4(d.wan)?.split('/')[0];
  // the range the provider delegates, else the router's own address
  const prefix = d.wan6?.['ipv6-prefix']?.[0];
  const v6 =
    prefix === undefined
      ? globalIpv6([...(d.wan6?.['ipv6-address'] ?? []), ...(d.wan?.['ipv6-address'] ?? [])].map((a) => a.address))[0]
      : `${prefix.address}/${String(prefix.mask)}`;
  const addresses: [string, string][] = [
    ...(v4 === undefined ? [] : [['IPv4', v4] as [string, string]]),
    ...(v6 === undefined ? [] : [[prefix === undefined ? 'IPv6' : 'IPv6 range', v6] as [string, string]]),
  ];
  return (
    <Tile
      icon={GlobeIcon}
      title={g.title}
      route={g.route}
      tone={g.tone}
      value={g.value}
      lines={
        online
          ? [
              // down and up on lines of their own: a growing rate never pushes the other out of view
              ...(latest?.wanDown === undefined
                ? []
                : [
                    <>
                      <Way dir="down" /> {formatBitrate(latest.wanDown)}
                    </>,
                    <>
                      <Way dir="up" /> {formatBitrate(latest.wanUp ?? 0)}
                    </>,
                  ]),
              `Connected for ${formatDurationShort(d.wan?.uptime ?? 0)}`,
            ]
          : [d.wan === undefined ? 'Set up the connection' : 'The WAN link is down']
      }
      footer={
        online && addresses.length > 0 ? (
          // static once connected, so they may wrap on a phone without the tile jumping
          <p className="flex flex-wrap gap-x-4 gap-y-0.5 border-t pt-2 text-xs text-muted-foreground">
            {addresses.map(([label, value]) => (
              <span key={label} className="flex min-w-0 items-baseline gap-1.5">
                {label}
                <span className="truncate font-mono text-foreground" title={value}>
                  {value}
                </span>
              </span>
            ))}
          </p>
        ) : undefined
      }
      spark={
        online
          ? {
              values: d.history.map((s) => s.wanDown),
              max: headroom(d.history.map((s) => s.wanDown)),
              color: 'var(--chart-2)',
              label: 'Download',
              format: formatBitrate,
            }
          : undefined
      }
      times={times}
    />
  );
}

export function WifiTile({ d }: { d: Dashboard }): ReactElement {
  const g = wifiGlance(d);
  // a band with no network switched on is off by choice, not down
  const on = d.radios.filter((r) => !r.off);
  const traffic = d.history.map((s) => (s.wifiDown === undefined ? undefined : s.wifiDown + (s.wifiUp ?? 0)));
  return (
    <Tile
      icon={WifiIcon}
      title={g.title}
      route={g.route}
      tone={g.tone}
      value={g.value}
      lines={
        d.radios.length === 0
          ? ['No band is turned on']
          : d.radios.map(
              (r) =>
                `${r.band ?? r.name} · ${r.off ? 'off' : r.up ? `${formatNumber(r.clients)} device${r.clients === 1 ? '' : 's'}` : 'down'}`,
            )
      }
      spark={
        on.length === 0
          ? undefined
          : {
              values: traffic,
              max: headroom(traffic),
              color: 'var(--chart-3)',
              label: 'Wi-Fi traffic',
              format: formatBitrate,
            }
      }
      times={d.history.map((s) => s.t)}
    />
  );
}

export function DevicesTile({ d }: { d: Dashboard }): ReactElement {
  const wifi = d.clients.length;
  const g = devicesGlance(d);
  return (
    <Tile
      icon={MonitorSmartphoneIcon}
      title={g.title}
      route={g.route}
      tone={g.tone}
      value={`${g.value} ${g.detail ?? ''}`.trim()}
      lines={[`${formatNumber(wifi)} on Wi-Fi`, ...(d.wired === undefined ? [] : [`${formatNumber(d.wired)} wired`])]}
      spark={{
        values: d.history.map((s) => s.devices),
        max: headroom(d.history.map((s) => s.devices)),
        color: 'var(--chart-1)',
        label: 'Devices',
        format: (n) => `${formatNumber(Math.round(n))} online`,
      }}
      times={d.history.map((s) => s.t)}
    />
  );
}
