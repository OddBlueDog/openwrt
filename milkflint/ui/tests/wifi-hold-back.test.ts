// The Radios & SSIDs page's hold-back period (the MU EDCA timers of a Wi-Fi 6
// radio): which of the two choices a radio's options amount to, and what a
// choice writes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HOLD_BACK_LABELS,
  HOLD_BACK_OPTIONS,
  holdBackChoices,
  holdBackHint,
  holdBackOf,
  holdBackValues,
} from '../src/features/wifi/hold-back.ts';

test('hold-back: what a radio has, from its four timers', () => {
  // the shortest on every kind of traffic, as first boot sets it
  assert.equal(holdBackOf(['1', '1', '1', '1']), 'short');
  // OpenWrt's own: unset, or its value written out, or a mix of the two
  assert.equal(holdBackOf([undefined, undefined, undefined, undefined]), 'openwrt');
  assert.equal(holdBackOf(['255', '255', '255', '255']), 'openwrt');
  assert.equal(holdBackOf(['255', undefined, '255', undefined]), 'openwrt');
  // anything else was set outside the page
  assert.equal(holdBackOf(['1', '1', '1', '20']), 'custom');
  assert.equal(holdBackOf(['1', undefined, '1', '1']), 'custom');
  assert.equal(holdBackOf(['8', '8', '8', '8']), 'custom');
});

test('hold-back: what a choice writes', () => {
  assert.deepEqual(HOLD_BACK_OPTIONS, ['he_mu_edca_ac_be_timer', 'he_mu_edca_ac_bk_timer', 'he_mu_edca_ac_vi_timer', 'he_mu_edca_ac_vo_timer']);
  // the shortest: all four set
  assert.deepEqual(holdBackValues('short'), {
    he_mu_edca_ac_be_timer: '1',
    he_mu_edca_ac_bk_timer: '1',
    he_mu_edca_ac_vi_timer: '1',
    he_mu_edca_ac_vo_timer: '1',
  });
  // OpenWrt's own: all four unset, left to OpenWrt
  const own = holdBackValues('openwrt');
  assert.deepEqual(Object.keys(own ?? {}), [...HOLD_BACK_OPTIONS]);
  assert.ok(Object.values(own ?? { x: '' }).every((v) => v === undefined));
  // what was set elsewhere is never written
  assert.equal(holdBackValues('custom'), undefined);
  // a choice reads back as itself
  assert.equal(holdBackOf(HOLD_BACK_OPTIONS.map((o) => holdBackValues('short')?.[o])), 'short');
  assert.equal(holdBackOf(HOLD_BACK_OPTIONS.map((o) => holdBackValues('openwrt')?.[o])), 'openwrt');
});

test('hold-back: the choices offered and their words', () => {
  assert.deepEqual(holdBackChoices('short'), ['short', 'openwrt']);
  assert.deepEqual(holdBackChoices('openwrt'), ['short', 'openwrt']);
  // what's set now is always among them
  assert.deepEqual(holdBackChoices('custom'), ['short', 'openwrt', 'custom']);
  assert.match(HOLD_BACK_LABELS.short, /8 ms/);
  assert.match(HOLD_BACK_LABELS.openwrt, /OpenWrt.*2 seconds/);
  for (const h of ['short', 'openwrt', 'custom'] as const) {
    assert.match(holdBackHint(h), /restarts this band/);
    assert.notEqual(HOLD_BACK_LABELS[h], '');
  }
});
