// The AdGuard Home page's model: its state in words, when the Dashboard warns,
// the sign-in form's checks (as AdGuard Home and bcrypt take a password), the
// updates' choices (going back, kept back) and the networks' subnets.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AdGuardStatus, Setting } from '../src/features/adguardhome/api.ts';
import {
  API_USER,
  blockedShare,
  compareVersions,
  describeState,
  needsAttention,
  networkOf,
  networkRows,
  updateChoice,
  validateCredentials,
  versionLabel,
} from '../src/features/adguardhome/model.ts';

const status = (over: Partial<AdGuardStatus> = {}): AdGuardStatus => ({
  installed: true,
  enabled: true,
  configured: true,
  mode: 'router',
  running: true,
  version: '0.107.80-r1',
  state: 'active',
  settings: [],
  ...over,
});

const setting = (key: string, breaks: boolean): Setting => ({ key, have: null, want: null, breaks, what: key });

test('its state: filtering, starting, round it or failing (stopped or silent), off, an access point', () => {
  assert.equal(describeState(status()).label, 'Filtering');
  assert.equal(describeState(status()).tone, 'success');
  assert.equal(describeState(status({ state: 'starting' })).label, 'Starting');
  assert.equal(describeState(status({ state: 'fallback', reason: 'stopped' })).label, 'Stopped');
  assert.equal(describeState(status({ state: 'fallback', reason: 'not answering' })).label, 'Not answering');
  assert.match(describeState(status({ state: 'fallback' })).text, /unfiltered/);
  // left to fail (the default): it says so, and that nothing gets through unfiltered
  assert.equal(describeState(status({ state: 'blocking', reason: 'stopped' })).label, 'Stopped');
  assert.equal(describeState(status({ state: 'blocking', reason: 'not answering' })).label, 'Not answering');
  assert.equal(describeState(status({ state: 'blocking' })).tone, 'warning');
  assert.match(describeState(status({ state: 'blocking' })).text, /fail .*nothing gets through unfiltered/);
  assert.equal(describeState(status({ enabled: false })).label, 'Off');
  // turned off, whatever the monitor said last
  assert.equal(describeState(status({ enabled: false, state: 'fallback' })).label, 'Off');
  assert.equal(describeState(status({ mode: 'ap' })).label, 'Not used');
});

test('the Dashboard warns while lookups go round it or fail, or a setting breaks the chain; not for a note, off, or an access point', () => {
  assert.deepEqual(needsAttention(status()), { fallback: false, blocking: false, broken: [] });
  assert.equal(needsAttention(status({ state: 'fallback' })).fallback, true);
  assert.deepEqual(needsAttention(status({ state: 'blocking' })), { fallback: false, blocking: true, broken: [] });
  assert.equal(needsAttention(status({ enabled: false, state: 'blocking' })).blocking, false);
  assert.deepEqual(
    needsAttention(status({ settings: [setting('dns.port', true), setting('dns.cache_enabled', false)] })).broken.map(
      (s) => s.key,
    ),
    ['dns.port'],
  );
  assert.deepEqual(needsAttention(status({ enabled: false, state: 'fallback', settings: [setting('dns.port', true)] })), {
    fallback: false,
    blocking: false,
    broken: [],
  });
  assert.deepEqual(needsAttention(status({ mode: 'ap', state: 'fallback' })), { fallback: false, blocking: false, broken: [] });
  assert.deepEqual(needsAttention(undefined), { fallback: false, blocking: false, broken: [] });
  assert.deepEqual(needsAttention({ installed: false }), { fallback: false, blocking: false, broken: [] });
});

