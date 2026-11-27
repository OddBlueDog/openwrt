// The Plan card's remembered choices: each field is checked on its own.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultChoices, parseChoices } from '../src/features/test-bench/plan-memory.ts';

test('junk gives the defaults', () => {
  assert.deepEqual(parseChoices(null), defaultChoices);
  assert.deepEqual(parseChoices('x'), defaultChoices);
});

test('a full valid object round-trips', () => {
  const full = {
    preset: 'custom' as const,
    custom: {
      idleS: 0,
      loadS: 30,
      download: false,
      upload: true,
      both: true,
      everyone: true,
      d2d: true,
      dns: false,
      household: true,
    },
    latency: 'eu' as const,
    budget_mb: 9000,
    custom_sites: ['example.org'],
  };
  assert.deepEqual(parseChoices(full), full);
});

test('a bad preset falls back alone', () => {
  assert.deepEqual(parseChoices({ preset: 'nope' }), defaultChoices);
});

test('out-of-range seconds go back to the defaults, other fields stay', () => {
  const c = parseChoices({ custom: { idleS: 999, loadS: 1, d2d: true } });
  assert.equal(c.custom.idleS, 20);
  assert.equal(c.custom.loadS, 15);
  assert.equal(c.custom.d2d, true);
  assert.equal(parseChoices({ custom: { idleS: 1.5, loadS: 61 } }).custom.idleS, 20);
  assert.equal(parseChoices({ custom: { idleS: 0, loadS: 60 } }).custom.loadS, 60);
});

test('the data limit is 0 or within bounds', () => {
  assert.equal(parseChoices({ budget_mb: 5 }).budget_mb, 0);
  assert.equal(parseChoices({ budget_mb: 9000 }).budget_mb, 9000);
  assert.equal(parseChoices({ budget_mb: 100_001 }).budget_mb, 0);
  assert.equal(parseChoices({ budget_mb: 12.5 }).budget_mb, 0);
});

test('custom sites keep only valid ones', () => {
  assert.deepEqual(parseChoices({ custom_sites: ['example.org', 'not a site', 7] }).custom_sites, ['example.org']);
  assert.deepEqual(parseChoices({ custom_sites: 'example.org' }).custom_sites, []);
});

test('latency must be uk, eu or us', () => {
  assert.equal(parseChoices({ latency: 'mars' }).latency, 'uk');
  assert.equal(parseChoices({ latency: 'us' }).latency, 'us');
});
