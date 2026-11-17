// Rates in words: on their own, and against a limit with the unit said once.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shapingShare } from '@/features/dashboard/model';
import { formatBitrate, formatBitrateOf } from '@/lib/format';

test('a rate takes the largest unit it reaches one of, at most a decimal under 100', () => {
  assert.equal(formatBitrate(0), '0 bit/s');
  assert.equal(formatBitrate(999), '999 bit/s');
  assert.equal(formatBitrate(4_100), '4.1 kbit/s');
  assert.equal(formatBitrate(21_000_000), '21 Mbit/s');
  assert.equal(formatBitrate(312_000_000), '312 Mbit/s');
  assert.equal(formatBitrate(2_400_000_000), '2.4 Gbit/s');
  assert.equal(formatBitrate(5e12), '5,000 Gbit/s');
});

test('a rate against its limit is said in the limit’s unit, once', () => {
  assert.equal(formatBitrateOf(312_000_000, 825_000_000), '312 of 825 Mbit/s');
  assert.equal(formatBitrateOf(21_400_000, 45_000_000), '21.4 of 45 Mbit/s');
  // an idle line: little of a large unit, not another unit beside it
  assert.equal(formatBitrateOf(300_000, 825_000_000), '0.3 of 825 Mbit/s');
  assert.equal(formatBitrateOf(0, 825_000_000), '0 of 825 Mbit/s');
  // over the limit for a moment (a burst between two readings)
  assert.equal(formatBitrateOf(1_200_000_000, 950_000_000), '1,200 of 950 Mbit/s');
  assert.equal(formatBitrateOf(400_000, 800_000), '400 of 800 kbit/s');
});

test('Smart Queue’s share of its limit: none without a rate or a limit', () => {
  assert.equal(shapingShare({ rate: 250e6, bandwidth: 500e6 }), 0.5);
  assert.equal(shapingShare({ rate: 600e6, bandwidth: 500e6 }), 1.2);
  assert.equal(shapingShare({ rate: undefined, bandwidth: 500e6 }), 0);
  assert.equal(shapingShare({ rate: 250e6, bandwidth: undefined }), 0);
  assert.equal(shapingShare({ rate: 250e6, bandwidth: 0 }), 0);
  assert.equal(shapingShare(undefined), 0);
});
