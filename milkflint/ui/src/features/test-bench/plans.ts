// The test plans: a preset and the bench's members in, the run's schedule
// out (phases one after another, each with who does what). Members not
// named in a phase still probe: latency to the router, the internet and
// their peers runs through every phase, since latency under load is what
// a run is for. The router checks the schedule again before it starts.
import type { Member, Options, Phase, PhaseKind, ScheduleRequest } from './api';

export interface PlanMember {
  id: string;
  name: string;
  /** true: wired, false: Wi-Fi, undefined: the router couldn't tell */
  wired: boolean | undefined;
}

export function planMembers(members: readonly Member[]): PlanMember[] {
  return members.map((m) => ({ id: m.id, name: m.name, wired: m.link === undefined || m.link === null ? undefined : m.link.kind === 'wired' }));
}

export type PresetId = 'quick' | 'full' | 'wifi-wired' | 'custom';

export const presets: readonly { id: PresetId; title: string; description: string }[] = [
  { id: 'quick', title: 'Quick check', description: 'Idle latency, one download and one upload under load, DNS. About a minute.' },
  {
    id: 'full',
    title: 'Full',
    description: 'Everything: single and shared downloads, uploads, both ways, device to device, DNS and pages, a busy household.',
  },
  { id: 'wifi-wired', title: 'Wi-Fi vs wired', description: 'The same loads on a wired device and a Wi-Fi one, then between them.' },
  { id: 'custom', title: 'Custom', description: 'Pick the tests and how long each load runs.' },
];

/** What a custom plan runs; times in seconds. */
export interface CustomPlan {
  idleS: number;
  loadS: number;
  download: boolean;
  upload: boolean;
  both: boolean;
  everyone: boolean;
  d2d: boolean;
  dns: boolean;
  household: boolean;
}

export const defaultCustom: CustomPlan = {
  idleS: 20,
  loadS: 15,
  download: true,
  upload: true,
  both: false,
  everyone: false,
  d2d: false,
  dns: true,
  household: false,
};

/** Bounds the router holds a schedule to (features/test-bench/rpcd.uc). */
export const MIN_PHASE_S = 3;
export const MAX_PHASE_S = 60;
export const MAX_RUN_S = 600;

/** Streams a loader opens: a download, an upload, each of several loaders. */
const STREAMS = { down: 6, up: 4, shared: 3 } as const;
const SETTLE_S = 3;
const MAX_PAIRS = 4;
/** Long enough for two offers and answers through the router's mailbox, polled four times a second, and ICE. */
const CONNECT_S = 10;

export interface Built {
  schedule: ScheduleRequest;
  /** what the plan left out, and why */
  notes: string[];
}

/** At most 48 bytes, as the router takes a label, cut at a character. */
export function fitLabel(s: string): string {
  const enc = new TextEncoder();
  if (enc.encode(s).length <= 48) return s;
  let out = '';
  for (const ch of s) {
    if (enc.encode(`${out}${ch}…`).length > 48) break;
    out += ch;
  }
  return `${out}…`;
}

/** Pairs for device-to-device tests: Wi-Fi with wired first, then Wi-Fi with Wi-Fi, then wired with wired. */
export function d2dPairs(members: readonly PlanMember[], max: number = MAX_PAIRS): [PlanMember, PlanMember][] {
  const all: [PlanMember, PlanMember, number][] = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i];
      const b = members[j];
      if (a === undefined || b === undefined) continue;
      const rank = a.wired !== b.wired ? 0 : a.wired === false ? 1 : 2;
      all.push(a.wired === false && b.wired === true ? [b, a, rank] : [a, b, rank]);
    }
  }
  all.sort((x, y) => x[2] - y[2]);
  return all.slice(0, max).map(([a, b]) => [a, b]);
}

class Builder {
  phases: ScheduleRequest['phases'] = [];
  private at = 0;

  add(kind: PhaseKind, seconds: number, label: string, roles: Record<string, string> = {}, extra: Partial<ScheduleRequest['phases'][number]> = {}): void {
    const dur = Math.round(Math.min(MAX_PHASE_S, Math.max(MIN_PHASE_S, seconds)) * 1000);
    this.phases.push({ kind, start: this.at, dur, label: fitLabel(label), roles, ...extra });
    this.at += dur;
  }

  /** a connect phase, unless one came before: the connections stay up for the rest of the run */
  connect(): void {
    if (!this.phases.some((p) => p.kind === 'connect')) this.add('connect', CONNECT_S, 'Connect devices');
  }

  /** a short gap after a load, for the queues to drain before the next */
  settle(): void {
    const last = this.phases[this.phases.length - 1];
    if (last !== undefined && last.kind !== 'cooldown' && last.kind !== 'idle') this.add('cooldown', SETTLE_S, 'Settle');
  }
}

