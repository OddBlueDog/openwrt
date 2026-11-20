// Device control's model: people (a name and their devices), the times
// their internet is off, and what's in force now. The times live only in the
// firewall's own rules (/etc/config/firewall), so the Firewall page and LuCI
// show the same rules this page writes; a person (name, devices, SafeSearch,
// Guest Wi-Fi) is a `person` section of /etc/config/milkflint, with no times.
//
// A window is "off from 21:00 until 07:00, on Sun–Thu nights". fw4 matches a
// rule's time and day on every packet, so an overnight window is written as
// two rules: its evening (21:00–23:59:59 on the days picked) and its morning
// (00:00–07:00 on the day after each), and the days mean what the parent
// picked. Each rule skips devices given extra time (the devctl_extra set);
// pausing puts devices in devctl_paused, which one rule blocks. Both sets are
// filled at runtime by the router (milkflint.devicecontrol), never by a save.
import { type Values, type Wanted, reconcile, type Owned } from '@/lib/api/owned';
import { bool, type Change, list, type Section, str } from '@/lib/api/uci';
import { GUEST_IDS } from '../wifi-guest/guest';
import { type FirewallConfig, isInternetZone, normalizeDay, type Rule, WEEKDAYS, wanZone } from '../firewall/model';
import {
  devctlPart,
  type DevctlPart,
  EXTRA_SET,
  GLOBAL_SECTIONS,
  isPersonId,
  PAUSE_RULE,
  PAUSED_SET,
  PREFIX,
  RESTORE_INCLUDE,
  RESTORE_PATH,
} from './names';

export type Day = (typeof WEEKDAYS)[number];
export const DAYS: readonly Day[] = WEEKDAYS;

// ---- Names on the router ----

export {
  devctlPart,
  type DevctlPart,
  EXTRA_SET,
  GLOBAL_SECTIONS,
  isPersonId,
  PAUSE_RULE,
  PAUSED_SET,
  PREFIX,
  RESTORE_INCLUDE,
  RESTORE_PATH,
} from './names';

// ---- Windows ----

export interface Window {
  /** hh:mm, by the router's clock */
  start: string;
  /** hh:mm; earlier than (or equal to midnight after) start: the next morning */
  stop: string;
  /** the days it starts on, Mon … Sun order */
  days: Day[];
  /** what it's called in the rule's name: a preset's name, or "Internet off" */
  label: string;
}

export const DEFAULT_LABEL = 'Internet off';

export interface Preset {
  id: 'bedtime' | 'school-nights' | 'school-hours' | 'weekends';
  window: Window;
  /** one line under its name */
  hint: string;
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'bedtime',
    window: { start: '21:00', stop: '07:00', days: [...DAYS], label: 'Bedtime' },
    hint: '21:00–07:00 every night',
  },
  {
    id: 'school-nights',
    window: { start: '21:00', stop: '07:00', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Sun'], label: 'School nights' },
    hint: '21:00–07:00, Sunday to Thursday night',
  },
  {
    id: 'school-hours',
    window: { start: '08:30', stop: '15:30', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], label: 'School hours' },
    hint: '08:30–15:30 on weekdays',
  },
  {
    id: 'weekends',
    window: { start: '23:00', stop: '08:00', days: ['Fri', 'Sat'], label: 'Weekends' },
    hint: '23:00–08:00 on Friday and Saturday night',
  },
];

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function minutesOf(hhmm: string): number {
  const m = HHMM.exec(hhmm);
  return m === null ? Number.NaN : Number(m[1]) * 60 + Number(m[2]);
}

/** Runs past midnight into the next morning (a stop at 00:00 ends at midnight, the same day). */
export function isOvernight(w: Pick<Window, 'start' | 'stop'>): boolean {
  return w.stop !== '00:00' && minutesOf(w.stop) < minutesOf(w.start);
}

export function windowError(w: Window): string | undefined {
  if (!HHMM.test(w.start) || !HHMM.test(w.stop)) return 'Times as hh:mm, e.g. 21:00.';
  if (w.start === w.stop) return 'It can’t start and end at the same time.';
  if (w.days.length === 0) return 'Pick at least one day.';
  return undefined;
}

/** Days in Mon … Sun order, each once. */
export function ordered(days: readonly string[]): Day[] {
  const set = new Set(days);
  return DAYS.filter((d) => set.has(d));
}

function shiftDays(days: readonly Day[], by: number): Day[] {
  const set = new Set(days.map((d) => (DAYS.indexOf(d) + by + 7) % 7));
  return DAYS.filter((_, i) => set.has(i));
}

// ---- People ----

export interface Person {
  /** its milkflint section: devctl_ab12 */
  id: string;
  /** undefined: a device on its own, named by its device */
  name: string | undefined;
  /** MACs, lower case */
  devices: string[];
  safeSearch: boolean;
  /** also stop Guest Wi-Fi's internet during their windows */
  guest: boolean;
}

