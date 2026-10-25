// What the Firewall page's dialogs share that isn't a component: schedules,
// device labels, lists typed into a field, and the actions the tabs call.
import type { Change } from '@/lib/api/uci';
import type { Device } from './api';
import { normalizeDay, type NatRule, type Redirect, type Rule, type Schedule, type Values, WEEKDAYS } from './model';

export function deviceLabel(d: Device): string {
  return `${d.name ?? 'Unnamed device'} · ${d.ip ?? d.mac}`;
}

/** Addresses typed with spaces or commas between them. */
export function splitList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter((x) => x !== '');
}

export interface ScheduleForm {
  start: string;
  stop: string;
  /** Mon … Sun */
  days: string[];
}

export const bedtime: ScheduleForm = { start: '22:00', stop: '07:00', days: [...WEEKDAYS] };

export function scheduleError(s: ScheduleForm): string | undefined {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(s.start) || !time.test(s.stop)) return 'Times as hh:mm, e.g. 22:00.';
  if (s.start === s.stop) return 'Start and end can’t be the same.';
  if (s.days.length === 0) return 'At least one day.';
  return undefined;
}

export function scheduleForm(s: Schedule | undefined): ScheduleForm {
  if (s === undefined) return bedtime;
  const days = s.weekdays.map(normalizeDay).filter((d) => d !== undefined);
  return { start: s.start?.slice(0, 5) ?? '00:00', stop: s.stop?.slice(0, 5) ?? '23:59', days: days.length === 0 ? [...WEEKDAYS] : days };
}

/** fw4's start_time, stop_time and weekdays; undefined schedule: always (all unset). */
export function scheduleValues(s: ScheduleForm | undefined): Values {
  if (s === undefined) return { start_time: undefined, stop_time: undefined, weekdays: undefined };
  return {
    start_time: `${s.start}:00`,
    stop_time: `${s.stop}:00`,
    weekdays: s.days.length === 7 ? undefined : s.days.join(' '),
  };
}

/** What a dialog for a new rule starts with. */
export interface RulePreset {
  name: string;
  target: 'ACCEPT' | 'REJECT' | 'DROP';
  /** '' for the router */
  src: string;
  dest: string;
  proto: string;
  ports: string;
}

/** What the tabs ask the page to do. */
export interface Actions {
  applying: boolean;
  /** stage and apply with rollback; `done` runs once the router confirmed it */
  apply: (changes: Change[], done?: () => void) => void;
  /** a dialog: undefined edits a new one */
  editForward: (r: Redirect | undefined) => void;
  editRule: (r: Rule | undefined, preset?: RulePreset) => void;
  editNat: (r: NatRule | undefined) => void;
  blockDevice: () => void;
  /** ask first, then apply */
  confirm: (c: { title: string; body: string; action: string; changes: Change[] }) => void;
}

const compact = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });

/** A counter for a table cell: 3.4k, 222.9k. */
export function hitsText(n: number | undefined): string {
  return n === undefined ? '–' : compact.format(n).toLowerCase();
}
