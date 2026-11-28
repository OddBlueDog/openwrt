// Smart Queue's advanced sheet: CAKE's keywords read into settings by group,
// and a save that writes only what changed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type AdvancedData,
  type AdvancedForm,
  advancedChanges,
  advancedData,
  downloadMq,
  cakeArgs,
  cakeEffect,
  directionOf,
  optsWith,
  advancedFormSchema,
  type AdvancedErrors,
} from '../src/features/sqm/advanced.ts';
import {
  cakeExtrasDefaults,
  cakeExtrasOf,
  cakeExtrasOptions,
  cakeParamMissing,
  dropOneSegmentIdle,
  dropOneSegmentNow,
  fraglistNow,
  oneSegmentDropsNow,
  sparseAheadChoices,
  sparseAheadLabel,
  sparseAheadNow,
} from '../src/features/sqm/cake-extras.ts';
import { formErrors } from '../src/lib/form/errors.ts';
import type { Change, Section } from '../src/lib/api/uci.ts';
import { applied, section } from './uci-fixture.ts';

const validateAdvanced = (f: AdvancedForm, data: AdvancedData): AdvancedErrors => formErrors(advancedFormSchema(data), f);

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
  const d = directionOf(
    'nat dual-dsthost ingress diffserv3 besteffort rtt 50ms memlimit 4mb overhead 18 conservative no-split-gso',
  );
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
  assert.equal(
    optsWith('nat dual-dsthost ingress no-split-gso', was, { ...was, diffserv: 'diffserv4' }),
    'nat dual-dsthost ingress no-split-gso diffserv4',
  );
  assert.equal(
    optsWith('nat dual-dsthost ingress no-split-gso', was, { ...was, isolation: 'hosts' }),
    'nat ingress no-split-gso hosts',
  );
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
  const data = advancedData(queue({ iqdisc_opts: 'nat dual-dsthost ingress', eqdisc_opts: 'nat dual-srchost' }), [], false);
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
  assert.deepEqual(
    save(data, (f) => ({ ...f, overhead: '18' })),
    [{ op: 'set', config: 'sqm', section: 'wan', values: { overhead: '18' } }],
  );
  assert.deepEqual(
    save(data, (f) => ({ ...f, debug: true })),
    [{ op: 'set', config: 'sqm', section: 'wan', values: { debug_logging: '1' } }],
  );
  assert.deepEqual(
    save(data, (f) => f),
    [],
  );
});

test('the GRO choice writes the download’s keyword when CAKE doesn’t already do it', () => {
  // taken out in LuCI, back to Automatic: whole at 800 Mbit/s, the setting already unset
  const luci = advancedData(queue({ iqdisc_opts: 'nat' }), [], false);
  assert.deepEqual(
    save(luci, (f) => ({ ...f, whole: 'auto' })),
    [
      {
        op: 'set',
        config: 'sqm',
        section: 'wan',
        values: { iqdisc_opts: 'nat no-split-gso', qdisc_advanced: '1', qdisc_really_really_advanced: '1' },
      },
    ],
  );
  // Never: the keyword goes and the setting is saved
  const auto = advancedData(queue({ iqdisc_opts: 'nat no-split-gso' }), [], false);
  assert.equal(auto.form.whole, 'auto');
  const never = after(
    auto,
    save(auto, (f) => ({ ...f, whole: 'off' })),
  );
  assert.equal(never.queue['iqdisc_opts'], 'nat');
  assert.equal(never.milkflint.find((s) => s['.name'] === 'gro')?.['whole'], '0');
  // Always where CAKE already takes them whole: only the setting
  const always = save(auto, (f) => ({ ...f, whole: 'on' }));
  assert.deepEqual(always, [{ op: 'add', config: 'milkflint', type: 'gro', name: 'gro', values: { whole: '1' } }]);
});

