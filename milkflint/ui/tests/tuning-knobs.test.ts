// The Performance Tuning page's latency settings: read as the router's
// scripts read them, written back only where they differ from the default.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cakeTargetMs } from '../src/features/sqm/gso.ts';
import {
  AQL_OWN_TOTAL,
  aqlAutoTotal,
  aqlTotalError,
  aqlTotalOf,
  aqlTotalValue,
  ecnDropLabel,
  ecnNow,
  l4sLabel,
  l4sNow,
  type Get,
  knobDefaults,
  knobOptions,
  knobSectionsChanged,
  lanRpsNow,
  readKnobs,
  retriesLabel,
  rxDelayChoices,
  rxDelayOptions,
  switchNow,
  voAggrChoices,
  voAggrLabel,
  rxDelayLabel,
} from '../src/features/tuning/knobs.ts';

function getter(options: Record<string, string>): Get {
  return (section, option) => options[`${section}.${option}`];
}

test('nothing set is the image’s defaults, and writes nothing', () => {
  const k = readKnobs(getter({}));
  assert.deepEqual(k, knobDefaults);
  assert.deepEqual(knobOptions(k), {
    steering: {
      wifi_all: undefined,
      rings_rt: undefined,
      lan_rps: undefined,
      pdma_stag: undefined,
      dsa_gro: undefined,
      rx_delay: undefined,
      rx_dim_per_ring: undefined,
      qdma_tx_dim: undefined,
    },
    cake: { ecn_drop: undefined, l4s: undefined },
    wifi: { retries: undefined, vo_aggr: undefined },
  });
});

test('each setting read back as set', () => {
  const k = readKnobs(
    getter({
      'steering.wifi_all': '0',
      'steering.rings_rt': '0',
      'steering.rx_delay': '100',
      'cake.ecn_drop': '0',
      'cake.l4s': '0',
      'wifi.retries': '7',
    }),
  );
  assert.deepEqual(k, {
    ...knobDefaults,
    wifiAll: false,
    ringsRt: false,
    rxDelay: '100',
    ecnDrop: '0',
    l4s: '0',
    retries: '7',
  });
  assert.deepEqual(knobOptions(k), {
    steering: {
      wifi_all: '0',
      rings_rt: '0',
      lan_rps: undefined,
      pdma_stag: undefined,
      dsa_gro: undefined,
      rx_delay: '100',
      rx_dim_per_ring: undefined,
      qdma_tx_dim: undefined,
    },
    cake: { ecn_drop: '0', l4s: '0' },
    wifi: { retries: '7', vo_aggr: undefined },
  });
});

test('no limit on the interrupt delay is 0, and stays set', () => {
  const k = readKnobs(getter({ 'steering.rx_delay': '0' }));
  assert.equal(k.rxDelay, '0');
  assert.equal(knobOptions(k).steering.rx_delay, '0');
  assert.equal(rxDelayLabel('0'), 'No limit (up to 260 µs)');
});

test('values the scripts would ignore read as the default', () => {
  for (const v of ['', 'abc', '-5', '1001', '80', '12345']) {
    assert.equal(readKnobs(getter({ 'steering.rx_delay': v })).rxDelay, '', `rx_delay ${v}`);
  }
  for (const v of ['0', '32', '15', 'x', '']) {
    assert.equal(readKnobs(getter({ 'wifi.retries': v })).retries, '', `retries ${v}`);
  }
  // only "0" turns a switch off, as in the scripts
  for (const v of ['1', 'no', 'off', '']) {
    const k = readKnobs(getter({ 'steering.wifi_all': v, 'steering.rings_rt': v, 'cake.ecn_drop': v, 'cake.l4s': v }));
    assert.equal(k.wifiAll && k.ringsRt, true, v);
    assert.equal(k.l4s, '', v);
    assert.equal(k.ecnDrop, '', v);
  }
  // ECN drops: 8 to 65535 or 0, as cake-ecn takes them
  for (const v of ['7', '8', '65536', '1234567', '-1', '2.5']) {
    assert.equal(readKnobs(getter({ 'cake.ecn_drop': v })).ecnDrop, '', `ecn_drop ${v}`);
  }
});

