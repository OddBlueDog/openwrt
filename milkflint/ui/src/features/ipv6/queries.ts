// What the IPv6 page reads (see ARCHITECTURE.md).
import { getInterfaces, type NetworkInterface } from '@/lib/api/network';
import { type LiveQuery, liveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import { loadIpv6 } from './api';
import type { Ipv6Data } from './model';

export const ipv6Queries = {
  settings: (): RouterQuery<Ipv6Data> => settingsQuery(['ipv6', 'settings'], loadIpv6),
  /** wan6 and the LAN's prefix now, every 10 s */
  interfaces: (): LiveQuery<NetworkInterface[]> => liveQuery(['ipv6', 'interfaces'], getInterfaces, 10_000),
};
