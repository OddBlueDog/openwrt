// Home's figures that are worked out rather than read straight off the
// router: the wired devices online, the responsiveness summary and its
// chart's scale, the busiest devices, and the path from the internet to the
// devices. Pure functions, so the tests can check them.
import type { FeatureId } from '@/features/ids';
import { niceCeil } from '@/components/charts/scale';
import type { AddressName } from '@/lib/api/names';
import type { Connections } from '../lan/connections-api';
import { inSubnet, isReachable, type Neighbor } from '@/lib/api/network';
import { formatBitrate, formatNumber, formatPercent } from '@/lib/format';
import type { Sample as ProbeSample } from '../network-quality/api';
import { possibleSamples, possibleTime } from '../network-quality/plausible';
import { type ProbeSummary, summarize } from '../network-quality/score';
import type { Client } from './use-dashboard';

/**
 * Wired devices online: neighbours on the LAN that answered recently and
 * aren't on the Wi-Fi, counted as All devices counts them. Undefined when the
 * router can't say (no neighbour table, or no LAN address).
 */
export function wiredDevices(
  neighbors: readonly Neighbor[] | undefined,
  lan: { address: string; mask: number } | undefined,
  wifiMacs: ReadonlySet<string>,
  skipIps: ReadonlySet<string>,
): number | undefined {
  // a router without the neighbour reader answers an empty list: then nothing is known
  if (neighbors === undefined || neighbors.length === 0 || lan === undefined) return undefined;
  const macs = new Set<string>();
  for (const n of neighbors) {
    const mac = n.mac.toLowerCase();
    if (n.ip === lan.address || skipIps.has(n.ip) || wifiMacs.has(mac)) continue;
    if (!inSubnet(n.ip, lan.address, lan.mask) || !isReachable(n)) continue;
    macs.add(mac);
  }
  return macs.size;
}

/** Below this a device counts as idle (bit/s, both ways together). */
const IDLE_BPS = 8000;

/** Busiest first; idle devices after them, strongest signal first. */
export function busiestFirst<T extends { down: number | undefined; up: number | undefined; signal: number | undefined }>(
  devices: readonly T[],
): T[] {
  const traffic = (d: T): number => (d.down ?? 0) + (d.up ?? 0);
  const active = devices.filter((d) => traffic(d) >= IDLE_BPS).sort((a, b) => traffic(b) - traffic(a));
  const idle = devices.filter((d) => traffic(d) < IDLE_BPS).sort((a, b) => (b.signal ?? -200) - (a.signal ?? -200));
  return [...active, ...idle];
}

/** Which devices Busiest devices lists: all of them, those on the Wi-Fi, or those on a cable. */
export type BusyFilter = 'all' | 'wifi' | 'lan';

/** What a device has received and sent through its connections now, bytes: one device across its addresses. */
export interface WiredSum {
  /** Its MAC, else the address when no MAC is known. */
  key: string;
  mac: string | undefined;
  name: string | undefined;
  /** Its IPv4 address if it has one, else the first it uses. */
  ip: string | undefined;
  received: number;
  sent: number;
}

/**
 * The connections' sums per device (milkflint.connections' summary: each
 * address's in and out), folded by MAC; the router's own left out.
 */
export function wiredSums(devices: Connections['devices'], names: ReadonlyMap<string, AddressName>): WiredSum[] {
  const byKey = new Map<string, WiredSum>();
  for (const d of devices) {
    if (d.addr === 'router') continue;
    const who = names.get(d.addr);
    const key = who?.mac ?? d.addr;
    const sum = byKey.get(key) ?? { key, mac: who?.mac, name: who?.name, ip: undefined, received: 0, sent: 0 };
    sum.received += d.in;
    sum.sent += d.out;
    if (sum.ip === undefined || (sum.ip.includes(':') && !d.addr.includes(':'))) sum.ip = d.addr;
    byKey.set(key, sum);
  }
  return [...byKey.values()];
}

/** A device in Busiest devices: on the Wi-Fi (with its station's figures) or on a cable. */
export interface BusyDevice {
  key: string;
  name: string | undefined;
  ip: string | undefined;
  wifi: Client | undefined;
  /** bit/s */
  down: number | undefined;
  up: number | undefined;
  signal: number | undefined;
}

