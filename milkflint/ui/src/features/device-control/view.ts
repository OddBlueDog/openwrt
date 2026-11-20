// What the page shows, worked out from the config and the router's status:
// a card for each person, and for each device that only an older rule
// covers (Block a device before Device control, or a rule made in LuCI);
// each card's state now and next, and its week as spans of time off.
import type { FirewallConfig } from '../firewall/model';
import type { Section } from '@/lib/api/uci';
import {
  type Clock,
  DAYS,
  type DeviceRule,
  deviceRules,
  type DeviceState,
  deviceState,
  type Overrides,
  type Person,
  type PersonRules,
  personRules,
  localParts,
  ruleBlocks,
  type Window,
  windowTimes,
  parseTime,
  parseDays,
} from './model';

export interface Entry {
  /** the person's id, or old:<section> for a device only an older rule covers */
  key: string;
  person: Person | undefined;
  title: string;
  macs: string[];
  /** Device control's reading of the person's own rules */
  own: PersonRules | undefined;
  /** older rules that cover their devices: shown as fw4 runs them */
  older: DeviceRule[];
}

export function entries(
  cfg: FirewallConfig,
  firewall: readonly Section[],
  people: readonly Person[],
  deviceName: (mac: string) => string | undefined,
): Entry[] {
  const rules = deviceRules(cfg);
  const out: Entry[] = people.map((p) => ({
    key: p.id,
    person: p,
    title: p.name ?? deviceName(p.devices[0] ?? '') ?? p.devices[0] ?? 'A device',
    macs: p.devices,
    own: personRules(cfg, firewall, p),
    older: [],
  }));
  const ownerOf = (mac: string): Entry | undefined => out.find((e) => e.person?.devices.includes(mac) === true);
  for (const r of rules) {
    if (r.person !== undefined) continue;
    const owners = new Set(r.macs.map(ownerOf));
    const [only] = owners;
    if (owners.size === 1 && only !== undefined) {
      only.older.push(r);
      continue;
    }
    // a device on its own, from an older rule (one card per rule)
    out.push({
      key: `old:${r.section}`,
      person: undefined,
      title:
        r.macs.length === 1
          ? (deviceName(r.macs[0] ?? '') ?? r.name?.replace(/^Block /, '') ?? r.macs[0] ?? 'A device')
          : (r.name ?? `${String(r.macs.length)} devices`),
      macs: r.macs,
      own: undefined,
      older: [r],
    });
  }
  return out;
}

export interface EntryState {
  /** every device of theirs is off */
  blocked: boolean;
  /** some are, some aren't */
  partly: boolean;
  /** the state to show: the first device's that's off (or the first's) */
  state: DeviceState;
  /** the device it's from */
  mac: string | undefined;
}

export function entryState(e: Entry, rules: readonly DeviceRule[], o: Overrides, clock: Clock): EntryState {
  const states = e.macs.map((m) => ({ mac: m, s: deviceState(m, rules, o, clock) }));
  const off = states.filter((x) => x.s.blocked);
  const shown = off[0] ?? states[0];
  return {
    blocked: states.length > 0 && off.length === states.length,
    partly: off.length > 0 && off.length < states.length,
    state: shown?.s ?? { blocked: false, reason: 'free', until: undefined },
    mac: shown?.mac,
  };
}

/** A span of a day, in seconds from its midnight: [from, to). */
export interface Span {
  from: number;
  to: number;
}

function union(spans: Span[]): Span[] {
  const sorted = spans.filter((s) => s.to > s.from).sort((a, b) => a.from - b.from);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out.at(-1);
    if (last !== undefined && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
  }
  return out;
}

/**
 * Each day's time off (Monday first) for a device, from the rules that
 * cover it, read as fw4 runs them: a rule's hours on the days it matches.
 */
export function weekSpans(mac: string, rules: readonly DeviceRule[]): Span[][] {
  return DAYS.map((_, day) => {
    const spans: Span[] = [];
    for (const r of rules) {
      if (!r.macs.includes(mac)) continue;
      if (!ruleBlocks({ ...r, start: undefined, stop: undefined }, day, 0)) continue;
      const { start, stop } = r;
      if (start !== undefined && stop !== undefined) {
        if (start <= stop) spans.push({ from: start, to: stop + 1 });
        else spans.push({ from: 0, to: stop }, { from: start + 1, to: 86400 });
      } else if (start !== undefined) spans.push({ from: start, to: 86400 });
      else if (stop !== undefined) spans.push({ from: 0, to: stop + 1 });
      else spans.push({ from: 0, to: 86400 });
    }
    return union(spans);
  });
}

/** "21:00", "24:00" for the end of the day; minutes rounded the way the times were written. */
export function spanTime(sec: number): string {
  const m = Math.round(sec / 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** A day's spans in words, for screen readers: "off until 07:00 and from 21:00". */
export function spansText(spans: readonly Span[]): string {
  if (spans.length === 0) return 'on all day';
  if (spans.length === 1 && spans[0]?.from === 0 && spans[0].to >= 86399) return 'off all day';
  // "off" once, at the start: "off until 07:00 and from 21:00"
  const parts = spans.map((s) =>
    s.from === 0
      ? `until ${spanTime(s.to)}`
      : s.to >= 86399
        ? `from ${spanTime(s.from)}`
        : `${spanTime(s.from)}–${spanTime(s.to)}`,
  );
  return `off ${new Intl.ListFormat('en-GB').format(parts)}`;
}

/** The week a form's times would make, before it's saved. */
export function formSpans(windows: readonly Window[], always: boolean): Span[][] {
  const mac = 'form';
  const rules: DeviceRule[] = always
    ? [
        {
          section: 'always',
          name: undefined,
          macs: [mac],
          start: undefined,
          stop: undefined,
          days: undefined,
          invertDays: false,
          exempt: true,
          person: undefined,
        },
      ]
    : windows.flatMap((w) =>
        windowTimes(w).map((t): DeviceRule => ({
          section: 'form',
          name: undefined,
          macs: [mac],
          start: parseTime(t.start_time),
          stop: parseTime(t.stop_time),
          days: t.weekdays === undefined ? undefined : parseDays(t.weekdays.split(' '))?.days,
          invertDays: false,
          exempt: true,
          person: undefined,
        })),
      );
  return weekSpans(mac, rules);
}

/** Whether what keeps a device off now is a rule that extra time can't lift (one not made by Device control). */
export function blockedByOlder(mac: string, rules: readonly DeviceRule[], o: Overrides, clock: Clock): boolean {
  if (o.paused.has(mac)) return false;
  const { day, sec } = localParts(clock.now, clock.offset);
  return rules.some((r) => !r.exempt && r.macs.includes(mac) && ruleBlocks(r, day, sec));
}
