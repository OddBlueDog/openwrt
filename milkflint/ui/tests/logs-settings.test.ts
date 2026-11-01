// The Logs page's settings as uci changes: the memory error checker
// (KFENCE) is written with the rest, and leaves dnsmasq alone.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type LogSettings, logSettingsChanges } from '../src/features/logs/api.ts';

const before: LogSettings = {
  persist: false,
  size: '3',
  wifi: true,
  interval: '10',
  channel: true,
  mu: true,
  rrm: true,
  net: true,
  radar: true,
  counters: false,
  snapshot: false,
  dns: false,
  kfence: false,
  dnsmasq: 'cfg01411c',
};

function logs(f: LogSettings): Record<string, string | string[]> | undefined {
  const c = logSettingsChanges(f, before).find((x) => x.op === 'set' && x.config === 'milkflint' && x.section === 'logs');
  return c?.op === 'set' ? c.values : undefined;
}

test('the checker is off as the defaults have it', () => {
  assert.equal(logs(before)?.['kfence'], '0');
});

test('turning the checker on writes it, and only milkflint changes', () => {
  const f = { ...before, kfence: true };
  assert.equal(logs(f)?.['kfence'], '1');
  assert.deepEqual(
    logSettingsChanges(f, before).map((c) => c.config),
    ['milkflint'],
  );
});
