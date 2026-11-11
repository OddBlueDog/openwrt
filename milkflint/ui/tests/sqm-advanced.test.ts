// Smart Queue's advanced sheet: CAKE's keywords read into settings by group,
// and a save that writes only what changed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type AdvancedData,
  type AdvancedForm,
  advancedChanges,
  advancedData,
  cakeArgs,
  cakeEffect,
  directionOf,
  optsWith,
  validateAdvanced,
} from '../src/features/sqm/advanced.ts';
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

const save = (data: AdvancedData, over: (f: AdvancedForm) => AdvancedForm): Change[] => advancedChanges(over(data.form), data);

/** the configs after the changes */
const after = (data: AdvancedData, changes: Change[]): { queue: Section; milkflint: Section[] } => {
  const out = applied({ sqm: [data.queue], milkflint: data.milkflint }, changes);
  const q = out['sqm']?.[0];
  assert.ok(q !== undefined);
  return { queue: q, milkflint: out['milkflint'] ?? [] };
};

test('a direction’s keywords by group, the last of each as CAKE takes it, the rest kept', () => {
  const d = directionOf('nat dual-dsthost ingress diffserv3 besteffort rtt 50ms memlimit 4mb overhead 18 conservative no-split-gso');
  assert.equal(d.diffserv, 'besteffort');
  assert.equal(d.isolation, 'dual-dsthost');
  assert.equal(d.nat, 'nat');
  assert.equal(d.ingress, 'ingress');
  assert.equal(d.rtt, '50ms');
  assert.equal(d.memlimit, '4mb');
  assert.equal(d.gso, 'no-split-gso');
  assert.equal(d.extra, 'overhead 18 conservative');
  assert.equal(directionOf('metro').rtt, 'metro');
  assert.equal(directionOf(undefined).diffserv, '');
});

test('a changed group goes to the end; the others keep their places', () => {
  const was = directionOf('nat dual-dsthost ingress no-split-gso');
  assert.equal(optsWith('nat dual-dsthost ingress no-split-gso', was, was), undefined);
  assert.equal(optsWith('nat dual-dsthost ingress no-split-gso', was, { ...was, diffserv: 'diffserv4' }), 'nat dual-dsthost ingress no-split-gso diffserv4');
  assert.equal(optsWith('nat dual-dsthost ingress no-split-gso', was, { ...was, isolation: 'hosts' }), 'nat ingress no-split-gso hosts');
  // every word of the group goes, duplicates too
  const twice = directionOf('diffserv3 nat besteffort');
  assert.equal(optsWith('diffserv3 nat besteffort', twice, { ...twice, diffserv: '' }), 'nat');
  // a value goes with its keyword
  const rtt = directionOf('rtt 50ms nat');
  assert.equal(optsWith('rtt 50ms nat', rtt, { ...rtt, rtt: 'metro' }), 'nat metro');
  assert.equal(optsWith('rtt 50ms nat', rtt, { ...rtt, rtt: '20ms' }), 'nat rtt 20ms');
  // Other options as typed
  const extra = directionOf('nat overhead 18');
  assert.equal(optsWith('nat overhead 18', extra, { ...extra, extra: 'conservative' }), 'nat conservative');
});

test('a change writes its own option and nothing else', () => {
  // no-split-gso taken out in LuCI at 800 Mbit/s
  const data = advancedData(queue({ iqdisc_opts: 'nat dual-dsthost ingress', eqdisc_opts: 'nat dual-srchost' }), []);
  assert.equal(data.form.whole, 'off');
  assert.deepEqual(
    save(data, (f) => ({ ...f, up: { ...f.up, ackFilter: 'ack-filter' } })),
    [
      {
        op: 'set',
        config: 'sqm',
        section: 'wan',
        values: { eqdisc_opts: 'nat dual-srchost ack-filter', qdisc_advanced: '1', qdisc_really_really_advanced: '1' },
      },
    ],
  );
  assert.deepEqual(save(data, (f) => ({ ...f, overhead: '18' })), [{ op: 'set', config: 'sqm', section: 'wan', values: { overhead: '18' } }]);
  assert.deepEqual(save(data, (f) => ({ ...f, debug: true })), [{ op: 'set', config: 'sqm', section: 'wan', values: { debug_logging: '1' } }]);
  assert.deepEqual(save(data, (f) => f), []);
});

