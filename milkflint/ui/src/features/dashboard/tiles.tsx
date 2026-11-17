// The status tiles, each a widget's one-column size: its icon and state in a
// word or figure, a line or two of detail, the last minutes as a graph that
// fills the rest of the tile (without one, the detail sits at the foot), and
// the whole tile a link to its page. The busiest devices' is a short list
// instead, as many as fit.
import { ChevronRightIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Sparkline } from '@/components/charts/sparkline';
import { globalIpv6, ipv4 } from '@/lib/api/network';
import type { Poll } from '@/hooks/use-poll';
import { Progress } from '@/components/ui/progress';
import { formatBitrate, formatBitrateOf, formatDurationShort, formatNumber, formatPercent } from '@/lib/format';
import { href, type Route } from '@/lib/router';
import { cn } from '@/lib/utils';
import type { Live } from '../network-quality/live';
import { deviceLabel } from '../clients/model';
import { delayMs } from '../sqm/cake';
import { CoreRings } from './core-rings';
import { useFit } from './fit';
import { busiestFirst, ms, pingScale, responsiveness, SHAPING_BUSY, shapingShare, temperatureLevel, type Tone } from './model';
import { sensorLabel, slotted, STEP_S, useSensorHistory } from './sensors';
import { type CakeDirection, type Dashboard, HISTORY } from './use-dashboard';
import { Dot, Way } from './widget';
import { useWidgetInfo } from './widget-info';
import { useDecorativeIcons } from '@/lib/presentation';
import { devicesGlance, internetGlance, mainRouter, responsivenessGlance, wifiGlance } from './glance';

const TILE =
  'group @container flex h-full min-w-0 flex-col rounded-xl border bg-card text-card-foreground shadow-xs transition-colors duration-fast hover:border-rule hover:bg-accent/40';

interface Spark {
  values: readonly (number | undefined)[];
  max: number;
  color: string;
  label: string;
  format: (value: number) => string;
}

