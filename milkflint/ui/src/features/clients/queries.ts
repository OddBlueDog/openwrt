// What All devices reads (see ARCHITECTURE.md).
import { sharedQueries } from '@/lib/query/shared';
import { type LiveQuery, liveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import { deviceStatus } from '../device-control/api';
import { type ClientsData, loadClients } from './api';

/** null: no Device control rule names the device (a query can't hold undefined) */
export type DeviceControlStatus = NonNullable<Awaited<ReturnType<typeof deviceStatus>>> | null;

export const clientsQueries = {
  /** every device the router knows of, every 5 s */
  devices: (): LiveQuery<ClientsData> => liveQuery(['clients', 'devices'], loadClients, 5000),
  /** when the router first saw each device: read once the sheet opens */
  seen: sharedQueries.seen,
  /** a device's Device control state (router mode only): read once the sheet opens */
  control: (mac: string): RouterQuery<DeviceControlStatus> =>
    settingsQuery(['clients', 'device-control', mac], async () => (await deviceStatus(mac)) ?? null),
};
