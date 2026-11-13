// The Smart Queue page's connection types (link presets): which one a queue
// has, on the port or on a PPPoE session's own device, the ones an older
// version or LuCI left near a preset, and what choosing one writes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advancedData, cakeArgs } from '../src/features/sqm/advanced.ts';
import {
  type LinkPreset,
  linkPresets,
  presetOf,
  presetOverhead,
  queueMove,
  type SqmData,
  type SqmForm,
  sqmData,
  toChanges,
} from '../src/features/sqm/model.ts';
import type { Change, Section } from '../src/lib/api/uci.ts';
import { applied, section } from './uci-fixture.ts';

const queue = (values: Record<string, string> = {}): Section =>
  section('queue', 'wan', {
    enabled: '1',
    interface: 'eth1',
    download: '80000',
    upload: '20000',
    qdisc: 'cake',
    script: 'piece_of_cake.qos',
    ...values,
  });

const ethernet = { linklayer: 'ethernet', overhead: '44', tcMPU: '84', linklayer_advanced: '1' };

/** wan as netifd reports it: DHCP on the port, or PPPoE with its session up or down */
const wans = {
  dhcp: { wanDevice: 'eth1', wanProto: 'dhcp' },
  pppoe: { wanDevice: 'pppoe-wan', wanProto: 'pppoe' },
  pppoeDown: { wanDevice: 'eth1', wanProto: 'pppoe' },
} as const;

const load = (sqm: Section[], wan: keyof typeof wans = 'dhcp'): SqmData =>
  sqmData({ sqm, firewall: [], milkflint: [], devices: ['eth1'], ...wans[wan] });

const save = (data: SqmData, over: Partial<SqmForm>): Change[] => toChanges({ ...data.form, ...over }, data);

const after = (sqm: Section[], changes: Change[]): Section => {
  const s = applied({ sqm }, changes)['sqm']?.[0];
  assert.ok(s !== undefined);
  return s;
};

test('a new queue is Fibre / Ethernet, not No compensation', () => {
  const data = load([]);
  assert.equal(data.form.link, 'ethernet');
  const q = after([], toChanges({ ...data.form, enabled: true, downloadMbit: '80', uploadMbit: '20' }, data));
  assert.equal(q['linklayer'], 'ethernet');
  assert.equal(q['overhead'], '44');
  assert.equal(q['tcMPU'], '84');
  assert.equal(load([q]).form.link, 'ethernet');
  // the shipped queue, with none: shown as it is, for the page to flag
  assert.equal(load([queue({ linklayer: 'none' })]).form.link, 'none');
  assert.equal(load([queue()]).form.link, 'none');
});

test('Fibre / Ethernet and DOCSIS count PPPoE’s header on the session’s own device; VDSL2 and ADSL already do', () => {
  // under PPPoE on the port CAKE counts the session's 8 bytes as the packet's;
  // on pppoe-wan it sees only the IP packet: the same count is 8 more there
  const extra: Record<LinkPreset, number> = { none: 0, ethernet: 8, docsis: 8, vdsl: 0, adsl: 0 };
  for (const [key, p] of Object.entries(linkPresets) as [LinkPreset, (typeof linkPresets)[LinkPreset]][]) {
    assert.equal(Number(presetOverhead(p, 'pppoe-wan')) - Number(presetOverhead(p, 'eth1')), extra[key], key);
    assert.equal(presetOverhead(p, 'eth1.911'), p.overhead, `${key} on a VLAN`);
  }
});

test('on PPPoE a new queue goes on the session, with its overhead there, connected or not', () => {
  for (const wan of ['pppoe', 'pppoeDown'] as const) {
    const data = load([], wan);
    assert.equal(data.pppoe, 'pppoe-wan', wan);
    assert.equal(data.wanDevice, 'pppoe-wan', wan);
    assert.equal(data.form.device, 'pppoe-wan', wan);
    const q = after([], toChanges({ ...data.form, enabled: true, downloadMbit: '80', uploadMbit: '20' }, data));
    assert.equal(q['interface'], 'pppoe-wan');
    assert.equal(q['overhead'], '52');
    assert.equal(q['tcMPU'], '84');
    assert.equal(load([q], wan).form.link, 'ethernet');
  }
  assert.equal(load([]).pppoe, undefined, 'DHCP: no session');
});

