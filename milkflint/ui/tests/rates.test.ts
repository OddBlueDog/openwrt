import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MIN_RATE_SECONDS, rate, ratesBetween, type ByteSample } from '@/lib/rates';

const at = (kind: ByteSample['kind'], down: number, up: number, ms: number): ByteSample => ({ kind, down, up, at: ms });

test('rate: bytes over seconds in bit/s; too short an interval or a falling counter gives nothing', () => {
  assert.equal(rate(0, 1000, 1), 8000);
  assert.equal(MIN_RATE_SECONDS, 0.5);
  assert.equal(rate(0, 1000, 0.4), undefined);
  assert.equal(rate(2000, 1000, 1), undefined);
  assert.equal(rate(undefined, 1000, 1), undefined);
  assert.equal(rate(0, undefined, 1), undefined);
});

test('ratesBetween: two samples of one kind', () => {
  const got = ratesBetween(at('wifi', 0, 0, 0), at('wifi', 2_000_000, 1_000_000, 2000), false);
  assert.deepEqual(got, { down: 8_000_000, up: 4_000_000 });
});

test('ratesBetween: no earlier sample gives nothing', () => {
  assert.deepEqual(ratesBetween(undefined, at('wifi', 5, 5, 2000), false), {});
});

test('ratesBetween: a move from Wi-Fi to wired (or back) gives nothing, not a spike', () => {
  assert.deepEqual(ratesBetween(at('wifi', 9e9, 9e9, 0), at('wired', 100, 100, 5000), true), {});
  assert.deepEqual(ratesBetween(at('wired', 100, 100, 0), at('wifi', 9e9, 9e9, 5000), false), {});
});

test('ratesBetween: wired sums that fall (a connection ended) floor at zero; Wi-Fi counters that fall give nothing', () => {
  assert.deepEqual(ratesBetween(at('wired', 5000, 5000, 0), at('wired', 100, 100, 5000), true), { down: 0, up: 0 });
  assert.deepEqual(ratesBetween(at('wifi', 5000, 5000, 0), at('wifi', 100, 100, 2000), false), {
    down: undefined,
    up: undefined,
  });
});

test('ratesBetween: samples too close together give nothing, even on a floor', () => {
  assert.deepEqual(ratesBetween(at('wired', 0, 0, 0), at('wired', 100, 100, 100), true), { down: undefined, up: undefined });
});