test('leading zeros are written as the number', () => {
  assert.equal(readKnobs(getter({ 'steering.rx_delay': '060' })).rxDelay, '60');
  assert.equal(readKnobs(getter({ 'wifi.retries': '07' })).retries, '7');
  assert.equal(readKnobs(getter({ 'cake.ecn_drop': '064' })).ecnDrop, '64');
  assert.equal(readKnobs(getter({ 'cake.ecn_drop': '00' })).ecnDrop, '0');
});

test('only the sections whose options differ are changed', () => {
  assert.deepEqual([...knobSectionsChanged(knobDefaults, knobDefaults)], []);
  assert.deepEqual([...knobSectionsChanged(knobDefaults, { ...knobDefaults, ecnDrop: '0' })], ['cake']);
  assert.deepEqual([...knobSectionsChanged(knobDefaults, { ...knobDefaults, l4s: '0' })], ['cake']);
  assert.deepEqual([...knobSectionsChanged(knobDefaults, { ...knobDefaults, l4s: '60' })], ['cake']);
  assert.deepEqual([...knobSectionsChanged(knobDefaults, { ...knobDefaults, ecnDrop: '256' })], ['cake']);
  assert.deepEqual([...knobSectionsChanged(knobDefaults, { ...knobDefaults, retries: '4' })], ['wifi']);
  assert.deepEqual([...knobSectionsChanged(knobDefaults, { ...knobDefaults, wifiAll: false, rxDelay: '20' })].sort(), [
    'steering',
  ]);
});

test('labels for the choices and for what the drivers report now', () => {
  assert.equal(rxDelayLabel(''), '80 µs');
  assert.equal(rxDelayLabel(160), '160 µs');
  assert.equal(retriesLabel(''), '15 sends');
  assert.equal(retriesLabel(1), '1 send');
  assert.equal(l4sNow(null, false, 5), 'Smart Queue hasn’t run since the router started');
  assert.equal(l4sNow(null, true, 5), 'Not in this image');
  assert.equal(l4sNow(0, true, 5), 'Only CAKE’s classic marks (as CAKE upstream)');
  assert.equal(l4sNow(100, true, 5), 'From 5 ms, every packet by 10 ms');
  assert.equal(l4sNow(60, true, 2.5), 'From 1.5 ms, every packet by 3 ms');
  assert.equal(l4sLabel('', 5), 'From 5 ms, every packet by 10 ms');
  assert.equal(l4sLabel('200', 5), 'From 10 ms, every packet by 20 ms');
  assert.equal(l4sLabel('0', 5), 'Off: only CAKE’s classic marks');
  assert.equal(l4sLabel('', null), 'From 100% of Smart Queue’s target, every packet by twice that');
  assert.equal(ecnNow(null, false), 'Smart Queue hasn’t run since the router started');
  assert.equal(ecnNow(null, true), 'Not in this image');
  assert.equal(ecnNow(0, true), 'Marks every ECN download (as CAKE upstream)');
  assert.equal(ecnNow(16, true), 'Drops from ECN downloads after 16 ignored marks (about 0.8 s)');
  assert.equal(ecnNow(256, true), 'Drops from ECN downloads after 256 ignored marks (about 3.2 s)');
  assert.equal(ecnDropLabel(''), 'After 8 ignored marks, about 0.6 s');
  assert.equal(ecnDropLabel('16'), 'After 16 ignored marks, about 0.8 s');
  assert.equal(ecnDropLabel('64'), 'After 64 ignored marks, about 1.6 s');
  assert.equal(ecnDropLabel('8'), 'After 8 ignored marks, about 0.6 s');
  assert.equal(ecnDropLabel('0'), 'Never: always marks');
  assert.equal(ecnDropLabel(65535), 'After 65535 ignored marks, about 51 s');
});

test('a chosen ECN drop count is written, the default is not', () => {
  assert.equal(knobOptions({ ...knobDefaults, ecnDrop: '256' }).cake.ecn_drop, '256');
  assert.equal(knobOptions({ ...knobDefaults, ecnDrop: '0' }).cake.ecn_drop, '0');
  assert.equal(knobOptions(knobDefaults).cake.ecn_drop, undefined);
  assert.equal(readKnobs(getter({ 'cake.ecn_drop': '256' })).ecnDrop, '256');
  assert.equal(readKnobs(getter({ 'cake.ecn_drop': '16' })).ecnDrop, '16');
});