/** The devices for a filter, busiest first: the Wi-Fi's from their stations, the rest from their connections. */
export function busyDevices(
  clients: readonly Client[],
  wired: readonly {
    key: string;
    mac: string | undefined;
    name: string | undefined;
    ip: string | undefined;
    down: number | undefined;
    up: number | undefined;
  }[],
  filter: BusyFilter,
): BusyDevice[] {
  const onWifi = new Set(clients.map((c) => c.mac));
  const wifi =
    filter === 'lan'
      ? []
      : clients.map((c): BusyDevice => ({
          key: c.mac,
          name: c.name,
          ip: c.ip,
          wifi: c,
          down: c.down,
          up: c.up,
          signal: c.signal,
        }));
  const cabled =
    filter === 'wifi'
      ? []
      : wired
          .filter((w) => w.mac === undefined || !onWifi.has(w.mac))
          .map((w): BusyDevice => ({
            key: w.key,
            name: w.name,
            ip: w.ip,
            wifi: undefined,
            down: w.down,
            up: w.up,
            signal: undefined,
          }));
  return busiestFirst([...wifi, ...cabled]);
}

export type Tone = 'success' | 'warning' | 'destructive' | 'info';

export interface Responsiveness {
  /** The latest ping (ms); null when it got no answer, undefined before the first. */
  now: number | null | undefined;
  /** Over the last hour. */
  hour: ProbeSummary;
  /** Over the last five minutes. */
  recent: ProbeSummary;
  state: { tone: Tone; label: string };
}

/** Pings in the last five minutes with fewer answers than this are too few to compare. */
const MIN_ROUNDS = 6;

/**
 * Network Quality's internet pings over the last hour and five minutes, and a
 * word for how they compare: steady, slower than usual, losing pings or not
 * answering. Only what the probe measured: a round with an impossible time
 * (network-quality/plausible.ts) is left out.
 */
export function responsiveness(all: readonly ProbeSample[], now: number): Responsiveness {
  const samples = possibleSamples(all);
  const hourSamples = samples.filter((s) => s.t > now - 3600);
  const recentSamples = samples.filter((s) => s.t > now - 300);
  const hour = summarize(hourSamples).probes.internet;
  const recent = summarize(recentSamples).probes.internet;
  const last = hourSamples[hourSamples.length - 1];
  let state: Responsiveness['state'];
  if (recentSamples.length === 0) state = { tone: 'info', label: 'Measuring' };
  else if (recent.answered === 0) state = { tone: 'destructive', label: 'Not answering' };
  else if (recent.loss > 0.02) state = { tone: 'warning', label: 'Losing pings' };
  else if (
    recent.answered >= MIN_ROUNDS &&
    hour.answered >= 5 * MIN_ROUNDS &&
    recent.typical !== undefined &&
    hour.typical !== undefined &&
    recent.typical > hour.typical * 1.5 + 5
  )
    state = { tone: 'warning', label: 'Slower than usual' };
  else state = { tone: 'success', label: 'Steady' };
  return { now: last === undefined ? undefined : last.internet, hour, recent, state };
}

/**
 * The ping chart's top: room for the hour's pings, but no more than eight
 * times the typical one, so a single spike doesn't flatten the rest. `cut` is
 * the highest ping when it's above the top (drawn at the top, and said). An
 * impossible time (network-quality/plausible.ts) is never the highest.
 */
