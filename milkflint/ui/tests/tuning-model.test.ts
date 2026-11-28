// Performance tuning's summary: which settings differ from MilkFlint's
// defaults, in the page's tiers, so the folded expert options can say what
// they hold.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedSettings, defaults } from '../src/features/tuning/model.ts';

const firewall = { firewall: { section: 'cfg01', hardware: false } };

test('the defaults change nothing', () => {
  assert.deepEqual(changedSettings(defaults, firewall), []);
});

test('each change is named in its tier', () => {
  const f = { ...defaults, steering: 'rps' as const, gro: 'plain' as const, retries: '7', wifiAll: false };
  assert.deepEqual(changedSettings(f, firewall), [
    { tier: 'essentials', label: 'Packet steering' },
    { tier: 'expert', label: 'Wi-Fi threads on every CPU' },
    { tier: 'expert', label: 'GRO' },
    { tier: 'expert', label: 'Sends per frame' },
  ]);
});

test('software offloading counts only where the firewall has a defaults section', () => {
  const f = { ...defaults, offload: false };
  assert.deepEqual(changedSettings(f, firewall), [{ tier: 'essentials', label: 'Software flow offloading' }]);
  assert.deepEqual(changedSettings(f, { firewall: undefined }), []);
});

test('a written AQL limit or total counts, even at the default figures', () => {
  assert.deepEqual(
    changedSettings({ ...defaults, aql: 'custom', aqlLow: '2500', aqlHigh: '5000', aqlTotal: 'own' }, firewall).map(
      (c) => c.label,
    ),
    ['Wi-Fi queue limit', 'Wi-Fi radio’s total'],
  );
});

test('the experimental CPU settings are named in the expert tier, in the page’s order', () => {
  const f = { ...defaults, lanRps: true, rxDimPerRing: true, qdmaTxDim: true, rxDelay: '20' };
  assert.deepEqual(changedSettings(f, firewall), [
    { tier: 'expert', label: 'Spread what the LAN ports receive' },
    { tier: 'expert', label: 'Receive interrupt delay' },
    { tier: 'expert', label: 'Each receive ring picks its own interrupt delay' },
    { tier: 'expert', label: 'Send-complete interrupts follow sending’s own moderation' },
  ]);
});
