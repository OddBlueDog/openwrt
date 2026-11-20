// Every widget Home can show, by id: what the catalogue says of it (title,
// one line, icon, group), the sizes it offers (columns by rows; the first is
// its default) and how it draws. WidgetId comes from this record's keys, so
// adding a widget is one entry here. A widget with nothing to show on this
// router (no temperature sensors) says so with `hidden`: Home leaves it out,
// and the catalogue says why.
import {
  ActivityIcon,
  ArrowDownUpIcon,
  CableIcon,
  CalendarClockIcon,
  ChartBarDecreasingIcon,
  ChartColumnIcon,
  CpuIcon,
  EthernetPortIcon,
  GaugeIcon,
  GlobeIcon,
  type LucideIcon,
  MemoryStickIcon,
  MonitorSmartphoneIcon,
  RadioTowerIcon,
  RouteIcon,
  RouterIcon,
  ShieldBanIcon,
  ShieldUserIcon,
  ShieldXIcon,
  SmartphoneIcon,
  ThermometerIcon,
  UsersIcon,
  WaypointsIcon,
  WifiIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';
import type { Poll } from '@/hooks/use-poll';
import type { Live } from '../network-quality/live';
import { ClientsCard } from './clients-card';
import { DeviceControlCard } from './device-control-card';
import { GuestCard } from './guest-card';
import { InternetDetailsCard } from './internet-details-card';
import { type Catalog, type Height, type Layout, parseLayout, type Size, type Width } from './layout';
import { PathCard } from './path-card';
import { PortsCard } from './ports-card';
import { RadiosCard } from './radios-card';
import { CpuCard, MemoryCard } from './resources-cards';
import { ResponsivenessCard } from './responsiveness-card';
import { ScheduleCard } from './schedule-card';
import { AdGuardCard, BanipCard } from './security-cards';
import { SqmCard } from './sqm-card';
import { SystemCard } from './system-card';
import { TemperaturesCard } from './temperatures-card';
import { BusiestTile, CpuTile, DevicesTile, InternetTile, ResponsivenessTile, SqmTile, TemperatureTile, WifiTile } from './tiles';
import { TrafficCard } from './traffic-card';
import { UsageCard } from './usage-card';
import type { Dashboard } from './use-dashboard';
import { RemoteAccessCard, VpnCard } from './vpn-cards';

/** What every widget is drawn from: Home's own poll, Network Quality's pings, and the router's mode. */
export interface HomeData {
  d: Dashboard;
  /** Network Quality's samples, shared by the widgets that show them. */
  live: Poll<Live>;
  /** Access point mode: the way out is the main router. */
  ap: boolean;
}

export interface WidgetProps extends HomeData {
  /** The size it's placed at: for what it shows, not how (its card adapts to its box by container queries). */
  size: Size;
}

/** The catalogue's groups, in its order. */
export const GROUPS = ['Internet', 'Wi-Fi', 'Devices', 'Security', 'VPN', 'Router'] as const;
export type Group = (typeof GROUPS)[number];

export interface WidgetDef {
  readonly title: string;
  /** One line for the catalogue: what it shows. */
  readonly description: string;
  /** Lucide, and no other widget's (DESIGN.md, "Signature: Home's widgets"). */
  readonly icon: LucideIcon;
  readonly group: Group;
  /** The sizes it looks right at, its default first. */
  readonly sizes: readonly [Size, ...Size[]];
  readonly render: (props: WidgetProps) => ReactElement;
  /** Nothing to show on this router (not a feature that's off: the widget says so itself). */
  readonly hidden?: (data: HomeData) => boolean;
}

const size = (w: Width, h: Height): Size => ({ w, h });

export const widgets = {
  responsiveness: {
    title: 'Responsiveness',
    description: 'How quickly the internet answers, at rest and under load, with the hour’s pings.',
    icon: ActivityIcon,
    group: 'Internet',
    sizes: [size(2, 2), size(3, 2), size(4, 2), size(1, 1)],
    render: ({ live, size: s }) => (s.w === 1 ? <ResponsivenessTile live={live} /> : <ResponsivenessCard live={live} />),
  },
  internet: {
    title: 'Internet',
    description: 'Online or not, the speed now, and the addresses your provider gave.',
    icon: GlobeIcon,
    group: 'Internet',
    sizes: [size(1, 1), size(2, 1)],
    render: ({ d, ap }) => <InternetTile d={d} ap={ap} />,
  },
  throughput: {
    title: 'Throughput',
    description: 'Download and upload over the last two minutes, on the internet or the Wi-Fi.',
    icon: ArrowDownUpIcon,
    group: 'Internet',
    sizes: [size(4, 1), size(2, 1), size(3, 1), size(2, 2)],
    render: ({ d }) => <TrafficCard d={d} />,
  },
  'internet-details': {
    title: 'Internet connection',
    description: 'How the router connects: its protocol, addresses, gateway and DNS servers.',
    icon: EthernetPortIcon,
    group: 'Internet',
    sizes: [size(1, 2), size(2, 1)],
    render: ({ d, ap }) => <InternetDetailsCard d={d} ap={ap} />,
  },
  'smart-queue': {
    title: 'Smart Queue',
    description: 'CAKE’s own figures: the limits it shapes to, its delay and what it dropped or marked.',
    icon: GaugeIcon,
    group: 'Internet',
    sizes: [size(2, 1), size(1, 2), size(1, 1), size(2, 2)],
    render: ({ d, ap, size: s }) => (s.w === 1 && s.h === 1 ? <SqmTile d={d} ap={ap} /> : <SqmCard d={d} ap={ap} />),
  },
  path: {
    title: 'Path',
    description: 'The way from the internet to your devices, and what the router measures at each step.',
    icon: WaypointsIcon,
    group: 'Internet',
    sizes: [size(4, 1), size(2, 2), size(4, 2)],
    render: ({ d, ap, live }) => <PathCard d={d} ap={ap} live={live} />,
  },
  wifi: {
    title: 'Wi-Fi',
    description: 'Whether each band is on, and how many devices use it.',
    icon: WifiIcon,
    group: 'Wi-Fi',
    sizes: [size(1, 1), size(2, 1)],
    render: ({ d }) => <WifiTile d={d} />,
  },
  radios: {
    title: 'Radios',
    description: 'Each band’s networks, channel, power and devices.',
    icon: RadioTowerIcon,
    group: 'Wi-Fi',
    sizes: [size(1, 1), size(2, 1)],
    render: ({ d }) => <RadiosCard d={d} />,
  },
  'busiest-devices': {
    title: 'Busiest Wi-Fi devices',
    description: 'The Wi-Fi devices moving the most data now, with their signal.',
    icon: ChartBarDecreasingIcon,
    group: 'Devices',
    sizes: [size(3, 2), size(2, 2), size(4, 1), size(4, 2), size(1, 1)],
    render: ({ d, size: s }) => (s.w === 1 ? <BusiestTile d={d} /> : <ClientsCard d={d} rows={s.h} />),
  },
  devices: {
    title: 'Devices',
    description: 'How many devices are online, on the Wi-Fi and wired.',
    icon: MonitorSmartphoneIcon,
    group: 'Devices',
    sizes: [size(1, 1), size(2, 1)],
    render: ({ d }) => <DevicesTile d={d} />,
  },
  'device-control': {
    title: 'Device control',
    description: 'Each person’s internet now (off until 07:00, paused, on), with Pause beside them.',
    icon: ShieldUserIcon,
    group: 'Devices',
    sizes: [size(2, 1), size(1, 1), size(1, 2), size(2, 2)],
    render: () => <DeviceControlCard />,
    hidden: ({ ap }) => ap,
  },
  usage: {
    title: 'Data usage',
    description: 'What was downloaded and uploaded this period, and by which devices.',
    icon: ChartColumnIcon,
    group: 'Devices',
    sizes: [size(2, 1), size(1, 1)],
    render: ({ ap }) => <UsageCard ap={ap} />,
  },
  ports: {
    title: 'Ethernet ports',
    description: 'Which of the router’s ports have a cable in, at what speed, and their traffic now.',
    icon: CableIcon,
    group: 'Devices',
    sizes: [size(2, 1), size(4, 1), size(1, 1)],
    render: ({ d }) => <PortsCard d={d} />,
  },
  cpu: {
    title: 'CPU',
    description: 'The processor’s use now, each core, the load and the last two minutes.',
    icon: CpuIcon,
    group: 'Router',
    sizes: [size(2, 1), size(1, 2), size(4, 1), size(1, 1)],
    render: ({ d, size: s }) => (s.w === 1 && s.h === 1 ? <CpuTile d={d} /> : <CpuCard d={d} />),
  },
  memory: {
    title: 'Memory',
    description: 'Memory in use, with the buffers and cache Linux frees when they’re needed.',
    icon: MemoryStickIcon,
    group: 'Router',
    sizes: [size(1, 1), size(2, 1)],
    render: ({ d }) => <MemoryCard d={d} />,
  },
  system: {
    title: 'System',
    description: 'How long the router has been up, its firmware, storage and connections.',
    icon: RouterIcon,
    group: 'Router',
    sizes: [size(1, 1), size(2, 1)],
    render: ({ d }) => <SystemCard d={d} />,
  },
  temperatures: {
    title: 'Temperatures',
    description: 'Each sensor’s reading, with its low and high over the last minutes or hour.',
    icon: ThermometerIcon,
    group: 'Router',
    sizes: [size(4, 1), size(2, 1), size(1, 2), size(1, 1)],
    render: ({ d, size: s }) => (s.w === 1 && s.h === 1 ? <TemperatureTile d={d} /> : <TemperaturesCard d={d} />),
    // a router (or VM) without sensors
    hidden: ({ d }) => d.stats.temperatures.length === 0,
  },
  schedules: {
    title: 'Scheduled tasks',
    description: 'The next restart, Wi-Fi switch or other scheduled job, by the router’s clock.',
    icon: CalendarClockIcon,
    group: 'Router',
    sizes: [size(1, 1)],
    render: ({ d }) => <ScheduleCard d={d} />,
  },
  'guest-wifi': {
    title: 'Guest Wi-Fi',
    description: 'Your guest network, its devices, and its password and join code behind Show.',
    icon: UsersIcon,
    group: 'Wi-Fi',
    sizes: [size(2, 1), size(1, 1)],
    render: () => <GuestCard />,
    // a router-mode page: the main router has the guest network
    hidden: ({ ap }) => ap,
  },
  banip: {
    title: 'banIP',
    description: 'The addresses on its block lists, and what it blocked in the last hour.',
    icon: ShieldXIcon,
    group: 'Security',
    sizes: [size(1, 1), size(2, 1)],
    render: () => <BanipCard />,
    // the main router faces the internet
    hidden: ({ ap }) => ap,
  },
  adguardhome: {
    title: 'AdGuard Home',
    description: 'The share of your devices’ lookups it blocked, and how quickly it answers.',
    icon: ShieldBanIcon,
    group: 'Security',
    sizes: [size(1, 1)],
    render: () => <AdGuardCard />,
    // the main router answers lookups
    hidden: ({ ap }) => ap,
  },
  vpn: {
    title: 'VPN',
    description: 'Whether your devices’ traffic goes through a VPN, and how much has.',
    icon: RouteIcon,
    group: 'VPN',
    sizes: [size(1, 1)],
    render: () => <VpnCard />,
    // no internet port of its own to send traffic from
    hidden: ({ ap }) => ap,
  },
  'remote-access': {
    title: 'Remote access',
    description: 'Which of your phones and laptops are connected from away.',
    icon: SmartphoneIcon,
    group: 'VPN',
    sizes: [size(1, 1)],
    render: () => <RemoteAccessCard />,
    // a router-mode page: the main router faces the internet
    hidden: ({ ap }) => ap,
  },
} as const satisfies Record<string, WidgetDef>;

export type WidgetId = keyof typeof widgets;

/** The widgets as the layout functions need them. */
export const catalog: Catalog<WidgetId> = widgets;

/** A layout from anywhere (the router, a theme), as Home can show it. */
export function parseHome(raw: unknown): Layout<WidgetId> {
  return parseLayout(raw, catalog);
}

/** A widget's entry, as every entry's common shape. */
export function definition(id: WidgetId): WidgetDef {
  return widgets[id];
}

export function isWidgetId(id: string): id is WidgetId {
  return Object.hasOwn(widgets, id);
}

/** Every widget's id, in the registry's order. */
export const WIDGET_IDS: readonly WidgetId[] = Object.keys(widgets).filter(isWidgetId);
