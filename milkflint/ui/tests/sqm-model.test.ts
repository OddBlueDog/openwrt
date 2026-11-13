// What the Smart Queue page saves: only the settings that changed, so CAKE
// keywords and options set in LuCI stay unless their own setting changed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advancedData, cakeArgs } from '../src/features/sqm/advanced.ts';
import { internetQueue, type SqmData, type SqmForm, sqmData, toChanges, validate } from '../src/features/sqm/model.ts';
import type { Change, Section } from '../src/lib/api/uci.ts';
import { applied, section } from './uci-fixture.ts';

const queue = (values: Record<string, string> = {}): Section =>
  section('queue', 'wan', {
    enabled: '1',
    interface: 'eth1',
    download: '800000',
    upload: '60000',
    qdisc: 'cake',
    script: 'piece_of_cake.qos',
    use_mq: '1',
    ...values,
  });

const load = (sqm: Section[] | undefined, milkflint: Section[] = []): SqmData =>
  sqmData({ sqm, firewall: [section('defaults', 'cfg01')], milkflint, wanDevice: 'eth1', wanProto: 'dhcp', devices: ['eth0', 'eth1', 'lo', 'br-lan'] });

const save = (data: SqmData, over: Partial<SqmForm>): Change[] => toChanges({ ...data.form, ...over }, data);

/** the queue's section after the changes */
const after = (data: SqmData, sqm: Section[], changes: Change[]): Section => {
  const s = applied({ sqm, milkflint: data.milkflint }, changes)['sqm']?.find((x) => x['.name'] === 'wan');
  assert.ok(s !== undefined);
  return s;
};

test('a new speed leaves no-split-gso out when it was taken out in LuCI', () => {
  // no-split-gso taken out of the download's options in LuCI, then a speed change
  const sqm = [queue({ iqdisc_opts: 'nat dual-dsthost ingress', eqdisc_opts: 'nat dual-srchost', qdisc_advanced: '1' })];
  const data = load(sqm);
  const changes = save(data, { downloadMbit: '640' });
  assert.deepEqual(changes, [{ op: 'set', config: 'sqm', section: 'wan', values: { download: '640000' } }]);
});

test('a speed change writes only the speed', () => {
  // keywords and options the page reads but these settings didn't change: one-sided
  // fairness, simple.qos, use_mq on below 500 Mbit/s, an old preset without its mpu (custom, near it)
  const sqm = [
    queue({
      download: '300000',
      script: 'simple.qos',
      use_mq: '1',
      linklayer: 'ethernet',
      overhead: '44',
      iqdisc_opts: 'nat dual-dsthost split-gso',
      eqdisc_opts: 'nat',
    }),
  ];
  const data = load(sqm);
  assert.equal(data.form.link, 'custom');
  assert.deepEqual(data.linkNear, { preset: 'ethernet', gaps: ['mpu'] });
  assert.equal(data.form.multiQueue, 'on');
  assert.equal(data.form.perDevice, false);
  const changes = save(data, { downloadMbit: '400', uploadMbit: '40' });
  assert.deepEqual(changes, [{ op: 'set', config: 'sqm', section: 'wan', values: { download: '400000', upload: '40000' } }]);
});

test('the automatic GRO choice follows the speed across 500 Mbit/s, and only then', () => {
  const sqm = [queue({ download: '400000', iqdisc_opts: 'nat dual-dsthost ingress' })];
  const up = save(load(sqm), { downloadMbit: '600' });
  assert.equal(after(load(sqm), sqm, up)['iqdisc_opts'], 'nat dual-dsthost ingress no-split-gso');

  const fast = [queue({ download: '800000', iqdisc_opts: 'nat no-split-gso dual-dsthost' })];
  const down = save(load(fast), { downloadMbit: '300' });
  assert.equal(after(load(fast), fast, down)['iqdisc_opts'], 'nat dual-dsthost');

  // already what it gives: the opts aren't rewritten
  const already = [queue({ download: '400000', iqdisc_opts: 'no-split-gso nat' })];
  const same = save(load(already), { downloadMbit: '600' });
  assert.equal(after(load(already), already, same)['iqdisc_opts'], 'no-split-gso nat');

  // the last keyword going takes the option with it
  const only = [queue({ download: '800000', iqdisc_opts: 'no-split-gso' })];
  const gone = save(load(only), { downloadMbit: '300' });
  assert.equal(after(load(only), only, gone)['iqdisc_opts'], undefined);
});