function Tile({
  title: named,
  route,
  tone,
  value,
  lines,
  spark,
  slots = HISTORY,
  times,
  graphic,
  footer,
}: {
  /** the widget's own, unless it says otherwise (the main router's in access point mode) */
  title?: string;
  route: Route;
  tone: Tone | 'off' | undefined;
  value: ReactNode;
  lines: readonly ReactNode[];
  /** the last minutes along the tile's foot */
  spark?: Spark | undefined;
  /** how many samples the graph's width holds: the dashboard's two minutes unless said */
  slots?: number;
  times: readonly number[];
  /** a picture under the details that stays when they go (each core's ring, Smart Queue's share of its limits) */
  graphic?: ReactNode;
  /** a line across the tile under the rest (the internet's addresses) */
  footer?: ReactNode;
}): ReactElement {
  const icons = useDecorativeIcons();
  const info = useWidgetInfo();
  const Icon = info.icon;
  const title = named ?? info.title;
  // when the cell is short: the graph goes first, then the last details; the addresses stay
  const box = useFit<HTMLAnchorElement>();
  const last = spark !== undefined ? 'spark' : footer !== undefined ? 'footer' : graphic !== undefined ? 'graphic' : 'words';
  return (
    <a
      {...box}
      href={href(route)}
      // the graph takes whatever height the cell has beyond the words, so there's no blank band at the foot
      className={TILE}
    >
      <div
        className={cn(
          'flex min-w-0 gap-3 px-5 pt-4',
          spark === undefined ? 'flex-1' : 'items-center',
          // the tile's foot is whatever comes last: these words, the picture under them, or the graph
          last === 'words' ? 'pb-4' : 'pb-2',
        )}
      >
        {/* narrow (a grid column): the details under the headline (at the foot when there's no graph); wide (a
            phone): one row, each side as wide as it needs, so neither the state nor a detail is cut short */}
        <div
          className={cn(
            'grid min-w-0 flex-1 gap-x-4 gap-y-2 @2xs:grid-cols-[auto_minmax(0,1fr)] @2xs:items-center',
            spark === undefined && 'content-between @2xs:content-center',
          )}
        >
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
              <li key={i} data-fit className="max-w-full truncate" title={typeof l === 'string' ? l : undefined}>
                {l}
              </li>
            ))}
          </ul>
        </div>
        <ChevronRightIcon className="hidden size-4 shrink-0 self-center text-muted-foreground @2xs:block" aria-hidden="true" />
      </div>
      {graphic !== undefined && <div className={cn('px-5', last === 'graphic' ? 'pb-4' : 'pb-2')}>{graphic}</div>}
      {footer !== undefined && <div className={cn('px-5', last === 'footer' ? 'pb-4' : 'pb-2')}>{footer}</div>}
      {spark !== undefined && (
        // grows into the cell's spare height and follows the tile's rounded foot (the tile itself doesn't clip, so
        // the hover card can rise above it); short of room, it goes before the figures and addresses do
        <div data-fit="2" className="mt-auto flex min-h-6 flex-1 flex-col">
          <Sparkline
            values={spark.values}
            max={spark.max}
            slots={slots}
            color={spark.color}
            className="h-auto min-h-6 flex-1 [&>svg]:absolute [&>svg]:inset-0 [&>svg]:rounded-b-[calc(var(--mf-radius-xl)-1px)]"
            label={spark.label}
            format={spark.format}
            timeOf={(slot) => times[slot - (slots - times.length)]}
          />
        </div>
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
    // a range shows its length (/56): no need to say so beside it, where a tile is narrow
    ...(v6 === undefined ? [] : [['IPv6', v6] as [string, string]]),
  ];
  return (
    <Tile
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

/** Ten minutes of pings along the tile's foot. */
const PING_SPAN_S = 600;

/** Responsiveness as a tile: the last 5 minutes' typical ping, its state, the latest, and the hour's worst and loss. */
export function ResponsivenessTile({ live }: { live: Poll<Live> }): ReactElement {
  const g = responsivenessGlance(live);
  const data = live.data;
  if (data?.status.enabled !== true) {
    return <Tile title={g.title} route={g.route} tone={g.tone} value={g.value} lines={[]} times={[]} />;
  }
  const { status, samples } = data;
  const r = responsiveness(samples, status.now);
  const recent = samples.filter((s) => s.t > status.now - PING_SPAN_S);
  const values = recent.map((s) => s.internet ?? undefined);
  return (
    <Tile
      title={g.title}
      route={g.route}
      tone={g.tone}
      value={g.value}
      lines={[
        r.state.label,
        r.now === undefined ? 'No ping yet' : r.now === null ? 'Latest ping lost' : `Latest ${ms(r.now)}`,
        `Worst ${r.hour.worst === undefined ? '—' : ms(r.hour.worst)} · ${formatPercent(r.hour.loss)} lost`,
      ]}
      spark={{
        values,
        max: pingScale(values.filter((v) => v !== undefined)).top,
        color: 'var(--chart-1)',
        label: 'Ping',
        format: ms,
      }}
      slots={Math.round(PING_SPAN_S / (status.interval ?? 5))}
      times={recent.map((s) => s.t)}
    />
  );
}

/** The processor: its use now, each core's as a ring, the load, and its last two minutes. */
export function CpuTile({ d }: { d: Dashboard }): ReactElement {
  const load = d.info.load.map((l) => (l / 65536).toFixed(2));
  return (
    <Tile
      route="system-overview"
      tone={undefined}
      value={d.cpu === undefined ? '—' : formatPercent(d.cpu)}
      lines={[`Load ${load.join(' · ')}`]}
      graphic={d.cores.length > 1 ? <CoreRings cores={d.cores} /> : undefined}
      spark={{
        values: d.history.map((s) => s.cpu),
        max: 1,
        color: 'var(--chart-1)',
        label: 'CPU',
        format: formatPercent,
      }}
      times={d.history.map((s) => s.t)}
    />
  );
}

/** Ten minutes of the hottest sensor along the tile's foot. */
const SENSOR_SPAN_S = 600;

/** The hottest sensor now, how many there are and their range, and the hottest's last ten minutes. */
export function TemperatureTile({ d }: { d: Dashboard }): ReactElement {
  const sensors = d.stats.temperatures;
  const history = useSensorHistory(sensors);
  const hottest = sensors.reduce<(typeof sensors)[number] | undefined>(
    (a, t) => (a === undefined || t.celsius > a.celsius ? t : a),
    undefined,
  );
  if (hottest === undefined) {
    // Home leaves the widget out without sensors; the catalogue says why
    return <Tile route="system-overview" tone="off" value="None" lines={['No sensors on this router']} times={[]} />;
  }
  const level = temperatureLevel(hottest.celsius);
  const name = sensorLabel(hottest, d);
  const readings = sensors.map((t) => t.celsius);
  const step = history.data?.interval ?? STEP_S;
  const slots = Math.round(SENSOR_SPAN_S / step);
  const now = history.data?.now ?? 0;
  const values = history.data === undefined ? [] : slotted(history.data.samples, hottest.name, now, slots, step);
  const seen = [hottest.celsius, ...values.filter((v): v is number => v !== undefined)];
  // its own range, at least 10 °C tall, so a steady temperature draws flat (as on the widget)
  const span = Math.max(10, Math.max(...seen) - Math.min(...seen));
  const floor = (Math.min(...seen) + Math.max(...seen) - span) / 2;
  return (
    <Tile
      route="system-overview"
      tone={level === 'hot' ? 'destructive' : level === 'warm' ? 'warning' : undefined}
      value={`${hottest.celsius.toFixed(0)} °C`}
      lines={[
        // the figure is the hottest sensor's: its name first, said warm or hot in words too
        `${name}${level === 'hot' ? ', hot' : level === 'warm' ? ', warm' : ''}`,
        sensors.length === 1
          ? 'The only sensor'
          : `Hottest of ${formatNumber(sensors.length)} · ${Math.min(...readings).toFixed(0)}–${Math.max(...readings).toFixed(0)} °C`,
      ]}
      spark={
        values.every((v) => v === undefined)
          ? undefined
          : {
              values: values.map((v) => (v === undefined ? undefined : v - floor)),
              max: span,
              color: 'var(--chart-3)',
              label: name,
              format: (v) => `${(v + floor).toFixed(1)} °C`,
            }
      }
      slots={slots}
      times={values.map((_, i) => now - (slots - 1 - i) * step)}
    />
  );
}

/** Smart Queue on or off, the limits it shapes to and CAKE's average delay each way. */
/** One direction of Smart Queue on its tile: what's going through it now of its limit, and that share as a bar. */
function Shaping({ c }: { c: CakeDirection }): ReactElement {
  const share = shapingShare(c);
  const name = c.download ? 'Download' : 'Upload';
  return (
    <div className="flex flex-col gap-1">
      <span className="truncate text-sm text-muted-foreground tabular">
        <Way dir={c.download ? 'down' : 'up'} />{' '}
        {c.bandwidth === undefined
          ? `${c.rate === undefined ? '—' : formatBitrate(c.rate)}, no limit`
          : c.rate === undefined
            ? `${formatBitrate(c.bandwidth)} limit`
            : formatBitrateOf(c.rate, c.bandwidth)}
      </span>
      <Progress
        value={share * 100}
        aria-label={`${name}, share of its limit`}
        className="h-1.5"
        indicatorClassName={share >= SHAPING_BUSY ? 'bg-warning' : c.download ? 'bg-chart-2' : 'bg-chart-1'}
      />
    </div>
  );
}

/** Whether Smart Queue shapes; while it does, the delay its queues add (down, then up) and each direction against its limit. */
export function SqmTile({ d, ap }: { d: Dashboard; ap: boolean }): ReactElement {
  const down = d.cake.find((c) => c.download);
  const up = d.cake.find((c) => !c.download);
  const on = !ap && d.cake.length > 0;
  return (
    <Tile
      route={ap ? 'mode' : 'sqm'}
      tone={on ? 'success' : 'off'}
      value={on ? 'On' : 'Off'}
      lines={
        ap
          ? ['Your main router shapes the internet']
          : on
            ? [
                `Delay ${delayMs(down?.avgDelayUs)} · ${delayMs(up?.avgDelayUs)}`,
                // goes first when a theme's larger text leaves less room
                `Peak ${delayMs(down?.peakDelayUs)} · ${delayMs(up?.peakDelayUs)}`,
              ]
            : ['Keeps latency low on a busy line']
      }
      graphic={
        on ? (
          <div className="flex flex-col gap-2">
            {[down, up].map((c) => (c === undefined ? null : <Shaping key={c.dev} c={c} />))}
          </div>
        ) : undefined
      }
      times={[]}
    />
  );
}

/** At most this many devices on the list; fewer where the tile has less room. */
const BUSIEST = 8;

/** The busiest Wi-Fi devices: each one's name and what it's downloading now, as many as fit. */
export function BusiestTile({ d }: { d: Dashboard }): ReactElement {
  const icons = useDecorativeIcons();
  const { icon: Icon } = useWidgetInfo();
  const list = useFit<HTMLUListElement>();
  const shown = busiestFirst(d.clients).slice(0, BUSIEST);
  return (
    <a href={href('clients')} className={TILE}>
      <h2 className="flex items-center justify-between gap-2 px-5 pt-4 text-sm font-medium text-muted-foreground">
        <span className="flex min-w-0 items-center gap-2">
          {icons && <Icon className="size-4 shrink-0" aria-hidden="true" />}
          {/* the widget's title, short enough for one column */}
          <span className="truncate">Busiest devices</span>
        </span>
        <ChevronRightIcon
          className="size-4 shrink-0 transition-transform duration-fast group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </h2>
      {shown.length === 0 ? (
        <p className="flex flex-1 items-center px-5 pb-4 text-sm text-muted-foreground">No devices on the Wi-Fi now</p>
      ) : (
        <ul {...list} aria-label="Busiest first" className="flex min-h-0 flex-1 flex-col gap-1.5 px-5 pt-3 pb-4 text-sm">
          {shown.map((c) => (
            <li key={c.mac} data-fit className="flex items-baseline justify-between gap-3">
              <span className={cn('min-w-0 truncate', c.name === undefined && 'text-muted-foreground')}>
                {deviceLabel(c.name)}
              </span>
              <span className="shrink-0 text-xs tabular">
                <Way dir="down" /> {c.down === undefined ? '—' : formatBitrate(c.down)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </a>
  );
}
