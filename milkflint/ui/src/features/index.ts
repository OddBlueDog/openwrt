// The feature registry: every page of the interface. Keyed by id, so the
// compiler checks each id in ids.ts has exactly one feature.
import { feature as adminPassword } from './admin-password/feature';
import { feature as backupReset } from './backup-reset/feature';
import { feature as clients } from './clients/feature';
import { feature as dashboard } from './dashboard/feature';
import { feature as dataStatistics } from './data-statistics/feature';
import { feature as dns } from './dns/feature';
import { feature as firewall } from './firewall/feature';
import { groups } from './groups';
import type { FeatureId } from './ids';
import { feature as internet } from './internet/feature';
import { feature as ipv6 } from './ipv6/feature';
import { feature as lan } from './lan/feature';
import { feature as logs } from './logs/feature';
import { feature as mode } from './mode/feature';
import { feature as networkQuality } from './network-quality/feature';
import { feature as radarScan } from './radar-scan/feature';
import { feature as remoteAccess } from './remote-access/feature';
import { feature as schedules } from './schedules/feature';
import { feature as sqm } from './sqm/feature';
import { feature as systemOverview } from './system-overview/feature';
import { feature as time } from './time/feature';
import { feature as tuning } from './tuning/feature';
import type { RouterMode } from '@/lib/router-mode';
import type { Feature, Group } from './types';
import { feature as upgrade } from './upgrade/feature';
import { feature as upnp } from './upnp/feature';
import { feature as vpnClient } from './vpn-client/feature';
import { feature as wifiGuest } from './wifi-guest/feature';
import { feature as wifiScan } from './wifi-scan/feature';
import { feature as wifi } from './wifi/feature';

const byId: { readonly [K in FeatureId]: Feature & { id: K } } = {
  dashboard,
  internet,
  dns,
  mode,
  wifi,
  'wifi-guest': wifiGuest,
  'wifi-scan': wifiScan,
  'radar-scan': radarScan,
  clients,
  lan,
  ipv6,
  'remote-access': remoteAccess,
  'vpn-client': vpnClient,
  'network-quality': networkQuality,
  'data-statistics': dataStatistics,
  sqm,
  tuning,
  firewall,
  upnp,
  'system-overview': systemOverview,
  'admin-password': adminPassword,
  upgrade,
  time,
  schedules,
  logs,
  'backup-reset': backupReset,
};

export function featureById(id: FeatureId): Feature {
  return byId[id];
}

const all: readonly Feature[] = Object.values(byId);

/** Top-level entries, in menu order. */
export const topLevel: readonly Feature[] = all.filter((f) => f.group === undefined).sort((a, b) => a.order - b.order);

/** Groups that have pages, each with its pages in menu order. */
export const menuGroups: readonly (Group & { features: readonly Feature[] })[] = groups
  .map((g) => ({ ...g, features: all.filter((f) => f.group === g.id).sort((a, b) => a.order - b.order) }))
  .filter((g) => g.features.length > 0)
  .sort((a, b) => a.order - b.order);

export type MenuEntry = { kind: 'page'; feature: Feature } | { kind: 'group'; group: (typeof menuGroups)[number] };

/** The whole menu: top-level pages and groups, by their shared order. */
export const menu: readonly MenuEntry[] = [
  ...topLevel.map((feature): MenuEntry & { order: number } => ({ kind: 'page', feature, order: feature.order })),
  ...menuGroups.map((group): MenuEntry & { order: number } => ({ kind: 'group', group, order: group.order })),
].sort((a, b) => a.order - b.order);

/** The menu in access point mode: without the pages only a router needs, and any group left empty. */
const accessPointMenu: readonly MenuEntry[] = menu.flatMap((entry): MenuEntry[] => {
  if (entry.kind === 'page') return entry.feature.routerOnly === true ? [] : [entry];
  const features = entry.group.features.filter((f) => f.routerOnly !== true);
  return features.length === 0 ? [] : [{ kind: 'group', group: { ...entry.group, features } }];
});

export function menuFor(routerMode: RouterMode | undefined): readonly MenuEntry[] {
  return routerMode === 'ap' ? accessPointMenu : menu;
}
