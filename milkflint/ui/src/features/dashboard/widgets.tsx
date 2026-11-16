// Every widget Home can place, by id (widget-ids.ts lists the ids; a theme's
// layout picks, orders and sizes them). A widget with nothing to show on this
// router says so with `hidden`, and its columns go to its neighbour.
import type { ReactElement } from 'react';
import type { Poll } from '@/hooks/use-poll';
import type { Live } from '../network-quality/live';
import { ClientsCard } from './clients-card';
import { InternetDetailsCard } from './internet-details-card';
import { PathCard } from './path-card';
import { RadiosCard } from './radios-card';
import { CpuCard, MemoryCard } from './resources-cards';
import { ResponsivenessCard } from './responsiveness-card';
import { SqmCard } from './sqm-card';
import { SystemCard } from './system-card';
import { TemperaturesCard } from './temperatures-card';
import { DevicesTile, InternetTile, WifiTile } from './tiles';
import { TrafficCard } from './traffic-card';
import { UsageCard } from './usage-card';
import type { Dashboard } from './use-dashboard';
import type { WidgetId } from './widget-ids';
import { devicesGlance, internetGlance, responsivenessGlance, wifiGlance } from './glance';
import { GlanceTile, GlanceTraffic } from './glance-tiles';

export interface WidgetProps {
  d: Dashboard;
  /** Network Quality's samples, shared by the widgets that show them. */
  live: Poll<Live>;
  /** Access point mode: the way out is the main router. */
  ap: boolean;
}

export interface WidgetEntry {
  render: (props: WidgetProps) => ReactElement;
  /** Nothing to show on this router (not a feature that's off: that says so instead). */
  hidden?: (props: WidgetProps) => boolean;
  /**
   * Takes its content's height rather than its row's: a list or a few
   * figures whose height varies with what there is, which stretched to a
   * taller neighbour would leave a blank band at its foot.
   */
  fit?: boolean;
}

export const widgets: Readonly<Record<WidgetId, WidgetEntry>> = {
  responsiveness: { render: ({ live }) => <ResponsivenessCard live={live} /> },
  internet: { render: ({ d, ap }) => <InternetTile d={d} ap={ap} /> },
  wifi: { render: ({ d }) => <WifiTile d={d} /> },
  devices: { render: ({ d }) => <DevicesTile d={d} /> },
  cpu: { render: ({ d }) => <CpuCard d={d} /> },
  memory: { render: ({ d }) => <MemoryCard d={d} /> },
  temperatures: {
    render: ({ d }) => <TemperaturesCard d={d} />,
    // a router (or VM) without sensors
    hidden: ({ d }) => d.stats.temperatures.length === 0,
  },
  system: { render: ({ d }) => <SystemCard d={d} /> },
  path: { render: ({ d, ap, live }) => <PathCard d={d} ap={ap} live={live} /> },
  throughput: { render: ({ d }) => <TrafficCard d={d} /> },
  radios: { render: ({ d }) => <RadiosCard d={d} /> },
  // fills its row: its summary line closes the bottom however few devices there are
  'busiest-devices': { render: ({ d }) => <ClientsCard d={d} /> },
  'internet-details': { render: ({ d, ap }) => <InternetDetailsCard d={d} ap={ap} />, fit: true },
  usage: { render: ({ ap }) => <UsageCard ap={ap} />, fit: true },
  'smart-queue': { render: ({ d, ap }) => <SqmCard d={d} ap={ap} />, fit: true },
  // at a glance (a calm Home): one word or number each, and one traffic line
  'glance-internet': { render: ({ d, ap }) => <GlanceTile glance={internetGlance(d, ap)} /> },
  'glance-responsiveness': { render: ({ live }) => <GlanceTile glance={responsivenessGlance(live)} /> },
  'glance-wifi': { render: ({ d }) => <GlanceTile glance={wifiGlance(d)} /> },
  'glance-devices': { render: ({ d }) => <GlanceTile glance={devicesGlance(d)} /> },
  // no WAN of its own in access point mode
  'glance-traffic': { render: ({ d }) => <GlanceTraffic d={d} />, hidden: ({ ap }) => ap },
};
