// Performance tuning's summary: which settings differ from MilkFlint's
// defaults, in the page's tiers, so the folded expert options can say what
// they hold.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedSettings, defaults, toChanges, tuningData } from '../src/features/tuning/model.ts';
import { section } from './uci-fixture.ts';

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

test('the switch tag and one-pass grouping are named in the expert tier, after the LAN ports’ RPS, as on the page', () => {
  const f = { ...defaults, lanRps: true, pdmaStag: true, dsaGro: true, rxDimPerRing: true };
  assert.deepEqual(changedSettings(f, firewall), [
    { tier: 'expert', label: 'Spread what the LAN ports receive' },
    { tier: 'expert', label: 'Let RSS spread what the LAN ports receive' },
    { tier: 'expert', label: 'Group what the LAN ports receive in one pass' },
    { tier: 'expert', label: 'Each receive ring picks its own interrupt delay' },
  ]);
  assert.deepEqual(changedSettings({ ...defaults, dsaGro: true }, firewall), [
    { tier: 'expert', label: 'Group what the LAN ports receive in one pass' },
  ]);
});

test('the switch tag and one-pass grouping: a save writes milkflint.steering’s changed option only', () => {
  const load = (steering: Record<string, string>) =>
    tuningData({ milkflint: [section('steering', 'steering', steering)], network: [], sqm: [], firewall: [] });
  const data = load({ lan_rps: '1' });
  assert.deepEqual(toChanges({ ...data.form, dsaGro: true }, data), [
    { op: 'set', config: 'milkflint', section: 'steering', values: { dsa_gro: '1' } },
  ]);
  assert.deepEqual(toChanges({ ...data.form, pdmaStag: true }, data), [
    { op: 'set', config: 'milkflint', section: 'steering', values: { pdma_stag: '1' } },
  ]);
  // read back as saved, and off is unset, the rest left alone
  const on = load({ lan_rps: '1', pdma_stag: '1', dsa_gro: '1' });
  assert.deepEqual([on.form.pdmaStag, on.form.dsaGro, on.form.lanRps], [true, true, true]);
  assert.deepEqual(toChanges({ ...on.form, pdmaStag: false }, on), [
    { op: 'unset', config: 'milkflint', section: 'steering', options: ['pdma_stag'] },
  ]);
  assert.deepEqual(toChanges(on.form, on), []);
  // anything but "1" reads as off, and isn't rewritten by a save that leaves it
  const junk = load({ dsa_gro: 'yes' });
  assert.equal(junk.form.dsaGro, false);
  assert.deepEqual(toChanges(junk.form, junk), []);
});
