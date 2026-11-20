// root's crontab (/etc/crontabs/root) as the router's cron (busybox crond)
// reads it: each line a job (five time fields, then the command), a comment,
// a variable (PATH=…) or blank. A job commented out ("# 0 4 * * * reboot")
// is a job that's switched off: LuCI's Scheduled Tasks and the Scheduled
// tasks page both show it so. Then each job's times: when it next runs, and
// in words. Plain data, so the tests check it.

export type Fields = readonly [string, string, string, string, string];

export interface Job {
  /** Not commented out. */
  enabled: boolean;
  fields: Fields;
  command: string;
}

export interface Line {
  text: string;
  /** The job on it, running or switched off; undefined for a comment, a variable or a blank line. */
  job: Job | undefined;
  /** Why cron won't read it: a line that's neither a job, a comment nor a variable. */
  error: string | undefined;
}

export interface FieldSpec {
  min: number;
  max: number;
  names?: readonly string[];
}

const MINUTE: FieldSpec = { min: 0, max: 59 };
const HOUR: FieldSpec = { min: 0, max: 23 };
const DOM: FieldSpec = { min: 1, max: 31 };
const MONTH: FieldSpec = {
  min: 1,
  max: 12,
  names: ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'],
};
// 7 is Sunday too
const DOW: FieldSpec = { min: 0, max: 7, names: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] };
const SPECS = [MINUTE, HOUR, DOM, MONTH, DOW] as const;
const FIELD_NAMES = ['minute', 'hour', 'day of the month', 'month', 'day of the week'] as const;

function value(s: string, spec: FieldSpec): number | undefined {
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n >= spec.min && n <= spec.max ? n : undefined;
  }
  const i = spec.names?.indexOf(s.toLowerCase()) ?? -1;
  return i < 0 ? undefined : i + spec.min;
}

/** A field's values ("*", "1-5", "*\/15", "mon,wed"), in order; undefined when cron won't read it. */
export function parseField(text: string, spec: FieldSpec): number[] | undefined {
  const out = new Set<number>();
  for (const item of text.split(',')) {
    const m = /^(\*|[a-z0-9]+(?:-[a-z0-9]+)?)(?:\/(\d+))?$/i.exec(item);
    if (m === null) return undefined;
    const [, range = '', stepText] = m;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (step < 1) return undefined;
    let from: number | undefined;
    let to: number | undefined;
    if (range === '*') [from, to] = [spec.min, spec.max];
    else {
      const [a = '', b] = range.split('-');
      from = value(a, spec);
      // "5/15": from 5 to the end, every 15th
      to = b === undefined ? (stepText === undefined ? from : spec.max) : value(b, spec);
    }
    if (from === undefined || to === undefined || to < from) return undefined;
    // the day of the week's 7 is Sunday, its 0
    for (let n = from; n <= to; n += step) out.add(spec.max === 7 && n === 7 ? 0 : n);
  }
  return [...out].sort((a, b) => a - b);
}

const JOB = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S.*)$/;

/** A job's text: its fields and command, or why cron won't read it. */
function parseJob(text: string): { job: Omit<Job, 'enabled'> } | { error: string } {
  if (text.startsWith('@')) return { error: 'this router’s cron doesn’t take @ words (like @daily): write the five times' };
  const m = JOB.exec(text);
  if (m === null) return { error: 'a job is five times (minute, hour, day, month, weekday) then the command' };
  const fields = [m[1], m[2], m[3], m[4], m[5]].map((f) => f ?? '') as unknown as Fields;
  for (const [i, f] of fields.entries()) {
    const spec = SPECS[i];
    if (spec === undefined || parseField(f, spec) === undefined) return { error: `“${f}” isn’t a ${FIELD_NAMES[i] ?? 'time'}` };
  }
  return { job: { fields, command: (m[6] ?? '').trim() } };
}