test('Performance Tuning’s GRO choice isn’t touched by a speed change', () => {
  for (const whole of ['1', '0']) {
    const sqm = [queue({ download: '400000', iqdisc_opts: 'nat' })];
    const data = load(sqm, [section('gro', 'gro', { whole })]);
    assert.deepEqual(save(data, { downloadMbit: '600' }), [{ op: 'set', config: 'sqm', section: 'wan', values: { download: '600000' } }]);
  }
});

test('automatic multi-queue follows the speed across 500 Mbit/s; a LuCI use_mq stays', () => {
  const sqm = [queue({ download: '400000', use_mq: '0' })];
  const data = load(sqm);
  assert.equal(data.form.multiQueue, 'auto');
  assert.equal(after(data, sqm, save(data, { downloadMbit: '600' }))['use_mq'], '1');

  const luci = [queue({ download: '800000', use_mq: '0' })];
  const off = load(luci);
  assert.equal(off.form.multiQueue, 'off');
  const changes = save(off, { downloadMbit: '820' });
  assert.equal(after(off, luci, changes)['use_mq'], '0');
  // the shown choice isn't saved as Performance Tuning's either
  assert.equal(
    changes.some((c) => c.config === 'milkflint'),
    false,
  );
});

test('each setting writes only its own keywords', () => {
  const sqm = [queue({ iqdisc_opts: 'nat split-gso wash', eqdisc_opts: 'nat ack-filter' })];
  const data = load(sqm);
  const s = (over: Partial<SqmForm>): Section => after(data, sqm, save(data, over));

  // latency: rtt in both directions
  const low = s({ latency: 'low' });
  assert.equal(low['iqdisc_opts'], 'nat split-gso wash rtt 50ms');
  assert.equal(low['eqdisc_opts'], 'nat ack-filter rtt 50ms');
  assert.equal(low['qdisc_advanced'], '1');

  // the ACK filter: the upload only
  const noAck = save(data, { ackFilter: 'off' });
  assert.deepEqual(noAck, [{ op: 'set', config: 'sqm', section: 'wan', values: { eqdisc_opts: 'nat', qdisc_advanced: '1', qdisc_really_really_advanced: '1' } }]);

  // fairness: its keywords, the rest stay
  const fair = s({ perDevice: true });
  assert.equal(fair['iqdisc_opts'], 'split-gso wash nat dual-dsthost ingress');
  assert.equal(fair['eqdisc_opts'], 'ack-filter nat dual-srchost');

  // the mode: the script, and CAKE with it
  assert.deepEqual(save(data, { prioritise: true }), [
    { op: 'set', config: 'sqm', section: 'wan', values: { qdisc: 'cake', script: 'layer_cake.qos' } },
  ]);
});

test('a link preset writes its options, and only when it changes', () => {
  const sqm = [queue({ linklayer: 'ethernet', overhead: '44', tcMPU: '84', linklayer_advanced: '1' })];
  const data = load(sqm);
  assert.equal(data.form.link, 'ethernet');
  const vdsl = after(data, sqm, save(data, { link: 'vdsl' }));
  assert.equal(vdsl['overhead'], '34');
  assert.equal(vdsl['tcMPU'], '68');
  assert.equal(vdsl['iqdisc_opts'], 'ptm');
  assert.equal(vdsl['eqdisc_opts'], 'ptm');
  const adsl = after(data, sqm, save(data, { link: 'adsl' }));
  assert.equal(adsl['linklayer'], 'atm');
  assert.equal(adsl['tcMPU'], undefined);
});

test('Low upload memory follows the upload speed; Automatic leaves memlimit alone', () => {
  const sqm = [queue({ upload: '120000', eqdisc_opts: 'nat memlimit 1500000' })];
  const data = load(sqm);
  assert.equal(data.form.uploadMemory, 'low');
  assert.equal(after(data, sqm, save(data, { uploadMbit: '240' }))['eqdisc_opts'], 'nat memlimit 3000000');

  const custom = [queue({ upload: '120000', eqdisc_opts: 'memlimit 32m' })];
  const c = load(custom);
  assert.equal(c.form.uploadMemory, 'custom');
  assert.deepEqual(save(c, { uploadMbit: '240' }), [{ op: 'set', config: 'sqm', section: 'wan', values: { upload: '240000' } }]);
});