test('a queue on the port under PPPoE: flagged for the page, and moving it takes the preset’s figure there', () => {
  const sqm = [queue(ethernet)];
  const data = load(sqm, 'pppoe');
  // the page warns while the device isn't the session's
  assert.equal(data.form.device, 'eth1');
  assert.equal(data.pppoe, 'pppoe-wan');
  assert.equal(data.form.link, 'ethernet');
  assert.deepEqual(save(data, { device: 'pppoe-wan' }), [
    { op: 'set', config: 'sqm', section: 'wan', values: { interface: 'pppoe-wan', overhead: '52' } },
  ]);
  const moved = after(sqm, save(data, { device: 'pppoe-wan' }));
  assert.equal(load([moved], 'pppoe').form.link, 'ethernet');
  // VDSL2's figure is the same on both; custom figures stay as they are
  const vdsl = [queue({ linklayer: 'ethernet', overhead: '34', tcMPU: '68', iqdisc_opts: 'ptm', eqdisc_opts: 'ptm' })];
  assert.deepEqual(save(load(vdsl, 'pppoe'), { device: 'pppoe-wan' }), [{ op: 'set', config: 'sqm', section: 'wan', values: { interface: 'pppoe-wan' } }]);
  const custom = [queue({ linklayer: 'ethernet', overhead: '40' })];
  assert.deepEqual(save(load(custom, 'pppoe'), { device: 'pppoe-wan' }), [{ op: 'set', config: 'sqm', section: 'wan', values: { interface: 'pppoe-wan' } }]);
  // a queue without an interface under PPPoE: shown, and saved, on the session
  const bare = load([section('queue', 'wan', { enabled: '1', download: '80000', upload: '20000', ...ethernet })], 'pppoeDown');
  assert.equal(bare.form.device, 'pppoe-wan');
  assert.equal(after([section('queue', 'wan', {})], save(bare, { uploadMbit: '21' }))['interface'], 'pppoe-wan');
});

test('a preset is told by the device it’s on: the other device’s figure is near it', () => {
  const onSession = queue({ ...ethernet, interface: 'pppoe-wan', overhead: '52' });
  assert.deepEqual(presetOf(onSession, 'pppoe-wan'), { link: 'ethernet', near: undefined });
  assert.deepEqual(presetOf(onSession, 'eth1'), { link: 'custom', near: { preset: 'ethernet', gaps: ['overhead'] } });
  assert.deepEqual(presetOf(queue(ethernet), 'pppoe-wan'), { link: 'custom', near: { preset: 'ethernet', gaps: ['overhead'] } });
  // choosing it again writes the figure for where it is
  const data = load([queue({ ...ethernet, interface: 'pppoe-wan' })], 'pppoe');
  assert.equal(data.form.link, 'custom');
  assert.equal(after([queue({ ...ethernet, interface: 'pppoe-wan' })], save(data, { link: 'ethernet' }))['overhead'], '52');
});

test('an older preset (no mpu, no ptm) is near it, and choosing it again completes it', () => {
  // VDSL2 as an older version of the page wrote it: it showed as VDSL2, and choosing
  // VDSL2 again changed nothing, so it never got its mpu or ptm
  const sqm = [queue({ linklayer: 'ethernet', overhead: '34' })];
  const data = load(sqm);
  assert.equal(data.form.link, 'custom');
  assert.deepEqual(data.linkNear, { preset: 'vdsl', gaps: ['mpu', 'ptm'] });
  const done = after(sqm, save(data, { link: 'vdsl' }));
  assert.equal(done['overhead'], '34');
  assert.equal(done['tcMPU'], '68');
  assert.equal(done['linklayer_advanced'], '1');
  assert.equal(done['iqdisc_opts'], 'ptm');
  assert.equal(done['eqdisc_opts'], 'ptm');
  assert.equal(load([done]).form.link, 'vdsl');
  assert.equal(load([done]).linkNear, undefined);
  // the others
  assert.deepEqual(load([queue({ linklayer: 'ethernet', overhead: '44' })]).linkNear, { preset: 'ethernet', gaps: ['mpu'] });
  assert.deepEqual(load([queue({ linklayer: 'ethernet', overhead: '18' })]).linkNear, { preset: 'docsis', gaps: ['mpu'] });
  assert.deepEqual(load([queue({ linklayer: 'ethernet', overhead: '34', tcMPU: '68' })]).linkNear, { preset: 'vdsl', gaps: ['ptm'] });
  // ADSL never had more: it's ADSL
  assert.equal(load([queue({ linklayer: 'atm', overhead: '44' })]).form.link, 'adsl');
});

