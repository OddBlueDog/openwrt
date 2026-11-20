// Scheduled tasks as the Scheduled tasks page and Home's widget show them:
// the jobs in root's crontab (cron.ts), each with what it does in words
// (restart the router, Wi-Fi off or on, banIP's update, or a command of your
// own) and when; the edits the Tasks view makes, each to its own line of the
// file, leaving every other line as it was; and the next one to run. Plain
// data, so the tests check it.
import {
  clock,
  crontabText,
  DAYS,
  describeDays,
  describeTimes,
  type Job,
  jobLine,
  type Line,
  nextTime,
  parseCrontab,
  simpleFields,
  simpleTimes,
  timesOf,
} from './cron';

export { DAYS as days, describeDays };

/** What the Tasks view adds and edits, and the line each is in the crontab. */
export const actions = {
  reboot: { label: 'Restart the router', done: 'restarts the router', command: '/sbin/reboot' },
  wifi_off: { label: 'Turn Wi-Fi off', done: 'turns Wi-Fi off', command: '/sbin/wifi down' },
  wifi_on: { label: 'Turn Wi-Fi on', done: 'turns Wi-Fi on', command: '/sbin/wifi up' },
} as const;
export type Action = keyof typeof actions;

/** banIP's list update: the banIP page sets its times, and keeps it in the crontab. */
export const BANIP_COMMAND = '/usr/libexec/milkflint/banip-action';

/** An action of the page's, banIP's update, or any other command. */
export type Kind = Action | 'banip' | 'command';

export function isAction(v: string | undefined): v is Action {
  return v !== undefined && Object.hasOwn(actions, v);
}

/** What a job's command does, as the page knows it ("reboot" and "/sbin/reboot" alike). */
export function kindOf(command: string): Kind {
  const c = command.trim().replace(/\s+/g, ' ');
  if (/^(\/sbin\/)?reboot$/.test(c)) return 'reboot';
  if (/^(\/sbin\/)?wifi down$/.test(c)) return 'wifi_off';
  if (/^(\/sbin\/)?wifi up$/.test(c)) return 'wifi_on';
  if (c.startsWith(`${BANIP_COMMAND} `)) return 'banip';
  return 'command';
}

export interface Task {
  /** Its line in the crontab, from 0. */
  line: number;
  kind: Kind;
  job: Job;
  /** Once a day at a time, on some days of the week: the Tasks view edits those; anything else in the crontab view. */
  simple: { time: string; days: number[] } | undefined;
}

export function tasksOf(lines: readonly Line[]): Task[] {
  return lines.flatMap((l, line) =>
    l.job === undefined ? [] : [{ line, kind: kindOf(l.job.command), job: l.job, simple: simpleTimes(l.job.fields) }],
  );
}

/** The tasks in a crontab's text. */
export function tasksFrom(text: string): Task[] {
  return tasksOf(parseCrontab(text));
}

/** What it does: "Restart the router", "Update banIP’s lists", else its command. */
export function label(t: Task): string {
  if (isAction(t.kind)) return actions[t.kind].label;
  return t.kind === 'banip' ? 'Update banIP’s lists' : t.job.command;
}

/** When it runs, in words: "at 04:00 every day". */
export function whenOf(t: Task): string {
  return describeTimes(t.job.fields);
}

/** "Restarts the router at 04:00 every day"; "Runs /root/backup.sh every 6 hours at :00" */
export function sentence(t: Task): string {
  const what = isAction(t.kind) ? actions[t.kind].done : t.kind === 'banip' ? 'updates banIP’s lists' : `runs ${t.job.command}`;
  const s = `${what} ${whenOf(t)}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- The Tasks view's edits: each rewrites its own line, the rest stay as they were ----

export interface TaskChange {
  action?: Action;
  time?: string;
  days?: number[];
  enabled?: boolean;
}

/**
 * The crontab with the task on `line` changed: another action, a new time or
 * days (for a task the view edits that way), switched on or off. Unchanged
 * when there's no task there, or the time isn't one.
 */
export function editTask(text: string, line: number, change: TaskChange): string {
  const lines = parseCrontab(text);
  const job = lines[line]?.job;
  if (job === undefined) return text;
  let fields = job.fields;
  if (change.time !== undefined || change.days !== undefined) {
    const simple = simpleTimes(job.fields);
    if (simple === undefined) return text;
    const f = simpleFields(change.time ?? simple.time, change.days ?? simple.days);
    if (f === undefined) return text;
    fields = f;
  }
  const next: Job = {
    enabled: change.enabled ?? job.enabled,
    fields,
    command: change.action === undefined ? job.command : actions[change.action].command,
  };
  return crontabText(lines.map((l, i) => (i === line ? jobLine(next) : l.text)));
}

/** The crontab without the line `line`. */
export function removeLine(text: string, line: number): string {
  return crontabText(
    parseCrontab(text)
      .filter((_, i) => i !== line)
      .map((l) => l.text),
  );
}

/** The crontab with a task added at its end; unchanged for a time that isn't one. */
export function addTask(text: string, action: Action, time: string, days: readonly number[] = []): string {
  const fields = simpleFields(time, days);
  if (fields === undefined) return text;
  const lines = parseCrontab(text).map((l) => l.text);
  return crontabText([...lines, jobLine({ enabled: true, fields, command: actions[action].command })]);
}

// ---- The next one to run (Home's widget) ----

export interface NextRun {
  task: Task;
  /** When, on the router's clock read in UTC. */
  at: number;
  /** 0 today, 1 tomorrow… */
  inDays: number;
  /** cron's day, 0 = Sunday */
  day: number;
}

/**
 * Runs a few times a day at most: one minute, not every hour. One that runs
 * every few minutes would always be next.
 */
export function occasional(t: Task): boolean {
  const times = timesOf(t.job.fields);
  return times?.minutes.length === 1 && times.hours.length < 24;
}

/**
 * The switched-on task that runs next after `localtime`, of the occasional
 * ones: the router's clock in its own time zone, as epoch seconds read in
 * UTC (as ubus system info gives it). One at this very minute has already run.
 */
export function nextRun(tasks: readonly Task[], localtime: number): NextRun | undefined {
  let best: { task: Task; at: number } | undefined;
  for (const task of tasks) {
    if (!task.job.enabled || !occasional(task)) continue;
    const times = timesOf(task.job.fields);
    const at = times === undefined ? undefined : nextTime(times, localtime);
    if (at !== undefined && (best === undefined || at < best.at)) best = { task, at };
  }
  if (best === undefined) return undefined;
  return {
    task: best.task,
    at: best.at,
    inDays: Math.floor(best.at / 86400) - Math.floor(localtime / 86400),
    day: new Date(best.at * 1000).getUTCDay(),
  };
}

/** "today at 23:00", "tomorrow at 04:00", "on Saturday at 04:00", "on 1 December at 04:00" */
export function whenText(r: NextRun): string {
  const d = new Date(r.at * 1000);
  const time = clock(d.getUTCHours(), d.getUTCMinutes());
  const name = DAYS.find((x) => x.n === r.day)?.name ?? '';
  const on =
    r.inDays === 0
      ? 'today'
      : r.inDays === 1
        ? 'tomorrow'
        : r.inDays < 7
          ? `on ${name}`
          : r.inDays === 7
            ? `next ${name}`
            : `on ${d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long' })}`;
  return `${on} at ${time}`;
}
