import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewLines } from '../src/features/firewall/preview-lines.ts';

const KEY = `${'A'.repeat(43)}=`;
const PSK = `${'B'.repeat(43)}=`;

test('a VPN profile’s keys are masked in the preview, in the section and in the changes', () => {
  const original = { '.name': 'vpnp_1', '.type': 'vpn_profile', name: 'France', private_key: KEY, endpoint_host: 'a.example' };
  const lines = previewLines('milkflint', 'vpn_profile', original, [
    { op: 'set', config: 'milkflint', section: 'vpnp_1', values: { preshared_key: PSK, keepalive: '25' } },
  ]);
  const text = lines.join('\n');
  assert.ok(!text.includes(KEY) && !text.includes(PSK));
  assert.ok(text.includes('option private_key') && text.includes('option preshared_key'));
  assert.ok(text.includes("option endpoint_host 'a.example'") && text.includes("option keepalive '25'"));
});

test('a new profile’s keys are masked too', () => {
  const lines = previewLines('milkflint', 'vpn_profile', undefined, [
    { op: 'add', config: 'milkflint', type: 'vpn_profile', name: 'vpnp_2', values: { private_key: KEY } },
  ]);
  assert.ok(!lines.join('\n').includes(KEY));
});