test('sign-in: a user name AdGuard Home takes, not MilkFlint’s own; a password bcrypt takes whole, typed twice', () => {
  const good = { user: 'admin', password: 'correct horse', again: 'correct horse' };
  assert.deepEqual(validateCredentials(good), {});
  assert.notEqual(validateCredentials({ ...good, user: '' }).user, undefined);
  assert.notEqual(validateCredentials({ ...good, user: 'two words' }).user, undefined);
  assert.notEqual(validateCredentials({ ...good, user: API_USER }).user, undefined);
  assert.deepEqual(validateCredentials({ ...good, user: 'me@home.lan' }), {});
  assert.notEqual(validateCredentials({ ...good, password: 'short', again: 'short' }).password, undefined);
  // 72 bytes is bcrypt's limit: 73 ASCII characters, or 25 three-byte ones, are too long
  assert.deepEqual(validateCredentials({ ...good, password: 'x'.repeat(72), again: 'x'.repeat(72) }), {});
  assert.notEqual(validateCredentials({ ...good, password: 'x'.repeat(73), again: 'x'.repeat(73) }).password, undefined);
  assert.notEqual(validateCredentials({ ...good, password: '€'.repeat(25), again: '€'.repeat(25) }).password, undefined);
  assert.notEqual(validateCredentials({ ...good, password: 'two\nlines', again: 'two\nlines' }).password, undefined);
  assert.notEqual(validateCredentials({ ...good, again: 'correct horsf' }).again, undefined);
});

test('versions: as AdGuard Home names them, in apk’s order', () => {
  assert.equal(versionLabel('0.107.80-r1'), 'v0.107.80');
  assert.equal(versionLabel('0.107.80-r3'), 'v0.107.80 (build 3)');
  assert.equal(versionLabel(null), 'unknown');
  assert.ok(compareVersions('0.107.80-r1', '0.107.79-r3') > 0);
  assert.ok(compareVersions('0.107.79-r3', '0.107.79-r1') > 0);
  assert.ok(compareVersions('0.107.100-r1', '0.107.99-r1') > 0);
  assert.equal(compareVersions('0.107.80-r1', '0.107.80-r1'), 0);
});

test('updates: a newer one to install, earlier ones to go back to, and one kept back', () => {
  const feed = { versions: ['0.107.79-r1', '0.107.81-r1', '0.107.80-r1'], latest: '0.107.81-r1' };
  const c = updateChoice('0.107.80-r1', feed);
  assert.equal(c.newer, true);
  assert.equal(c.latest, '0.107.81-r1');
  assert.deepEqual(c.earlier, ['0.107.79-r1']);
  assert.equal(c.pinned, false);
  // gone back to 79: the newest is newer, and it's kept back until then
  const back = updateChoice('0.107.79-r1', { ...feed, pinned: '0.107.79-r1' });
  assert.equal(back.newer, true);
  assert.equal(back.pinned, true);
  assert.deepEqual(back.earlier, []);
  // never checked
  assert.deepEqual(updateChoice('0.107.80-r1', null), {
    installed: '0.107.80-r1',
    latest: undefined,
    newer: false,
    earlier: [],
    pinned: false,
  });
});

test('a blocked share: one decimal under 10%', () => {
  assert.equal(blockedShare({ queries: 1000, blocked: 52, hours: 24 }), '5.2%');
  assert.equal(blockedShare({ queries: 1000, blocked: 312, hours: 24 }), '31%');
  assert.equal(blockedShare({ queries: 0, blocked: 0, hours: 24 }), undefined);
  assert.equal(blockedShare(null), undefined);
});

test('networks by subnet: home, guests by their label, Remote access; the subnet, not the router’s address', () => {
  assert.equal(networkOf('192.168.1.1/24'), '192.168.1.0/24');
  assert.equal(networkOf('10.99.0.1/16'), '10.99.0.0/16');
  assert.equal(networkOf('not an address'), 'not an address');
  const rows = networkRows(
    [
      { interface: 'wg_in', zone: 'wg_in', ipv4: ['10.7.0.1/24'], ipv6: [] },
      { interface: 'guest', zone: 'guest', ipv4: ['192.168.9.1/24'], ipv6: [] },
      { interface: 'lan', zone: 'lan', ipv4: ['192.168.1.1/24'], ipv6: ['fd16:3d2d:bca1::/60'] },
      { interface: 'empty', zone: 'guest2', ipv4: [], ipv6: [] },
    ],
    (z) => (z === 'guest' ? 'Visitors' : undefined),
  );
  assert.deepEqual(rows, [
    { label: 'Home network', subnets: ['192.168.1.0/24', 'fd16:3d2d:bca1::/60'] },
    { label: 'Visitors', subnets: ['192.168.9.0/24'] },
    { label: 'Remote access', subnets: ['10.7.0.0/24'] },
  ]);
});