/** A name with its spaces trimmed; undefined when there's none. */
function blankless(name: string | undefined): string | undefined {
  const n = name?.trim();
  return n === undefined || n === '' ? undefined : n;
}

export function parsePeople(milkflint: readonly Section[]): Person[] {
  return milkflint
    .filter((s) => s['.type'] === 'person' && isPersonId(s['.name']))
    .map((s) => ({
      id: s['.name'],
      name: blankless(str(s, 'name')),
      devices: [...new Set(list(s, 'device').map((m) => m.toLowerCase()))],
      safeSearch: bool(s, 'safesearch'),
      guest: bool(s, 'guest'),
    }));
}

/** A new person's section name, one no section of either config has. */
export function newPersonId(taken: ReadonlySet<string>, random: () => number = Math.random): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (;;) {
    let id = PREFIX;
    for (let i = 0; i < 4; i++) id += chars[Math.floor(random() * chars.length) % chars.length] ?? 'a';
    if (![...taken].some((t) => t === id || t.startsWith(`${id}_`))) return id;
  }
}

// ---- Reading the firewall's rules back ----

/** Options a Device control rule may have: anything else was added by hand. */
const RULE_OPTIONS = new Set([
  'name',
  'src',
  'dest',
  'src_mac',
  'ipset',
  'proto',
  'target',
  'start_time',
  'stop_time',
  'weekdays',
]);

