import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHIP_LIMIT_C, HOT_C, WARM_C, temperatureLevel } from '@/features/dashboard/model';

test('temperatures are warm and hot by how close the chips are to protecting themselves', () => {
  assert.equal(CHIP_LIMIT_C, 120);
  assert.equal(WARM_C, 95);
  assert.equal(HOT_C, 110);
  // a router at work in a room: normal, including the 70s the old card called warm
  for (const c of [41, 48, 70, 85, 94.9]) assert.equal(temperatureLevel(c), 'normal', String(c));
  for (const c of [95, 109.9]) assert.equal(temperatureLevel(c), 'warm', String(c));
  for (const c of [110, 120, 125]) assert.equal(temperatureLevel(c), 'hot', String(c));
});