test('the GRO choice writes the download’s keyword when CAKE doesn’t already do it', () => {
  // taken out in LuCI, back to Automatic: whole at 800 Mbit/s, the setting already unset
  const luci = advancedData(queue({ iqdisc_opts: 'nat' }), []);
  assert.deepEqual(save(luci, (f) => ({ ...f, whole: 'auto' })), [
    { op: 'set', config: 'sqm', section: 'wan', values: { iqdisc_opts: 'nat no-split-gso', qdisc_advanced: '1', qdisc_really_really_advanced: '1' } },
  ]);
  // Never: the keyword goes and the setting is saved
  const auto = advancedData(queue({ iqdisc_opts: 'nat no-split-gso' }), []);
  assert.equal(auto.form.whole, 'auto');
  const never = after(auto, save(auto, (f) => ({ ...f, whole: 'off' })));
  assert.equal(never.queue['iqdisc_opts'], 'nat');
  assert.equal(never.milkflint.find((s) => s['.name'] === 'gro')?.['whole'], '0');
  // Always where CAKE already takes them whole: only the setting
  const always = save(auto, (f) => ({ ...f, whole: 'on' }));
  assert.deepEqual(always, [{ op: 'add', config: 'milkflint', type: 'gro', name: 'gro', values: { whole: '1' } }]);
});

test('link options: tcMPU and the stab ones with LuCI’s advanced mode, cleared ones unset', () => {
  const data = advancedData(queue({ linklayer: 'ethernet', overhead: '44', tcMPU: '84', linklayer_advanced: '1' }), []);
  assert.deepEqual(save(data, (f) => ({ ...f, mpu: '64' })), [
    { op: 'set', config: 'sqm', section: 'wan', values: { tcMPU: '64', linklayer_advanced: '1' } },
  ]);
  assert.deepEqual(save(data, (f) => ({ ...f, mpu: '' })), [{ op: 'unset', config: 'sqm', section: 'wan', options: ['tcMPU'] }]);
  // PTM: both directions
  const ptm = after(data, save(data, (f) => ({ ...f, down: { ...f.down, ptm: true }, up: { ...f.up, ptm: true } })));
  assert.equal(ptm.queue['iqdisc_opts'], 'ptm');
  assert.equal(ptm.queue['eqdisc_opts'], 'ptm');
});

test('DSCP options: written when changed, left to Keep devices’ priorities when that’s on', () => {
  const data = advancedData(queue({ script: 'layer_cake.qos' }), []);
  assert.deepEqual(save(data, (f) => ({ ...f, squashIngress: false })), [
    { op: 'set', config: 'sqm', section: 'wan', values: { squash_ingress: '0' } },
  ]);
  const restoring = advancedData(queue({ script: 'layer_cake.qos', squash_ingress: '0' }), [section('cake', 'cake', { dscp_restore: '1' })]);
  assert.equal(restoring.dscpRestore, true);
  assert.deepEqual(save(restoring, (f) => ({ ...f, squashIngress: true, squashDscp: false })), []);
});

test('upload multi-queue: like the download is unset', () => {
  const data = advancedData(queue({ use_mq_egress: '0' }), []);
  assert.equal(data.form.mqEgress, '0');
  assert.deepEqual(save(data, (f) => ({ ...f, mqEgress: '' })), [{ op: 'unset', config: 'sqm', section: 'wan', options: ['use_mq_egress'] }]);
});