/** fw4's time: H[:MM[:SS]] in seconds of the day, as fw4 itself parses it. */
export function parseTime(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const m = /^([0-9]{1,2})(?::([0-9]{1,2})(?::([0-9]{1,2}))?)?$/.exec(v.trim());
  if (m === null) return undefined;
  const [h, mi, s] = [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
  if (h > 23 || mi > 59 || s > 59) return undefined;
  return h * 3600 + mi * 60 + s;
}

function hhmm(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** fw4's weekdays: names or prefixes of them, the whole list inverted by a leading "!". */
export function parseDays(values: readonly string[]): { days: Day[]; invert: boolean } | undefined {
  if (values.length === 0) return undefined;
  const first = values[0] ?? '';
  const invert = first.startsWith('!');
  const names = values.map((v, i) => (i === 0 && invert ? v.slice(1) : v)).filter((v) => v !== '');
  const days = names.map(normalizeDay);
  if (days.some((d) => d === undefined)) return undefined;
  const set = new Set(days);
  return { days: DAYS.filter((d) => set.has(d)), invert };
}

/** One rule of a person, read from its section. */
interface Piece {
  section: Section;
  part: Exclude<DevctlPart, { kind: 'global' }>;
}

/** What Device control finds of one person in the firewall config. */
export interface PersonRules {
  windows: Window[];
  always: boolean;
  /** their sections Device control would write differently: shown as they are, left alone */
  byHand: Section[];
  /** the sections Device control wrote and may rewrite or delete */
  owned: string[];
  /** some window lacks its Guest Wi-Fi rule (a guest network added since), or has one it shouldn't */
  guestDrift: boolean;
  /** each owned section's window ('always' for the always-off rule), for the Firewall page */
  bySection: Map<string, Window | 'always'>;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const x = new Set(a.map((v) => v.toLowerCase()));
  const y = new Set(b.map((v) => v.toLowerCase()));
  return x.size === y.size && [...x].every((v) => y.has(v));
};

/** Name of the person a rule is for, as written: "Sam: Bedtime" → "Bedtime" (and " (morning)" taken off). */
function labelOf(name: string | undefined): string {
  const after = name?.includes(': ') === true ? name.slice(name.indexOf(': ') + 2) : '';
  const label = after
    .replace(/, (Guest Wi-Fi|guest[23]?)$/, '')
    .replace(/ \(morning\)$/, '')
    .trim();
  return label === '' || label === 'always off' ? DEFAULT_LABEL : label;
}

function plain(s: Section, wan: string, kind: 'person' | 'guest', person: Person | undefined, zone?: string): boolean {
  const keys = Object.keys(s).filter((k) => !k.startsWith('.'));
  if (keys.some((k) => !RULE_OPTIONS.has(k))) return false;
  if (str(s, 'dest') !== wan || str(s, 'target') !== 'REJECT') return false;
  const proto = list(s, 'proto');
  if (proto.length !== 1 || proto[0] !== 'all') return false;
  if (kind === 'person') {
    return (
      str(s, 'src') === '*' &&
      str(s, 'ipset') === `!${EXTRA_SET}` &&
      person !== undefined &&
      person.devices.length > 0 &&
      sameSet(list(s, 'src_mac'), person.devices)
    );
  }
  return str(s, 'src') === zone && list(s, 'src_mac').length === 0 && str(s, 'ipset') === undefined;
}

interface Timed {
  start: number;
  stop: number;
  days: Day[];
}

function timed(s: Section): Timed | undefined {
  const start = parseTime(str(s, 'start_time'));
  const stop = parseTime(str(s, 'stop_time'));
  if (start === undefined || stop === undefined || start >= stop) return undefined;
  const wd = list(s, 'weekdays');
  if (wd.length === 0) return { start, stop, days: [...DAYS] };
  const d = parseDays(wd);
  if (d === undefined || d.invert || d.days.length === 0) return undefined;
  return { start, stop, days: d.days };
}

const END_OF_DAY = 23 * 3600 + 59 * 60 + 59;

/**
 * The windows a person's rules hold, the ones edited by hand, and which
 * sections are Device control's to rewrite. A rule counts as Device
 * control's only exactly as it writes it: any zone to the internet, the
 * person's devices and no others, every protocol, reject, skipping devices
 * with extra time, with its times; an overnight window's evening and morning
 * agree. A rule turned off, given a port, or with its devices changed in
 * LuCI is left as it is.
 */
export function personRules(cfg: FirewallConfig, sections: readonly Section[], person: Person): PersonRules {
  const wan = wanZone(cfg)?.name ?? 'wan';
  const guestZones = cfg.zones.filter((z) => GUEST_IDS.some((g) => g === z.name)).map((z) => z.name);
  const pieces: Piece[] = sections.flatMap((s) => {
    if (s['.type'] !== 'rule') return [];
    const part = devctlPart(s['.name']);
    return part !== undefined && part.kind !== 'global' && part.person === person.id ? [{ section: s, part }] : [];
  });
  const out: PersonRules = { windows: [], always: false, byHand: [], owned: [], guestDrift: false, bySection: new Map() };
  const handled = new Set<string>();
  const byHand = (s: Section): void => {
    if (!handled.has(s['.name'])) out.byHand.push(s);
    handled.add(s['.name']);
  };
  const own = (s: Section): void => {
    out.owned.push(s['.name']);
    handled.add(s['.name']);
  };

  for (const p of pieces) {
    if (p.part.kind !== 'always') continue;
    const s = p.section;
    const noTimes = ['start_time', 'stop_time', 'weekdays'].every((o) => s[o] === undefined);
    if (plain(s, wan, 'person', person) && noTimes && bool(s, 'enabled', true)) {
      out.always = true;
      own(s);
      out.bySection.set(s['.name'], 'always');
    } else byHand(s);
  }

  const numbers = [
    ...new Set(pieces.flatMap((p) => (p.part.kind === 'window' && p.part.guest === undefined ? [p.part.n] : []))),
  ].sort((a, b) => a - b);
  const find = (n: number, guest: string | undefined, morning: boolean): Section | undefined =>
    pieces.find((p) => p.part.kind === 'window' && p.part.n === n && p.part.guest === guest && p.part.morning === morning)
      ?.section;

  for (const n of numbers) {
    const evening = find(n, undefined, false);
    const morning = find(n, undefined, true);
    const ok = (s: Section | undefined): s is Section =>
      s !== undefined && plain(s, wan, 'person', person) && bool(s, 'enabled', true) && timed(s) !== undefined;
    let w: Window | undefined;
    const label = labelOf(str(evening ?? morning, 'name'));
    if (ok(evening) && morning === undefined) {
      const t = timed(evening);
      if (t !== undefined)
        w = { start: hhmm(t.start), stop: t.stop === END_OF_DAY ? '00:00' : hhmm(t.stop), days: t.days, label };
    } else if (ok(evening) && ok(morning)) {
      const e = timed(evening);
      const m = timed(morning);
      if (
        e !== undefined &&
        m !== undefined &&
        e.stop === END_OF_DAY &&
        m.start === 0 &&
        m.stop < e.start &&
        shiftDays(e.days, 1).join() === m.days.join()
      )
        w = { start: hhmm(e.start), stop: hhmm(m.stop), days: e.days, label };
    }
    if (w === undefined) {
      if (evening !== undefined) byHand(evening);
      if (morning !== undefined) byHand(morning);
      continue;
    }
    out.windows.push(w);
    const found = w;
    const ownOf = (s: Section): void => {
      own(s);
      out.bySection.set(s['.name'], found);
    };
    if (evening !== undefined) ownOf(evening);
    if (morning !== undefined) ownOf(morning);
    // its Guest Wi-Fi rules: the same times, from each guest network
    const want = windowTimes(w);
    for (const zone of guestZones) {
      for (const morningPart of [false, true]) {
        const s = find(n, zone, morningPart);
        const t = want.find((x) => x.morning === morningPart);
        if (s === undefined) {
          if (person.guest && t !== undefined) out.guestDrift = true;
          continue;
        }
        const matches =
          t !== undefined &&
          plain(s, wan, 'guest', person, zone) &&
          bool(s, 'enabled', true) &&
          str(s, 'start_time') === t.start_time &&
          str(s, 'stop_time') === t.stop_time &&
          (str(s, 'weekdays') ?? '') === (t.weekdays ?? '');
        if (!matches) {
          byHand(s);
          continue;
        }
        // there while Guest Wi-Fi is off for them: the next save takes it out
        if (!person.guest) out.guestDrift = true;
        ownOf(s);
      }
    }
  }
  // guest rules of a window number that has no rules of its own
  for (const p of pieces) if (!handled.has(p.section['.name'])) byHand(p.section);
  return out;
}

// ---- Writing them ----

interface RuleTimes {
  start_time: string;
  stop_time: string;
  weekdays: string | undefined;
  morning: boolean;
}

/** A window as fw4 rules' times: one rule, or an evening and a morning. */
export function windowTimes(w: Window): RuleTimes[] {
  const days = (d: readonly Day[]): string | undefined => (ordered(d).length === 7 ? undefined : ordered(d).join(' '));
  if (!isOvernight(w)) {
    return [
      {
        start_time: `${w.start}:00`,
        stop_time: w.stop === '00:00' ? '23:59:59' : `${w.stop}:00`,
        weekdays: days(w.days),
        morning: false,
      },
    ];
  }
  return [
    { start_time: `${w.start}:00`, stop_time: '23:59:59', weekdays: days(w.days), morning: false },
    { start_time: '00:00:00', stop_time: `${w.stop}:00`, weekdays: days(shiftDays(w.days, 1)), morning: true },
  ];
}

/** What the person is called in rule names: their name, else their device's. */
export function whoName(person: Person, deviceName: (mac: string) => string | undefined): string {
  if (person.name !== undefined) return person.name;
  const mac = person.devices[0] ?? '';
  return deviceName(mac) ?? mac;
}

/** A rule's name, at most 50 characters as the Firewall page's names are: a long name for the person is cut short. */
export function ruleName(who: string, rest: string): string {
  const room = 50 - rest.length - 2;
  const chars = Array.from(who);
  const short = chars.length <= room ? who : `${chars.slice(0, Math.max(1, room - 1)).join('')}…`;
  return `${short}: ${rest}`;
}

export interface PersonForm {
  name: string | undefined;
  devices: string[];
  windows: Window[];
  always: boolean;
  safeSearch: boolean;
  guest: boolean;
}

export interface SaveContext {
  cfg: FirewallConfig;
  firewall: readonly Section[];
  milkflint: readonly Section[];
  deviceName: (mac: string) => string | undefined;
}

function globals(wan: string): Wanted[] {
  const set = (name: string): Wanted => ({
    config: 'firewall',
    type: 'ipset',
    name,
    values: { name, family: 'any', match: ['src_mac'], timeout: '0' },
  });
  return [
    set(PAUSED_SET),
    set(EXTRA_SET),
    {
      config: 'firewall',
      type: 'rule',
      name: PAUSE_RULE,
      values: {
        name: 'Device control: paused',
        src: '*',
        dest: wan,
        ipset: PAUSED_SET,
        proto: 'all',
        target: 'REJECT',
      },
    },
    {
      config: 'firewall',
      type: 'include',
      name: RESTORE_INCLUDE,
      values: { type: 'script', path: RESTORE_PATH, fw4_compatible: '1' },
    },
  ];
}

/** The sections that are Device control's own and not a person's: owned while anyone is set up. */
const GLOBAL_OWNED: Owned[] = GLOBAL_SECTIONS.map((name) => ({ config: 'firewall', name }));

/**
 * The changes that make `id` hold `form`: its milkflint section, its rules
 * (rewritten whole, numbered past any edited by hand) and, while anyone is
 * set up, the sets, the pause rule and the include. `form` undefined:
 * the person is deleted, with every rule of theirs (edited by hand too).
 */
export function personChanges(id: string, form: PersonForm | undefined, ctx: SaveContext): Change[] {
  const { cfg, firewall, milkflint } = ctx;
  const wan = wanZone(cfg)?.name ?? 'wan';
  const people = parsePeople(milkflint);
  const before = people.find((p) => p.id === id);
  const existing = before === undefined ? undefined : personRules(cfg, firewall, before);
  const everyRule = firewall.filter((s) => {
    const p = devctlPart(s['.name']);
    return s['.type'] === 'rule' && p !== undefined && p.kind !== 'global' && p.person === id;
  });
  const owned: Owned[] = [
    { config: 'milkflint', name: id },
    ...(form === undefined ? everyRule.map((s) => s['.name']) : (existing?.owned ?? [])).map((name) => ({
      config: 'firewall',
      name,
    })),
  ];
  const wanted: Wanted[] = [];
  if (form !== undefined) {
    const devices = [...new Set(form.devices.map((m) => m.toLowerCase()))];
    const person: Person = { id, name: blankless(form.name), devices, safeSearch: form.safeSearch, guest: form.guest };
    const values: Values = {
      name: person.name,
      device: devices,
      safesearch: form.safeSearch ? '1' : undefined,
      guest: form.guest ? '1' : undefined,
    };
    wanted.push({ config: 'milkflint', type: 'person', name: id, values });
    const who = whoName(person, ctx.deviceName);
    const base = (name: string): Values => ({
      name,
      src: '*',
      dest: wan,
      src_mac: devices,
      ipset: `!${EXTRA_SET}`,
      proto: 'all',
      target: 'REJECT',
      start_time: undefined,
      stop_time: undefined,
      weekdays: undefined,
    });
    if (form.always && devices.length > 0) {
      wanted.push({ config: 'firewall', type: 'rule', name: `${id}_always`, values: base(ruleName(who, 'always off')) });
    }
    // window numbers a rule edited by hand still has: skipped, so it's never overwritten
    const taken = new Set(
      (existing?.byHand ?? []).flatMap((s) => {
        const p = devctlPart(s['.name']);
        return p?.kind === 'window' ? [p.n] : [];
      }),
    );
    const guestZones = cfg.zones.filter((z) => GUEST_IDS.some((g) => g === z.name));
    let n = 0;
    for (const w of devices.length > 0 ? form.windows : []) {
      do n++;
      while (taken.has(n));
      for (const t of windowTimes(w)) {
        const label = t.morning ? `${w.label} (morning)` : w.label;
        wanted.push({
          config: 'firewall',
          type: 'rule',
          name: `${id}_w${String(n)}${t.morning ? '_am' : ''}`,
          values: { ...base(ruleName(who, label)), start_time: t.start_time, stop_time: t.stop_time, weekdays: t.weekdays },
        });
        if (!form.guest) continue;
        for (const z of guestZones) {
          wanted.push({
            config: 'firewall',
            type: 'rule',
            name: `${id}_w${String(n)}_${z.name}${t.morning ? '_am' : ''}`,
            values: {
              name: ruleName(who, `${label}, ${guestZones.length > 1 ? z.name : 'Guest Wi-Fi'}`),
              src: z.name,
              dest: wan,
              src_mac: undefined,
              ipset: undefined,
              proto: 'all',
              target: 'REJECT',
              start_time: t.start_time,
              stop_time: t.stop_time,
              weekdays: t.weekdays,
            },
          });
        }
      }
    }
  }
  // the shared sections: there while anyone is set up, gone with the last
  const anyoneLeft = people.some((p) => p.id !== id) || form !== undefined;
  const globalWanted = anyoneLeft ? globals(wan) : [];
  return reconcile([...globalWanted, ...wanted], [...owned, ...GLOBAL_OWNED], { firewall, milkflint });
}

// ---- Old "Block a device" rules and any other rule that keeps devices off the internet ----

/** A firewall rule that keeps some devices off the internet, as fw4 runs it. */
export interface DeviceRule {
  section: string;
  name: string | undefined;
  macs: string[];
  /** seconds of the day */
  start: number | undefined;
  stop: number | undefined;
  days: Day[] | undefined;
  invertDays: boolean;
  /** skips devices given extra time (Device control's own rules) */
  exempt: boolean;
  /** Device control's section of a person, or another rule (an older Block a device, LuCI) */
  person: string | undefined;
}

/**
 * Every rule on that blocks particular devices' internet: any zone (or one)
 * to the internet, by MAC, all traffic, reject or drop, maybe at set times.
 * Rules that also need an address, a port or a protocol only block part of
 * a device's traffic, so they don't count.
 */
export function deviceRules(cfg: FirewallConfig): DeviceRule[] {
  const wan = new Set(cfg.zones.filter(isInternetZone).map((z) => z.name));
  return cfg.rules.flatMap((r: Rule): DeviceRule[] => {
    if (!r.enabled || (r.target !== 'REJECT' && r.target !== 'DROP')) return [];
    if (r.dest === undefined || !wan.has(r.dest) || r.srcMac.length === 0) return [];
    if (r.srcIp.length > 0 || r.destIp.length > 0 || r.destPort.length > 0 || r.srcPort.length > 0) return [];
    if (!r.proto.includes('all') || r.limit !== undefined) return [];
    if (r.extra.some((o) => o !== 'ipset')) return [];
    const part = devctlPart(r.section);
    const s = r.schedule;
    const d = s === undefined ? undefined : parseDays(s.weekdays);
    if (s !== undefined && s.weekdays.length > 0 && d === undefined) return [];
    return [
      {
        section: r.section,
        name: r.name,
        macs: r.srcMac,
        start: parseTime(s?.start),
        stop: parseTime(s?.stop),
        days: d?.days,
        invertDays: d?.invert ?? false,
        exempt: r.extra.includes('ipset'),
        person: part !== undefined && part.kind !== 'global' ? part.person : undefined,
      },
    ];
  });
}

// ---- The router's clock ----

/** The router's clock: Unix time now, and its time zone's offset from UTC (seconds). */
export interface Clock {
  now: number;
  offset: number;
}

/** Day (0 Monday … 6 Sunday), second of that day and the day's local midnight, for a Unix time on the router's clock. */
export function localParts(t: number, offset: number): { day: number; sec: number; midnight: number } {
  const local = t + offset;
  const sec = ((local % 86400) + 86400) % 86400;
  const days = Math.floor(local / 86400);
  // 1 January 1970 was a Thursday (3, counting from Monday)
  return { day: (((days + 3) % 7) + 7) % 7, sec, midnight: t - sec };
}

/** Whether a rule blocks at local second `sec` of weekday `day`, as nftables decides it for each packet. */
export function ruleBlocks(r: Pick<DeviceRule, 'start' | 'stop' | 'days' | 'invertDays'>, day: number, sec: number): boolean {
  let hour = true;
  if (r.start !== undefined && r.stop !== undefined) {
    // nft turns a range that wraps midnight into "outside stop…start", bounds excluded
    hour = r.start <= r.stop ? sec >= r.start && sec <= r.stop : sec > r.start || sec < r.stop;
  } else if (r.start !== undefined) hour = sec >= r.start;
  else if (r.stop !== undefined) hour = sec <= r.stop;
  if (!hour) return false;
  if (r.days === undefined) return true;
  const on = r.days.includes(DAYS[day] ?? 'Mon');
  return r.invertDays ? !on : on;
}

/** Pause and extra time on the router now: MAC → until (Unix time; null: until resumed). */
export interface Overrides {
  paused: ReadonlyMap<string, number | null>;
  extra: ReadonlyMap<string, number>;
}

export const NO_OVERRIDES: Overrides = { paused: new Map(), extra: new Map() };

export type Reason = 'paused' | 'always' | 'schedule' | 'extra' | 'free';

export interface DeviceState {
  blocked: boolean;
  reason: Reason;
  /** when that changes, if it does in the next week; null: not by itself (paused until resumed, always off) */
  until: number | null | undefined;
}

function active(until: number | null | undefined, t: number): boolean {
  return until === null || (until !== undefined && until > t);
}

/** What blocks a device at time t: its pause, else a rule (one that skips extra time only while it hasn't any). */
function stateAt(mac: string, rules: readonly DeviceRule[], o: Overrides, t: number, offset: number): Reason {
  if (active(o.paused.get(mac), t)) return 'paused';
  const { day, sec } = localParts(t, offset);
  const extra = active(o.extra.get(mac), t);
  let lifted = false;
  for (const r of rules) {
    if (!r.macs.includes(mac)) continue;
    if (!ruleBlocks(r, day, sec)) continue;
    if (r.exempt && extra) {
      lifted = true;
      continue;
    }
    return r.start === undefined && r.stop === undefined && r.days === undefined ? 'always' : 'schedule';
  }
  return lifted ? 'extra' : 'free';
}

const blocking = (r: Reason): boolean => r === 'paused' || r === 'always' || r === 'schedule';

/** The moments within a week of `from` where a device's state can change. */
function edges(mac: string, rules: readonly DeviceRule[], o: Overrides, from: number, offset: number): number[] {
  const out = new Set<number>();
  const { midnight } = localParts(from, offset);
  for (let k = 0; k <= 8; k++) {
    const day = midnight + k * 86400;
    out.add(day);
    for (const r of rules) {
      if (!r.macs.includes(mac)) continue;
      for (const s of [r.start, r.stop]) if (s !== undefined) for (const d of [0, 1]) out.add(day + s + d);
    }
  }
  const p = o.paused.get(mac);
  if (typeof p === 'number') out.add(p);
  const e = o.extra.get(mac);
  if (e !== undefined) out.add(e);
  return [...out].filter((t) => t > from && t <= from + 8 * 86400).sort((a, b) => a - b);
}

/** A device's state now, and when it next changes. */
export function deviceState(mac: string, rules: readonly DeviceRule[], o: Overrides, clock: Clock): DeviceState {
  const reason = stateAt(mac, rules, o, clock.now, clock.offset);
  const blocked = blocking(reason);
  if (reason === 'paused' && o.paused.get(mac) === null) return { blocked, reason, until: null };
  for (const t of edges(mac, rules, o, clock.now, clock.offset)) {
    const r = stateAt(mac, rules, o, t, clock.offset);
    if (blocking(r) !== blocked) return { blocked, reason, until: t };
  }
  return { blocked, reason, until: reason === 'always' ? null : undefined };
}

/** When the device's rules alone (no pause, no extra time) next block it, after `after`. */
export function nextBlockStart(mac: string, rules: readonly DeviceRule[], after: number, offset: number): number | undefined {
  let was = blocking(stateAt(mac, rules, NO_OVERRIDES, after, offset));
  for (const t of edges(mac, rules, NO_OVERRIDES, after, offset)) {
    const now = blocking(stateAt(mac, rules, NO_OVERRIDES, t, offset));
    if (now && !was) return t;
    was = now;
  }
  return undefined;
}

/** When the device's rules alone next let it back on, after `after`. */
export function nextBlockEnd(mac: string, rules: readonly DeviceRule[], after: number, offset: number): number | undefined {
  if (!blocking(stateAt(mac, rules, NO_OVERRIDES, after, offset))) return after;
  for (const t of edges(mac, rules, NO_OVERRIDES, after, offset)) {
    if (!blocking(stateAt(mac, rules, NO_OVERRIDES, t, offset))) return t;
  }
  return undefined;
}

// ---- Pause and extra time choices ----

export type PauseChoice = '30m' | '1h' | 'morning' | 'resume';
export type ExtraChoice = '15m' | '30m' | '1h' | 'next';

/**
 * "Until tomorrow morning": when the coming night's overnight window ends
 * (the one starting on the evening before that morning), else 07:00. Before
 * 04:00 the morning is this one.
 */
export function morningAfter(windows: readonly Window[], clock: Clock): number {
  const { day, sec, midnight } = localParts(clock.now, clock.offset);
  const ahead = sec < 4 * 3600 ? 0 : 1;
  const morningMidnight = midnight + ahead * 86400;
  const eveDay = DAYS[(day + ahead + 6) % 7] ?? 'Mon';
  const night = windows.find((w) => isOvernight(w) && w.days.includes(eveDay));
  const stop = night === undefined ? 7 * 60 : minutesOf(night.stop);
  return morningMidnight + stop * 60;
}

/** Until when a pause lasts (null: until resumed). */
export function pauseUntil(choice: PauseChoice, windows: readonly Window[], clock: Clock): number | null {
  switch (choice) {
    case '30m':
      return clock.now + 30 * 60;
    case '1h':
      return clock.now + 3600;
    case 'morning':
      return morningAfter(windows, clock);
    case 'resume':
      return null;
  }
}

/**
 * Until when extra time lasts: 15 min, 30 min or an hour (never past the
 * block's own end: then it's simply over), or until the next block after
 * this one. Undefined: nothing to give (not blocked by its times).
 */
export function extraUntil(choice: ExtraChoice, mac: string, rules: readonly DeviceRule[], clock: Clock): number | undefined {
  const end = nextBlockEnd(mac, rules, clock.now, clock.offset);
  if (end === undefined || end <= clock.now) return undefined;
  const minutes = { '15m': 15, '30m': 30, '1h': 60 } as const;
  if (choice !== 'next') return Math.min(clock.now + minutes[choice] * 60, end);
  return nextBlockStart(mac, rules, end, clock.offset) ?? end + 7 * 86400;
}

// ---- Words ----

function dayRange(days: readonly Day[]): string {
  // runs of consecutive days (Mon–Thu), the rest by name
  const idx = days.map((d) => DAYS.indexOf(d)).sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const i of idx) {
    const last = runs.at(-1);
    if (last?.at(-1) === i - 1) last.push(i);
    else runs.push([i]);
  }
  const parts = runs.map((r) =>
    r.length >= 3 ? `${DAYS[r[0] ?? 0] ?? ''}–${DAYS[r.at(-1) ?? 0] ?? ''}` : r.map((i) => DAYS[i] ?? '').join(', '),
  );
  return new Intl.ListFormat('en-GB').format(parts.join(', ').split(', '));
}

const FULL: Record<Day, string> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
};

