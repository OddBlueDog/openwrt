// Scheduled tasks (src/features/schedules/cron.ts and model.ts): root's
// crontab read as the router's busybox cron reads it, each job in words,
// the Tasks view's edits (each to its own line, the rest of the file as it
// was), and the next to run by the router's own clock, as Home's widget
// shows it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  describeTimes,
  dowField,
  type Fields,
  nextTime,
  parseCrontab,
  parseField,
  simpleFields,
  simpleTimes,
  timesOf,
} from '@/features/schedules/cron';
import {
  addTask,
  editTask,
  kindOf,
  label,
  nextRun,
  occasional,
  removeLine,
  sentence,
  tasksFrom,
  whenText,
} from '@/features/schedules/model';

const f = (s: string): Fields => s.split(' ') as unknown as Fields;
// the router's local time, read in UTC as ubus gives it
const at = (y: number, m: number, d: number, hh: number, mm: number): number => Date.UTC(y, m - 1, d, hh, mm) / 1000;
// a Wednesday
const NOW = at(2026, 6, 10, 22, 30);
const iso = (t: number | undefined): string => (t === undefined ? 'never' : new Date(t * 1000).toISOString().slice(0, 16));

const FILE = `# a note of mine
PATH=/usr/sbin:/usr/bin:/sbin:/bin
0 4 * * * /sbin/reboot
# 30 23 * * 1-5 wifi down
*/5 * * * * /root/check.sh > /dev/null 2>&1

# milkflint-banip begin (managed by the web interface)
34 3,15 * * * /usr/libexec/milkflint/banip-action reload
# milkflint-banip end
`;

test('the crontab’s lines: jobs on and off, comments, variables, blanks; a newline at the end needn’t be a line', () => {
  const lines = parseCrontab(FILE);
  assert.equal(lines.length, 9);
  assert.deepEqual(
    lines.map((l) => (l.job === undefined ? (l.error === undefined ? '-' : 'error') : l.job.enabled ? 'on' : 'off')),
    ['-', '-', 'on', 'off', 'on', '-', '-', 'on', '-'],
  );
  assert.equal(lines[4]?.job?.command, '/root/check.sh > /dev/null 2>&1');
  assert.deepEqual(lines[3]?.job?.fields, f('30 23 * * 1-5'));
  assert.equal(parseCrontab('').length, 0);
  assert.equal(parseCrontab('0 4 * * * reboot').length, 1);
  assert.equal(parseCrontab('a\r\nb\r\n').length, 2);
});

test('what cron won’t read, and why; this router’s cron has no @ words', () => {
  const err = (line: string): string | undefined => parseCrontab(line)[0]?.error;
  assert.match(err('@daily /sbin/reboot') ?? '', /@ words/);
  assert.match(err('0 4 * * reboot') ?? '', /five times/);
  assert.match(err('60 4 * * * reboot') ?? '', /minute/);
  assert.match(err('0 24 * * * reboot') ?? '', /hour/);
  assert.match(err('0 4 0 * * reboot') ?? '', /day of the month/);
  assert.match(err('0 4 * 13 * reboot') ?? '', /month/);
  assert.match(err('0 4 * * 8 reboot') ?? '', /day of the week/);
  assert.match(err('0 4 * * mon-fri/0 reboot') ?? '', /day of the week/);
  assert.match(err('0 4 ? * * reboot') ?? '', /day of the month/);
  for (const ok of [
    '0 4 * * * reboot',
    '*/15 0-6,22,23 1,15 jan-mar mon-fri /bin/true',
    '0 4 * * 7 x',
    '5/10 * * * * x',
    'X=1',
  ]) {
    assert.equal(err(ok), undefined, ok);
  }
  // a commented line that isn't a job is just a comment
  assert.equal(parseCrontab('# 99 things')[0]?.job, undefined);
});

test('fields: lists, ranges, steps, names; Sunday as 0 or 7', () => {
  const dow = { min: 0, max: 7, names: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] };
  assert.deepEqual(parseField('*/15', { min: 0, max: 59 }), [0, 15, 30, 45]);
  assert.deepEqual(parseField('1-5', dow), [1, 2, 3, 4, 5]);
  assert.deepEqual(parseField('sat,7', dow), [0, 6]);
  assert.deepEqual(parseField('MON-wed', dow), [1, 2, 3]);
  assert.deepEqual(parseField('50/5', { min: 0, max: 59 }), [50, 55]);
  for (const bad of ['', '5-1', '*/0', '1,', 'x', '1-2-3', '8']) assert.equal(parseField(bad, dow), undefined, bad);
});