test('link options: tcMPU and the stab ones with LuCI’s advanced mode, cleared ones unset', () => {
  const data = advancedData(queue({ linklayer: 'ethernet', overhead: '44', tcMPU: '84', linklayer_advanced: '1' }), [], false);
  assert.deepEqual(
    save(data, (f) => ({ ...f, mpu: '64' })),
    [{ op: 'set', config: 'sqm', section: 'wan', values: { tcMPU: '64', linklayer_advanced: '1' } }],
  );
  assert.deepEqual(
    save(data, (f) => ({ ...f, mpu: '' })),
    [{ op: 'unset', config: 'sqm', section: 'wan', options: ['tcMPU'] }],
  );
  // PTM: both directions
  const ptm = after(
    data,
    save(data, (f) => ({ ...f, down: { ...f.down, ptm: true }, up: { ...f.up, ptm: true } })),
  );
  assert.equal(ptm.queue['iqdisc_opts'], 'ptm');
  assert.equal(ptm.queue['eqdisc_opts'], 'ptm');
});

test('DSCP options: written when changed, left to Keep devices’ priorities when that’s on', () => {
  const data = advancedData(queue({ script: 'layer_cake.qos' }), [], false);
  // with LuCI's advanced mode, which its next save would drop them without
  assert.deepEqual(
    save(data, (f) => ({ ...f, squashIngress: false })),
    [{ op: 'set', config: 'sqm', section: 'wan', values: { squash_ingress: '0', qdisc_advanced: '1' } }],
  );
  const restoring = advancedData(
    queue({ script: 'layer_cake.qos', squash_ingress: '0' }),
    [section('cake', 'cake', { dscp_restore: '1' })],
    false,
  );
  assert.equal(restoring.dscpRestore, true);
  assert.deepEqual(
    save(restoring, (f) => ({ ...f, squashIngress: true, squashDscp: false })),
    [],
  );
});

test('upload multi-queue: like the download is unset', () => {
  const data = advancedData(queue({ use_mq_egress: '0' }), [], false);
  assert.equal(data.form.mqEgress, '0');
  assert.deepEqual(
    save(data, (f) => ({ ...f, mqEgress: '' })),
    [{ op: 'unset', config: 'sqm', section: 'wan', options: ['use_mq_egress'] }],
  );
});

test('what can’t be saved', () => {
  const data = advancedData(queue(), [], false);
  const errors = (over: (f: AdvancedForm) => AdvancedForm): string[] => Object.keys(validateAdvanced(over(data.form), data));
  assert.deepEqual(
    errors((f) => f),
    [],
  );
  assert.deepEqual(
    errors((f) => ({ ...f, down: { ...f.down, rtt: 'fast' } })),
    ['down.rtt'],
  );
  assert.deepEqual(
    errors((f) => ({ ...f, down: { ...f.down, rtt: '0.5ms' } })),
    [],
  );
  assert.deepEqual(
    errors((f) => ({ ...f, up: { ...f.up, memlimit: '32mb' } })),
    [],
  );
  assert.deepEqual(
    errors((f) => ({ ...f, up: { ...f.up, memlimit: 'lots' } })),
    ['up.memlimit'],
  );
  assert.deepEqual(
    errors((f) => ({ ...f, up: { ...f.up, fwmark: '0xff' } })),
    [],
  );
  assert.deepEqual(
    errors((f) => ({ ...f, overhead: '300' })),
    ['overhead'],
  );
  assert.deepEqual(
    errors((f) => ({ ...f, overhead: '-4' })),
    [],
  );
  // Other options: not a keyword with its own setting, nor sqm's, nor a value missing
  assert.equal(
    validateAdvanced({ ...data.form, up: { ...data.form.up, extra: 'diffserv4' } }, data)['up.extra'],
    'diffserv4 has its own setting above.',
  );
  assert.equal(
    validateAdvanced({ ...data.form, up: { ...data.form.up, extra: 'bandwidth 10mbit' } }, data)['up.extra'],
    'sqm sets bandwidth itself.',
  );
  assert.equal(
    validateAdvanced({ ...data.form, up: { ...data.form.up, extra: 'conservative mpu' } }, data)['up.extra'],
    'mpu needs a value after it.',
  );
  assert.deepEqual(
    errors((f) => ({ ...f, up: { ...f.up, extra: 'conservative mpu 64' } })),
    [],
  );
});

