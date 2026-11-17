// Scheduled tasks as the router keeps them (milkflint.schedule sections, run
// by its cron on its own clock), in words, and when the next one runs: the
// Scheduled tasks page and Home's widget share them. Plain data, so the
// tests check it.
import { bool, list, type Section, str } from '@/lib/api/uci';

export const actions = {
  reboot: { label: 'Restart the router', done: 'restarts the router' },
  wifi_off: { label: 'Turn Wi-Fi off', done: 'turns Wi-Fi off' },
  wifi_on: { label: 'Turn Wi-Fi on', done: 'turns Wi-Fi on' },
} as const;
export type Action = keyof typeof actions;

// cron numbering: 0 = Sunday
export const days = [
  { n: 1, label: 'Mon', name: 'Monday' },
  { n: 2, label: 'Tue', name: 'Tuesday' },
  { n: 3, label: 'Wed', name: 'Wednesday' },
  { n: 4, label: 'Thu', name: 'Thursday' },
  { n: 5, label: 'Fri', name: 'Friday' },
  { n: 6, label: 'Sat', name: 'Saturday' },
  { n: 0, label: 'Sun', name: 'Sunday' },
] as const;

export interface Task {
  /** Stable key in the page's form. */
  key: string;
  /** UCI section name for tasks already saved. */
  section: string | undefined;
  action: Action;
  time: string;
  /** Empty: every day. */
  days: number[];
  enabled: boolean;
}

export function isAction(v: string | undefined): v is Action {
  return v !== undefined && Object.hasOwn(actions, v);
}

/** The tasks in the milkflint config's sections; one with an action this page doesn't know is left out. */
export function tasksFrom(sections: readonly Section[]): Task[] {
  return sections
    .filter((s) => s['.type'] === 'schedule')
    .flatMap((s): Task[] => {
      const action = str(s, 'action');
      if (!isAction(action)) return [];
      return [
        {
          key: s['.name'],
          section: s['.name'],
          action,
          time: str(s, 'time') ?? '04:00',
          days: list(s, 'days')
            .map(Number)
            .filter((n) => n >= 0 && n <= 6),
          enabled: bool(s, 'enabled', true),
        },
      ];
    });
}

export function describeDays(d: readonly number[]): string {
  if (d.length === 0 || d.length === 7) return 'every day';
  const set = new Set(d);
  if (set.size === 5 && [1, 2, 3, 4, 5].every((n) => set.has(n))) return 'on weekdays';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'at weekends';
  return `on ${days
    .filter((x) => set.has(x.n))
    .map((x) => x.label)
    .join(', ')}`;
}

/** "Restarts the router at 04:00 every day" */
export function sentence(t: Task): string {
  const s = `${actions[t.action].done} at ${t.time} ${describeDays(t.days)}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "HH:MM" as minutes after midnight; undefined for anything else. */
function minutesOf(time: string): number | undefined {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time);
  return m === null ? undefined : Number(m[1]) * 60 + Number(m[2]);
}

export interface NextRun {
  task: Task;
  /** 0 today, 1 tomorrow… up to 7 (a weekly task whose time today has passed). */
  inDays: number;
  /** cron's day, 0 = Sunday */
  day: number;
}

/**
 * The switched-on task that runs next after `localtime`: the router's clock
 * in its own time zone, as epoch seconds read in UTC (as ubus system info
 * gives it). One at this very minute has already run.
 */
export function nextRun(tasks: readonly Task[], localtime: number): NextRun | undefined {
  const now = new Date(localtime * 1000);
  const today = now.getUTCDay();
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  let best: (NextRun & { at: number }) | undefined;
  for (const task of tasks) {
    const m = minutesOf(task.time);
    if (!task.enabled || m === undefined) continue;
    for (let inDays = 0; inDays <= 7; inDays++) {
      const day = (today + inDays) % 7;
      if (task.days.length > 0 && !task.days.includes(day)) continue;
      if (inDays === 0 && m <= minute) continue;
      const at = inDays * 1440 + m;
      if (best === undefined || at < best.at) best = { task, inDays, day, at };
      break;
    }
  }
  return best === undefined ? undefined : { task: best.task, inDays: best.inDays, day: best.day };
}

/** "today at 23:00", "tomorrow at 04:00", "on Saturday at 04:00" */
export function whenText(r: NextRun): string {
  const name = days.find((d) => d.n === r.day)?.name ?? '';
  const on = r.inDays === 0 ? 'today' : r.inDays === 1 ? 'tomorrow' : r.inDays === 7 ? `next ${name}` : `on ${name}`;
  return `${on} at ${r.task.time}`;
}