test('the next time a job runs: later today, else on a day that matches; the minute it is now has run', () => {
  const next = (s: string, now = NOW): string => {
    const t = timesOf(f(s));
    return iso(t === undefined ? undefined : nextTime(t, now));
  };
  assert.equal(next('0 23 * * *'), '2026-06-10T23:00');
  assert.equal(next('30 22 * * *'), '2026-06-11T22:30');
  assert.equal(next('31 22 * * *'), '2026-06-10T22:31');
  assert.equal(next('0 4 * * *'), '2026-06-11T04:00');
  assert.equal(next('*/15 * * * *'), '2026-06-10T22:45');
  // Wednesday's time has gone: next Wednesday
  assert.equal(next('0 4 * * 3'), '2026-06-17T04:00');
  assert.equal(next('0 4 * * sat'), '2026-06-13T04:00');
  assert.equal(next('0 4 1 * *'), '2026-07-01T04:00');
  // day of the month and of the week both set: either will do (cron's rule)
  assert.equal(next('0 4 20 * 5'), '2026-06-12T04:00');
  assert.equal(next('0 0 1 1 *'), '2027-01-01T00:00');
  assert.equal(next('0 0 31 2 *'), 'never');
  // more than a year and a day away is never looked for
  assert.equal(next('0 0 29 2 *'), 'never');
  assert.equal(next('0 0 29 2 *', at(2027, 6, 10, 0, 0)), '2028-02-29T00:00');
});

test('when, in words', () => {
  const words = (s: string): string => describeTimes(f(s));
  assert.equal(words('0 4 * * *'), 'at 04:00 every day');
  assert.equal(words('30 23 * * 1-5'), 'at 23:30 on weekdays');
  assert.equal(words('0 9 * * 0,6'), 'at 09:00 at weekends');
  assert.equal(words('0 9 * * 1,3'), 'at 09:00 on Mon, Wed');
  assert.equal(words('34 3,15 * * *'), 'at 03:34 and 15:34 every day');
  assert.equal(words('0 1,2,3 * * *'), 'at 01:00, 02:00 and 03:00 every day');
  assert.equal(words('*/5 * * * *'), 'every 5 minutes');
  assert.equal(words('0,30 * * * *'), 'every 30 minutes');
  assert.equal(words('* * * * *'), 'every minute');
  assert.equal(words('15 * * * *'), 'every hour at :15');
  assert.equal(words('0 */6 * * *'), 'every 6 hours at :00');
  assert.equal(words('0 4 1 * *'), 'at 04:00 on the 1st of the month');
  assert.equal(words('0 4 22 * *'), 'at 04:00 on the 22nd of the month');
  assert.equal(words('0 4 * 1 *'), 'at the times “0 4 * 1 *”');
  assert.equal(words('*/5 9-17 * * 1-5'), 'at the times “*/5 9-17 * * 1-5”');
});

test('the Tasks view’s own: once a day at a time, on some days of the week', () => {
  assert.deepEqual(simpleTimes(f('5 8 * * *')), { time: '08:05', days: [] });
  assert.deepEqual(simpleTimes(f('0 23 * * 5,1')), { time: '23:00', days: [1, 5] });
  assert.deepEqual(simpleTimes(f('0 23 * * 0-6')), { time: '23:00', days: [] });
  for (const s of ['0 4 1 * *', '0 4 * 1 *', '*/5 * * * *', '0 3,15 * * *', '0-5 4 * * *']) {
    assert.equal(simpleTimes(f(s)), undefined, s);
  }
  assert.deepEqual(simpleFields('08:05', []), f('5 8 * * *'));
  assert.deepEqual(simpleFields('23:59', [6, 0]), f('59 23 * * 0,6'));
  for (const t of ['', '8:05', '24:00', '12:60', 'x']) assert.equal(simpleFields(t, []), undefined, t);
  assert.equal(dowField([1, 2, 3, 4, 5]), '1-5');
  assert.equal(dowField([0, 1, 2, 4, 6]), '0-2,4,6');
  assert.equal(dowField([1, 2]), '1,2');
  assert.equal(dowField([0, 1, 2, 3, 4, 5, 6]), '*');
});

test('what each job does: the page’s actions by any spelling, banIP’s update, or a command', () => {
  assert.equal(kindOf('reboot'), 'reboot');
  assert.equal(kindOf('/sbin/reboot'), 'reboot');
  assert.equal(kindOf('wifi  down'), 'wifi_off');
  assert.equal(kindOf('/sbin/wifi up'), 'wifi_on');
  assert.equal(kindOf('/usr/libexec/milkflint/banip-action reload'), 'banip');
  assert.equal(kindOf('reboot now'), 'command');
  assert.equal(kindOf('/etc/init.d/banip reload'), 'command');
  const tasks = tasksFrom(FILE);
  assert.deepEqual(
    tasks.map((t) => [t.line, t.kind, label(t)]),
    [
      [2, 'reboot', 'Restart the router'],
      [3, 'wifi_off', 'Turn Wi-Fi off'],
      [4, 'command', '/root/check.sh > /dev/null 2>&1'],
      [7, 'banip', 'Update banIP’s lists'],
    ],
  );
  assert.deepEqual(tasks.map(sentence), [
    'Restarts the router at 04:00 every day',
    'Turns Wi-Fi off at 23:30 on weekdays',
    'Runs /root/check.sh > /dev/null 2>&1 every 5 minutes',
    'Updates banIP’s lists at 03:34 and 15:34 every day',
  ]);
});

