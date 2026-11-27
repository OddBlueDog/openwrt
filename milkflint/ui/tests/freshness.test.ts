// The Freshness line's words: how long ago a poll answered and when it asks next.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { freshnessText } from '@/lib/freshness';
import { formatDurationShort } from '@/lib/format';

test('says how long ago and how long to go', () => {
  assert.equal(freshnessText(10_000, 0, 30_000), 'Updated 10 s ago · next in 20 s');
});

test('says Updating… once the next poll is due', () => {
  assert.equal(freshnessText(31_000, 0, 30_000), 'Updating…');
  assert.equal(freshnessText(30_000, 0, 30_000), 'Updating…');
});

test('is empty before the first answer', () => {
  assert.equal(freshnessText(5_000, undefined, undefined), '');
  assert.equal(freshnessText(5_000, undefined, 30_000), '');
});

test('says only when it answered while nothing is scheduled (page hidden)', () => {
  assert.equal(freshnessText(10_000, 0, undefined), 'Updated 10 s ago');
});

test('uses formatDurationShort over a minute', () => {
  assert.equal(freshnessText(90_000, 0, 300_000), `Updated ${formatDurationShort(90)} ago · next in ${formatDurationShort(210)}`);
});

test('never shows negative ages', () => {
  assert.equal(freshnessText(0, 1_000, 30_000), 'Updated 0 s ago · next in 30 s');
});