function loaders(members: readonly PlanMember[]): { wired: PlanMember | undefined; wifi: PlanMember | undefined; any: PlanMember | undefined } {
  const wired = members.find((m) => m.wired === true);
  const wifi = members.find((m) => m.wired === false);
  return { wired, wifi, any: wired ?? members[0] };
}

function d2dPhases(b: Builder, pairs: readonly [PlanMember, PlanMember][], seconds: number): void {
  if (pairs.length === 0) return;
  b.connect();
  for (const [x, y] of pairs) {
    b.add('d2d', seconds, `${x.name} → ${y.name}`, { [x.id]: 'a', [y.id]: 'b' }, { pair: [x.id, y.id], dir: 'ab' });
    b.add('d2d', seconds, `${y.name} → ${x.name}`, { [x.id]: 'a', [y.id]: 'b' }, { pair: [x.id, y.id], dir: 'ba' });
  }
}

function everyone(members: readonly PlanMember[], role: string): Record<string, string> {
  return Object.fromEntries(members.map((m) => [m.id, role]));
}

/** A busy household: one device downloads, another uploads, a pair talks, the rest browse. */
function householdRoles(members: readonly PlanMember[]): { roles: Record<string, string>; pair: [string, string] | undefined } {
  const roles: Record<string, string> = {};
  const l = loaders(members);
  const down = l.any;
  if (down !== undefined) roles[down.id] = 'down';
  const up = members.find((m) => m.id !== down?.id);
  if (up !== undefined) roles[up.id] = 'up';
  const rest = members.filter((m) => roles[m.id] === undefined);
  let pair: [string, string] | undefined;
  const [a, c] = rest;
  if (a !== undefined && c !== undefined) {
    roles[a.id] = 'a';
    roles[c.id] = 'b';
    pair = [a.id, c.id];
  }
  for (const m of members) roles[m.id] ??= 'pages';
  return { roles, pair };
}

export const defaultOptions: Options = { endpoint: 'cloudflare', latency: 'uk', budget_mb: 2000, custom_sites: [] };

export function buildPlan(
  preset: PresetId,
  members: readonly PlanMember[],
  dry: boolean,
  custom: CustomPlan = defaultCustom,
  options: Options = defaultOptions,
): Built {
  const b = new Builder();
  const notes: string[] = [];
  const l = loaders(members);
  const name = presets.find((p) => p.id === preset)?.title ?? 'Custom';

  const download = (m: PlanMember, seconds: number): void => {
    b.add('wan_down', seconds, `Download · ${m.name}`, { [m.id]: 'down' }, { streams: STREAMS.down });
    b.settle();
  };
  const upload = (m: PlanMember, seconds: number): void => {
    b.add('wan_up', seconds, `Upload · ${m.name}`, { [m.id]: 'up' }, { streams: STREAMS.up });
    b.settle();
  };

  if (preset === 'quick') {
    b.add('idle', 15, 'Idle');
    if (l.any !== undefined) {
      download(l.any, 15);
      upload(l.any, 15);
    }
    b.add('dns', 10, 'DNS and pages', everyone(members, 'dns'));
    b.add('cooldown', 5, 'Cool down');
  } else if (preset === 'full') {
    b.add('idle', 30, 'Idle');
    if (l.wired !== undefined) download(l.wired, 20);
    if (l.wifi !== undefined) download(l.wifi, 20);
    if (l.wired === undefined && l.wifi === undefined && l.any !== undefined) download(l.any, 20);
    if (l.any !== undefined) {
      upload(l.any, 20);
      b.add('wan_both', 20, `Both ways · ${l.any.name}`, { [l.any.id]: 'both' }, { streams: STREAMS.up });
      b.settle();
    }
    if (members.length > 1) {
      b.add('wan_down', 20, 'Everyone downloads', everyone(members, 'down'), { streams: STREAMS.shared });
      b.settle();
    }
    const pairs = d2dPairs(members);
    if (pairs.length === 0) notes.push('Device to device needs two devices.');
    d2dPhases(b, pairs, 8);
    b.add('dns', 30, 'DNS and pages', everyone(members, 'dns'));
    const h = householdRoles(members);
    b.add('household', 30, 'Busy household', h.roles, h.pair === undefined ? {} : { pair: h.pair, dir: 'both' });
    b.add('cooldown', 10, 'Cool down');
  } else if (preset === 'wifi-wired') {
    if (l.wired === undefined || l.wifi === undefined) {
      notes.push('Wi-Fi vs wired needs a wired device and a Wi-Fi one.');
    }
    b.add('idle', 20, 'Idle');
    for (const m of [l.wired, l.wifi]) if (m !== undefined) download(m, 20);
    for (const m of [l.wired, l.wifi]) if (m !== undefined) upload(m, 15);
    const pairs: [PlanMember, PlanMember][] = [];
    if (l.wired !== undefined && l.wifi !== undefined) pairs.push([l.wired, l.wifi]);
    const wifi2 = members.find((m) => m.wired === false && m.id !== l.wifi?.id);
    if (l.wifi !== undefined && wifi2 !== undefined) pairs.push([l.wifi, wifi2]);
    else notes.push('Wi-Fi to Wi-Fi needs a second Wi-Fi device.');
    d2dPhases(b, pairs, 8);
    b.add('cooldown', 5, 'Cool down');
  } else {
    const c = custom;
    if (c.idleS > 0) b.add('idle', c.idleS, 'Idle');
    if (l.any !== undefined) {
      if (c.download) download(l.any, c.loadS);
      if (c.upload) upload(l.any, c.loadS);
      if (c.both) {
        b.add('wan_both', c.loadS, `Both ways · ${l.any.name}`, { [l.any.id]: 'both' }, { streams: STREAMS.up });
        b.settle();
      }
    }
    if (c.everyone) {
      if (members.length > 1) {
        b.add('wan_down', c.loadS, 'Everyone downloads', everyone(members, 'down'), { streams: STREAMS.shared });
        b.settle();
      } else notes.push('Everyone downloads needs two devices.');
    }
    if (c.d2d) {
      const pairs = d2dPairs(members);
      if (pairs.length === 0) notes.push('Device to device needs two devices.');
      d2dPhases(b, pairs, Math.min(c.loadS, 20));
    }
    if (c.dns) b.add('dns', 20, 'DNS and pages', everyone(members, 'dns'));
    if (c.household) {
      const h = householdRoles(members);
      if (h.pair !== undefined) b.connect();
      b.add('household', Math.max(c.loadS, 20), 'Busy household', h.roles, h.pair === undefined ? {} : { pair: h.pair, dir: 'both' });
    }
    if (b.phases.length === 0) b.add('idle', 10, 'Idle');
    b.add('cooldown', 5, 'Cool down');
  }

  // a plan longer than a run may be loses its last phases
  const phases = b.phases;
  while (phases.length > 1 && scheduleLength({ phases }) > MAX_RUN_S * 1000) {
    const p = phases.pop();
    if (p !== undefined) notes.push(`Left out "${p.label ?? p.kind}": a run is ${String(MAX_RUN_S / 60)} minutes at most.`);
  }
  connectRoles(phases);
  return { schedule: { name, dry, phases, options }, notes };
}

