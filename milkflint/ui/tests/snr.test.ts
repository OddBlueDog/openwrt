import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stationSnr } from '@/lib/api/wireless';
import { snrOf } from '@/lib/snr';

test('SNR: how far the signal stands above the noise, when both are known', () => {
  assert.equal(snrOf(-62, -93), 31);
  assert.equal(snrOf(-54.4, -91.6), 37);
  // a driver without a noise figure says 0
  assert.equal(snrOf(-62, 0), undefined);
  assert.equal(snrOf(-62, undefined), undefined);
  assert.equal(snrOf(undefined, -93), undefined);
  assert.equal(snrOf(-95, -93), undefined);
  assert.equal(snrOf(Number.NaN, -93), undefined);
});

test('SNR: a station’s own noise first, else its radio’s', () => {
  assert.equal(stationSnr({ mac: 'aa', signal: -60, signal_avg: -62, noise: -91 }, -95), 29);
  assert.equal(stationSnr({ mac: 'aa', signal: -60, noise: 0 }, -95), 35);
  assert.equal(stationSnr({ mac: 'aa', signal: -60 }, undefined), undefined);
  assert.equal(stationSnr({ mac: 'aa' }, -95), undefined);
});