export function pingScale(pings: readonly number[]): { top: number; cut: number | undefined } {
  const sorted = pings.filter((v) => possibleTime(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return { top: 20, cut: undefined };
  const typical = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const highest = sorted[sorted.length - 1] ?? 0;
  const top = niceCeil(Math.max(20, Math.min(highest * 1.1, 8 * typical)));
  return { top, cut: highest > top ? highest : undefined };
}

export const ms = (v: number): string => `${formatNumber(v, v < 10 ? 1 : 0)} ms`;

/** Times for the foot of a chart that ends now: "2 min ago" and "Now". */
export function agoLabels(from: number, to: number, spanText: string): { t: number; label: string }[] {
  return [
    { t: from, label: `${spanText} ago` },
    { t: to, label: 'Now' },
  ];
}

// ---- at rest and under load ----
//
// Network Quality's pings carry no load, so Home measures it while it's open:
// each ping is paired with the WAN rate Home polled over the seconds around
// it, and the pair is busy when either direction carries half of what Smart
// Queue lets through (while it shapes that direction), or else half of the
// highest rate seen, and at least LOAD_FLOOR_BPS.

/** A ping paired with the line's load when it was sent. */
export interface LoadPair {
  /** When the ping was sent, epoch seconds on the router's clock (as Network Quality's samples). */
  t: number;
  /** ms; null when it got no answer. */
  ping: number | null;
  /** The WAN's rates then, bit/s. */
  down: number;
  up: number;
  /** Smart Queue's limit for each direction then, bit/s; undefined while it didn't shape it. */
  limitDown: number | undefined;
  limitUp: number | undefined;
}

/** A direction counts as busy at this share of its limit (or of the highest rate seen). */
export const LOAD_SHARE = 0.5;
/** Without Smart Queue's limit, a direction below this is never busy: an idle line's bursts aren't load. */
export const LOAD_FLOOR_BPS = 1e6;
/** How long Home keeps its pairs: the chart's hour. */
export const LOAD_KEEP_S = 3600;

/**
 * Pairs each ping with the WAN rate polled over the interval it fell in: the
 * first rate after it, over an ordinary poll interval (not one stretched by
 * a hidden tab). `offset` is this browser's clock minus the router's (s): the
 * rates are timed by the browser. A ping no rate covers yet (or ever) is
 * left out.
 */
export function pairPings(
  samples: readonly { t: number; internet: number | null }[],
  rates: readonly { t: number; wanDown: number | undefined; wanUp: number | undefined }[],
  offset: number,
  limits: { down: number | undefined; up: number | undefined },
  pollSeconds: number,
): LoadPair[] {
  const out: LoadPair[] = [];
  for (const s of samples) {
    if (!possibleTime(s.internet)) continue;
    const at = s.t + offset;
    // the first rate measured after the ping covers it (each rate spans the poll before it)
    const i = rates.findIndex((x) => x.t >= at);
    const r = rates[i];
    const before = rates[i - 1];
    if (r === undefined || before === undefined || r.t - before.t > pollSeconds * 1.5) continue;
    if (r.wanDown === undefined || r.wanUp === undefined) continue;
    out.push({ t: s.t, ping: s.internet, down: r.wanDown, up: r.wanUp, limitDown: limits.down, limitUp: limits.up });
  }
  return out;
}

/** The pairs held so far with the new ones, once each, oldest first, for the last LOAD_KEEP_S. */
export function mergePairs(held: readonly LoadPair[], fresh: readonly LoadPair[], now: number): LoadPair[] {
  const byTime = new Map(held.map((p) => [p.t, p]));
  for (const p of fresh) byTime.set(p.t, p);
  return [...byTime.values()].filter((p) => p.t > now - LOAD_KEEP_S).sort((a, b) => a.t - b.t);
}

/**
 * The highest rate that counts: the highest, unless it's more than ten times
 * the next (a counter glitch, a near-zero interval), when the next one
 * counts instead, so one bogus sample can't set the bar for "busy".
 */
export function highRate(rates: readonly number[]): number {
  const sorted = [...rates].sort((a, b) => b - a);
  let i = 0;
  while (i + 1 < sorted.length && (sorted[i] ?? 0) > 10 * (sorted[i + 1] ?? 0) && (sorted[i + 1] ?? 0) > 0) i++;
  return sorted[i] ?? 0;
}

function directionBusy(rate: number, limit: number | undefined, highest: number): boolean {
  const threshold = limit !== undefined && limit > 0 ? LOAD_SHARE * limit : Math.max(LOAD_FLOOR_BPS, LOAD_SHARE * highest);
  return rate >= threshold;
}

/**
 * Whether the line is busy now, by the same rule as Responsiveness's pairs:
 * the newest 2 s sample against Smart Queue's limit each way, or against the
 * highest rate in the samples held (and never below LOAD_FLOOR_BPS).
 */
export function lineBusyNow(
  history: readonly { wanDown: number | undefined; wanUp: number | undefined }[],
  limitDown: number | undefined,
  limitUp: number | undefined,
): boolean {
  const latest = history[history.length - 1];
  if (latest === undefined) return false;
  const highestDown = highRate(history.map((s) => s.wanDown ?? 0));
  const highestUp = highRate(history.map((s) => s.wanUp ?? 0));
  return directionBusy(latest.wanDown ?? 0, limitDown, highestDown) || directionBusy(latest.wanUp ?? 0, limitUp, highestUp);
}

/** Whether the line was busy at each pair. */
export function busyFlags(pairs: readonly LoadPair[]): boolean[] {
  const highestDown = highRate(pairs.map((p) => p.down));
  const highestUp = highRate(pairs.map((p) => p.up));
  return pairs.map((p) => directionBusy(p.down, p.limitDown, highestDown) || directionBusy(p.up, p.limitUp, highestUp));
}

function median(values: readonly number[]): number | undefined {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? undefined : sorted[Math.floor(sorted.length / 2)];
}

export interface LoadSummary {
  /** Pings paired with a rate. */
  paired: number;
  busy: number;
  /** Median ping while the line was quiet, and while it was busy (answered pings only). */
  atRest: number | undefined;
  underLoad: number | undefined;
  /** The stretches the line was busy, router clock, padded by half a probe interval each side. */
  stretches: { from: number; to: number }[];
}

/** At rest against under load, from the pairs; `step` is the probe's interval (s). */
export function loadSummary(pairs: readonly LoadPair[], step: number): LoadSummary {
  const flags = busyFlags(pairs);
  const quiet: number[] = [];
  const loaded: number[] = [];
  const stretches: { from: number; to: number }[] = [];
  let open: { from: number; to: number } | undefined;
  pairs.forEach((p, i) => {
    const busy = flags[i] === true;
    if (p.ping !== null) (busy ? loaded : quiet).push(p.ping);
    if (busy && open !== undefined && p.t - open.to <= step * 2.5) open.to = p.t;
    else if (busy) {
      if (open !== undefined) stretches.push(open);
      open = { from: p.t, to: p.t };
    } else if (open !== undefined) {
      stretches.push(open);
      open = undefined;
    }
  });
  if (open !== undefined) stretches.push(open);
  return {
    paired: pairs.length,
    busy: flags.filter(Boolean).length,
    atRest: median(quiet),
    underLoad: median(loaded),
    stretches: stretches.map((s) => ({ from: s.from - step / 2, to: s.to + step / 2 })),
  };
}

// ---- the path ----

/** A core at or above this is busy (it can hold up the traffic it handles). */
export const CORE_BUSY = 0.9;
/** Smart Queue at or above this share of its limit: the line is full and it's shaping. */
export const SHAPING_BUSY = 0.8;

/** A Smart Queue direction's rate as a share of its limit: 0 without a rate or a limit. */
export function shapingShare(c: { rate: number | undefined; bandwidth: number | undefined } | undefined): number {
  return c?.rate === undefined || c.bandwidth === undefined || c.bandwidth <= 0 ? 0 : c.rate / c.bandwidth;
}

export type StepState = 'ok' | 'busy' | 'off' | 'down';

export interface PathStep {
  key: string;
  name: string;
  /** Its page. */
  route: FeatureId;
  state: StepState;
  /** The word beside the state's dot. */
  status: string;
  /** The delay measured at this step, if any: none where the router doesn't measure one. */
  delays: { label: string; value: string }[];
  /** Its main reading, when the router measures one here. */
  figure: { label: string; value: string } | undefined;
  lines: string[];
}

export interface PathInput {
  ap: boolean;
  online: boolean;
  /** Not set up at all (no WAN interface). */
  noWan: boolean;
  wanDown: number | undefined;
  wanUp: number | undefined;
  /** The line is busy now (lineBusyNow). */
  lineBusy: boolean;
  /**
   * Network Quality's typical pings over the last five minutes, while it's on:
   * to the internet target and to the provider's gateway (the first hop),
   * which some providers' gateways never answer.
   */
  probe: { internet: number | undefined; gateway: number | undefined; gatewaySilent: boolean } | undefined;
  cake: readonly {
    download: boolean;
    rate: number | undefined;
    bandwidth: number | undefined;
    avgDelayUs: number | undefined;
    peakDelayUs: number | undefined;
  }[];
  cpu: number | undefined;
  cores: readonly number[];
  radios: readonly {
    name: string;
    band: string | undefined;
    up: boolean;
    /** no network switched on: off by choice, not down */
    off?: boolean;
    clients: number;
    channel: number | undefined;
    htmode: string | undefined;
    rateDown: number | undefined;
  }[];
  wired: number | undefined;
  lanUp: boolean;
  gateway: string | undefined;
}

const delay = (us: number | undefined): string => (us === undefined ? '—' : `${formatNumber(us / 1000, 1)} ms`);

/** The internet step's delays: past the gateway (the internet ping less the gateway's), and the gateway itself. */
function internetDelays(probe: PathInput['probe']): { delays: PathStep['delays']; lines: string[] } {
  if (probe === undefined) return { delays: [], lines: ['Delay not measured: Network Quality is off'] };
  if (probe.internet === undefined) return { delays: [], lines: ['No ping answered in the last 5 minutes'] };
  if (probe.gatewaySilent || probe.gateway === undefined) {
    // the whole way only: no first hop to take off
    return { delays: [], lines: [`Ping ${ms(probe.internet)}; the gateway doesn’t answer pings`] };
  }
  return {
    delays: [{ label: 'Past the gateway, adds about', value: ms(Math.max(0, probe.internet - probe.gateway)) }],
    lines: [`To the gateway ${ms(probe.gateway)}`],
  };
}

/**
 * The way from the internet to the devices, each step with what the router
 * measures there: delay where it measures it (Network Quality's pings,
 * Smart Queue's queues), the rates, the CPU and the devices. First the parts
 * all traffic shares, then the last hop (each device uses one of them).
 */
export function pathSteps(p: PathInput): { shared: PathStep[]; last: PathStep[] } {
  const shared: PathStep[] = [];

  if (p.ap) {
    shared.push({
      key: 'uplink',
      name: 'Main router',
      route: 'mode',
      state: p.online ? 'ok' : 'down',
      status: p.online ? 'Connected' : 'Not connected',
      delays: [],
      figure: undefined,
      lines: p.online ? [`Via ${p.gateway ?? 'the LAN'}`] : ['No address from it yet'],
    });
  } else {
    const measured = p.online ? internetDelays(p.probe) : { delays: [], lines: [] };
    shared.push({
      key: 'internet',
      name: 'Internet',
      route: 'internet',
      state: p.online ? (p.lineBusy ? 'busy' : 'ok') : 'down',
      status: p.noWan ? 'Not set up' : p.online ? (p.lineBusy ? 'Busy' : 'Online') : 'Offline',
      delays: measured.delays,
      figure: p.online && p.wanDown !== undefined ? { label: 'Download now', value: formatBitrate(p.wanDown) } : undefined,
      lines: p.online
        ? [...measured.lines, ...(p.wanUp === undefined ? [] : [`Upload ${formatBitrate(p.wanUp)}`])]
        : [p.noWan ? 'No internet connection set up' : 'The WAN link is down'],
    });

    const down = p.cake.find((c) => c.download);
    const up = p.cake.find((c) => !c.download);
    const busy = Math.max(shapingShare(down), shapingShare(up)) >= SHAPING_BUSY;
    const limit = (c: (typeof p.cake)[number] | undefined): string =>
      c?.bandwidth === undefined ? 'no limit' : formatBitrate(c.bandwidth);
    const peaks = [down, up].flatMap((c) =>
      c?.peakDelayUs === undefined ? [] : [`${delay(c.peakDelayUs)} ${c.download ? 'down' : 'up'}`],
    );
    shared.push(
      p.cake.length === 0
        ? {
            key: 'sqm',
            name: 'Smart Queue',
            route: 'sqm',
            state: 'off',
            status: 'Off',
            delays: [],
            figure: undefined,
            lines: ['Keeps latency low when the line is busy'],
          }
        : {
            key: 'sqm',
            name: 'Smart Queue',
            route: 'sqm',
            state: busy ? 'busy' : 'ok',
            status: busy ? 'Busy' : 'On',
            // CAKE's own average time in the queue, each way
            delays: [down, up].flatMap((c) =>
              c === undefined ? [] : [{ label: `Queue ${c.download ? 'down' : 'up'}`, value: delay(c.avgDelayUs) }],
            ),
            figure: undefined,
            lines: [
              `Limits ${limit(down)} down, ${limit(up)} up`,
              ...(peaks.length > 0 ? [`Peaks ${peaks.join(', ')}`] : []),
              ...(busy ? [`At ${formatPercent(Math.max(shapingShare(down), shapingShare(up)))} of its limit`] : []),
            ],
          },
    );
  }

  const busiest = p.cores.reduce((m, c) => Math.max(m, c), 0);
  const coreBusy = p.cores.length > 0 && busiest >= CORE_BUSY;
  shared.push({
    key: 'router',
    name: 'Router',
    route: 'system-overview',
    state: coreBusy ? 'busy' : 'ok',
    status: coreBusy ? 'Busy' : 'OK',
    delays: [],
    figure: p.cpu === undefined ? undefined : { label: 'CPU', value: formatPercent(p.cpu) },
    lines: [
      ...(p.cores.length > 0 ? [`${formatNumber(p.cores.length)} core${p.cores.length === 1 ? '' : 's'}`] : []),
      ...(p.cores.length > 1 ? [`Busiest core ${formatPercent(busiest)}`] : []),
    ],
  });

  const last: PathStep[] = p.radios.map((r) => ({
    key: `wifi-${r.name}`,
    name: `Wi-Fi ${r.band ?? r.name}`,
    route: 'wifi',
    state: r.off === true ? 'off' : r.up ? 'ok' : 'down',
    status: r.off === true ? 'Off' : r.up ? 'On' : 'Down',
    delays: [],
    figure: r.up ? { label: 'Devices', value: formatNumber(r.clients) } : undefined,
    lines:
      r.off === true
        ? ['No network switched on']
        : r.up
          ? [
              [r.channel === undefined ? undefined : `Channel ${String(r.channel)}`, r.htmode].filter(Boolean).join(' · '),
              ...(r.rateDown === undefined ? [] : [`Download ${formatBitrate(r.rateDown)}`]),
            ].filter((l) => l !== '')
          : ['Enabled but not broadcasting'],
  }));
  last.push({
    key: 'wired',
    name: 'Wired',
    route: 'clients',
    state: p.lanUp ? 'ok' : 'down',
    status: p.lanUp ? 'On' : 'Down',
    delays: [],
    figure: p.wired === undefined ? undefined : { label: 'Devices', value: formatNumber(p.wired) },
    lines: [p.lanUp ? 'Devices on the LAN ports' : 'The LAN is down'],
  });

  return { shared, last };
}

/**
 * Where the Flint 2's chips protect themselves: the Wi-Fi firmware slows its
 * sending from 120 °C (mt7915's temp1_max), the 2.5G port chips raise their
 * alarm at 120 °C, and the CPU's thermal zone warns at 120 °C and powers the
 * router off at 125 °C. Its lower trip points drive a fan the Flint 2 doesn't
 * have, so nothing happens there.
 */
export const CHIP_LIMIT_C = 120;
/** Hot: within 10 °C of that limit. Warm: within 25 °C. Below, a normal working temperature. */
export const HOT_C = CHIP_LIMIT_C - 10;
export const WARM_C = CHIP_LIMIT_C - 25;

export function temperatureLevel(celsius: number): 'normal' | 'warm' | 'hot' {
  return celsius >= HOT_C ? 'hot' : celsius >= WARM_C ? 'warm' : 'normal';
}