/** The days of a window in words: "on school nights", "on weekdays", "every night", "on Fri and Sat nights". */
export function daysText(win: Pick<Window, 'days' | 'start' | 'stop'>): string {
  const w = { ...win, days: ordered(win.days) };
  const d = w.days.join(' ');
  const night = isOvernight(w);
  if (w.days.length === 7) return night ? 'every night' : 'every day';
  if (night && d === 'Mon Tue Wed Thu Sun') return 'on school nights';
  if (!night && d === 'Mon Tue Wed Thu Fri') return 'on weekdays';
  if (!night && d === 'Sat Sun') return 'at weekends';
  if (night && d === 'Fri Sat') return 'on Friday and Saturday nights';
  if (w.days.length === 1) return night ? `on ${FULL[w.days[0] ?? 'Mon']} nights` : `on ${FULL[w.days[0] ?? 'Mon']}s`;
  return night ? `on ${dayRange(w.days)} nights` : `on ${dayRange(w.days)}`;
}

export function windowText(w: Window): string {
  return `${w.start}–${w.stop} ${daysText(w)}`;
}

/** "Off 21:00–07:00 on school nights and 08:30–15:30 on weekdays". */
export function scheduleSummary(windows: readonly Window[], always: boolean): string {
  if (always) return 'Always off';
  if (windows.length === 0) return 'No set times';
  return `Off ${new Intl.ListFormat('en-GB').format(windows.map(windowText))}`;
}

