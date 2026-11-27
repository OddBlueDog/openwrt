import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstSeenText, type Seen } from '../src/lib/api/seen.ts';

function text(seen: Seen, mac: string): string {
  const out = firstSeenText(seen, mac);
  if (out === undefined) throw new Error('expected a first-seen text');
  return out;
}

test('a device first seen within ten minutes of the record starting is "on or before"', () => {
  assert.ok(text({ since: 1000, devices: { aa: [1300, 5000] } }, 'aa').startsWith('First seen on or before '));
});

test('ten minutes or more after the record started gives the date and time', () => {
  const out = text({ since: 1000, devices: { aa: [5000 + 86400, 99999] } }, 'aa');
  assert.ok(out.startsWith('First seen '));
  assert.ok(!out.includes('on or before'));
  assert.match(out, /\d{2}:\d{2}/);
});

test('exactly ten minutes after is a real first sighting', () => {
  assert.ok(!text({ since: 1000, devices: { aa: [1600, 1600] } }, 'aa').includes('on or before'));
});

test('an unknown record start counts as a real first sighting', () => {
  assert.ok(!text({ since: null, devices: { aa: [1300, 1300] } }, 'aa').includes('on or before'));
});

test('the MAC is matched case-insensitively', () => {
  assert.notEqual(firstSeenText({ since: 1000, devices: { 'aa:bb': [50000, 60000] } }, 'AA:BB'), undefined);
});

test('a MAC that is not recorded gives undefined', () => {
  assert.equal(firstSeenText({ since: 1000, devices: {} }, 'aa'), undefined);
});

test('within a week of the record starting, a real first sighting says when the records began', () => {
  const since = 1_794_000_000;
  const out = text({ since, devices: { aa: [since + 2 * 86400, since + 2 * 86400] } }, 'aa');
  assert.match(out, /^First seen .*\d{2}:\d{2} \(records began \d{1,2} \w{3} \d{4}\)$/);
});

test('within a week, "on or before" says it too; after a week neither carries the note', () => {
  const since = 1_794_000_000;
  assert.match(text({ since, devices: { aa: [since, since] } }, 'aa'), /^First seen on or before .* \(records began .*\)$/);
  assert.ok(!text({ since, devices: { aa: [since + 7 * 86400, since + 7 * 86400] } }, 'aa').includes('records began'));
  assert.ok(!text({ since, devices: { aa: [since + 30 * 86400, since + 30 * 86400] } }, 'aa').includes('records began'));
});

test('an unknown record start carries no note', () => {
  assert.ok(!text({ since: null, devices: { aa: [1_794_000_000, 1_794_000_000] } }, 'aa').includes('records began'));
});
