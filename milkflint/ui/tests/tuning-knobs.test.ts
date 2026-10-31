// The Performance Tuning page's latency settings: read as the router's
// scripts read them, written back only where they differ from the default.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ecnNow,
  type Get,
  knobDefaults,
  knobOptions,
  knobSectionsChanged,
  readKnobs,
  retriesLabel,
  rxDelayLabel,
} from '../src/features/tuning/knobs.ts';

function getter(options: Record<string, string>): Get {
  return (section, option) => options[`${section}.${option}`];
}

test('nothing set is the image’s defaults, and writes nothing', () => {
  const k = readKnobs(getter({}));
  assert.deepEqual(k, knobDefaults);
  assert.deepEqual(knobOptions(k), {
    steering: { wifi_all: undefined, rings_rt: undefined, rx_delay: undefined },
    cake: { ecn_drop: undefined },
    wifi: { retries: undefined },
  });
});

test('each setting read back as set', () => {
  const k = readKnobs(
    getter({ 'steering.wifi_all': '0', 'steering.rings_rt': '0', 'steering.rx_delay': '80', 'cake.ecn_drop': '0', 'wifi.retries': '7' }),
  );
  assert.deepEqual(k, { wifiAll: false, ringsRt: false, rxDelay: '80', ecnDrop: false, retries: '7' });
  assert.deepEqual(knobOptions(k), {
    steering: { wifi_all: '0', rings_rt: '0', rx_delay: '80' },
    cake: { ecn_drop: '0' },
    wifi: { retries: '7' },
  });
});

test('no limit on the interrupt delay is 0, and stays set', () => {
  const k = readKnobs(getter({ 'steering.rx_delay': '0' }));
  assert.equal(k.rxDelay, '0');
  assert.equal(knobOptions(k).steering.rx_delay, '0');
  assert.equal(rxDelayLabel('0'), 'No limit (up to 260 µs)');
});

test('values the scripts would ignore read as the default', () => {
  for (const v of ['', 'abc', '-5', '1001', '40', '12345']) {
    assert.equal(readKnobs(getter({ 'steering.rx_delay': v })).rxDelay, '', `rx_delay ${v}`);
  }
  for (const v of ['0', '32', '15', 'x', '']) {
    assert.equal(readKnobs(getter({ 'wifi.retries': v })).retries, '', `retries ${v}`);
  }
  // only "0" turns a switch off, as in the scripts
  for (const v of ['1', 'no', 'off', '']) {
    const k = readKnobs(getter({ 'steering.wifi_all': v, 'steering.rings_rt': v, 'cake.ecn_drop': v }));
    assert.equal(k.wifiAll && k.ringsRt && k.ecnDrop, true, v);
  }
});

test('leading zeros are written as the number', () => {
  assert.equal(readKnobs(getter({ 'steering.rx_delay': '080' })).rxDelay, '80');
  assert.equal(readKnobs(getter({ 'wifi.retries': '07' })).retries, '7');
});

test('only the sections whose options differ are changed', () => {
  assert.deepEqual([...knobSectionsChanged(knobDefaults, knobDefaults)], []);
  assert.deepEqual([...knobSectionsChanged(knobDefaults, { ...knobDefaults, ecnDrop: false })], ['cake']);
  assert.deepEqual([...knobSectionsChanged(knobDefaults, { ...knobDefaults, retries: '4' })], ['wifi']);
  assert.deepEqual(
    [...knobSectionsChanged(knobDefaults, { ...knobDefaults, wifiAll: false, rxDelay: '20' })].sort(),
    ['steering'],
  );
});

test('labels for the choices and for what the drivers report now', () => {
  assert.equal(rxDelayLabel(''), '40 µs');
  assert.equal(rxDelayLabel(160), '160 µs');
  assert.equal(retriesLabel(''), '15 sends');
  assert.equal(retriesLabel(1), '1 send');
  assert.equal(ecnNow(null, false), 'Smart Queue hasn’t run since the router started');
  assert.equal(ecnNow(null, true), 'Not in this image');
  assert.equal(ecnNow(0, true), 'Marks every ECN download (as CAKE upstream)');
  assert.equal(ecnNow(256, true), 'Drops ECN downloads that ignore the marks');
});
