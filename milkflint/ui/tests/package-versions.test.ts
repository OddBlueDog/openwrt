// The Updates cards' versions (AdGuard Home and banIP): apk's version as it
// is, apk's order, the choices (a newer one, going back, kept back), the
// "Newest tested" row and what the card says of the last check or install.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareVersions,
  lastRunMessage,
  newestText,
  updateChoice,
  upstreamRelease,
  versionLabel,
} from '../src/lib/package-versions.ts';

test('versions: as apk gives them, MilkFlint’s build number included; in apk’s order', () => {
  assert.equal(versionLabel('1.9.1-r1005'), '1.9.1-r1005');
  assert.equal(versionLabel('1.0.0-r1001'), '1.0.0-r1001');
  assert.equal(versionLabel(null), 'unknown');
  assert.equal(versionLabel(''), 'unknown');
  assert.equal(upstreamRelease('1.9.1-r1005'), 5);
  assert.equal(upstreamRelease('0.107.80-r3'), 3);
  assert.equal(upstreamRelease('nonsense'), undefined);
  assert.ok(compareVersions('1.0.0-r1', '0.107.80-r1') > 0);
  assert.ok(compareVersions('0.107.80-r1', '0.107.79-r3') > 0);
  assert.ok(compareVersions('0.107.79-r3', '0.107.79-r1') > 0);
  assert.ok(compareVersions('0.107.100-r1', '0.107.99-r1') > 0);
  assert.ok(compareVersions('1.9.1-r1006', '1.9.1-r1005') > 0);
  assert.equal(compareVersions('1.0.0-r1', '1.0.0-r1'), 0);
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

test('the newest tested: the version, the feed out of reach, nothing tested for this release yet, or not checked', () => {
  assert.equal(newestText({ checked: 1 }, '1.9.1-r1006'), '1.9.1-r1006');
  assert.equal(newestText({ checked: 1, error: 'feed' }, undefined), 'couldn’t reach the feed');
  assert.equal(newestText({ checked: 1, versions: [] }, undefined), 'no tested update for this release yet');
  assert.equal(newestText({}, undefined), 'not checked yet');
  assert.equal(newestText(null, undefined), 'not checked yet');
});

test('the last run: plain reasons for each failure, and whether the version before is back on', () => {
  const install = { action: 'install', ok: false, installed: '1.9.1-r1005' };
  assert.deepEqual(lastRunMessage({ ...install, ok: true, installed: '1.9.1-r1006' }, 'banIP'), {
    tone: 'success',
    text: 'Installed 1.9.1-r1006.',
  });
  assert.equal(
    lastRunMessage({ ...install, error: 'after', back_on: true }, 'banIP')?.text,
    'banIP didn’t work with that version, so 1.9.1-r1005 is back on.',
  );
  assert.equal(
    lastRunMessage({ ...install, installed: '1.9.1-r1006', error: 'after', back_on: false }, 'banIP')?.text,
    'banIP didn’t work with that version, and the version before couldn’t go back on, so 1.9.1-r1006 stays installed.',
  );
  assert.match(
    lastRunMessage({ ...install, error: 'feed' }, 'banIP')?.text ?? '',
    /couldn’t reach MilkFlint’s package feed, so nothing changed/,
  );
  assert.match(
    lastRunMessage({ ...install, error: 'version' }, 'banIP')?.text ?? '',
    /isn’t one MilkFlint has tested with this release/,
  );
  assert.equal(
    lastRunMessage({ ...install, error: 'install', back_on: true }, 'AdGuard Home')?.text,
    'The package didn’t install, so 1.9.1-r1005 is back on.',
  );
  assert.match(
    lastRunMessage({ ...install, error: 'settings', back_on: true }, 'AdGuard Home')?.text ?? '',
    /can’t read AdGuard Home’s settings, which a newer version changed, so 1.9.1-r1005 is back on/,
  );
  // never apk's own lines
  assert.doesNotMatch(
    lastRunMessage({ ...install, error: 'install', log: 'ERROR: unable to select packages' }, 'banIP')?.text ?? '',
    /ERROR/,
  );
  // a check: only when it didn't work; nothing while busy
  assert.equal(lastRunMessage({ action: 'check', ok: true }, 'banIP'), undefined);
  assert.equal(
    lastRunMessage({ action: 'check', ok: false, error: 'feed' }, 'banIP')?.text,
    'The router couldn’t reach MilkFlint’s package feed.',
  );
  assert.equal(lastRunMessage({ ...install, busy: true }, 'banIP'), undefined);
});
