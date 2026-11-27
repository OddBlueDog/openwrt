// What Home reads (see ARCHITECTURE.md). Its widgets share these, and the
// pages' own queries where Home reads the same thing: two readers on one key
// make one call.
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { type BuiltinPort, getBuiltinPorts, getNeighbors } from '@/lib/api/network';
import type { WgStatus } from '@/lib/api/wireguard';
import { type Every, type LiveQuery, liveQuery, type RouterQuery, settingsQuery, staticQuery } from '@/lib/query/options';
import type { AdGuardStatus } from '../adguardhome/api';
import { adguardQueries } from '../adguardhome/queries';
import type { BanipStatus } from '../banip/api';
import { banipQueries } from '../banip/queries';
import { type DcStatus, getStatus as getDeviceControlStatus, pause, resume } from '../device-control/api';
import { wgStatusQuery } from '../remote-access/queries';
import type { Task } from '../schedules/model';
import { loadAllGuests, loadGuest } from '../wifi-guest/api';
import type { GuestData } from '../wifi-guest/model';
import { getSensorHistory, type SensorHistory } from './api';
import { type ConnectionsSummary, readConnections } from './connections-summary';
import { getReadings, NEIGHBORS_MS, type Neighbors, POLL_MS, type Readings } from './readings';
import { loadPeople, loadTasks, loadUsage, type People, peerNames, timeZoneChosen, type Usage, vpnKillSwitch } from './reads';

type Guests = Awaited<ReturnType<typeof loadAllGuests>>;

export const dashboardQueries = {
  /** the router's readings, every 2 s */
  readings: (): LiveQuery<Readings> => liveQuery(['dashboard', 'readings'], getReadings, POLL_MS),
  /** the wired devices online (the neighbour table): null when the router can't say */
  neighbors: (): LiveQuery<Neighbors | null> =>
    liveQuery(['dashboard', 'neighbors'], () => getNeighbors().catch(() => null), NEIGHBORS_MS),
  /** the board's Ethernet ports: null when the router can't say */
  builtinPorts: (): RouterQuery<BuiltinPort[] | null> =>
    staticQuery(['dashboard', 'builtin-ports'], () => getBuiltinPorts().catch(() => null)),
  /** the connections' summary and the names in it; each widget asks at its own pace */
  connections: (every: Every<ConnectionsSummary>): LiveQuery<ConnectionsSummary> =>
    liveQuery(['dashboard', 'connections'], readConnections, every),
  deviceControl: (): RouterQuery<People> => settingsQuery(['dashboard', 'device-control'], loadPeople),
  deviceControlStatus: (): LiveQuery<DcStatus> =>
    liveQuery(['dashboard', 'device-control-status'], getDeviceControlStatus, 15_000),
  tasks: (): RouterQuery<Task[]> => settingsQuery(['dashboard', 'tasks'], loadTasks),
  usage: (): LiveQuery<Usage | 'off' | 'missing'> => liveQuery(['dashboard', 'usage'], loadUsage, 60_000),
  guest: (): RouterQuery<GuestData> => settingsQuery(['dashboard', 'guest'], loadGuest),
  guestDevices: (): LiveQuery<Guests> => liveQuery(['dashboard', 'guest-devices'], loadAllGuests, 30_000),
  /** shared with banIP's page, read here every 30 s */
  banip: (): LiveQuery<BanipStatus> => banipQueries.statusEvery30s(),
  /** shared with AdGuard Home's page, read here every 30 s */
  adguard: (): LiveQuery<AdGuardStatus> => adguardQueries.status(30_000),
  /** shared with Remote access and the VPN pages, read here every 10 s */
  tunnels: (): LiveQuery<WgStatus> => wgStatusQuery(10_000),
  vpnKillSwitch: (): RouterQuery<boolean> => settingsQuery(['dashboard', 'vpn-kill-switch'], vpnKillSwitch),
  peerNames: (): RouterQuery<Map<string, string>> => settingsQuery(['dashboard', 'peer-names'], peerNames),
  timeZoneChosen: (): RouterQuery<boolean> => settingsQuery(['dashboard', 'time-zone-chosen'], timeZoneChosen),
  /** the recorded temperatures, at the recorder's pace (10 s); `load` is the sample one under `pnpm dev` without sensors */
  sensorHistory: (sample: boolean, load: () => Promise<SensorHistory>): LiveQuery<SensorHistory> =>
    liveQuery(['dashboard', 'sensor-history', sample ? 'sample' : 'router'], sample ? load : getSensorHistory, 10_000),
};

/** Pause a device or group (Device control), or resume it; the widget's state reads again after. */
export function usePauseDevice(): UseMutationResult<void, Error, { macs: readonly string[]; until: number | null | 'resume' }> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ macs, until }) => (until === 'resume' ? resume(macs) : pause(macs, until)),
    onSettled: () => client.invalidateQueries({ queryKey: dashboardQueries.deviceControlStatus().queryKey }),
  });
}