/** A time from now on the router's clock: "07:00", "Monday 07:00" past the next 24 hours. */
export function atText(t: number, clock: Clock): string {
  const { sec, day } = localParts(t, clock.offset);
  const time = hhmm(sec);
  if (t - clock.now < 86400 - 60) return time;
  return `${FULL[DAYS[day] ?? 'Mon']} ${time}`;
}

/** The state in words: "Off until 07:00", "Paused until 19:30", "Extra time until 21:30", "Can use the internet". */
export function stateText(s: DeviceState, clock: Clock): string {
  const until = s.until === undefined || s.until === null ? undefined : atText(s.until, clock);
  switch (s.reason) {
    case 'paused':
      return s.until === null ? 'Paused until you resume' : `Paused until ${until ?? ''}`;
    case 'always':
      return 'Always off';
    case 'schedule':
      return until === undefined ? 'Off' : `Off until ${until}`;
    case 'extra':
      return until === undefined ? 'Extra time' : `Extra time until ${until}`;
    case 'free':
      return 'Can use the internet';
  }
}

/** What happens next: "Back on at 07:00", "Off at 21:00", or nothing. */
export function nextText(s: DeviceState, clock: Clock): string | undefined {
  if (s.until === undefined || s.until === null) return undefined;
  const at = atText(s.until, clock);
  const day = at.includes(' ');
  return s.blocked ? `Back on ${day ? '' : 'at '}${at}` : `Off ${day ? '' : 'at '}${at}`;
}

