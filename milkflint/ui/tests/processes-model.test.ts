import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayName, formatShare, shownRows, snapshot, stateLabel } from '@/components/processes/model';
import type { Process, ProcessList } from '@/lib/api/processes';

const proc = (over: Partial<Process>): Process => ({
  pid: 1,
  ppid: 0,
  name: 'procd',
  state: 'S',
  ticks: 0,
  threads: 1,
  start: 0,
  kernel: false,
  user: 'root',
  rss: 0,
  cmd: '/sbin/procd',
  ...over,
});

const list = (over: Partial<ProcessList>, processes: Process[]): ProcessList => ({
  uptime: 100,
  cpu: { total: 40_000, idle: 36_000 },
  cores: 4,
  memory: { total: 1000, available: 750 },
  processes,
  ...over,
});

test('a process’s share is its ticks over every core’s ticks between two readings', () => {
  const a = list({}, [proc({ pid: 10, name: 'hostapd', ticks: 500 }), proc({ pid: 11, name: 'dnsmasq', ticks: 50 })]);
  // 3 s on 4 cores at 100 ticks a second: 1200 ticks, 300 of them busy
  const b = list({ uptime: 103, cpu: { total: 41_200, idle: 36_900 } }, [
    proc({ pid: 10, name: 'hostapd', ticks: 800 }),
    proc({ pid: 11, name: 'dnsmasq', ticks: 50 }),
  ]);

  const first = snapshot(undefined, a);
  assert.equal(first.cpu, undefined, 'one reading says nothing about use');
  assert.ok(first.rows.every((r) => r.cpu === undefined));

  const s = snapshot(a, b);
  assert.equal(s.cpu, 0.25);
  assert.equal(s.rows.find((r) => r.p.pid === 10)?.cpu, 0.25, 'one core flat out is a quarter of four');
  assert.equal(s.rows.find((r) => r.p.pid === 11)?.cpu, 0);
  assert.equal(s.memory, 0.25);
});

test('a new process counts all its time once it started after the reading before; a reused pid is a new process', () => {
  const a = list({}, [proc({ pid: 20, start: 500, ticks: 900 })]);
  const b = list({ uptime: 103, cpu: { total: 41_200, idle: 36_000 } }, [
    // started 1 s after the first reading (uptime 100 s = tick 10000)
    proc({ pid: 21, start: 10_100, ticks: 120 }),
    // pid 20 again, but a different process (its start differs)
    proc({ pid: 20, start: 10_050, ticks: 60 }),
    // already running before the first reading yet missing from it: unknown
    proc({ pid: 22, start: 400, ticks: 5000 }),
  ]);
  const s = snapshot(a, b);
  assert.equal(s.rows.find((r) => r.p.pid === 21)?.cpu, 0.1);
  assert.equal(s.rows.find((r) => r.p.pid === 20)?.cpu, 0.05);
  assert.equal(s.rows.find((r) => r.p.pid === 22)?.cpu, undefined);
});

test('names cut at 15 characters come back whole from the command line', () => {
  assert.equal(displayName(proc({ name: 'AdGuardHome', cmd: '/usr/bin/AdGuardHome -c x' })), 'AdGuardHome');
  assert.equal(
    displayName(proc({ name: 'banip-service.s', cmd: '/bin/sh /usr/bin/banip-service.sh reload' })),
    'banip-service.sh',
  );
  assert.equal(displayName(proc({ name: 'a-very-long-nam', cmd: '/usr/bin/other' })), 'a-very-long-nam');
  assert.equal(displayName(proc({ name: 'kworker/0:0-eve', kernel: true, cmd: '' })), 'kworker/0:0-eve');
});

test('the list filters by kind and typed letters, biggest in memory first, then by name and pid', () => {
  const a = list({}, [
    proc({ pid: 2, name: 'kthreadd', kernel: true, cmd: '' }),
    proc({ pid: 23, name: 'ksoftirqd/1', kernel: true, cmd: '', ticks: 100 }),
    proc({ pid: 100, name: 'hostapd', user: 'network', rss: 400, cmd: '/usr/sbin/hostapd -s -g /var/run/hostapd/global' }),
    proc({ pid: 101, name: 'dnsmasq', user: 'dnsmasq', rss: 900, cmd: '/usr/sbin/dnsmasq -C /var/etc/dnsmasq.conf' }),
    proc({ pid: 300, name: 'udhcpc', rss: 400, cmd: 'udhcpc -i wan' }),
    proc({ pid: 200, name: 'udhcpc', rss: 400, cmd: 'udhcpc -i wan6' }),
  ]);
  const rows = snapshot(undefined, a).rows;
  const shown = (view: 'all' | 'programs' | 'kernel', query = ''): string[] =>
    shownRows(rows, view, query).map((r) => `${r.name} ${String(r.p.pid)}`);

  // the table's sort keeps this order among rows it can't tell apart (idle under CPU, kernel threads under Memory)
  assert.deepEqual(shown('all'), ['dnsmasq 101', 'hostapd 100', 'udhcpc 200', 'udhcpc 300', 'ksoftirqd/1 23', 'kthreadd 2']);
  assert.deepEqual(shown('programs'), ['dnsmasq 101', 'hostapd 100', 'udhcpc 200', 'udhcpc 300']);
  assert.deepEqual(shown('kernel'), ['ksoftirqd/1 23', 'kthreadd 2']);
  assert.deepEqual(shown('all', 'NETWORK'), ['hostapd 100'], 'by user');
  assert.deepEqual(shown('all', 'dnsmasq.conf'), ['dnsmasq 101'], 'by command');
  assert.deepEqual(shown('all', '23'), ['ksoftirqd/1 23'], 'by the whole pid');
});

test('shares keep small figures visible, and states read in words', () => {
  assert.equal(formatShare(0), '0%');
  assert.equal(formatShare(0.0004), '<0.1%');
  assert.equal(formatShare(0.003), '0.3%');
  assert.equal(formatShare(0.25), '25%');
  assert.equal(stateLabel('R'), 'Running (R)');
  assert.equal(stateLabel('D'), 'Waiting on a device (D)');
  assert.equal(stateLabel('?'), '?');
});