/** Each connect phase's roles: every member a later phase pairs with another. */
function connectRoles(phases: ScheduleRequest['phases']): void {
  phases.forEach((p, i) => {
    if (p.kind !== 'connect') return;
    const ids = new Set(phases.slice(i + 1).flatMap((q) => q.pair ?? []));
    p.roles = Object.fromEntries([...ids].map((id) => [id, 'rtc']));
  });
}

/** Whether any phase loads the internet line (device-to-device data stays on the LAN). */
export function usesInternet(s: { readonly phases: readonly Pick<Phase, 'roles'>[] }): boolean {
  return s.phases.some((p) => Object.values(p.roles).some((r) => r === 'down' || r === 'up' || r === 'both'));
}

/** A schedule's length in ms. */
export function scheduleLength(s: { readonly phases: readonly Pick<Phase, 'start' | 'dur'>[] }): number {
  const last = s.phases[s.phases.length - 1];
  return last === undefined ? 0 : last.start + last.dur;
}

/** The phase at `t` ms from the run's start: its index, or -1 before the first and after the last. */
export function phaseAt(s: { readonly phases: readonly Pick<Phase, 'start' | 'dur'>[] }, t: number): number {
  return s.phases.findIndex((p) => t >= p.start && t < p.start + p.dur);
}

/**
 * The most a plan's internet loads can move, MB: each load phase's length
 * at Smart Queue's shaped rate, downloads and uploads (shared loads share
 * the line, so they count once). Undefined without Smart Queue's rates.
 */
export function dataEstimate(s: Pick<ScheduleRequest, 'phases' | 'dry'>, shaper: { down_kbit: number; up_kbit: number } | null | undefined): { down: number; up: number } | undefined {
  if (shaper === undefined || shaper === null || shaper.down_kbit <= 0 || s.dry) return s.dry ? { down: 0, up: 0 } : undefined;
  let down = 0;
  let up = 0;
  for (const p of s.phases) {
    const roles = Object.values(p.roles);
    const sec = p.dur / 1000;
    if (roles.includes('down') || roles.includes('both')) down += (shaper.down_kbit * sec) / 8000;
    if (roles.includes('up') || roles.includes('both')) up += (shaper.up_kbit * sec) / 8000;
  }
  return { down: Math.round(down), up: Math.round(up) };
}

/** A data budget for each member's loads: the plan's estimate with room to spare, 2,000 MB without one. */
export function defaultBudget(estimate: { down: number; up: number } | undefined): number {
  if (estimate === undefined) return 2000;
  return Math.max(500, Math.ceil(((estimate.down + estimate.up) * 1.5) / 100) * 100);
}