test('an edit rewrites its own line only; the rest of the file stays as it was', () => {
  const lines = (t: string): string[] => t.split('\n');
  const was = lines(FILE);
  const changed = (t: string): number[] => lines(t).flatMap((l, i) => (l === was[i] ? [] : [i]));

  const later = editTask(FILE, 2, { time: '05:30' });
  assert.deepEqual(changed(later), [2]);
  assert.equal(lines(later)[2], '30 5 * * * /sbin/reboot');
  // switched on: the comment mark goes; days: as cron's list
  assert.equal(lines(editTask(FILE, 3, { enabled: true }))[3], '30 23 * * 1-5 wifi down');
  assert.equal(lines(editTask(FILE, 3, { days: [0, 6] }))[3], '# 30 23 * * 0,6 wifi down');
  assert.equal(lines(editTask(FILE, 2, { enabled: false }))[2], '# 0 4 * * * /sbin/reboot');
  assert.equal(lines(editTask(FILE, 2, { action: 'wifi_on' }))[2], '0 4 * * * /sbin/wifi up');
  // a command's switch, but not times the view doesn't edit, nor a line that isn't a job, nor a half-typed time
  assert.equal(lines(editTask(FILE, 4, { enabled: false }))[4], '# */5 * * * * /root/check.sh > /dev/null 2>&1');
  assert.equal(editTask(FILE, 4, { time: '04:00' }), FILE);
  assert.equal(editTask(FILE, 0, { enabled: false }), FILE);
  assert.equal(editTask(FILE, 2, { time: '4:0' }), FILE);
  assert.equal(editTask(FILE, 99, { enabled: false }), FILE);

  const removed = removeLine(FILE, 4);
  assert.equal(lines(removed).length, was.length - 1);
  assert.ok(!removed.includes('check.sh'));
  assert.ok(removed.endsWith('# milkflint-banip end\n'));

  assert.equal(addTask(FILE, 'wifi_off', '23:30', [1, 2, 3, 4, 5]), `${FILE}30 23 * * 1-5 /sbin/wifi down\n`);
  assert.equal(addTask('', 'reboot', '04:00'), '0 4 * * * /sbin/reboot\n');
  assert.equal(addTask('0 3 * * * x', 'reboot', '04:00'), '0 3 * * * x\n0 4 * * * /sbin/reboot\n');
  assert.equal(addTask(FILE, 'reboot', '25:00'), FILE);
});

test('the next to run: switched-on, occasional tasks only; the earliest; a week on when today’s time has passed', () => {
  const tasks = tasksFrom(FILE);
  // the every-five-minutes check is never "next"; the Wi-Fi task is off
  assert.deepEqual(
    tasks.map((t) => occasional(t)),
    [true, true, false, true],
  );
  const r = nextRun(tasks, NOW);
  assert.ok(r !== undefined);
  assert.equal(r.task.kind, 'banip');
  assert.equal(whenText(r), 'tomorrow at 03:34');
  assert.equal(nextRun(tasksFrom('0 23 * * * reboot\n'), NOW)?.inDays, 0);
  const today = nextRun(tasksFrom('0 23 * * * reboot\n'), NOW);
  assert.ok(today !== undefined);
  assert.equal(whenText(today), 'today at 23:00');
  const weekly = nextRun(tasksFrom('0 4 * * 3 reboot\n'), NOW);
  assert.ok(weekly !== undefined);
  assert.equal(whenText(weekly), 'next Wednesday at 04:00');
  const saturday = nextRun(tasksFrom('0 4 * * 6 reboot\n'), NOW);
  assert.ok(saturday !== undefined);
  assert.equal(whenText(saturday), 'on Saturday at 04:00');
  const monthly = nextRun(tasksFrom('0 4 1 * * reboot\n'), NOW);
  assert.ok(monthly !== undefined);
  assert.equal(whenText(monthly), 'on 1 July at 04:00');
  assert.equal(nextRun(tasksFrom('# 0 23 * * * reboot\n*/5 * * * * x\n'), NOW), undefined);
  assert.equal(nextRun([], NOW), undefined);
});
