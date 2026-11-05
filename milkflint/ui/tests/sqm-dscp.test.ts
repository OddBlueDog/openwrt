// What the Smart Queue page writes to sqm for downloads' restored DSCP.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sqmDscpOptions } from '../src/features/sqm/dscp.ts';

test('on: CAKE has to wash, and with layer_cake have tins on the download', () => {
  assert.deepEqual(sqmDscpOptions(true, true, false), { set: { squash_ingress: '0' }, unset: ['squash_dscp'] });
  assert.deepEqual(sqmDscpOptions(true, false, false), { set: {}, unset: ['squash_dscp', 'squash_ingress'] });
});

test('switching layer_cake off with it on takes the tins back', () => {
  assert.deepEqual(sqmDscpOptions(true, false, true).unset, ['squash_dscp', 'squash_ingress']);
});

test('off: what on set goes, and with it off all along nothing set in LuCI is touched', () => {
  assert.deepEqual(sqmDscpOptions(false, true, true), { set: {}, unset: ['squash_ingress'] });
  assert.deepEqual(sqmDscpOptions(false, true, false), { set: {}, unset: [] });
  assert.deepEqual(sqmDscpOptions(false, false, false), { set: {}, unset: [] });
});