test('restored DSCP: its sqm options with it, and with the mode while it’s on', () => {
  const sqm = [queue({ script: 'layer_cake.qos' })];
  const data = load(sqm);
  const on = save(data, { restoreDscp: true });
  assert.equal(after(data, sqm, on)['squash_ingress'], '0');
  assert.deepEqual(
    on.filter((c) => c.config === 'milkflint'),
    [{ op: 'add', config: 'milkflint', type: 'cake', name: 'cake', values: { dscp_restore: '1' } }],
  );

  const restoring = [queue({ script: 'layer_cake.qos', squash_ingress: '0', squash_dscp: '0' })];
  const r = load(restoring, [section('cake', 'cake', { dscp_restore: '1' })]);
  const simple = after(r, restoring, save(r, { prioritise: false }));
  assert.equal(simple['squash_ingress'], undefined);
  assert.equal(simple['squash_dscp'], undefined);

  // off all along: the mode doesn't touch LuCI's squash options
  const luci = [queue({ squash_ingress: '0' })];
  assert.equal(after(load(luci), luci, save(load(luci), { prioritise: true }))['squash_ingress'], '0');
});

test('nothing changed, nothing written', () => {
  const data = load([queue({ iqdisc_opts: 'nat dual-dsthost ingress no-split-gso', eqdisc_opts: 'nat dual-srchost' })]);
  assert.deepEqual(save(data, { downloadMbit: '800.0' }), []);
  assert.deepEqual(save(data, {}), []);
});

test('a queue with no interface gets the one the page shows', () => {
  const sqm = [section('queue', 'wan', { enabled: '1', download: '800000', upload: '60000' })];
  const data = load(sqm);
  assert.deepEqual(save(data, { uploadMbit: '50' }), [{ op: 'set', config: 'sqm', section: 'wan', values: { interface: 'eth1', upload: '50000' } }]);
});

test('a new queue gets everything, and loads back as saved', () => {
  const data = load([]);
  const form = { ...data.form, enabled: true, downloadMbit: '800', uploadMbit: '60', link: 'ethernet' as const, perDevice: true };
  const changes = toChanges(form, data);
  const sqm = applied({ sqm: [] }, changes)['sqm'] ?? [];
  assert.deepEqual(sqm[0], {
    '.type': 'queue',
    '.name': 'wan',
    enabled: '1',
    interface: 'eth1',
    download: '800000',
    upload: '60000',
    qdisc: 'cake',
    script: 'piece_of_cake.qos',
    use_mq: '1',
    use_mq_egress: '0',
    linklayer: 'ethernet',
    overhead: '44',
    tcMPU: '84',
    linklayer_advanced: '1',
    iqdisc_opts: 'nat dual-dsthost ingress no-split-gso',
    eqdisc_opts: 'nat dual-srchost',
    qdisc_advanced: '1',
    qdisc_really_really_advanced: '1',
  });
  const back = load(sqm).form;
  assert.deepEqual({ ...back, section: undefined }, form);
});

test('a save loads back as the form that made it', () => {
  const sqm = [queue({ iqdisc_opts: 'nat dual-dsthost ingress', eqdisc_opts: 'nat dual-srchost' })];
  const data = load(sqm);
  const form: SqmForm = { ...data.form, downloadMbit: '450', uploadMbit: '45', latency: 'low', uploadMemory: 'low', ackFilter: 'on', link: 'docsis' };
  assert.deepEqual(load([after(data, sqm, toChanges(form, data))]).form, form);
});

/**
 * The section as LuCI's SQM page leaves it when it saves: an option whose
 * dependencies aren't met goes (luci-app-sqm's depends, LuCI's form.js
 * removes an inactive option that isn't retained).
 */
function luciSave(s: Section): Section {
  const gates: Record<string, (x: Section) => boolean> = {
    squash_dscp: (x) => x['qdisc_advanced'] === '1',
    squash_ingress: (x) => x['qdisc_advanced'] === '1',
    qdisc_really_really_advanced: (x) => x['qdisc_advanced'] === '1',
    iqdisc_opts: (x) => x['qdisc_really_really_advanced'] === '1',
    eqdisc_opts: (x) => x['qdisc_really_really_advanced'] === '1',
    linklayer_advanced: (x) => x['linklayer'] === 'ethernet' || x['linklayer'] === 'atm',
    tcMPU: (x) => x['linklayer_advanced'] === '1',
    linklayer_adaptation_mechanism: (x) => x['linklayer_advanced'] === '1',
  };
  let out = { ...s };
  for (;;) {
    const drop = Object.keys(gates).filter((o) => o in out && gates[o]?.(out) === false);
    if (drop.length === 0) return out;
    out = Object.fromEntries(Object.entries(out).filter(([k]) => !drop.includes(k))) as Section;
  }
}

