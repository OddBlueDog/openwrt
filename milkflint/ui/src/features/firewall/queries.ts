// What the Firewall and Port forwards pages read (see ARCHITECTURE.md).
import { type LiveQuery, liveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import {
  type Counters,
  type FirewallData,
  getCounters,
  getUpnpMappings,
  getWarnings,
  loadFirewall,
  type UpnpMapping,
} from './api';

export const firewallQueries = {
  /** the firewall config with what the pages show beside it (devices, networks) */
  config: (): RouterQuery<FirewallData> => settingsQuery(['firewall', 'config'], loadFirewall),
  /** each rule's hits in the running ruleset, every 10 s */
  counters: (): LiveQuery<Counters> => liveQuery(['firewall', 'counters'], getCounters, 10_000),
  /** the ports devices opened through UPnP, every 15 s */
  upnpMappings: (): LiveQuery<UpnpMapping[]> => liveQuery(['firewall', 'upnp-mappings'], getUpnpMappings, 15_000),
  /** what fw4's check warns of, every minute */
  warnings: (): LiveQuery<string[]> => liveQuery(['firewall', 'warnings'], getWarnings, 60_000),
};
