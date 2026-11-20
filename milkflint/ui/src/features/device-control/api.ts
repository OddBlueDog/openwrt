// What the Device control page reads and does. The people and their times
// are UCI (milkflint person sections, firewall rules), read with the
// Firewall page's own loader so both pages see the same rules; what's
// paused or given extra time, the router's clock, each device's data today
// and when it was last seen come from milkflint.devicecontrol; pause, extra
// time and resume go there too, applied at once without a firewall reload.
import { z } from 'zod';
import { getNeighbors, isPrivateMac, isReachable } from '@/lib/api/network';
import { getConfig, type Section } from '@/lib/api/uci';
import { parseFirewall } from '../firewall/model';
import { getAccessPoints } from '@/lib/api/wireless';
import { call } from '@/lib/ubus';
import { interceptOn } from '../dns/intercept';
import { type FirewallData, loadFirewall, zoneForIp } from '../firewall/api';
import { isInternetZone } from '../firewall/model';
import { GUEST_IDS } from '../wifi-guest/guest';
import { type Clock, deviceRules, deviceState, nextText, type Overrides, parsePeople, type Person, stateText } from './model';

const statusSchema = z.object({
  now: z.number(),
  offset: z.number(),
  /** MAC → until (Unix time; 0 until resumed) */
  paused: z.record(z.string(), z.number()),
  extra: z.record(z.string(), z.number()),
  /** the firewall has the two sets (someone is set up and it's loaded) */
  ready: z.boolean(),
  today: z
    .object({
      since: z.number(),
      midnight: z.number(),
      devices: z.record(z.string(), z.tuple([z.number(), z.number()])),
    })
    .nullable(),
  /** seconds since each device last answered the router */
  seen: z.record(z.string(), z.number()),
  clock: z.object({
    /** it sets its clock from the internet (Time page) */
    ntp: z.boolean(),
    /** null: ntpd hasn't said yet */
    synced: z.boolean().nullable(),
    stratum: z.number().nullable(),
    at: z.number().nullable(),
    uptime: z.number(),
  }),
  adguard: z.object({ installed: z.boolean(), enabled: z.boolean(), state: z.string().nullable() }),
});
export type DcStatus = z.output<typeof statusSchema>;

export function getStatus(): Promise<DcStatus> {
  return call('milkflint.devicecontrol', 'status', {}, statusSchema);
}

export function clockOf(s: DcStatus): Clock {
  return { now: s.now, offset: s.offset };
}

export function overridesOf(s: DcStatus): Overrides {
  return {
    paused: new Map(Object.entries(s.paused).map(([m, u]) => [m, u === 0 ? null : u])),
    extra: new Map(Object.entries(s.extra)),
  };
}

const resultSchema = z.object({ ok: z.boolean().optional(), error: z.string().optional() });

const errors: Record<string, string> = {
  devices: 'Those devices’ addresses weren’t right.',
  until: 'That time isn’t in the next week.',
  write: 'The router couldn’t save it.',
  nft: 'The firewall didn’t take it: is it running?',
};

async function act(method: 'pause' | 'extra' | 'resume', params: Record<string, unknown>): Promise<void> {
  const r = await call('milkflint.devicecontrol', method, params, resultSchema);
  if (r.error !== undefined) throw new Error(errors[r.error] ?? `The router couldn’t: ${r.error}.`);
}

/** Their internet off until then (null: until resumed); open connections end. */
export function pause(macs: readonly string[], until: number | null): Promise<void> {
  return act('pause', { macs, until: until ?? 0 });
}

/** Their times lifted until then. */
export function giveExtra(macs: readonly string[], until: number): Promise<void> {
  return act('extra', { macs, until });
}

/** Pause and extra time over. */
export function resume(macs: readonly string[]): Promise<void> {
  return act('resume', { macs });
}

export const WHO_URL = '/cgi-bin/milkflint-device-control';

