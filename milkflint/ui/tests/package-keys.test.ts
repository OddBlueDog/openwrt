// Package keys on Router access (src/features/admin-password/package-keys/model.ts):
// the keys apk trusts (/etc/apk/keys), which ones the page won't remove
// (OpenWrt's and MilkFlint's own, without which updates stop installing),
// a new key checked before it's written, and the file name it's written as.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRepoKey, fileNameFor, isBuiltIn } from '@/features/admin-password/package-keys/model';

const PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAECqruC4JU7pfpnkQuueBaT29I1dFx
Xbc7xYsY5R2+r3Hg3SO3B2QLpMaghA9Uzx/E2PGaNkYe24uPPg/n7Q9Jeg==
-----END PUBLIC KEY-----
`;

test('OpenWrt’s keys and MilkFlint’s own are built in', () => {
  assert.equal(isBuiltIn('openwrt-25.12.pem'), true);
  assert.equal(isBuiltIn('openwrt-snapshots.pem'), true);
  assert.equal(isBuiltIn('public-key.pem'), true);
  assert.equal(isBuiltIn('my-feed.pem'), false);
});

test('a new key: a PEM public key, not one already there', () => {
  assert.equal(checkRepoKey(PEM, []), undefined);
  assert.match(checkRepoKey('ssh-ed25519 AAAA', []) ?? '', /PEM/);
  assert.match(checkRepoKey(PEM.replace('PUBLIC', 'PRIVATE').replace('PUBLIC', 'PRIVATE'), []) ?? '', /a private key/);
  assert.match(checkRepoKey(`${PEM}${'x'.repeat(9000)}`, []) ?? '', /long/);
  // the same key, its lines wrapped differently
  assert.match(checkRepoKey(PEM.replace(/\n/g, '\r\n'), [{ name: 'openwrt-25.12.pem', text: PEM }]) ?? '', /openwrt-25\.12\.pem/);
});

test('the file name: from the file or address it came from, safe, .pem, not one in use', () => {
  assert.equal(fileNameFor('my feed.pub', []), 'my-feed.pem');
  assert.equal(fileNameFor('https://example.org/keys/feed-key.pem?x=1', []), 'feed-key.pem');
  assert.equal(fileNameFor('feed-key.pem', ['feed-key.pem']), 'feed-key-2.pem');
  assert.match(fileNameFor('', []), /^key-\d+\.pem$/);
  assert.equal(fileNameFor('../../etc/passwd', []), 'passwd.pem');
});
