// Home at a glance: one word or number for each thing that matters (the
// internet, how responsive it is, the Wi-Fi, the devices), as the status
// tiles (tiles.tsx) show them. Plain data, so the tests check it.
import type { Sample, Status } from '@/features/network-quality/api';
import { formatNumber } from '@/lib/format';
import type { Route } from '@/lib/router';
import { responsiveness, type Tone } from './model';
import type { Dashboard } from './use-dashboard';

export interface Glance {
  title: string;
  /** The one word or number. */
  value: string;
  /** A few words beside it, if any. */
  detail?: string;
  /** Its state's dot (or "!" for trouble where the theme asks); undefined for a plain count. */
  tone: Tone | 'off' | undefined;
  /** The page it opens. */
  route: Route;
}

/** Network Quality's samples, as Home polls them. */
export interface LiveInput {
  data?: { status: Pick<Status, 'enabled' | 'now'>; samples: readonly Sample[] } | undefined;
  error?: unknown;
}

/** In access point mode the way out is the LAN's default route, to the main router. */
export function mainRouter(lan: Dashboard['lan']): string | undefined {
  return lan?.route?.find((r) => r.target === '0.0.0.0' && r.mask === 0)?.nexthop;
}

export function internetGlance(d: Pick<Dashboard, 'wan' | 'lan'>, ap: boolean): Glance {
  if (ap) {
    const online = d.lan?.up === true && mainRouter(d.lan) !== undefined;
    return {
      title: 'Main router',
      value: online ? 'Connected' : 'Not connected',
      tone: online ? 'success' : 'destructive',
      route: 'mode',
    };
  }
  const online = d.wan?.up === true;
  return {
    title: 'Internet',
    value: d.wan === undefined ? 'Not set up' : online ? 'Online' : 'Offline',
    tone: d.wan === undefined ? 'off' : online ? 'success' : 'destructive',
    route: 'internet',
  };
}

export function wifiGlance(d: Pick<Dashboard, 'radios'>): Glance {
  // a band with no network switched on is off by choice, not down
  const on = d.radios.filter((r) => !r.off);
  const down = on.filter((r) => !r.up);
  return {
    title: 'Wi-Fi',
    value: on.length === 0 ? 'Off' : down.length === 0 ? 'On' : `${String(down.length)} band${down.length === 1 ? '' : 's'} down`,
    tone: on.length === 0 ? 'off' : down.length === 0 ? 'success' : 'warning',
    route: 'wifi',
  };
}

export function devicesGlance(d: Pick<Dashboard, 'clients' | 'wired'>): Glance {
  return {
    title: 'Devices',
    value: formatNumber(d.clients.length + (d.wired ?? 0)),
    detail: 'online',
    tone: undefined,
    route: 'clients',
  };
}

export function responsivenessGlance(live: LiveInput): Glance {
  const at = { title: 'Responsiveness', route: 'network-quality' } as const;
  if (live.data === undefined)
    return live.error === undefined ? { ...at, value: 'Measuring', tone: 'info' } : { ...at, value: 'Unavailable', tone: 'off' };
  if (!live.data.status.enabled) return { ...at, value: 'Off', tone: 'off' };
  const r = responsiveness(live.data.samples, live.data.status.now);
  const typical = r.recent.typical;
  return {
    ...at,
    value: typical === undefined ? '—' : `${String(Math.round(typical))} ms`,
    detail: r.state.label,
    tone: r.state.tone,
  };
}