/** This device's address and MAC, as the router sees it (the CGI); empty when it can't tell. */
export async function whoAmI(): Promise<{ ip?: string | undefined; mac?: string | undefined }> {
  try {
    const res = await fetch(WHO_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!res.ok) return {};
    const r = z.object({ ip: z.string().optional(), mac: z.string().optional() }).safeParse(await res.json());
    return r.success ? { ...r.data, ...(r.data.mac === undefined ? {} : { mac: r.data.mac.toLowerCase() }) } : {};
  } catch {
    return {};
  }
}

// ---- Devices ----

export interface DcDevice {
  /** lower case */
  mac: string;
  name: string | undefined;
  ip: string | undefined;
  /** the zone of its address: lan, guest… */
  zone: string | undefined;
  guest: boolean;
  online: boolean;
  /** a Wi-Fi network it's on now */
  ssid: string | undefined;
  /** an address the device made up (a phone's private Wi-Fi address) */
  privateMac: boolean;
}

export interface DcData {
  fw: FirewallData;
  milkflint: Section[];
  people: Person[];
  devices: DcDevice[];
  /** DNS intercept on the home network (the DNS page) */
  intercept: boolean;
  /** guest networks set up, by zone */
  guestZones: string[];
}

export async function loadDeviceControl(): Promise<DcData> {
  const [fw, milkflint, neighbors, aps] = await Promise.all([
    loadFirewall(),
    getConfig('milkflint').catch((): Section[] => []),
    getNeighbors().catch(() => []),
    getAccessPoints().catch(() => []),
  ]);
  const online = new Set(neighbors.filter(isReachable).map((n) => n.mac.toLowerCase()));
  const ssid = new Map<string, string | undefined>();
  for (const ap of aps) {
    for (const s of ap.stations) {
      online.add(s.mac.toLowerCase());
      ssid.set(s.mac.toLowerCase(), ap.ssid);
    }
  }
  const guestZones = fw.cfg.zones.filter((z) => GUEST_IDS.some((g) => g === z.name)).map((z) => z.name);
  const internet = new Set(fw.cfg.zones.filter(isInternetZone).map((z) => z.name));
  const devices = fw.devices
    .map((d): DcDevice => {
      const zone = d.ip === undefined ? undefined : zoneForIp(fw, d.ip);
      return {
        mac: d.mac,
        name: d.name,
        ip: d.ip,
        zone,
        guest: zone !== undefined && guestZones.includes(zone),
        online: online.has(d.mac),
        ssid: ssid.get(d.mac),
        privateMac: isPrivateMac(d.mac),
      };
    })
    .filter((d) => d.zone === undefined || !internet.has(d.zone));
  return {
    fw,
    milkflint,
    people: parsePeople(milkflint),
    devices,
    intercept: interceptOn(fw.sections),
    guestZones,
  };
}

/**
 * One device's Device control state in words, for the All devices sheet:
 * "Sam · Paused until 07:00", with what's next. Undefined: no rule or pause
 * covers it.
 */
export async function deviceStatus(
  mac: string,
): Promise<{ who: string | undefined; text: string; next: string | undefined } | undefined> {
  const [firewall, milkflint, status] = await Promise.all([
    getConfig('firewall'),
    getConfig('milkflint').catch((): Section[] => []),
    getStatus().catch(() => undefined),
  ]);
  const cfg = parseFirewall(firewall, milkflint);
  const rules = deviceRules(cfg);
  const o = status === undefined ? { paused: new Map(), extra: new Map() } : overridesOf(status);
  const person = parsePeople(milkflint).find((p) => p.devices.includes(mac));
  if (person === undefined && !rules.some((r) => r.macs.includes(mac)) && !o.paused.has(mac)) return undefined;
  const clock: Clock = status === undefined ? { now: Math.floor(Date.now() / 1000), offset: 0 } : clockOf(status);
  const st = deviceState(mac, rules, o, clock);
  return { who: person?.name, text: stateText(st, clock), next: nextText(st, clock) };
}