test('cake.l4s: read as cake-ecn reads it', () => {
  const l4s = (v: string | undefined): string => readKnobs(getter(v === undefined ? {} : { 'cake.l4s': v })).l4s;
  assert.equal(l4s(undefined), '');
  assert.equal(l4s('0'), '0');
  assert.equal(l4s('00'), '0');
  assert.equal(l4s('100'), '');
  assert.equal(l4s('060'), '60');
  assert.equal(l4s('20'), '20');
  assert.equal(l4s('400'), '400');
  for (const v of ['19', '401', '1234567', '-1', 'off', '']) assert.equal(l4s(v), '', v);
  assert.equal(knobOptions({ ...knobDefaults, l4s: '60' }).cake.l4s, '60');
  assert.equal(knobOptions({ ...knobDefaults, l4s: '0' }).cake.l4s, '0');
  assert.equal(knobOptions(knobDefaults).cake.l4s, undefined);
});

test('the Wi-Fi queue total: its value, the automatic one and what is wrong with it', () => {
  assert.deepEqual(aqlTotalOf(undefined), { aqlTotal: 'auto', aqlTotalCustom: '' });
  assert.deepEqual(aqlTotalOf('junk'), { aqlTotal: 'auto', aqlTotalCustom: '' });
  assert.deepEqual(aqlTotalOf('24000'), { aqlTotal: 'own', aqlTotalCustom: '' });
  assert.deepEqual(aqlTotalOf('08000'), { aqlTotal: 'custom', aqlTotalCustom: '8000' });
  assert.equal(aqlTotalValue('auto', ''), undefined);
  assert.equal(aqlTotalValue('own', ''), String(AQL_OWN_TOTAL));
  assert.equal(aqlTotalValue('custom', '08000'), '8000');
  assert.equal(aqlAutoTotal(5000, false), 6000);
  assert.equal(aqlAutoTotal(8000, false), 9600);
  assert.equal(aqlAutoTotal(12_000, true), AQL_OWN_TOTAL);
  assert.equal(aqlTotalError('auto', '', 5000), undefined);
  assert.equal(aqlTotalError('own', '', 5000), undefined);
  assert.notEqual(aqlTotalError('own', '', 30_000), undefined);
  assert.equal(aqlTotalError('custom', '5000', 5000), undefined);
  assert.equal(aqlTotalError('custom', '50000', 5000), undefined);
  assert.notEqual(aqlTotalError('custom', '4999', 5000), undefined);
  assert.notEqual(aqlTotalError('custom', '50001', 5000), undefined);
  assert.notEqual(aqlTotalError('custom', '', 5000), undefined);
  assert.notEqual(aqlTotalError('custom', 'abc', 5000), undefined);
  // a custom high limit still being typed
  assert.equal(aqlTotalError('auto', '', Number.NaN), undefined);
});

test('CAKE target from its options', () => {
  assert.equal(cakeTargetMs(undefined), 5);
  assert.equal(cakeTargetMs('no-split-gso'), 5);
  assert.equal(cakeTargetMs('no-split-gso rtt 50ms'), 2.5);
  assert.equal(cakeTargetMs('rtt 1s'), 50);
  assert.equal(cakeTargetMs('rtt 300000us'), 15);
  assert.equal(cakeTargetMs('oceanic'), 15);
  assert.equal(cakeTargetMs('rtt nonsense'), null);
  assert.equal(cakeTargetMs('rtt 50'), null);
});

test('voice queue aggregation: unset is on, and only 0 is anything else', () => {
  assert.equal(knobDefaults.voAggr, '');
  assert.equal(readKnobs(getter({})).voAggr, '');
  assert.equal(readKnobs(getter({ 'wifi.vo_aggr': '0' })).voAggr, '0');
  for (const v of ['1', '2', 'on', 'off', '']) assert.equal(readKnobs(getter({ 'wifi.vo_aggr': v })).voAggr, '', v);
});

