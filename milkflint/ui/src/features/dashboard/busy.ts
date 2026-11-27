// Busiest devices' list, for its card and its tile: Wi-Fi devices from Home's
// samples (their stations' counters, every 2 s), wired ones from the bytes
// of their connections through the router (the Connections widget's
// summary, every 10 s or so, slower when reading it costs more). Which
// devices it lists (All, Wi-Fi, LAN) is kept in this browser.
import { useState } from 'react';
import { useLive } from '@/lib/query/use-live';
import { type ByteSample, ratesBetween } from '@/lib/rates';
import { storedValue } from '@/lib/stored';
import { pollDelay } from '../lan/connections';
import { type BusyDevice, busyDevices, type BusyFilter, wiredSums } from './model';
import { dashboardQueries } from './queries';
import type { Dashboard } from './use-dashboard';

const FIRST_RATE_MS = 2000;

export const busyFilter = storedValue<BusyFilter>(
  'milkflint.home.busiest',
  (v) => (v === 'wifi' || v === 'lan' ? v : 'all'),
  () => 'all',
);

export function useBusyDevices(d: Dashboard): {
  filter: BusyFilter;
  rows: BusyDevice[];
  /** Wired devices are asked for, and the first answer isn't in yet. */
  waiting: boolean;
} {
  const filter = busyFilter.use();
  // each answer counted once, by when it came: the rates are between it and the one before
  const [sums, setSums] = useState<{ at: number | undefined; last: Map<string, ByteSample>; rows: WiredRow[] }>(() => ({
    at: undefined,
    last: new Map(),
    rows: [],
  }));
  const wired = useLive({
    ...dashboardQueries.connections((data) =>
      // a rate takes two answers: the second soon after the first
      sums.last.size === 0 ? FIRST_RATE_MS : pollDelay(10_000, data?.c.cost_ms),
    ),
    enabled: filter !== 'wifi',
  });
  const at = wired.at;
  if (filter !== 'wifi' && wired.data !== undefined && at !== undefined && at !== sums.at) {
    const now = new Map<string, ByteSample>();
    const rows = wiredSums(wired.data.c.devices, wired.data.names).map((w) => {
      const sample: ByteSample = { kind: 'wired', down: w.received, up: w.sent, at };
      now.set(w.key, sample);
      const r = ratesBetween(sums.last.get(w.key), sample, true);
      return { key: w.key, mac: w.mac, name: w.name, ip: w.ip, down: r.down, up: r.up };
    });
    setSums({ at, last: now, rows });
  }
  return {
    filter,
    rows: busyDevices(d.clients, filter === 'wifi' ? [] : sums.rows, filter),
    waiting: filter !== 'wifi' && sums.at === undefined && wired.error === undefined,
  };
}

type WiredRow = Parameters<typeof busyDevices>[1][number];
