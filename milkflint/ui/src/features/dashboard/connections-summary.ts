// The connections' summary (milkflint.connections with rows: 0) and the
// names of the addresses in it, read by every widget on Home that shows it
// (the Connections widget, and Busiest devices for its wired devices)
// through one query (dashboardQueries.connections).
import { type AddressName, loadAddressNames } from '@/lib/api/names';
import { foldDevices } from '../lan/connections';
import { type Connections, getConnections } from '../lan/connections-api';

export async function readConnections(): Promise<ConnectionsSummary> {
  const [c, names] = await Promise.all([
    getConnections({ rows: 0 }),
    loadAddressNames().catch((): Map<string, AddressName> => new Map()),
  ]);
  return { c, names, devices: foldDevices(c.devices, names) };
}

export interface ConnectionsSummary {
  c: Connections;
  names: Map<string, AddressName>;
  devices: ReturnType<typeof foldDevices>;
}
