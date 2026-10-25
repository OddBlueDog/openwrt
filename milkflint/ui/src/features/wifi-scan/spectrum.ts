// What the Nearby Networks page works out from a scan: where each network
// sits on the radar (angle: its frequency, by band; distance: its signal),
// which ones share this router's channels, and how crowded each channel is.
import type { ScannedNetwork } from './api';

export type BandId = '2g' | '5g' | '6g';

interface BandPlan {
  label: string;
  /** The frequencies Wi-Fi uses (MHz), in runs; the gaps between them aren't drawn. */
  runs: readonly (readonly [number, number])[];
  /** Channels numbered around the edge. */
  marks: readonly number[];
  /** Share of the circle, against the other bands: 2.4 GHz is narrow but the busiest. */
  weight: number;
}

const plans: Record<BandId, BandPlan> = {
  // channel 1's lower edge to 13's upper (14, Japan only, falls on the edge)
  '2g': { label: '2.4 GHz', runs: [[2401, 2483]], marks: [1, 6, 11], weight: 1 },
  // 36–64, 100–144, 149–165
  '5g': {
    label: '5 GHz',
    runs: [
      [5170, 5330],
      [5490, 5730],
      [5735, 5835],
    ],
    marks: [36, 52, 64, 100, 116, 132, 149, 165],
    weight: 1.6,
  },
  '6g': { label: '6 GHz', runs: [[5945, 7125]], marks: [1, 33, 65, 97, 129, 161, 193, 225], weight: 1.2 },
};

export const bandOrder: readonly BandId[] = ['2g', '5g', '6g'];

export function bandLabel(band: string): string {
  return band in plans ? plans[band as BandId].label : band;
}

export function channelMhz(band: BandId, channel: number): number {
  if (band === '2g') return channel === 14 ? 2484 : 2407 + 5 * channel;
  if (band === '6g') return channel === 2 ? 5935 : 5950 + 5 * channel;
  return 5000 + 5 * channel;
}

/** The 20 MHz channels a band has, for the crowding chart. */
export function bandChannels(band: BandId): number[] {
  if (band === '2g') return Array.from({ length: 13 }, (_, i) => i + 1);
  if (band === '6g') return Array.from({ length: 59 }, (_, i) => 1 + 4 * i);
  return [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165];
}

/** The frequencies a network (or this router) takes up: [low, high] MHz. */
export function spanOf(n: { center: number; width: number }): [number, number] {
  return [n.center - n.width / 2, n.center + n.width / 2];
}

/** MHz two spans share. */
export function overlapMhz(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
}

// ---- the radar's geometry: angles in degrees clockwise from 12 o'clock ----

export const RADAR = {
  /** The router in the middle. */
  inner: 30,
  outer: 168,
  /** Between bands, at the top for the ring labels. */
  bandGap: 16,
  runGap: 3,
} as const;

interface Run {
  from: number;
  to: number;
  start: number;
  end: number;
}

export interface Sector {
  band: BandId;
  label: string;
  start: number;
  end: number;
  runs: Run[];
  marks: readonly number[];
}

/** The bands around the circle, each a sector its frequencies spread over. */
export function layoutSectors(bands: readonly BandId[]): Sector[] {
  const shown = bandOrder.filter((b) => bands.includes(b));
  const total = shown.reduce((s, b) => s + plans[b].weight, 0);
  const free = 360 - RADAR.bandGap * shown.length;
  let at = RADAR.bandGap / 2;
  return shown.map((band) => {
    const plan = plans[band];
    const size = (free * plan.weight) / total;
    const mhz = plan.runs.reduce((s, [a, b]) => s + b - a, 0);
    const perMhz = (size - RADAR.runGap * (plan.runs.length - 1)) / mhz;
    const start = at;
    let pos = at;
    const runs = plan.runs.map(([from, to]) => {
      const run = { from, to, start: pos, end: pos + (to - from) * perMhz };
      pos = run.end + RADAR.runGap;
      return run;
    });
    at += size + RADAR.bandGap;
    return { band, label: plan.label, start, end: start + size, runs, marks: plan.marks };
  });
}

/** Where a frequency falls on its band's sector (clamped into the nearest run). */
export function angleOf(sector: Sector, mhz: number): number {
  const runs = sector.runs;
  const first = runs[0];
  if (first === undefined) return sector.start;
  if (mhz <= first.from) return first.start;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (r === undefined) continue;
    if (mhz <= r.to) return r.start + ((mhz - r.from) / (r.to - r.from)) * (r.end - r.start);
    const next = runs[i + 1];
    // in the gap between two runs: whichever edge is nearer
    if (next !== undefined && mhz < next.from) return mhz - r.to < next.from - mhz ? r.end : next.start;
  }
  return runs.at(-1)?.end ?? sector.end;
}