test('what sqm gives CAKE, and what CAKE makes of it', () => {
  const data = advancedData(
    queue({ linklayer: 'ethernet', overhead: '44', tcMPU: '84', iqdisc_opts: 'nat dual-dsthost ingress', use_mq_egress: '0' }),
    [],
    false,
  );
  const down = cakeArgs(data.form, data, 'down');
  assert.equal(
    down.join(' '),
    'cake_mq bandwidth 800000kbit overhead 44 mpu 84 diffserv3 nat besteffort wash nat dual-dsthost ingress',
  );
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
  const layer = {
    ...data.form,
    script: 'layer_cake.qos',
    squashIngress: false,
    down: { ...data.form.down, rtt: '50ms' },
    whole: 'on' as const,
  };
  const layered = cakeArgs(layer, data, 'down');
  assert.equal(cakeEffect(layered).diffserv, 'diffserv3');
  assert.equal(cakeEffect(layered).rtt, '50ms');
  assert.equal(cakeEffect(layered).gso, 'no-split-gso');
  // tc's stab instead of CAKE's own
  const stab = cakeArgs({ ...data.form, llam: 'tc_stab' }, data, 'up');
  assert.equal(
    stab.join(' '),
    'stab mtu 2047 tsize 512 mpu 84 overhead 44 linklayer ethernet cake bandwidth 60000kbit diffserv3 nat besteffort',
  );
});

test('a save loads back as the sheet that made it', () => {
  // one CAKE on the download: it estimates the speed
  const data = advancedData(
    queue({ use_mq: '0', iqdisc_opts: 'nat dual-dsthost ingress', eqdisc_opts: 'nat dual-srchost' }),
    [],
    false,
  );
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
    dropOneSegment: true,
    sparseAhead: '250',
  };
  assert.deepEqual(validateAdvanced(form, data), {});
  const out = after(data, advancedChanges(form, data));
  const back = advancedData(out.queue, out.milkflint, false).form;
  assert.deepEqual(back, { ...form, down: { ...form.down, gso: 'no-split-gso' } });
});

test('LuCI’s advanced modes are written only when they aren’t on', () => {
  const data = advancedData(queue({ eqdisc_opts: 'nat', qdisc_advanced: '1', qdisc_really_really_advanced: '1' }), [], false);
  assert.deepEqual(
    save(data, (f) => ({ ...f, up: { ...f.up, ackFilter: 'ack-filter' } })),
    [{ op: 'set', config: 'sqm', section: 'wan', values: { eqdisc_opts: 'nat ack-filter' } }],
  );
});

test('estimating the line’s speed is refused with multi-queue CAKE, which the kernel won’t start with it', () => {
  const mq = advancedData(queue({ use_mq: '1' }), [], false);
  const on = (data: AdvancedData): AdvancedForm => ({ ...data.form, down: { ...data.form.down, autorate: true } });
  assert.deepEqual(Object.keys(validateAdvanced(on(mq), mq)), ['down.autorate']);
  // one CAKE: fine
  const one = advancedData(queue({ use_mq: '0' }), [], false);
  assert.deepEqual(validateAdvanced(on(one), one), {});
  // already on with multi-queue (LuCI): turning it off is what's allowed
  const luci = advancedData(queue({ use_mq: '1', iqdisc_opts: 'nat autorate-ingress' }), [], false);
  assert.equal(luci.form.down.autorate, true);
  assert.notDeepEqual(validateAdvanced(luci.form, luci), {});
  const off = { ...luci.form, down: { ...luci.form.down, autorate: false } };
  assert.deepEqual(validateAdvanced(off, luci), {});
  assert.equal(after(luci, advancedChanges(off, luci)).queue['iqdisc_opts'], 'nat');
});

test('DSCP options from the sheet keep LuCI’s advanced mode on, and don’t write it when it is', () => {
  const plain = advancedData(queue(), [], false);
  const washOff = after(
    plain,
    save(plain, (f) => ({ ...f, squashDscp: false })),
  );
  assert.equal(washOff.queue['squash_dscp'], '0');
  assert.equal(washOff.queue['qdisc_advanced'], '1');
  const adv = advancedData(queue({ qdisc_advanced: '1' }), [], false);
  assert.deepEqual(
    save(adv, (f) => ({ ...f, squashDscp: false })),
    [{ op: 'set', config: 'sqm', section: 'wan', values: { squash_dscp: '0' } }],
  );
});

