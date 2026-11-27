// About this router: each core's load between two samples of the CPU counters.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coreLoads } from '../src/features/system-overview/model.ts';

const cpu = (busy0: number, busy1: number, total: number): { name: string; total: number; idle: number }[] => [
  { name: 'cpu', total: total * 2, idle: total * 2 - busy0 - busy1 },
  { name: 'cpu0', total, idle: total - busy0 },
  { name: 'cpu1', total, idle: total - busy1 },
];

test('none until there are two samples', () => {
  assert.equal(coreLoads(undefined, cpu(10, 20, 100)), undefined);
});

test('each core’s busy share since the last sample, the total line left out', () => {
  assert.deepEqual(coreLoads(cpu(10, 20, 100), cpu(60, 20, 200)), [0.5, 0]);
});

test('no time passed: 0, not a division by zero', () => {
  assert.deepEqual(coreLoads(cpu(10, 20, 100), cpu(10, 20, 100)), [0, 0]);
});