/** Stronger signals sit closer to the router: -30 dBm at the middle, -92 at the edge. */
export function radiusOf(signal: number | null): number {
  const t = signal === null ? 1 : Math.min(1, Math.max(0, (-30 - signal) / 62));
  return RADAR.inner + 10 + t * (RADAR.outer - RADAR.inner - 10);
}

export const ringSignals = [-50, -60, -70, -80] as const;

export function point(angle: number, radius: number): { x: number; y: number } {
  const a = (angle * Math.PI) / 180;
  return { x: radius * Math.sin(a), y: -radius * Math.cos(a) };
}

/** An SVG arc along the circle of `radius`, from one angle to another (clockwise). */
export function arcPath(radius: number, from: number, to: number): string {
  const a = point(from, radius);
  const b = point(to, radius);
  const large = to - from > 180 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${String(radius)} ${String(radius)} 0 ${String(large)} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

/** A ring segment between two radii and two angles. */
export function wedgePath(r0: number, r1: number, from: number, to: number): string {
  const a = point(from, r1);
  const b = point(to, r1);
  const c = point(to, r0);
  const d = point(from, r0);
  const large = to - from > 180 ? 1 : 0;
  const f = (n: number): string => n.toFixed(2);
  return `M ${f(a.x)} ${f(a.y)} A ${String(r1)} ${String(r1)} 0 ${String(large)} 1 ${f(b.x)} ${f(b.y)} L ${f(c.x)} ${f(c.y)} A ${String(r0)} ${String(r0)} 0 ${String(large)} 0 ${f(d.x)} ${f(d.y)} Z`;
}

/** A small, steady offset from a network's address, so ones on the same channel don't sit on top of each other. */
export function jitter(bssid: string): number {
  let h = 2166136261;
  for (let i = 0; i < bssid.length; i++) h = Math.imul(h ^ bssid.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000 - 0.5;
}

// ---- what a network is ----

/**
 * The channel numbers a network's air covers. On 2.4 GHz channels are 5 MHz
 * apart but 20 MHz wide, so one on channel 1 (2402–2422 MHz) covers 1–3;
 * elsewhere, the 20 MHz channels it bonds.
 */
export function coveredChannels(n: { band: BandId; center: number; width: number }): number[] {
  const [lo, hi] = spanOf(n);
  if (n.band === '2g') return bandChannels('2g').filter((c) => channelMhz('2g', c) >= lo && channelMhz('2g', c) <= hi);
  return bandChannels(n.band).filter((c) => channelMhz(n.band, c) - 10 >= lo - 1 && channelMhz(n.band, c) + 10 <= hi + 1);
}

/** "1–3", or "36" for a single channel. */
export function coverLabel(n: { band: BandId; center: number; width: number; channel: number }): string {
  const covered = coveredChannels(n);
  const first = covered[0];
  const last = covered.at(-1);
  if (first === undefined || last === undefined) return String(n.channel);
  return first === last ? String(first) : `${String(first)}–${String(last)}`;
}

/** How strong a signal is here, in a word. */
export function signalWord(signal: number | null): string {
  if (signal === null) return 'Unknown';
  if (signal >= -55) return 'Strong';
  if (signal >= -67) return 'Good';
  if (signal >= -77) return 'Fair';
  return 'Faint';
}

export function standardLabel(standard: string): string {
  return { be: 'Wi-Fi 7', ax: 'Wi-Fi 6', ac: 'Wi-Fi 5', n: 'Wi-Fi 4' }[standard] ?? 'Legacy';
}

export interface Security {
  label: string;
  /** No password, or one that's easily broken. */
  weak: boolean;
  open: boolean;
}

export function securityOf(n: ScannedNetwork): Security {
  const rsn = n.security.rsn ?? undefined;
  const wpa = n.security.wpa ?? undefined;
  const akm = new Set([...(rsn?.akm ?? []), ...(wpa?.akm ?? [])]);
  const has = (...names: string[]): boolean => names.some((a) => akm.has(a));
  if (has('eap', 'ft-eap', 'eap-sha256', 'eap-suite-b', 'eap-suite-b-192'))
    return { label: has('eap-suite-b-192') || rsn?.mfp === 'required' ? 'WPA3-Enterprise' : 'Enterprise', weak: false, open: false };
  const sae = has('sae', 'ft-sae', 'sae-ext', 'ft-sae-ext');
  const psk = has('psk', 'ft-psk', 'psk-sha256');
  if (sae && psk) return { label: 'WPA2/WPA3', weak: false, open: false };
  if (sae) return { label: 'WPA3', weak: false, open: false };
  if (has('owe')) return { label: 'Enhanced Open', weak: false, open: true };
  if (psk && rsn !== undefined && wpa !== undefined) return { label: 'WPA/WPA2', weak: false, open: false };
  if (psk && rsn !== undefined) return { label: 'WPA2', weak: false, open: false };
  if (wpa !== undefined) return { label: 'WPA', weak: true, open: false };
  if (n.security.privacy) return { label: 'WEP', weak: true, open: false };
  return { label: 'Open', weak: true, open: true };
}

/** "36", or "36–48" for a wider channel (by its 20 MHz channels). */
export function channelRange(n: { band: BandId; channel: number; center: number; width: number }): string {
  if (n.width <= 20) return String(n.channel);
  const [lo, hi] = spanOf(n);
  if (n.band === '2g') {
    // 2.4 GHz channels are 5 MHz apart: name the two 20 MHz channels it bonds
    const other = n.center > n.channel * 5 + 2407 ? n.channel + 4 : n.channel - 4;
    return `${String(Math.min(n.channel, other))}–${String(Math.max(n.channel, other))}`;
  }
  const first = (lo + 10 - (n.band === '6g' ? 5950 : 5000)) / 5;
  const last = (hi - 10 - (n.band === '6g' ? 5950 : 5000)) / 5;
  return `${String(first)}–${String(last)}`;
}

// ---- how crowded the air is ----

/** How much a network weighs on a channel it overlaps: 1 when it's loud, nothing at the edge of hearing. */
export function loudness(signal: number | null): number {
  if (signal === null) return 0.1;
  return Math.min(1, Math.max(0.05, (signal + 95) / 40));
}

export interface ChannelLoad {
  channel: number;
  mhz: number;
  /** Networks that overlap it, loud ones counting most. */
  load: number;
  networks: number;
}

/** For each 20 MHz channel of a band: who else is on it. */
export function channelLoads(band: BandId, networks: readonly ScannedNetwork[]): ChannelLoad[] {
  return bandChannels(band).map((channel) => {
    const mhz = channelMhz(band, channel);
    const span: [number, number] = [mhz - 10, mhz + 10];
    let load = 0;
    let count = 0;
    for (const n of networks) {
      if (n.band !== band) continue;
      const shared = overlapMhz(spanOf(n), span);
      if (shared <= 0) continue;
      // on 2.4 GHz, a neighbour two channels away still covers half of it
      load += (shared / 20) * loudness(n.signal);
      count++;
    }
    return { channel, mhz, load, networks: count };
  });
}

/**
 * Where a network `width` MHz wide can go: on 2.4 GHz channels 1, 6 and 11
 * (the three that don't overlap each other), elsewhere every block of that
 * width, as the 20 MHz channels it covers. `allowed` holds the 20 MHz
 * channels the radio may use.
 */
function blocksOf(band: BandId, width: number, allowed: ReadonlySet<number> | undefined): number[][] {
  const blocks: number[][] = [];
  if (band === '2g') blocks.push([1], [6], [11]);
  else {
    const n = Math.max(1, width / 20);
    const all = new Set(bandChannels(band));
    for (const start of band === '5g' ? [36, 100, 149] : [1]) {
      for (let first = start; all.has(first); first += 4 * n) {
        const block = Array.from({ length: n }, (_, i) => first + 4 * i);
        if (block.every((c) => all.has(c))) blocks.push(block);
      }
    }
  }
  return blocks.filter((block) => allowed === undefined || block.every((c) => allowed.has(c)));
}

function blockSpan(band: BandId, block: readonly number[]): [number, number] {
  return [channelMhz(band, block[0] ?? 0) - 10, channelMhz(band, block.at(-1) ?? 0) + 10];
}

/**
 * The quietest place for a network `width` MHz wide (see blocksOf), each
 * place scored by the neighbours whose air it would share, loud ones
 * counting most.
 */
export function quietest(
  band: BandId,
  width: number,
  networks: readonly ScannedNetwork[],
  allowed: ReadonlySet<number> | undefined,
): { channels: number[]; load: number } | undefined {
  let best: { channels: number[]; load: number } | undefined;
  for (const block of blocksOf(band, width, allowed)) {
    const span = blockSpan(band, block);
    const load = networks
      .filter((n) => n.band === band)
      .reduce((sum, n) => sum + (overlapMhz(span, spanOf(n)) / (span[1] - span[0])) * loudness(n.signal), 0);
    if (best === undefined || load < best.load - 0.001) best = { channels: block, load };
  }
  return best;
}

/**
 * When no block of `width` is free of neighbours: the widest narrower width
 * (halving down to 20 MHz) that has blocks no other network touches at all,
 * and those blocks. Not on 2.4 GHz, where channels overlap their neighbours.
 */
export function emptyNarrower(
  band: BandId,
  width: number,
  networks: readonly ScannedNetwork[],
  allowed: ReadonlySet<number> | undefined,
): { width: number; blocks: number[][] } | undefined {
  if (band === '2g') return undefined;
  const here = networks.filter((n) => n.band === band);
  const empty = (w: number): number[][] =>
    blocksOf(band, w, allowed).filter((block) => here.every((n) => overlapMhz(blockSpan(band, block), spanOf(n)) <= 0));
  if (empty(width).length > 0) return undefined;
  for (let w = width / 2; w >= 20; w /= 2) {
    const blocks = empty(w);
    if (blocks.length > 0) return { width: w, blocks };
  }
  return undefined;
}
