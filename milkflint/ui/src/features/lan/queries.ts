// What the LAN & DHCP page reads (see ARCHITECTURE.md).
import { type AddressName, loadAddressNames } from '@/lib/api/names';
import { type LiveQuery, liveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import { loadLan } from './api';
import { type Connections, getConnections } from './connections-api';
import { pollDelay } from './connections';
import { loadLeases } from './leases';
import type { LanForm } from './model';

export type Leases = Awaited<ReturnType<typeof loadLeases>>;
export type ConnectionsArgs = Parameters<typeof getConnections>[0];

export const lanQueries = {
  settings: (): RouterQuery<LanForm> => settingsQuery(['lan', 'settings'], loadLan),
  /** who holds an address now, every 30 s */
  leases: (): LiveQuery<Leases> => liveQuery(['lan', 'leases'], loadLeases, 30_000),
  /** names for addresses, to label connections */
  addressNames: (): RouterQuery<Map<string, AddressName>> => settingsQuery(['lan', 'address-names'], loadAddressNames),
  /**
   * The connection list for what's asked (`asked`: the device, family and
   * words chosen), every 5 s or longer when the router took long to answer.
   * `args` gives the call's arguments when it's made: they depend on the last
   * answer (the device's addresses, the owners the words name), which doesn't
   * make it another read.
   */
  connections: (asked: string, args: () => ConnectionsArgs): LiveQuery<Connections> =>
    liveQuery(
      ['lan', 'connections', asked],
      () => getConnections(args()),
      (last) => pollDelay(5000, last?.cost_ms),
    ),
};