test('voice queue aggregation: what each choice writes, in the Wi-Fi section', () => {
  assert.equal(knobOptions({ ...knobDefaults, voAggr: '' }).wifi.vo_aggr, undefined);
  assert.equal(knobOptions({ ...knobDefaults, voAggr: '0' }).wifi.vo_aggr, '0');
  assert.deepEqual([...knobSectionsChanged(knobDefaults, { ...knobDefaults, voAggr: '0' })], ['wifi']);
  assert.deepEqual([...knobSectionsChanged({ ...knobDefaults, voAggr: '0' }, { ...knobDefaults, voAggr: '0' })], []);
});

test('voice queue aggregation: the choices and their labels', () => {
  assert.deepEqual(voAggrChoices, ['', '0']);
  assert.equal(voAggrLabel(''), 'On (default)');
  assert.equal(voAggrLabel('0'), 'Off, as stock OpenWrt');
});

test('the experimental Ethernet switches: unset is off, only "1" is on, and on writes "1"', () => {
  assert.equal(knobDefaults.lanRps || knobDefaults.rxDimPerRing || knobDefaults.qdmaTxDim, false);
  const k = readKnobs(getter({ 'steering.lan_rps': '1', 'steering.rx_dim_per_ring': '1', 'steering.qdma_tx_dim': '1' }));
  assert.deepEqual([k.lanRps, k.rxDimPerRing, k.qdmaTxDim], [true, true, true]);
  const o = knobOptions(k).steering;
  assert.deepEqual([o.lan_rps, o.rx_dim_per_ring, o.qdma_tx_dim], ['1', '1', '1']);
  // as packet-steering.sh and eth-dim take them: anything but "1" is off
  for (const v of ['0', 'Y', 'yes', 'on', '01', '1 ', '']) {
    const j = readKnobs(getter({ 'steering.lan_rps': v, 'steering.rx_dim_per_ring': v, 'steering.qdma_tx_dim': v }));
    assert.deepEqual([j.lanRps, j.rxDimPerRing, j.qdmaTxDim], [false, false, false], v);
  }
  // off is unset, not "0"
  const off = knobOptions(knobDefaults).steering;
  assert.deepEqual([off.lan_rps, off.rx_dim_per_ring, off.qdma_tx_dim], [undefined, undefined, undefined]);
});

test('the experimental Ethernet switches change the steering section only', () => {
  for (const key of ['lanRps', 'rxDimPerRing', 'qdmaTxDim'] as const) {
    assert.deepEqual([...knobSectionsChanged(knobDefaults, { ...knobDefaults, [key]: true })], ['steering'], key);
    assert.deepEqual([...knobSectionsChanged({ ...knobDefaults, [key]: true }, { ...knobDefaults, [key]: true })], [], key);
  }
});

test('the experimental settings’ live readings', () => {
  assert.equal(switchNow(null), 'Not in this image');
  assert.equal(switchNow(true), 'On');
  assert.equal(switchNow(false), 'Off');
  assert.equal(lanRpsNow(null), 'No switch port in this image');
  assert.equal(lanRpsNow([]), 'Stays on the CPU it arrives on');
  assert.equal(lanRpsNow([1, 2, 3]), 'Handed on to CPUs 1–3');
  assert.equal(lanRpsNow([2]), 'Handed on to CPU 2');
  assert.equal(lanRpsNow([0, 2, 3]), 'Handed on to CPUs 0, 2–3');
});

test('the receive interrupt delays offered: 80 (the default), 40 to 160 µs in steps the hardware keeps, and no limit', () => {
  assert.deepEqual(rxDelayChoices, ['', '40', '60', '100', '140', '160', '0']);
  assert.ok(!rxDelayChoices.includes('20'));
  // each one a multiple of the hardware's 20 µs step
  for (const v of rxDelayChoices) assert.equal(Number(v === '' ? 80 : v) % 20, 0, v);
  assert.deepEqual(
    rxDelayChoices.map((v) => rxDelayLabel(v)),
    ['80 µs', '40 µs', '60 µs', '100 µs', '140 µs', '160 µs', 'No limit (up to 260 µs)'],
  );
  // every choice reads back as itself, and the default as unset
  for (const v of rxDelayChoices) {
    const k = readKnobs(getter(v === '' ? {} : { 'steering.rx_delay': v }));
    assert.equal(k.rxDelay, v, v);
    assert.equal(knobOptions(k).steering.rx_delay, v === '' ? undefined : v, v);
  }
});