/** One line of the crontab, as cron reads it. */
export function parseLine(text: string): Line {
  const t = text.trim();
  if (t === '') return { text, job: undefined, error: undefined };
  if (t.startsWith('#')) {
    // a job switched off, or any other comment
    const inner = parseJob(t.replace(/^#+\s*/, ''));
    return { text, job: 'job' in inner ? { ...inner.job, enabled: false } : undefined, error: undefined };
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(t)) return { text, job: undefined, error: undefined };
  const r = parseJob(t);
  return 'job' in r ? { text, job: { ...r.job, enabled: true }, error: undefined } : { text, job: undefined, error: r.error };
}

/** The whole crontab, a line each (without the empty one after its last newline). */
export function parseCrontab(text: string): Line[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.map(parseLine);
}

/** The lines back as a file: each ended by a newline, as cron wants the last one. */
export function crontabText(lines: readonly string[]): string {
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/** A job as a line: its fields and command, behind "# " when it's switched off. */
export function jobLine(job: Job): string {
  return `${job.enabled ? '' : '# '}${job.fields.join(' ')} ${job.command}`;
}

// ---- When it runs ----

export interface Times {
  minutes: number[];
  hours: number[];
  doms: number[];
  months: number[];
  dows: number[];
  /** The day of the month and the day of the week are both limited: a day that matches either counts (cron's rule). */
  either: boolean;
  domAll: boolean;
  dowAll: boolean;
}

export function timesOf(fields: Fields): Times | undefined {
  const [mi, h, dom, mon, dow] = fields.map((f, i) => {
    const spec = SPECS[i];
    return spec === undefined ? undefined : parseField(f, spec);
  });
  if (mi === undefined || h === undefined || dom === undefined || mon === undefined || dow === undefined) return undefined;
  const domAll = dom.length === 31;
  const dowAll = dow.length === 7;
  return { minutes: mi, hours: h, doms: dom, months: mon, dows: dow, either: !domAll && !dowAll, domAll, dowAll };
}

function dayMatches(t: Times, d: Date): boolean {
  if (!t.months.includes(d.getUTCMonth() + 1)) return false;
  const dom = t.doms.includes(d.getUTCDate());
  const dow = t.dows.includes(d.getUTCDay());
  if (t.either) return dom || dow;
  return t.domAll ? dow : dom;
}

/**
 * The next minute the job runs after `localtime`: the router's clock in its
 * own time zone, as epoch seconds read in UTC (as ubus system info gives it),
 * and the answer the same way. The minute it is now has already run. Within
 * a year and a day; undefined for a date that never comes (31 February).
 */
export function nextTime(t: Times, localtime: number): number | undefined {
  const start = Math.floor(localtime / 60) * 60 + 60;
  const day0 = Math.floor(start / 86400) * 86400;
  const minuteOfDay = (start - day0) / 60;
  for (let n = 0; n <= 366; n++) {
    const day = day0 + n * 86400;
    if (!dayMatches(t, new Date(day * 1000))) continue;
    for (const h of t.hours) {
      for (const m of t.minutes) {
        if (n === 0 && h * 60 + m < minuteOfDay) continue;
        return day + h * 3600 + m * 60;
      }
    }
  }
  return undefined;
}

// ---- In words ----

export const DAYS = [
  { n: 1, label: 'Mon', name: 'Monday' },
  { n: 2, label: 'Tue', name: 'Tuesday' },
  { n: 3, label: 'Wed', name: 'Wednesday' },
  { n: 4, label: 'Thu', name: 'Thursday' },
  { n: 5, label: 'Fri', name: 'Friday' },
  { n: 6, label: 'Sat', name: 'Saturday' },
  { n: 0, label: 'Sun', name: 'Sunday' },
] as const;

const pad = (n: number): string => String(n).padStart(2, '0');

/** "HH:MM" */
export function clock(h: number, m: number): string {
  return `${pad(h)}:${pad(m)}`;
}

/** "every day", "on weekdays", "at weekends", "on Mon, Wed" (cron's numbering, 0 Sunday) */
export function describeDays(d: readonly number[]): string {
  if (d.length === 0 || d.length === 7) return 'every day';
  const set = new Set(d);
  if (set.size === 5 && [1, 2, 3, 4, 5].every((n) => set.has(n))) return 'on weekdays';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'at weekends';
  return `on ${DAYS.filter((x) => set.has(x.n))
    .map((x) => x.label)
    .join(', ')}`;
}

/** "1st", "2nd", "11th", "23rd" */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${String(n)}${suffix}`;
}

/** Evenly spaced from the field's start: "*\/15" and "0,15,30,45" are every 15. */
function every(values: readonly number[], size: number): number | undefined {
  if (values.length < 2 || values[0] !== 0) return undefined;
  const step = (values[1] ?? 0) - values[0];
  return step > 0 && size % step === 0 && values.length === size / step && values.every((v, i) => v === i * step)
    ? step
    : undefined;
}

/**
 * When a job runs, in words: "at 04:00 every day", "every 15 minutes",
 * "at 03:34 and 15:34 every day", "at 04:00 on the 1st of the month".
 * Anything stranger is its five fields as written.
 */
export function describeTimes(fields: Fields): string {
  const t = timesOf(fields);
  if (t === undefined) return fields.join(' ');
  const raw = `at the times “${fields.join(' ')}”`;
  if (t.months.length !== 12) return raw;
  const days =
    t.domAll && t.dowAll
      ? 'every day'
      : t.domAll
        ? describeDays(t.dows)
        : t.dowAll && t.doms.length === 1
          ? `on the ${ordinal(t.doms[0] ?? 1)} of the month`
          : undefined;
  if (days === undefined) return raw;
  const daily = days === 'every day' ? '' : ` ${days}`;
  const minuteStep = every(t.minutes, 60);
  if (t.hours.length === 24 && t.minutes.length === 60) return `every minute${daily}`;
  if (t.hours.length === 24 && minuteStep !== undefined) return `every ${String(minuteStep)} minutes${daily}`;
  if (t.minutes.length !== 1) return raw;
  const m = t.minutes[0] ?? 0;
  const hourStep = every(t.hours, 24);
  if (t.hours.length === 24) return `every hour at :${pad(m)}${daily}`;
  if (hourStep !== undefined) return `every ${String(hourStep)} hours at :${pad(m)}${daily}`;
  if (t.hours.length <= 4) {
    const times = t.hours.map((h) => clock(h, m));
    const list = times.length === 1 ? times[0] : `${times.slice(0, -1).join(', ')} and ${times.at(-1) ?? ''}`;
    return `at ${list ?? ''} ${days}`;
  }
  return raw;
}

/** The time and days of a job that runs once a day on some days of the week, as the Tasks view edits them. */
export function simpleTimes(fields: Fields): { time: string; days: number[] } | undefined {
  const t = timesOf(fields);
  if (t === undefined || !/^\d+$/.test(fields[0]) || !/^\d+$/.test(fields[1])) return undefined;
  if (fields[2] !== '*' || fields[3] !== '*') return undefined;
  return { time: clock(t.hours[0] ?? 0, t.minutes[0] ?? 0), days: t.dows.length === 7 ? [] : t.dows };
}

/** Days of the week as cron's field: "*", "1-5", "0,6", "1,3,5". */
export function dowField(days: readonly number[]): string {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (d.length === 0 || d.length === 7) return '*';
  const runs: string[] = [];
  for (let i = 0; i < d.length;) {
    let j = i;
    while (j + 1 < d.length && d[j + 1] === (d[j] ?? 0) + 1) j++;
    const a = d[i] ?? 0;
    const b = d[j] ?? 0;
    runs.push(j - i >= 2 ? `${String(a)}-${String(b)}` : d.slice(i, j + 1).join(','));
    i = j + 1;
  }
  return runs.join(',');
}

/** "04:00" on these days as the five fields; undefined for anything but a real time. */
export function simpleFields(time: string, days: readonly number[]): Fields | undefined {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (m === null) return undefined;
  return [String(Number(m[2])), String(Number(m[1])), '*', '*', dowField(days)];
}
