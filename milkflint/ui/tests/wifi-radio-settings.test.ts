// The Radios & SSIDs page's spatial reuse and QoS map settings: what each choice
// writes, and that the page reads back what it wrote.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OPENWRT_QOS_MAP, qosMapChoice, qosMapValue } from '../src/features/wifi/qos-map.ts';
import {
  SPR_DEFAULT_THRESHOLD,
  SPR_THRESHOLDS,
  type SprMode,
  sprDriverMode,
  sprModes,
  sprNow,
  sprOf,
  sprOption,
  sprRadioOptions,
  sprThresholdLabel,
} from '../src/features/wifi/spatial-reuse.ts';

test('spatial reuse: unset is automatic, OpenWrt’s default', () => {
  assert.deepEqual(sprOf(undefined, undefined, undefined), { mode: 'auto', threshold: SPR_DEFAULT_THRESHOLD });
  assert.deepEqual(sprRadioOptions({ mode: 'auto', threshold: -72 }), {
    he_spr_sr_control: undefined,
    he_spr_non_srg_obss_pd_max_offset: undefined,
  });
  assert.equal(sprDriverMode({ mode: 'auto', threshold: -72 }), undefined);
});

test('spatial reuse: devices are let in with sr_control 0, which wifi-scripts turns into offset present, parametrized off', () => {
  assert.deepEqual(sprRadioOptions({ mode: 'devices', threshold: -72 }), {
    he_spr_sr_control: '0',
    he_spr_non_srg_obss_pd_max_offset: '10',
  });
  assert.deepEqual(sprRadioOptions({ mode: 'fixed', threshold: -62 }), {
    he_spr_sr_control: '0',
    he_spr_non_srg_obss_pd_max_offset: '20',
  });
});

test('spatial reuse: the driver’s mode is only set for fixed and off', () => {
  assert.equal(sprDriverMode({ mode: 'fixed', threshold: -72 }), 'fixed');
  assert.equal(sprDriverMode({ mode: 'off', threshold: -72 }), 'off');
  assert.equal(sprDriverMode({ mode: 'devices', threshold: -72 }), undefined);
  assert.equal(sprOption('5g'), 'spr_5g');
});

test('spatial reuse: off tells devices no as well, the radio’s two options unset', () => {
  assert.deepEqual(sprRadioOptions({ mode: 'off', threshold: -72 }), {
    he_spr_sr_control: undefined,
    he_spr_non_srg_obss_pd_max_offset: undefined,
  });
});

test('spatial reuse: every choice reads back as itself', () => {
  for (const threshold of SPR_THRESHOLDS) {
    for (const mode of ['auto', 'devices', 'fixed', 'off'] as SprMode[]) {
      const opts = sprRadioOptions({ mode, threshold });
      const back = sprOf(opts['he_spr_sr_control'], opts['he_spr_non_srg_obss_pd_max_offset'], sprDriverMode({ mode, threshold }));
      assert.equal(back.mode, mode, `${mode} ${String(threshold)}`);
      if (mode === 'devices' || mode === 'fixed') assert.equal(back.threshold, threshold);
    }
  }
});

test('spatial reuse: what was set some other way is left alone', () => {
  // OpenWrt's default written out, a value of its own, an offset alone
  for (const [control, offset] of [
    ['3', undefined],
    ['16', undefined],
    [undefined, '10'],
    ['3', '10'],
  ] as const) {
    const s = sprOf(control, offset, undefined);
    assert.equal(s.mode, 'custom', `${String(control)} ${String(offset)}`);
    assert.deepEqual(sprRadioOptions(s), {});
    assert.equal(sprDriverMode(s), undefined);
  }
});

test('spatial reuse: a driver mode without the options that go with it is not fixed', () => {
  assert.equal(sprOf(undefined, undefined, 'fixed').mode, 'auto');
  assert.equal(sprOf('0', '10', 'off').mode, 'devices');
  assert.equal(sprOf(undefined, undefined, 'nonsense').mode, 'auto');
});

test('spatial reuse: an offset outside the standard’s 0 to 20 falls back to the default threshold', () => {
  assert.equal(sprOf('0', '21', undefined).threshold, SPR_DEFAULT_THRESHOLD);
  assert.equal(sprOf('0', 'x', undefined).threshold, SPR_DEFAULT_THRESHOLD);
  assert.equal(sprOf('0', '0', undefined).threshold, -82);
});

test('spatial reuse: a driver without the setting only has the choices hostapd makes', () => {
  assert.deepEqual(sprModes(false), ['auto', 'devices']);
  assert.deepEqual(sprModes(true), ['auto', 'devices', 'fixed', 'off']);
});

test('spatial reuse: the threshold labels', () => {
  assert.equal(sprThresholdLabel(-77), '-77 dBm (cautious)');
  assert.equal(sprThresholdLabel(-72), '-72 dBm');
  assert.equal(sprThresholdLabel(-62), '-62 dBm (most reuse)');
});

test('spatial reuse: what’s in use now, as the router reports it', () => {
  const now = (mode: string | null, control: number | null, offset: number | null) => ({ running: true, mode, control, offset });
  assert.equal(sprNow(undefined), '');
  assert.equal(sprNow({ running: false, mode: 'auto', control: null, offset: null }), '');
  assert.equal(sprNow(now('auto', 3, null)), 'In use now: radio the firmware’s choice, devices not allowed.');
  assert.equal(sprNow(now('auto', 5, 10)), 'In use now: radio the firmware’s choice, devices allowed up to -72 dBm.');
  assert.equal(sprNow(now('fixed', 5, 20)), 'In use now: radio a fixed threshold, devices allowed up to -62 dBm.');
  assert.equal(sprNow(now('off', 3, null)), 'In use now: radio off, devices not allowed.');
  assert.equal(sprNow(now(null, 1, null)), 'In use now: radio the firmware’s choice, devices allowed.');
  assert.equal(sprNow(now('auto', null, null)), 'In use now: radio the firmware’s choice, devices free to choose.');
});

test('QoS map: unset is the image’s, OpenWrt’s by its value, anything else left alone', () => {
  assert.equal(qosMapChoice(''), 'edge');
  assert.equal(qosMapChoice(OPENWRT_QOS_MAP), 'openwrt');
  assert.equal(qosMapChoice('0,7,0,63,255,255,255,255,255,255,255,255,255,255,255,255,255,255'), 'custom');
  assert.equal(qosMapValue('edge'), undefined);
  assert.equal(qosMapValue('openwrt'), OPENWRT_QOS_MAP);
});