test('what can’t be saved', () => {
  const data = advancedData(queue(), []);
  const errors = (over: (f: AdvancedForm) => AdvancedForm): string[] => Object.keys(validateAdvanced(over(data.form)));
  assert.deepEqual(errors((f) => f), []);
  assert.deepEqual(errors((f) => ({ ...f, down: { ...f.down, rtt: 'fast' } })), ['down.rtt']);
  assert.deepEqual(errors((f) => ({ ...f, down: { ...f.down, rtt: '0.5ms' } })), []);
  assert.deepEqual(errors((f) => ({ ...f, up: { ...f.up, memlimit: '32mb' } })), []);
  assert.deepEqual(errors((f) => ({ ...f, up: { ...f.up, memlimit: 'lots' } })), ['up.memlimit']);
  assert.deepEqual(errors((f) => ({ ...f, up: { ...f.up, fwmark: '0xff' } })), []);
  assert.deepEqual(errors((f) => ({ ...f, overhead: '300' })), ['overhead']);
  assert.deepEqual(errors((f) => ({ ...f, overhead: '-4' })), []);
  // Other options: not a keyword with its own setting, nor sqm's, nor a value missing
  assert.equal(validateAdvanced({ ...data.form, up: { ...data.form.up, extra: 'diffserv4' } })['up.extra'], 'diffserv4 has its own setting above.');
  assert.equal(validateAdvanced({ ...data.form, up: { ...data.form.up, extra: 'bandwidth 10mbit' } })['up.extra'], 'sqm sets bandwidth itself.');
  assert.equal(validateAdvanced({ ...data.form, up: { ...data.form.up, extra: 'conservative mpu' } })['up.extra'], 'mpu needs a value after it.');
  assert.deepEqual(errors((f) => ({ ...f, up: { ...f.up, extra: 'conservative mpu 64' } })), []);
});

test('what sqm gives CAKE, and what CAKE makes of it', () => {
  const data = advancedData(queue({ linklayer: 'ethernet', overhead: '44', tcMPU: '84', iqdisc_opts: 'nat dual-dsthost ingress', use_mq_egress: '0' }), []);
  const down = cakeArgs(data.form, data, 'down');
  assert.equal(down.join(' '), 'cake_mq bandwidth 800000kbit overhead 44 mpu 84 diffserv3 nat besteffort wash nat dual-dsthost ingress');
  assert.deepEqual(cakeEffect(down), {
    diffserv: 'besteffort',
    isolation: 'dual-dsthost',
    nat: 'nat',
    wash: 'wash',
    ingress: 'ingress',
    ackFilter: 'no-ack-filter',
    gso: 'split-gso',
    rtt: '100ms',
  });
  assert.equal(cakeArgs(data.form, data, 'up').join(' '), 'cake bandwidth 60000kbit overhead 44 mpu 84 diffserv3 nat besteffort');
  // layer_cake: three tins up, and down once squash_ingress is off; the sheet's edits show before saving
  const layer = { ...data.form, script: 'layer_cake.qos', squashIngress: false, down: { ...data.form.down, rtt: '50ms' }, whole: 'on' as const };
  const layered = cakeArgs(layer, data, 'down');
  assert.equal(cakeEffect(layered).diffserv, 'diffserv3');
  assert.equal(cakeEffect(layered).rtt, '50ms');
  assert.equal(cakeEffect(layered).gso, 'no-split-gso');
  // tc's stab instead of CAKE's own
  const stab = cakeArgs({ ...data.form, llam: 'tc_stab' }, data, 'up');
  assert.equal(stab.join(' '), 'stab mtu 2047 tsize 512 mpu 84 overhead 44 linklayer ethernet cake bandwidth 60000kbit diffserv3 nat besteffort');
});

test('a save loads back as the sheet that made it', () => {
  const data = advancedData(queue({ iqdisc_opts: 'nat dual-dsthost ingress', eqdisc_opts: 'nat dual-srchost' }), []);
  const form: AdvancedForm = {
    ...data.form,
    down: { ...data.form.down, diffserv: 'diffserv4', rtt: 'metro', autorate: true, extra: 'conservative' },
    up: { ...data.form.up, ackFilter: 'ack-filter-aggressive', memlimit: '8mb', fwmark: '0xff', wash: 'wash' },
    whole: 'on',
    script: 'layer_cake.qos',
    linklayer: 'atm',
    overhead: '32',
    llam: 'tc_stab',
    tsize: '128',
    verbosity: '8',
  };
  const out = after(data, advancedChanges(form, data));
  const back = advancedData(out.queue, out.milkflint).form;
  assert.deepEqual(back, { ...form, down: { ...form.down, gso: 'no-split-gso' } });
});

test('LuCI’s advanced modes are written only when they aren’t on', () => {
  const data = advancedData(queue({ eqdisc_opts: 'nat', qdisc_advanced: '1', qdisc_really_really_advanced: '1' }), []);
  assert.deepEqual(save(data, (f) => ({ ...f, up: { ...f.up, ackFilter: 'ack-filter' } })), [
    { op: 'set', config: 'sqm', section: 'wan', values: { eqdisc_opts: 'nat ack-filter' } },
  ]);
});
