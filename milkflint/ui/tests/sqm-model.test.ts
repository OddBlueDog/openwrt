// What the Smart Queue page saves: only the settings that changed, so CAKE
// keywords and options set in LuCI stay unless their own setting changed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type SqmData, type SqmForm, sqmData, toChanges } from '../src/features/sqm/model.ts';
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
  sqmData({ sqm, firewall: [section('defaults', 'cfg01')], milkflint, wanDevice: 'eth1', devices: ['eth0', 'eth1', 'lo', 'br-lan'] });

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
  // fairness, simple.qos, use_mq on below 500 Mbit/s, an old preset without its mpu
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
  assert.equal(data.form.link, 'ethernet');
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