test('Multi-queue in the sheet writes use_mq for the speed and the choice in milkflint, as the page did', () => {
  // 800 Mbit/s on an Ethernet line: Automatic gives one CAKE (from 1 Gbit/s there)
  const eth = advancedData(queue({ use_mq: '0' }), [], false);
  assert.equal(eth.form.multiQueue, 'auto');
  assert.equal(downloadMq(eth.form, eth), false);
  assert.equal(eth.pppoe, false);
  // ... and on a PPPoE line multi-queue (from 500 Mbit/s there)
  const data = advancedData(queue({ use_mq: '1' }), [], true);
  assert.equal(data.form.multiQueue, 'auto');
  assert.equal(downloadMq(data.form, data), true);
  assert.deepEqual(
    save(data, (f) => ({ ...f, multiQueue: 'off' })),
    [
      { op: 'set', config: 'sqm', section: 'wan', values: { use_mq: '0' } },
      { op: 'add', config: 'milkflint', type: 'cake', name: 'cake', values: { multi_queue: '0' } },
    ],
  );
  // back to Automatic: the choice goes, and use_mq follows the speed
  const off = advancedData(queue({ use_mq: '0' }), [section('cake', 'cake', { multi_queue: '0' })], true);
  assert.equal(off.form.multiQueue, 'off');
  assert.deepEqual(
    save(off, (f) => ({ ...f, multiQueue: 'auto' })),
    [
      { op: 'set', config: 'sqm', section: 'wan', values: { use_mq: '1' } },
      { op: 'delete', config: 'milkflint', section: 'cake' },
    ],
  );
  assert.deepEqual(
    save(off, (f) => f),
    [],
  );
  // what CAKE gets, and the speed estimate's check, follow the choice before it's saved
  assert.ok(cakeArgs({ ...off.form, multiQueue: 'on' }, off, 'down').includes('cake_mq'));
  assert.ok(cakeArgs(off.form, off, 'down').includes('cake'));
  const estimating = { ...off.form, multiQueue: 'on' as const, down: { ...off.form.down, autorate: true } };
  assert.deepEqual(Object.keys(validateAdvanced(estimating, off)), ['down.autorate']);
  // a choice that loads back as itself
  const on = after(
    off,
    save(off, (f) => ({ ...f, multiQueue: 'on' })),
  );
  assert.equal(advancedData(on.queue, on.milkflint, true).form.multiQueue, 'on');
});

test('the experimental settings: unset is off, and only what cake-shaper takes reads as set', () => {
  assert.deepEqual(cakeExtrasOf(undefined, undefined), cakeExtrasDefaults);
  assert.deepEqual(cakeExtrasDefaults, { dropOneSegment: false, sparseAhead: '' });
  assert.deepEqual(cakeExtrasOf('1', '250'), { dropOneSegment: true, sparseAhead: '250' });
  for (const v of ['0', 'Y', 'yes', 'on', '01', '']) assert.equal(cakeExtrasOf(v, undefined).dropOneSegment, false, v);
  // µs, 1 to 1000, without leading zeros once read
  assert.equal(cakeExtrasOf(undefined, '0500').sparseAhead, '500');
  assert.equal(cakeExtrasOf(undefined, '1000').sparseAhead, '1000');
  assert.equal(cakeExtrasOf(undefined, '1').sparseAhead, '1');
  for (const v of ['0', '00', '1001', '01000', '-1', '2.5', '250us', 'off', '']) {
    assert.equal(cakeExtrasOf(undefined, v).sparseAhead, '', v);
  }
  assert.deepEqual(cakeExtrasOptions(cakeExtrasDefaults), { drop_one_segment: undefined, sparse_ahead: undefined });
  assert.deepEqual(cakeExtrasOptions({ dropOneSegment: true, sparseAhead: '100' }), {
    drop_one_segment: '1',
    sparse_ahead: '100',
  });
});

