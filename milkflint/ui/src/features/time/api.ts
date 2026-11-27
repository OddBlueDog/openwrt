// Name & time's router side: the system section (name, time zone), the
// time servers, the router's list of zones, and its clock.
import { getInfo, getTimezones, getUnixtime, setLocaltime } from '@/lib/api/system';
import { bool, getConfig, list, str } from '@/lib/api/uci';
import type { TimeData } from './model';
import { withUtc, zoneChosen } from './zone';

export async function loadTime(): Promise<TimeData> {
  const [system, zones] = await Promise.all([getConfig('system'), getTimezones().catch(() => [])]);
  const s = system.find((x) => x['.type'] === 'system');
  const ntp = system.find((x) => x['.type'] === 'timeserver');
  return {
    form: {
      section: s?.['.name'] ?? 'system',
      hostname: str(s, 'hostname') ?? 'MilkFlint',
      zonename: zoneChosen(s) ? (str(s, 'zonename') ?? 'UTC') : '',
      ntp: ntp === undefined ? false : bool(ntp, 'enabled', true),
      servers: list(ntp, 'server').join('\n'),
    },
    zones: withUtc(zones),
    ntpSection: ntp?.['.name'],
  };
}

export interface ClockOffsets {
  /** Router clock minus this device's clock (ms): real drift. */
  drift: number;
  /** The router's time zone offset from UTC right now (ms). */
  zone: number;
}

export async function clockOffsets(): Promise<ClockOffsets> {
  const [info, unix] = await Promise.all([getInfo(), getUnixtime()]);
  return { drift: unix * 1000 - Date.now(), zone: (info.localtime - unix) * 1000 };
}

/** Set the router's clock to this device's. */
export function setClockFromDevice(): Promise<void> {
  return setLocaltime(Math.floor(Date.now() / 1000));
}