test('with Smart Queue off, a speed is checked when it’s written', () => {
  // off with LuCI's 0 (don't shape): left as it is, nothing to check
  const zero = load([queue({ enabled: '0', download: '0', upload: '0' })]);
  assert.deepEqual(validate(zero.form, zero), {});
  assert.deepEqual(validate({ ...zero.form, prioritise: true }, zero), {});
  // typed while off: an empty or mistyped speed would be written as 0 or NaN, flipping
  // the automatic choices that go with it; it was let through before
  const off = load([queue({ enabled: '0' })]);
  assert.deepEqual(validate(off.form, off), {});
  for (const typed of ['', 'abc', '0', '-5', '1e999']) {
    assert.notEqual(validate({ ...off.form, downloadMbit: typed }, off).downloadMbit, undefined, typed);
    assert.notEqual(validate({ ...off.form, uploadMbit: typed }, off).uploadMbit, undefined, typed);
  }
  assert.deepEqual(validate({ ...off.form, downloadMbit: '640', uploadMbit: '50' }, off), {});
  // a new queue writes both speeds, on or off
  const none = load([]);
  assert.notEqual(validate(none.form, none).downloadMbit, undefined);
  assert.deepEqual(validate({ ...none.form, downloadMbit: '80', uploadMbit: '20' }, none), {});
});

test('a speed under 1 kbit/s is refused: written as 0, it would mean don’t shape', () => {
  const data = load([queue()]);
  assert.match(validate({ ...data.form, downloadMbit: '0.0004' }, data).downloadMbit ?? '', /at least 0\.001/);
  assert.match(validate({ ...data.form, enabled: false, uploadMbit: '0.0004' }, data).uploadMbit ?? '', /at least 0\.001/);
  assert.deepEqual(validate({ ...data.form, downloadMbit: '0.001', uploadMbit: '0.001' }, data), {});
  assert.notEqual(validate({ ...data.form, downloadMbit: '10001' }, data).downloadMbit, undefined);
});

test('multi-queue CAKE can’t estimate the speed: the kernel refuses it and downloads go unshaped', () => {
  const sqm = [queue({ download: '800000', iqdisc_opts: 'nat autorate-ingress' })];
  const data = load(sqm);
  assert.equal(data.form.multiQueue, 'auto');
  assert.notEqual(validate(data.form, data).multiQueue, undefined);
  // either one off
  assert.deepEqual(validate({ ...data.form, multiQueue: 'off' }, data), {});
  assert.deepEqual(validate({ ...data.form, downloadMbit: '300' }, data), {}, 'one CAKE below 500 Mbit/s');
  assert.notEqual(validate({ ...data.form, downloadMbit: '300', multiQueue: 'on' }, data).multiQueue, undefined);
  // not while it's off
  assert.deepEqual(validate({ ...data.form, enabled: false }, data), {});
  // without autorate, nothing to say
  const plain = load([queue({ download: '800000', iqdisc_opts: 'nat' })]);
  assert.deepEqual(validate(plain.form, plain), {});
});

test('a new queue’s upload stays one CAKE; an existing queue’s choice isn’t touched', () => {
  const data = load([]);
  const sqm = applied({ sqm: [] }, toChanges({ ...data.form, enabled: true, downloadMbit: '800', uploadMbit: '100' }, data))['sqm'] ?? [];
  const q = sqm[0];
  assert.ok(q !== undefined);
  assert.equal(q['use_mq'], '1');
  assert.equal(q['use_mq_egress'], '0');
  // as sqm-scripts gets it: multi-queue down, one CAKE up (without use_mq_egress the upload followed use_mq)
  const adv = advancedData(q, []);
  assert.equal(cakeArgs(adv.form, adv, 'down')[0], 'cake_mq');
  assert.equal(cakeArgs(adv.form, adv, 'up')[0], 'cake');
  const unset = { ...q };
  Reflect.deleteProperty(unset, 'use_mq_egress');
  const was = advancedData(unset, []);
  assert.equal(cakeArgs(was.form, was, 'up')[0], 'cake_mq');
  // a queue that's there: nothing about it, whatever the speed does
  for (const values of [{}, { use_mq_egress: '1' }]) {
    const existing = load([queue({ download: '300000', use_mq: '0', ...values })]);
    for (const c of save(existing, { downloadMbit: '900', multiQueue: 'auto' })) {
      assert.ok(!(c.op === 'set' && 'use_mq_egress' in c.values));
    }
  }
});

