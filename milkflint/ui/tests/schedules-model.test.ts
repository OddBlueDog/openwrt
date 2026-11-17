// Scheduled tasks (src/features/schedules/model.ts): read from the router's
// config, and the next one to run by the router's own clock, as Home's
// widget shows it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Section } from '@/lib/api/uci';
import { nextRun, type Task, tasksFrom, whenText } from '@/features/schedules/model';

const task = (over: Partial<Task>): Task => ({
  key: 'k',
  section: 'k',
  action: 'reboot',
  time: '04:00',
  days: [],
  enabled: true,
  ...over,
});
// the router's local time, read in UTC as ubus gives it
const at = (y: number, m: number, d: number, hh: number, mm: number): number => Date.UTC(y, m - 1, d, hh, mm) / 1000;
const NOW = at(2026, 6, 10, 22, 30);
const today = new Date(NOW * 1000).getUTCDay();
const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

test('the next run: later today, else tomorrow; the minute it runs counts as gone', () => {
  const nightly = task({ action: 'wifi_off', time: '23:00' });
  const r = nextRun([nightly], NOW);
  assert.equal(r?.inDays, 0);
  assert.equal(whenText(r), 'today at 23:00');
  assert.equal(nextRun([nightly], at(2026, 6, 10, 23, 0))?.inDays, 1);
  const tomorrow = nextRun([nightly], at(2026, 6, 10, 23, 30));
  assert.ok(tomorrow !== undefined);
  assert.equal(whenText(tomorrow), 'tomorrow at 23:00');
});

test('the next run on the days a task is set for, a week on when today’s time has passed', () => {
  const in3 = (today + 3) % 7;
  const r = nextRun([task({ days: [in3], time: '08:15' })], NOW);
  assert.deepEqual([r?.inDays, r?.day], [3, in3]);
  assert.ok(r !== undefined);
  assert.equal(whenText(r), `on ${NAMES[in3] ?? ''} at 08:15`);
  const weekly = nextRun([task({ days: [today], time: '04:00' })], NOW);
  assert.equal(weekly?.inDays, 7);
  assert.equal(whenText(weekly), `next ${NAMES[today] ?? ''} at 04:00`);
});

test('the earliest of several; switched-off tasks and unreadable times left out; none at all', () => {
  const tasks = [
    task({ key: 'a', time: '04:00' }),
    task({ key: 'b', time: '23:45' }),
    task({ key: 'c', time: '22:45', enabled: false }),
    task({ key: 'd', time: '25:00' }),
    task({ key: 'e', time: 'soon' }),
  ];
  assert.equal(nextRun(tasks, NOW)?.task.key, 'b');
  assert.equal(nextRun([], NOW), undefined);
  assert.equal(nextRun([task({ enabled: false })], NOW), undefined);
});

test('tasks from the config: known actions only (no prototype keys), days 0 to 6', () => {
  const s = (name: string, values: Record<string, string | string[]>): Section => ({
    '.name': name,
    '.type': 'schedule',
    ...values,
  });
  const tasks = tasksFrom([
    s('a', { action: 'wifi_on', time: '07:00', days: ['1', '5', '9', 'x'] }),
    s('b', { action: 'toString' }),
    s('c', { action: 'constructor' }),
    s('d', { action: 'reboot', enabled: '0' }),
    { '.name': 'e', '.type': 'other', action: 'reboot' },
  ]);
  assert.deepEqual(
    tasks.map((t) => [t.key, t.action, t.days, t.enabled]),
    [
      ['a', 'wifi_on', [1, 5], true],
      ['d', 'reboot', [], false],
    ],
  );
});