test('what a preset wouldn’t have isn’t near it', () => {
  for (const values of [
    { linklayer: 'ethernet', overhead: '44', tcMPU: '64' },
    { linklayer: 'ethernet', overhead: '40' },
    { ...ethernet, iqdisc_opts: 'ptm', eqdisc_opts: 'ptm' },
    { linklayer: 'atm', overhead: '44', tcMPU: '53' },
    // ptm in one direction only
    { linklayer: 'ethernet', overhead: '34', tcMPU: '68', iqdisc_opts: 'ptm' },
  ]) {
    const data = load([queue(values)]);
    assert.equal(data.form.link, 'custom', JSON.stringify(values));
    assert.equal(data.linkNear, undefined, JSON.stringify(values));
  }
  assert.equal(load([queue({ linklayer: 'none', iqdisc_opts: 'ptm', eqdisc_opts: 'ptm' })]).form.link, 'custom');
});

test('a preset is CAKE’s own compensation: tc’s size table or HTB’s isn’t it, and choosing it puts CAKE’s back', () => {
  for (const llam of ['tc_stab', 'htb_private']) {
    const sqm = [queue({ ...ethernet, linklayer_adaptation_mechanism: llam })];
    const data = load(sqm);
    assert.equal(data.form.link, 'custom', llam);
    assert.deepEqual(data.linkNear, { preset: 'ethernet', gaps: ['mechanism'] }, llam);
    const changes = save(data, { link: 'ethernet' });
    assert.ok(changes.some((c) => c.op === 'unset' && c.options.includes('linklayer_adaptation_mechanism')), llam);
    const done = after(sqm, changes);
    assert.equal(load([done]).form.link, 'ethernet', llam);
    // what sqm-scripts then gives CAKE: its own overhead and mpu, no stab in front
    const adv = advancedData(done, []);
    assert.equal(cakeArgs(adv.form, adv, 'up').join(' '), 'cake bandwidth 20000kbit overhead 44 mpu 84 diffserv3 nat besteffort');
  }
  // before: tc's table in front of CAKE and none of CAKE's own, or with HTB's no compensation at all
  const stab = advancedData(queue({ ...ethernet, linklayer_adaptation_mechanism: 'tc_stab' }), []);
  assert.match(cakeArgs(stab.form, stab, 'up').join(' '), /^stab .* cake bandwidth 20000kbit diffserv3/);
  const htb = advancedData(queue({ ...ethernet, linklayer_adaptation_mechanism: 'htb_private' }), []);
  assert.equal(cakeArgs(htb.form, htb, 'up').join(' '), 'cake bandwidth 20000kbit diffserv3 nat besteffort');
  // CAKE's own, named: the preset, and another preset leaves it
  for (const llam of ['default', 'cake']) {
    const sqm = [queue({ ...ethernet, linklayer_adaptation_mechanism: llam })];
    const data = load(sqm);
    assert.equal(data.form.link, 'ethernet', llam);
    assert.equal(after(sqm, save(data, { link: 'docsis' }))['linklayer_adaptation_mechanism'], llam);
  }
});

test('moving the queue for the Internet page: its interface, and a preset’s overhead there', () => {
  assert.deepEqual(queueMove(queue(ethernet), 'pppoe-wan'), { interface: 'pppoe-wan', overhead: '52' });
  assert.deepEqual(queueMove(queue({ ...ethernet, interface: 'pppoe-wan', overhead: '52' }), 'eth1'), { interface: 'eth1', overhead: '44' });
  assert.deepEqual(queueMove(queue({ linklayer: 'ethernet', overhead: '18', tcMPU: '64' }), 'pppoe-wan'), { interface: 'pppoe-wan', overhead: '26' });
  // the same figure on both, custom, near a preset, or none: only the interface
  for (const values of [
    { linklayer: 'ethernet', overhead: '34', tcMPU: '68', iqdisc_opts: 'ptm', eqdisc_opts: 'ptm' },
    { linklayer: 'ethernet', overhead: '40' },
    { linklayer: 'ethernet', overhead: '44' },
    { linklayer: 'none' },
    {},
  ]) {
    assert.deepEqual(queueMove(queue(values), 'pppoe-wan'), { interface: 'pppoe-wan' }, JSON.stringify(values));
  }
});
