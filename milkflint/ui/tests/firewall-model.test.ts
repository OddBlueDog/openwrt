// The Firewall page's writing and reading: options set in LuCI survive an edit,
// a rule moved keeps every other section in place, schedules as fw4 takes them,
// and the checks on what's typed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bedtime, scheduleError, scheduleForm, scheduleValues, splitList } from '../src/features/firewall/forms.ts';
import { editSection, isAddress, isDmz, isMac, moveTo, normalizeDay, parseFirewall, portError, portsOverlap, protosOverlap, scheduleText, WEEKDAYS } from '../src/features/firewall/model.ts';
import { applied, section } from './uci-fixture.ts';

test('an edit touches only what it’s given: options set in LuCI stay', () => {
  const rule = section('rule', 'r1', { name: 'Game', target: 'ACCEPT', src: 'wan', limit: '10/second', extra: '--some-match', dest_port: '25565' });
  assert.deepEqual(editSection('rule', rule, { name: 'Game', dest_port: '25566', proto: ['tcp'] }), [{ op: 'set', config: 'firewall', section: 'r1', values: { dest_port: '25566', proto: ['tcp'] } }]);
  const after = applied({ firewall: [rule] }, editSection('rule', rule, { dest_port: '25566' }))['firewall']?.[0];
  assert.equal(after?.['limit'], '10/second');
  assert.equal(after['extra'], '--some-match');
});

test('nothing changed: nothing written; undefined and empty lists unset what’s there', () => {
  const rule = section('rule', 'r1', { src: 'wan', dest_port: ['80', '443'], proto: 'tcp' });
  assert.deepEqual(editSection('rule', rule, { src: 'wan', dest_port: ['80', '443'], proto: ['tcp'] }), []);
  assert.deepEqual(editSection('rule', rule, { src: undefined, dest_port: [], weekdays: undefined }), [{ op: 'unset', config: 'firewall', section: 'r1', options: ['src', 'dest_port'] }]);
});

test('a list where a single value is written is rewritten: fw4 refuses it', () => {
  const rule = section('redirect', 'r1', { src_dport: ['80'] });
  assert.deepEqual(editSection('redirect', rule, { src_dport: '80' }), [{ op: 'set', config: 'firewall', section: 'r1', values: { src_dport: '80' } }]);
});

test('no section yet: added, with only what has a value', () => {
  assert.deepEqual(editSection('redirect', undefined, { name: 'Web', src: 'wan', dest_ip: undefined, proto: [] }), [{ op: 'add', config: 'firewall', type: 'redirect', values: { name: 'Web', src: 'wan' } }]);
});

test('reading a rule keeps what the page has no field for in its extras', () => {
  const cfg = parseFirewall([section('defaults', 'd'), section('rule', 'r1', { src: 'wan', target: 'accept', helper: 'ftp', src_dscp: 'ef' })]);
  const r = cfg.rules[0];
  assert.equal(r?.target, 'ACCEPT');
  assert.ok(r.extra.length >= 2, JSON.stringify(r.extra));
});

test('a rule moved up or down: its place, every other section where it was', () => {
  const order = ['d', 'lan', 'wan', 'r1', 'r2', 'r3', 'f1'];
  assert.deepEqual(moveTo(order, 'r3', 'r1'), { op: 'order', config: 'firewall', sections: ['d', 'lan', 'wan', 'r3', 'r1', 'r2', 'f1'] });
  assert.deepEqual(moveTo(order, 'r1', 'r3'), { op: 'order', config: 'firewall', sections: ['d', 'lan', 'wan', 'r2', 'r3', 'r1', 'f1'] });
  assert.deepEqual(moveTo(order, 'r2', 'r3'), { op: 'order', config: 'firewall', sections: ['d', 'lan', 'wan', 'r1', 'r3', 'r2', 'f1'] });
  assert.deepEqual(moveTo(order, 'r2', 'r1'), { op: 'order', config: 'firewall', sections: ['d', 'lan', 'wan', 'r2', 'r1', 'r3', 'f1'] });
  const moved = moveTo(order, 'r3', 'r1');
  assert.ok(moved.op === 'order');
  assert.deepEqual([...moved.sections].sort(), [...order].sort(), 'none lost, none twice');
});

test('bedtime: every day across midnight, written as fw4 takes it', () => {
  assert.equal(scheduleError(bedtime), undefined);
  assert.deepEqual(scheduleValues(bedtime), { start_time: '22:00:00', stop_time: '07:00:00', weekdays: undefined });
});

test('some days are written as a list; no schedule unsets all three', () => {
  assert.deepEqual(scheduleValues({ start: '08:30', stop: '17:00', days: ['Mon', 'Fri'] }), { start_time: '08:30:00', stop_time: '17:00:00', weekdays: 'Mon Fri' });
  assert.deepEqual(scheduleValues(undefined), { start_time: undefined, stop_time: undefined, weekdays: undefined });
});