test('a receive interrupt delay the page no longer offers is kept, and stays a choice until it’s changed', () => {
  // 20 µs, offered before, saved on a router
  const k = readKnobs(getter({ 'steering.rx_delay': '20' }));
  assert.equal(k.rxDelay, '20');
  assert.equal(knobOptions(k).steering.rx_delay, '20');
  assert.equal(rxDelayLabel(k.rxDelay), '20 µs');
  assert.deepEqual(rxDelayOptions('20', '20'), [...rxDelayChoices, '20']);
  // still offered while another is picked but not yet saved, so it can be picked back
  assert.deepEqual(rxDelayOptions('20', '60'), [...rxDelayChoices, '20']);
  // and one set by hand in uci
  assert.deepEqual(rxDelayOptions('20', '120'), [...rxDelayChoices, '20', '120']);
  assert.deepEqual(rxDelayOptions('', ''), rxDelayChoices);
  assert.deepEqual(rxDelayOptions('160', '0'), rxDelayChoices);
  // saving another leaves the knobs' steering section alone otherwise
  assert.deepEqual([...knobSectionsChanged(k, { ...k, rxDelay: '' })], ['steering']);
});

test('the switch tag and one-pass grouping: unset is off, only "1" (as packet-steering.sh takes them) is on, and on writes "1"', () => {
  assert.equal(knobDefaults.pdmaStag || knobDefaults.dsaGro, false);
  const k = readKnobs(getter({ 'steering.pdma_stag': '1', 'steering.dsa_gro': '1' }));
  assert.deepEqual([k.pdmaStag, k.dsaGro], [true, true]);
  // each on its own, the other left off
  assert.deepEqual(readKnobs(getter({ 'steering.pdma_stag': '1' })), { ...knobDefaults, pdmaStag: true });
  assert.deepEqual(readKnobs(getter({ 'steering.dsa_gro': '1' })), { ...knobDefaults, dsaGro: true });
  const o = knobOptions(k).steering;
  assert.deepEqual([o.pdma_stag, o.dsa_gro], ['1', '1']);
  // only these two of the steering section
  assert.deepEqual(o, { ...knobOptions(knobDefaults).steering, pdma_stag: '1', dsa_gro: '1' });
  for (const v of ['0', 'Y', 'yes', 'on', '01', '1 ', '1; reboot', '']) {
    const j = readKnobs(getter({ 'steering.pdma_stag': v, 'steering.dsa_gro': v }));
    assert.deepEqual([j.pdmaStag, j.dsaGro], [false, false], v);
  }
  // off is unset, not "0"
  const off = knobOptions(knobDefaults).steering;
  assert.deepEqual([off.pdma_stag, off.dsa_gro], [undefined, undefined]);
});

test('the switch tag and one-pass grouping change the steering section only', () => {
  for (const key of ['pdmaStag', 'dsaGro'] as const) {
    assert.deepEqual([...knobSectionsChanged(knobDefaults, { ...knobDefaults, [key]: true })], ['steering'], key);
    assert.deepEqual([...knobSectionsChanged({ ...knobDefaults, [key]: true }, knobDefaults)], ['steering'], key);
    assert.deepEqual([...knobSectionsChanged({ ...knobDefaults, [key]: true }, { ...knobDefaults, [key]: true })], [], key);
  }
  // nor does one stand in for the other, or for the LAN ports' RPS
  const both = { ...knobDefaults, pdmaStag: true, dsaGro: true };
  assert.deepEqual([...knobSectionsChanged(both, { ...both, lanRps: true })], ['steering']);
  assert.deepEqual(
    [...knobSectionsChanged({ ...knobDefaults, pdmaStag: true }, { ...knobDefaults, dsaGro: true })],
    ['steering'],
  );
});