test('the experimental settings read into the sheet from milkflint.cake, junk as off', () => {
  const set = advancedData(queue(), [section('cake', 'cake', { drop_one_segment: '1', sparse_ahead: '500' })], false);
  assert.equal(set.form.dropOneSegment, true);
  assert.equal(set.form.sparseAhead, '500');
  const junk = advancedData(queue(), [section('cake', 'cake', { drop_one_segment: 'yes', sparse_ahead: '99999' })], false);
  assert.equal(junk.form.dropOneSegment, false);
  assert.equal(junk.form.sparseAhead, '');
  const none = advancedData(queue(), [], false);
  assert.equal(none.form.dropOneSegment, false);
  assert.equal(none.form.sparseAhead, '');
});

test('the experimental settings write milkflint.cake only, and only what changed', () => {
  const data = advancedData(queue(), [], false);
  assert.deepEqual(
    save(data, (f) => ({ ...f, dropOneSegment: true })),
    [{ op: 'add', config: 'milkflint', type: 'cake', name: 'cake', values: { drop_one_segment: '1' } }],
  );
  assert.deepEqual(
    save(data, (f) => ({ ...f, sparseAhead: '100' })),
    [{ op: 'add', config: 'milkflint', type: 'cake', name: 'cake', values: { sparse_ahead: '100' } }],
  );
  // beside other milkflint.cake options, which are left as they are
  const other = advancedData(
    queue(),
    [section('cake', 'cake', { ecn_drop: '16', sparse_ahead: '250', drop_one_segment: '1', multi_queue: '1' })],
    false,
  );
  assert.deepEqual(
    save(other, (f) => ({ ...f, sparseAhead: '500' })),
    [{ op: 'set', config: 'milkflint', section: 'cake', values: { sparse_ahead: '500' } }],
  );
  assert.deepEqual(
    save(other, (f) => ({ ...f, sparseAhead: '', dropOneSegment: false })),
    [{ op: 'unset', config: 'milkflint', section: 'cake', options: ['drop_one_segment', 'sparse_ahead'] }],
  );
  // one that's all the section has: off deletes it
  const alone = advancedData(queue(), [section('cake', 'cake', { drop_one_segment: '1' })], false);
  assert.deepEqual(
    save(alone, (f) => ({ ...f, dropOneSegment: false })),
    [{ op: 'delete', config: 'milkflint', section: 'cake' }],
  );
  // a junk value read as off isn't rewritten by a save that didn't touch it
  const junk = advancedData(queue(), [section('cake', 'cake', { sparse_ahead: 'abc' })], false);
  assert.deepEqual(
    save(junk, (f) => ({ ...f, overhead: '18' })),
    [{ op: 'set', config: 'sqm', section: 'wan', values: { overhead: '18' } }],
  );
  // with Multi-queue in the same save: one change to the section
  const mq = advancedData(queue({ use_mq: '1' }), [], true);
  assert.deepEqual(
    save(mq, (f) => ({ ...f, multiQueue: 'off', dropOneSegment: true })),
    [
      { op: 'set', config: 'sqm', section: 'wan', values: { use_mq: '0' } },
      { op: 'add', config: 'milkflint', type: 'cake', name: 'cake', values: { multi_queue: '0', drop_one_segment: '1' } },
    ],
  );
  // CAKE's command doesn't change: they're module parameters, not keywords
  const on = { ...data.form, dropOneSegment: true, sparseAhead: '500' };
  assert.deepEqual(cakeArgs(on, data, 'down'), cakeArgs(data.form, data, 'down'));
});

test('the experimental settings’ choices and labels', () => {
  assert.deepEqual(sparseAheadChoices, ['', '100', '250', '500']);
  assert.deepEqual(
    sparseAheadChoices.map((v) => sparseAheadLabel(v)),
    ['Off (default)', 'Up to 100 µs ahead', 'Up to 250 µs ahead', 'Up to 500 µs ahead'],
  );
  assert.equal(sparseAheadLabel(0), 'Off (default)');
  assert.equal(sparseAheadLabel('750'), 'Up to 750 µs ahead');
});

