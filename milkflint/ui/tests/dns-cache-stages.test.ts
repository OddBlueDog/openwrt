// The DNS cache card's story of one answer must match what the settings do.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cacheStages, httpsHint, keepLabel, sizeHint } from '../src/features/dns/cache-stages.ts';
import { KEEP_HOURS } from '../src/features/dns/upstreams.ts';

const on = { cacheOn: true, quick: true, keepHours: '12' } as const;
const shape = (f: Parameters<typeof cacheStages>[0]): [string, boolean][] => cacheStages(f).map((s) => [s.id, s.instant]);

test('with the cache off nothing is remembered, whatever else is set', () => {
  assert.deepEqual(cacheStages({ ...on, cacheOn: false }), []);
});

test('reusing: fresh and expired answers are instant, then the device waits', () => {
  assert.deepEqual(shape(on), [
    ['fresh', true],
    ['expired', true],
    ['forgotten', false],
  ]);
});

test('not reusing: the device waits as soon as an answer expires', () => {
  assert.deepEqual(shape({ ...on, quick: false }), [
    ['fresh', true],
    ['expired', false],
  ]);
});

test('how long an expired answer is reused is the chosen time', () => {
  assert.equal(cacheStages({ ...on, keepHours: '24' })[1]?.lasts, 'For up to 1 day');
  assert.equal(cacheStages({ ...on, quick: false })[1]?.lasts, 'Not kept');
});

test('every choice of time reads properly', () => {
  assert.deepEqual(KEEP_HOURS.map(keepLabel), ['1 hour', '6 hours', '12 hours', '1 day', '2 days']);
});

test('expired answers share the size only when dnsmasq keeps them', () => {
  const shares = (f: Parameters<typeof sizeHint>[0]): boolean => sizeHint(f).includes('share this room');
  assert.equal(shares({ mode: 'auto', quick: true }), true);
  assert.equal(shares({ mode: 'static', quick: true }), true);
  assert.equal(shares({ mode: 'static', quick: false }), false);
  // dnsproxy has memory of its own
  assert.equal(shares({ mode: 'encrypted', quick: true }), false);
  assert.ok(sizeHint({ mode: 'encrypted', quick: true }).includes('kept separately'));
  assert.ok(!sizeHint({ mode: 'encrypted', quick: false }).includes('kept separately'));
});

test('the HTTPS records switch only stops mattering while dnsproxy keeps everything', () => {
  const little = (f: Parameters<typeof httpsHint>[0]): boolean => httpsHint(f).includes('little difference');
  assert.equal(little({ mode: 'encrypted', quick: true }), true);
  assert.equal(little({ mode: 'encrypted', quick: false }), false);
  // dnsmasq keeps them for reuse too, only if this switch says so
  assert.equal(little({ mode: 'auto', quick: true }), false);
  assert.equal(little({ mode: 'static', quick: true }), false);
});
