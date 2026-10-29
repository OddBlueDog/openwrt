// The Wi-Fi password rule both Wi-Fi pages use (Radios & SSIDs, Guest
// networks): a 64-digit hex key is a raw WPA2 key, which WPA3-SAE can't use.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keyError, securityOptions } from '../src/features/wifi/security.ts';

const hex64 = '0123456789abcdefABCDEF0123456789abcdef0123456789abcdef0123456789';
const sae = ['sae', 'sae-mixed', 'psk3', 'psk3-mixed', 'sae-compat'];
const wpa2 = ['psk', 'psk2', 'psk-mixed'];

test('a 64-digit hex key is refused for every mode with WPA3, saying why', () => {
  assert.equal(hex64.length, 64);
  for (const mode of sae) assert.match(keyError(mode, hex64) ?? '', /WPA3.*64-digit hex key only works with WPA2/, mode);
});

test('a 64-digit hex key is fine for WPA2-only modes', () => {
  for (const mode of wpa2) assert.equal(keyError(mode, hex64), undefined, mode);
});

test('switching a network with a 64-digit hex key from WPA2 to WPA3 shows the error', () => {
  assert.equal(keyError('psk2', hex64), undefined);
  assert.notEqual(keyError('sae-mixed', hex64), undefined);
  assert.notEqual(keyError('sae', hex64), undefined);
});

test('every password mode the pages offer takes 8 to 63 characters', () => {
  const modes = securityOptions.map((o) => o.value).filter((v) => v !== 'none');
  assert.deepEqual(modes, ['sae-mixed', 'sae', 'psk2', 'psk-mixed']);
  for (const mode of [...modes, ...sae, ...wpa2]) {
    assert.equal(keyError(mode, 'a'.repeat(8)), undefined, mode);
    assert.equal(keyError(mode, 'a'.repeat(63)), undefined, mode);
    assert.equal(keyError(mode, 'a'.repeat(7)), 'Use 8 to 63 characters.', mode);
    assert.equal(keyError(mode, ''), 'Use 8 to 63 characters.', mode);
    // 64 characters that aren't all hex aren't a key either
    assert.equal(keyError(mode, `${hex64.slice(0, 63)}g`), 'Use 8 to 63 characters.', mode);
    assert.equal(keyError(mode, 'a'.repeat(65)), 'Use 8 to 63 characters.', mode);
  }
});

test('an open network needs no password', () => {
  assert.equal(keyError('none', ''), undefined);
  assert.equal(keyError('none', hex64), undefined);
});
