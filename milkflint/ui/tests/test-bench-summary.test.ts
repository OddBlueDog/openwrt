// The Test bench's answer on top: who has joined and whether they're ready,
// and a run's state, each as a status word.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AWAY_MS,
  devicesStatus,
  distinctNames,
  namesText,
  presence,
  runOn,
  runStatus,
} from '../src/features/test-bench/summary.ts';

const ready = { seen_ms: 500, visible: true };
const away = { seen_ms: AWAY_MS + 1, visible: true };
const hidden = { seen_ms: 500, visible: false };

test('presence: away after the timeout, before a hidden page; ready otherwise', () => {
  assert.equal(presence(ready), 'ready');
  assert.equal(presence({ seen_ms: AWAY_MS, visible: null }), 'ready');
  assert.equal(presence(away), 'away');
  assert.equal(presence({ seen_ms: AWAY_MS + 1, visible: false }), 'away');
  assert.equal(presence(hidden), 'hidden');
});

test('devices: none yet, all ready, or how many are not', () => {
  assert.deepEqual(devicesStatus([]), { text: 'None yet', tone: 'outline', ready: 0, total: 0 });
  assert.deepEqual(devicesStatus([ready]), { text: 'Ready', tone: 'success', ready: 1, total: 1 });
  assert.deepEqual(devicesStatus([ready, ready, ready]), { text: 'All 3 ready', tone: 'success', ready: 3, total: 3 });
  assert.deepEqual(devicesStatus([ready, away, hidden]), { text: '2 of 3 not ready', tone: 'warning', ready: 1, total: 3 });
  assert.deepEqual(devicesStatus([hidden]), { text: 'Not ready', tone: 'warning', ready: 0, total: 1 });
});

test('a run: each state in a word, a finished one by how it ended', () => {
  assert.deepEqual(runStatus(undefined), { text: 'Nothing running', tone: 'outline' });
  assert.deepEqual(runStatus(null), { text: 'Nothing running', tone: 'outline' });
  assert.equal(runStatus({ state: 'scheduled', ended: null }).text, 'Starting');
  assert.deepEqual(runStatus({ state: 'running', ended: null }), { text: 'Running', tone: 'success' });
  assert.equal(runStatus({ state: 'stopping', ended: null }).tone, 'warning');
  assert.equal(runStatus({ state: 'collecting', ended: { reason: 'completed', at: 1 } }).text, 'Collecting results');
  assert.deepEqual(runStatus({ state: 'done', ended: { reason: 'completed', at: 1 } }), { text: 'Finished', tone: 'success' });
  assert.deepEqual(runStatus({ state: 'done', ended: { reason: 'stopped by Mac', at: 1 } }), {
    text: 'Ended early',
    tone: 'warning',
  });
  assert.deepEqual(runStatus({ state: 'done', ended: undefined }), { text: 'Finished', tone: 'success' });
});

test('a run is on from its start until it has stopped', () => {
  assert.equal(runOn(undefined), false);
  assert.equal(runOn({ state: 'scheduled' }), true);
  assert.equal(runOn({ state: 'running' }), true);
  assert.equal(runOn({ state: 'stopping' }), true);
  assert.equal(runOn({ state: 'collecting' }), false);
  assert.equal(runOn({ state: 'done' }), false);
});

test('names: a list in British English, cut short past the maximum', () => {
  assert.equal(namesText([]), '');
  assert.equal(namesText(['Mac']), 'Mac');
  assert.equal(namesText(['Mac', 'PC']), 'Mac and PC');
  assert.equal(namesText(['Mac', 'iPhone', 'PC']), 'Mac, iPhone and PC');
  assert.equal(namesText(['A', 'B', 'C', 'D']), 'A, B, C and D');
  assert.equal(namesText(['A', 'B', 'C', 'D', 'E', 'F']), 'A, B, C and 3 more');
});

test('distinct names: a name two devices share gets each one’s id', () => {
  const names = distinctNames([
    { id: 'm1', name: 'Mac' },
    { id: 'm2', name: 'iPhone' },
    { id: 'm3', name: 'Mac' },
  ]);
  assert.deepEqual(
    [...names],
    [
      ['m1', 'Mac (m1)'],
      ['m2', 'iPhone'],
      ['m3', 'Mac (m3)'],
    ],
  );
});