/**
 * An old Block a device rule's times, as fw4 runs them (time and day on
 * each packet): an overnight one with days covers both ends of each day
 * ticked, its early morning and its evening.
 */
export function deviceRuleText(r: DeviceRule): string {
  if (r.start === undefined && r.stop === undefined && r.days === undefined) return 'Always off';
  const s = r.start === undefined ? undefined : hhmm(r.start);
  const e = r.stop === undefined ? undefined : hhmm(r.stop === END_OF_DAY ? 0 : r.stop);
  const days = r.days === undefined ? undefined : r.invertDays ? DAYS.filter((d) => !(r.days ?? []).includes(d)) : r.days;
  const dayWords = days === undefined || days.length === 7 ? 'every day' : `on ${dayRange(days)}`;
  if (s !== undefined && e !== undefined && r.start !== undefined && r.stop !== undefined && r.start > r.stop) {
    return days === undefined || days.length === 7 ? `Off ${s}–${e} every night` : `Off until ${e} and from ${s} ${dayWords}`;
  }
  const time =
    s !== undefined && e !== undefined ? `${s}–${e}` : s !== undefined ? `from ${s}` : e !== undefined ? `until ${e}` : 'all day';
  return `Off ${time} ${dayWords}`;
}

/** Whether an old rule means something different from what Device control would write for the same times. */
export function oldMeaningDiffers(r: DeviceRule): boolean {
  return r.start !== undefined && r.stop !== undefined && r.start > r.stop && r.days !== undefined && r.days.length < 7;
}