test('the experimental settings against what sch_cake has now', () => {
  const loaded = { dropOneSegment: false, sparseAhead: 0, oneSegmentDrops: 0, loaded: true };
  // a parameter is missing only when sch_cake is loaded without it
  assert.equal(cakeParamMissing(null, { ...loaded, dropOneSegment: null }), true);
  assert.equal(cakeParamMissing(null, { dropOneSegment: null, sparseAhead: null, oneSegmentDrops: null, loaded: false }), false);
  assert.equal(cakeParamMissing(false, loaded), false);
  assert.equal(cakeParamMissing(undefined, undefined), false);
  // said only where they differ
  assert.equal(dropOneSegmentNow(false, loaded), undefined);
  assert.equal(dropOneSegmentNow(true, loaded), 'In use now: off.');
  assert.equal(dropOneSegmentNow(false, { ...loaded, dropOneSegment: true }), 'In use now: on.');
  assert.equal(dropOneSegmentNow(true, { ...loaded, dropOneSegment: null }), undefined);
  assert.equal(dropOneSegmentNow(true, undefined), undefined);
  assert.equal(sparseAheadNow('', loaded), undefined);
  assert.equal(sparseAheadNow('250', { ...loaded, sparseAhead: 250 }), undefined);
  assert.equal(sparseAheadNow('250', loaded), 'In use now: off.');
  assert.equal(sparseAheadNow('', { ...loaded, sparseAhead: 100 }), 'In use now: up to 100 µs ahead.');
  assert.equal(sparseAheadNow('250', { ...loaded, sparseAhead: null }), undefined);
});

test('fraglist GRO on the internet port now, from Performance Tuning’s status', () => {
  const port = (list: boolean | null): { now: { list: boolean | null } } => ({ now: { list } });
  assert.equal(fraglistNow(undefined), undefined);
  assert.equal(fraglistNow([]), false);
  assert.equal(fraglistNow([port(true)]), true);
  assert.equal(fraglistNow([port(false)]), false);
  assert.equal(fraglistNow([port(false), port(true)]), true);
  // ethtool didn't say: not known, so nothing is claimed
  assert.equal(fraglistNow([port(null)]), undefined);
  assert.equal(fraglistNow([port(false), port(null)]), undefined);
});

test('why dropping one packet of a group does nothing now: each reason its own line, both at once', () => {
  const split =
    'CAKE splits grouped packets up at this setting and speed, so there are no groups to drop from (Grouped packets, above).';
  const plain =
    'The internet port isn’t grouping with fraglist now, so this does nothing: change Receive grouping on Performance Tuning.';
  assert.deepEqual(dropOneSegmentIdle(true, true), []);
  assert.deepEqual(dropOneSegmentIdle(true, undefined), []);
  assert.deepEqual(dropOneSegmentIdle(false, true), [split]);
  assert.deepEqual(dropOneSegmentIdle(true, false), [plain]);
  assert.deepEqual(dropOneSegmentIdle(false, false), [split, plain]);
  assert.deepEqual(dropOneSegmentIdle(false, undefined), [split]);
});

test('what dropping one packet of a group has done: while on, or once it has dropped any', () => {
  const live = (
    n: number | null,
  ): { dropOneSegment: boolean; sparseAhead: number; oneSegmentDrops: number | null; loaded: boolean } => ({
    dropOneSegment: true,
    sparseAhead: 0,
    oneSegmentDrops: n,
    loaded: true,
  });
  assert.equal(oneSegmentDropsNow(true, live(0)), 'Dropped this way since Smart Queue started: 0 packets.');
  assert.equal(oneSegmentDropsNow(true, live(1)), 'Dropped this way since Smart Queue started: 1 packet.');
  assert.equal(oneSegmentDropsNow(true, live(12345)), 'Dropped this way since Smart Queue started: 12,345 packets.');
  // off: only once it has dropped some (turned off since)
  assert.equal(oneSegmentDropsNow(false, live(0)), undefined);
  assert.equal(oneSegmentDropsNow(false, live(7)), 'Dropped this way since Smart Queue started: 7 packets.');
  // without the counter, or before the router said
  assert.equal(oneSegmentDropsNow(true, live(null)), undefined);
  assert.equal(oneSegmentDropsNow(true, undefined), undefined);
});
