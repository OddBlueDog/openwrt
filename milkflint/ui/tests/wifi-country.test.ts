// The Wi-Fi country on Networks & radios: OpenWrt keeps one on each radio,
// the page shows and saves one for all. What the page shows when the radios
// don't all have the same one (LuCI sets each radio's apart, a radio added
// since has none) mustn't pass for the router's setting, and mustn't be one
// that saving would put over a country chosen on purpose.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { radiosCountry } from '../src/features/wifi/model.ts';

const r = (band: string, code: string) => ({ band, code });

test('every radio with the same country: that country, nothing to fill in', () => {
  assert.deepEqual(radiosCountry([r('2g', 'DE'), r('5g', 'DE')]), { country: 'DE', fill: '', mixed: [] });
  assert.deepEqual(radiosCountry([r('2g', 'de'), r('5g', 'DE')]).country, 'DE');
});

test('no radio with a country (a fresh install): unset, GB filled in', () => {
  assert.deepEqual(radiosCountry([r('2g', ''), r('5g', '')]), { country: '', fill: 'GB', mixed: [] });
  assert.deepEqual(radiosCountry([r('2g', '00'), r('5g', '00')]), { country: '', fill: 'GB', mixed: [] });
  assert.deepEqual(radiosCountry([]), { country: '', fill: 'GB', mixed: [] });
});

test('a radio without one beside radios that agree: their country is filled in, not GB', () => {
  assert.deepEqual(radiosCountry([r('2g', 'NL'), r('5g', '')]), { country: '', fill: 'NL', mixed: [] });
  assert.deepEqual(radiosCountry([r('2g', '00'), r('5g', 'US')]), { country: '', fill: 'US', mixed: [] });
});

test('radios with different countries: unset, nothing filled in, each band listed once', () => {
  assert.deepEqual(radiosCountry([r('5g', 'DE'), r('2g', 'GB')]), {
    country: '',
    fill: '',
    mixed: [r('2g', 'GB'), r('5g', 'DE')],
  });
  assert.deepEqual(radiosCountry([r('2g', 'fr'), r('5g', 'DE'), r('6g', '00')]).mixed, [
    r('2g', 'FR'),
    r('5g', 'DE'),
    r('6g', ''),
  ]);
  // two radios on one band with the same country: one line
  assert.deepEqual(radiosCountry([r('2g', 'GB'), r('5g', 'DE'), r('6g', 'GB'), r('6g', 'GB')]).mixed, [
    r('2g', 'GB'),
    r('5g', 'DE'),
    r('6g', 'GB'),
  ]);
});