/** An old rule as a window Device control would write (overnight: the nights of the days picked). */
export function windowOfRule(r: DeviceRule): Window | undefined {
  if (r.start === undefined || r.stop === undefined || r.invertDays) return undefined;
  return {
    start: hhmm(r.start),
    stop: r.stop === END_OF_DAY ? '00:00' : hhmm(r.stop),
    days: r.days ?? [...DAYS],
    label: DEFAULT_LABEL,
  };
}

// ---- The Firewall page's reading of Device control's sections ----

export interface DevctlRow {
  /** the person (or device) it's for; undefined: shared by everyone */
  who: string | undefined;
  /** what it does, in words */
  text: string;
  /** Device control wouldn't write it like this: edit it on the Firewall page, Device control leaves it alone */
  byHand: boolean;
  /** where Device control shows it */
  href: string;
}

/** Each Device control section of the firewall config, as the Firewall page describes it. */
export function devctlRows(
  cfg: FirewallConfig,
  firewall: readonly Section[],
  milkflint: readonly Section[],
  deviceName: (mac: string) => string | undefined,
): Map<string, DevctlRow> {
  const out = new Map<string, DevctlRow>();
  const people = parsePeople(milkflint);
  for (const s of firewall) {
    const part = devctlPart(s['.name']);
    if (part === undefined) continue;
    if (part.kind === 'global') {
      out.set(s['.name'], {
        who: undefined,
        text:
          s['.name'] === PAUSE_RULE
            ? 'Keeps devices off the internet while they’re paused on Device control.'
            : 'Kept up by Device control for its pause and extra time.',
        byHand: false,
        href: '#/device-control',
      });
      continue;
    }
    const p = people.find((x) => x.id === part.person);
    out.set(s['.name'], {
      who: p === undefined ? undefined : whoName(p, deviceName),
      text:
        p === undefined
          ? 'Its person is gone from Device control: it’s left as it is.'
          : 'Changed by hand: Device control leaves it as it is.',
      byHand: true,
      href: `#/device-control/${part.person}`,
    });
  }
  for (const p of people) {
    const who = whoName(p, deviceName);
    for (const [section, w] of personRules(cfg, firewall, p).bySection) {
      const guest = devctlPart(section);
      const onGuest = guest?.kind === 'window' && guest.guest !== undefined;
      out.set(section, {
        who,
        text: w === 'always' ? `${who}: always off` : `${who}: off ${windowText(w)}${onGuest ? ', Guest Wi-Fi too' : ''}`,
        byHand: false,
        href: `#/device-control/${p.id}`,
      });
    }
  }
  return out;
}