test('Fair share per device off takes out what on put in, and on puts it in once', () => {
  // the download's ingress mode goes with it: left behind, it would charge drops to the shaper for nothing
  const sqm = [queue({ iqdisc_opts: 'nat dual-dsthost ingress no-split-gso', eqdisc_opts: 'nat dual-srchost ack-filter' })];
  const data = load(sqm);
  assert.equal(data.form.perDevice, true);
  const off = after(data, sqm, save(data, { perDevice: false }));
  assert.equal(off['iqdisc_opts'], 'no-split-gso');
  assert.equal(off['eqdisc_opts'], 'ack-filter');
  assert.equal(load([off]).form.perDevice, false);
  // and back on: the recipe once, other words kept
  const back = load([off]);
  const on = after(back, [off], save(back, { perDevice: true }));
  assert.equal(on['iqdisc_opts'], 'no-split-gso nat dual-dsthost ingress');
  assert.equal(on['eqdisc_opts'], 'ack-filter nat dual-srchost');
  // one direction's isolation set in LuCI: on completes it, off takes the recipe out, the rest stays
  const oneSided = [queue({ iqdisc_opts: 'dual-dsthost', eqdisc_opts: 'triple-isolate' })];
  const one = load(oneSided);
  assert.equal(one.form.perDevice, false);
  const both = after(one, oneSided, save(one, { perDevice: true }));
  assert.equal(both['eqdisc_opts'], 'triple-isolate nat dual-srchost');
  const none = after(load([both]), [both], save(load([both]), { perDevice: false }));
  assert.equal(none['iqdisc_opts'], undefined);
  assert.equal(none['eqdisc_opts'], 'triple-isolate');
});

test('Keep devices’ priorities writes its sqm options with LuCI’s advanced mode, so a save in LuCI keeps them', () => {
  const sqm = [queue({ script: 'layer_cake.qos' })];
  const data = load(sqm);
  const on = after(data, sqm, save(data, { restoreDscp: true }));
  assert.equal(on['squash_ingress'], '0');
  assert.equal(on['qdisc_advanced'], '1');
  // LuCI drops squash_ingress without it: downloads would lose their tins, the switch still on
  assert.equal(luciSave(on)['squash_ingress'], '0');
  const without = { ...on };
  Reflect.deleteProperty(without, 'qdisc_advanced');
  assert.equal(luciSave(without)['squash_ingress'], undefined);
  // already in advanced mode: not written again
  const adv = [queue({ script: 'layer_cake.qos', qdisc_advanced: '1' })];
  const a = load(adv);
  assert.deepEqual(
    save(a, { restoreDscp: true }).filter((c) => c.config === 'sqm'),
    [{ op: 'set', config: 'sqm', section: 'wan', values: { squash_ingress: '0' } }],
  );
  // what's only unset needs no advanced mode
  const restoring = [queue({ squash_ingress: '0', squash_dscp: '0' })];
  const r = load(restoring, [section('cake', 'cake', { dscp_restore: '1' })]);
  assert.deepEqual(
    save(r, { restoreDscp: false }).filter((c) => c.config === 'sqm'),
    [{ op: 'unset', config: 'sqm', section: 'wan', options: ['squash_ingress'] }],
  );
});

test('what the page saves survives a save in LuCI', () => {
  const data = load([]);
  const form: SqmForm = {
    ...data.form,
    enabled: true,
    downloadMbit: '80',
    uploadMbit: '20',
    prioritise: true,
    link: 'vdsl',
    latency: 'low',
    uploadMemory: 'low',
    ackFilter: 'on',
    perDevice: true,
    restoreDscp: true,
  };
  const out = applied({ sqm: [], milkflint: [] }, toChanges(form, data));
  const q = out['sqm']?.[0];
  assert.ok(q !== undefined);
  assert.deepEqual(luciSave(q), q);
  assert.deepEqual({ ...load([luciSave(q)], out['milkflint']).form, section: undefined }, form);
});

test('the Interface choices leave out the VPN’s tunnel and the guest networks’ devices', () => {
  const data = sqmData({
    sqm: [queue()],
    firewall: [],
    milkflint: [],
    wanDevice: 'eth1',
    wanProto: 'dhcp',
    devices: ['eth0', 'eth1', 'eth1.911', 'lo', 'br-lan', 'br-guest', 'ifb4br-guest', 'br-guest2', 'wg_out', 'ifb4wg_out', 'ifb4eth1', 'phy1-ap0', 'pppoe-wan', 'wwan0'],
  });
  assert.deepEqual(data.devices, ['eth0', 'eth1', 'eth1.911', 'pppoe-wan', 'wwan0']);
  // the reason: a queue there is the VPN's or a guest network's, and the page loses its own
  assert.equal(internetQueue([queue({ interface: 'wg_out' })]), undefined);
  assert.equal(internetQueue([queue({ interface: 'br-guest' })]), undefined);
});
