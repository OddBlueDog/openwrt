// The Data usage page: which rows it shows, one device's when All devices links to it, and their totals.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { UsageRow } from '../src/features/data-statistics/api.ts';
import { macFromPath, shownRows, totals } from '../src/features/data-statistics/model.ts';

const row = (key: string, ip: string | undefined, rx: number, tx: number): UsageRow => ({ key, ip, conns: 1, rx, tx });
const rows = [
  row('aa:bb:cc:dd:ee:01', '192.168.1.10', 100, 10),
  row('AA:BB:CC:DD:EE:02', '192.168.1.11', 50, 5),
  row('aa:bb:cc:dd:ee:03', '192.168.1.1', 7, 7),
];
const router = new Set(['192.168.1.1']);

test('a MAC address in the path picks one device; anything else picks none', () => {
  assert.equal(macFromPath('AA:BB:CC:DD:EE:02'), 'aa:bb:cc:dd:ee:02');
  assert.equal(macFromPath('aa%3Abb%3Acc%3Add%3Aee%3A02'), 'aa:bb:cc:dd:ee:02');
  assert.equal(macFromPath(''), undefined);
  assert.equal(macFromPath('zones'), undefined);
  assert.equal(macFromPath('aa:bb:cc'), undefined);
});

test('by device: the router’s own traffic is left out, and one device when asked', () => {
  assert.deepEqual(
    shownRows(rows, 'devices', router, undefined).map((r) => r.key),
    ['aa:bb:cc:dd:ee:01', 'AA:BB:CC:DD:EE:02'],
  );
  assert.deepEqual(
    shownRows(rows, 'devices', router, 'aa:bb:cc:dd:ee:02').map((r) => r.key),
    ['AA:BB:CC:DD:EE:02'],
  );
  // before the router's addresses are known, nothing is left out
  assert.equal(shownRows(rows, 'devices', undefined, undefined).length, 3);
});

test('by application: every row, whatever device was asked for', () => {
  assert.equal(shownRows(rows, 'apps', router, 'aa:bb:cc:dd:ee:02').length, 3);
});

test('totals add up what is shown', () => {
  assert.deepEqual(totals(shownRows(rows, 'devices', router, undefined)), { rx: 150, tx: 15 });
  assert.deepEqual(totals([]), { rx: 0, tx: 0 });
});

test('the router’s own MACs, to hide from the history the way shownRows hides its rows', async () => {
  const { routerMacs } = await import('../src/features/data-statistics/model.ts');
  assert.deepEqual([...routerMacs(rows, router)], ['aa:bb:cc:dd:ee:03']);
  assert.deepEqual([...routerMacs(rows, undefined)], []);
});
