import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDuration, formatDurationShort } from '@/lib/format';

test('durations: the full form, and the short one for a line that must not grow every minute', () => {
  const t = 3 * 86400 + 15 * 3600 + 54 * 60 + 7;
  assert.equal(formatDuration(t), '3d 15h 54m');
  assert.equal(formatDurationShort(t), '3d 15h');
  assert.equal(formatDurationShort(15 * 3600 + 54 * 60), '15h 54m');
  assert.equal(formatDurationShort(54 * 60 + 7), '54m');
  assert.equal(formatDurationShort(42), '42s');
  // the same length all day once it's past a day: only the hours tick
  assert.equal(formatDurationShort(t + 59 * 60).length, formatDurationShort(t).length);
});
