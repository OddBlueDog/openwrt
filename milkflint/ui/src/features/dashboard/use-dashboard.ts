// Everything Home shows, kept current: the readings every POLL_MS, worked
// out into figures once per reading (keyed by when it came, so a re-render
// never adds a sample twice), with the wired devices and the board's ports
// read on their own, slower.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { type Live, useLive } from '@/lib/query/use-live';
import { dashboardQueries } from './queries';
import { type Carry, type Dashboard, nextDashboard, startCarry } from './readings';

export type { CakeDirection, Client, Dashboard, Radio, Sample } from './readings';
export { HISTORY, POLL_MS } from './readings';

export function useDashboard(): Live<Dashboard> {
  const readings = useLive(dashboardQueries.readings());
  const neighbors = useQuery(dashboardQueries.neighbors());
  const builtin = useQuery(dashboardQueries.builtinPorts());
  const [state, setState] = useState<{ at: number | undefined; dashboard: Dashboard | undefined; carry: Carry }>(() => ({
    at: undefined,
    dashboard: undefined,
    carry: startCarry(),
  }));
  // the first figures wait for the wired devices and the ports, as they always have
  const ready = !neighbors.isPending && !builtin.isPending;
  if (readings.data !== undefined && ready && readings.at !== state.at) {
    const next = nextDashboard(readings.data, neighbors.data ?? undefined, builtin.data ?? undefined, state.carry);
    setState({ at: readings.at, dashboard: next.dashboard, carry: next.carry });
  }
  return {
    data: state.dashboard,
    error: readings.error,
    loading: state.dashboard === undefined && readings.error === undefined,
    refresh: readings.refresh,
    at: readings.at,
    next: readings.next,
  };
}
