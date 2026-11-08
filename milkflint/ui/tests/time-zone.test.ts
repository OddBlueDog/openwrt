// When the dashboard stops asking for a time zone.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withUtc, zoneChosen } from '../src/features/time/zone.ts';
import { section } from './uci-fixture.ts';

test('a new router has none: OpenWrt first-boot values, or none at all', () => {
  assert.equal(zoneChosen(section('system', 's', { zonename: 'UTC', timezone: 'GMT0' })), false);
  assert.equal(zoneChosen(section('system', 's', { timezone: 'GMT0' })), false);
  assert.equal(zoneChosen(section('system', 's')), false);
  assert.equal(zoneChosen(undefined), false);
});

test('anything picked counts, UTC included', () => {
  assert.equal(zoneChosen(section('system', 's', { zonename: 'Europe/Paris', timezone: 'CET-1CEST,M3.5.0,M10.5.0/3' })), true);
  assert.equal(zoneChosen(section('system', 's', { zonename: 'UTC', timezone: 'UTC0' })), true);
  assert.equal(zoneChosen(section('system', 's', { zonename: 'Africa/Abidjan', timezone: 'GMT0' })), true);
  // LuCI's own UTC
  assert.equal(zoneChosen(section('system', 's', { zonename: 'UTC', timezone: 'UTC' })), true);
});

test('UTC is in the list, so it can be picked', () => {
  const zones = [{ name: 'Europe/Paris', tz: 'CET-1CEST,M3.5.0,M10.5.0/3' }];
  assert.deepEqual(withUtc(zones)[0], { name: 'UTC', tz: 'UTC0' });
  assert.equal(zoneChosen(section('system', 's', { zonename: 'UTC', timezone: withUtc(zones)[0]?.tz ?? '' })), true);
  // only when the list loaded: otherwise the page shows just what's set
  assert.deepEqual(withUtc([]), []);
});