test('a schedule reads back as it was written', () => {
  for (const s of [bedtime, { start: '08:30', stop: '17:00', days: ['Mon', 'Fri'] }, { start: '00:00', stop: '23:59', days: ['Sat', 'Sun'] }]) {
    const v = scheduleValues(s);
    const rule = section('rule', 'r', Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string')));
    const parsed = parseFirewall([rule]).rules[0]?.schedule;
    assert.deepEqual(scheduleForm(parsed), s);
  }
});

test('LuCI’s ways of writing it read too', () => {
  assert.deepEqual(scheduleForm({ start: '21:00:30', stop: undefined, weekdays: ['monday', 'TUE', 'nope'] }), { start: '21:00', stop: '23:59', days: ['Mon', 'Tue'] });
  assert.deepEqual(scheduleForm({ start: undefined, stop: '06:00', weekdays: [] }).days, [...WEEKDAYS]);
  assert.deepEqual(scheduleForm(undefined), bedtime);
  assert.equal(normalizeDay('sunday'), 'Sun');
  assert.equal(normalizeDay('x'), undefined);
});

test('a schedule’s checks', () => {
  for (const [start, stop] of [['24:00', '07:00'], ['7:00', '08:00'], ['12:60', '13:00'], ['', '']]) {
    assert.notEqual(scheduleError({ start: start ?? '', stop: stop ?? '', days: ['Mon'] }), undefined, `${String(start)}-${String(stop)}`);
  }
  assert.notEqual(scheduleError({ start: '10:00', stop: '10:00', days: ['Mon'] }), undefined);
  assert.notEqual(scheduleError({ start: '10:00', stop: '11:00', days: [] }), undefined);
  assert.equal(scheduleError({ start: '23:59', stop: '00:00', days: ['Sun'] }), undefined);
});

test('a schedule in words', () => {
  assert.equal(scheduleText(undefined), undefined);
  assert.equal(scheduleText({ start: '22:00:00', stop: '07:00:00', weekdays: [] }), '22:00–07:00, every day');
  assert.equal(scheduleText({ start: '08:00:00', stop: undefined, weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] }), 'from 08:00, Mon–Fri');
  assert.equal(scheduleText({ start: undefined, stop: '08:00:00', weekdays: ['Sat', 'Sun'] }), 'until 08:00, weekends');
  assert.equal(scheduleText({ start: undefined, stop: undefined, weekdays: ['Wed'] }), 'all day, Wed');
});

test('what’s typed: ports, addresses, MACs and lists', () => {
  for (const v of ['1', '65535', '8000-8010', '8000:8010', '80-80']) assert.equal(portError(v), undefined, v);
  for (const v of ['', '0', '65536', '8010-8000', 'http', '80,443', '1-65536']) assert.notEqual(portError(v), undefined, v);
  for (const v of ['1.2.3.4', '1.2.3.4/32', '10.0.0.0/8', 'fd00::1', 'fd00::/8', '::ffff:1.2.3.4']) assert.ok(isAddress(v), v);
  for (const v of ['1.2.3', '1.2.3.256', '1.2.3.4/33', 'fd00::/129', '1.2.3.4/1/2', 'fd00::1::2', 'host.example.com', '']) assert.ok(!isAddress(v), v);
  assert.ok(isMac('AA:bb:CC:dd:EE:ff'));
  for (const v of ['aa:bb:cc:dd:ee', 'aa-bb-cc-dd-ee-ff', 'gg:bb:cc:dd:ee:ff']) assert.ok(!isMac(v), v);
  assert.deepEqual(splitList(' 1.2.3.4, 5.6.7.8\n9.9.9.9,,'), ['1.2.3.4', '5.6.7.8', '9.9.9.9']);
});

test('forwards that would clash', () => {
  assert.ok(portsOverlap('8000-8010', '8010'));
  assert.ok(portsOverlap('8005', '8000:8010'));
  assert.ok(!portsOverlap('8000-8010', '8011'));
  assert.ok(protosOverlap(['tcp'], ['tcp', 'udp']));
  assert.ok(protosOverlap(['all'], ['udp']));
  assert.ok(!protosOverlap(['tcp'], ['udp']));
});

test('a port forward reads as what fw4 does with it', () => {
  const cfg = parseFirewall([
    section('redirect', 'web', { src: 'wan', src_dport: '8080', dest: 'lan', dest_ip: '192.168.1.5', dest_port: '80', proto: 'tcp' }),
    section('redirect', 'dmz', { src: 'wan', dest: 'lan', dest_ip: '192.168.1.9', proto: 'all' }),
  ]);
  const [web, dmz] = cfg.redirects;
  assert.ok(web !== undefined && dmz !== undefined);
  assert.equal(web.target, 'DNAT');
  assert.equal(web.reflection, true, 'fw4’s default');
  assert.ok(!isDmz(web));
  assert.ok(isDmz(dmz));
});
