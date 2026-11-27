// The first-boot apk pins (features/apk-pins/uci-defaults) run for real, over
// a pretend package database and world: what MilkFlint builds itself is pinned
// at the version installed, by origin or by name, so OpenWrt's package feeds
// can't replace it; the rest of the world stays as it was.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = readFileSync(
  fileURLToPath(new URL('../../../package/milkflint/milkflint-ui/files/features/apk-pins/uci-defaults', import.meta.url)),
  'utf8',
);

interface Pkg {
  name: string;
  version: string;
  origin: string;
}

const HOSTAPD = 'feeds/base/network/services/hostapd';
const db: Pkg[] = [
  { name: 'wpad-basic-mbedtls', version: '2025.08.26~ca266cc2-r6', origin: HOSTAPD },
  { name: 'hostapd-common', version: '2025.08.26~ca266cc2-r6', origin: HOSTAPD },
  { name: 'wifi-scripts', version: '1.0-r2', origin: 'feeds/base/network/config/wifi-scripts' },
  { name: 'base-files', version: '1720~981c978eff', origin: 'feeds/base/base-files' },
  // an override, by name: its origin depends on where the build found it (a feed linked in, or the tree)
  { name: 'gawk', version: '5.3.2-r2', origin: '/build/feed/overrides/gawk' },
  { name: 'sqm-scripts', version: '1.8.0-r3', origin: 'feeds/base/milkflint/sqm-scripts' },
  { name: 'banip', version: '1.9.1-r2', origin: 'feeds/packages/feeds/packages/net/banip' },
  { name: 'adguardhome', version: '0.107.80-r1', origin: 'feeds/base/milkflint/adguardhome' },
  { name: 'ucode', version: '2026.01.16~85922056-r2', origin: 'feeds/base/utils/ucode' },
  { name: 'kmod-mt7915e', version: '6.12.115.2026.10.08~467ae2e3-r3', origin: 'feeds/base/kernel/mt76' },
];

/** apk's database as it writes it: P:, V:, o: among other fields, a blank line after each package. */
function database(pkgs: Pkg[]): string {
  return pkgs.map((p) => `C:Q1x=\nP:${p.name}\nV:${p.version}\nA:aarch64_cortex-a53\no:${p.origin}\nm:x\n`).join('\n');
}

/** The script over this database and world: its exit status and the world it leaves. */
function run(world: string, pkgs: Pkg[] = db): { status: number | null; world: string } {
  const root = mkdtempSync(join(tmpdir(), 'apk-pins-'));
  try {
    const worldFile = join(root, 'world');
    const dbFile = join(root, 'installed');
    writeFileSync(worldFile, world);
    writeFileSync(dbFile, database(pkgs));
    const body = script.replace(/^world=.*$/m, `world=${worldFile}`).replace(/^db=.*$/m, `db=${dbFile}`);
    assert.notEqual(body, script);
    writeFileSync(join(root, 'run.sh'), body);
    const r = spawnSync('/bin/sh', [join(root, 'run.sh')], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
    return { status: r.status, world: readFileSync(worldFile, 'utf8') };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const lines = (s: string): string[] =>
  s
    .split('\n')
    .filter((l) => l !== '')
    .sort();

const world = [
  'adguardhome',
  'banip',
  'base-files=1720~981c978eff',
  'custompkg@custom',
  'gawk',
  'hostapd-common',
  'kmod-mt7915e',
  'kernel=6.12.115~b5431106-r1',
  'sqm-scripts',
  'ucode',
  'wpad-basic-mbedtls',
  '',
].join('\n');

test('what MilkFlint changes is pinned at the version installed, by origin or by name', () => {
  const r = run(world);
  assert.equal(r.status, 0);
  const got = lines(r.world);
  for (const pin of [
    'adguardhome=0.107.80-r1',
    'wpad-basic-mbedtls=2025.08.26~ca266cc2-r6',
    'hostapd-common=2025.08.26~ca266cc2-r6',
    'gawk=5.3.2-r2',
    'sqm-scripts=1.8.0-r3',
    'banip=1.9.1-r2',
  ]) {
    assert.ok(got.includes(pin), pin);
  }
});

test('the rest stays as it was: OpenWrt’s own packages, kernel modules, pins and tags already there', () => {
  const got = lines(run(world).world);
  for (const same of ['ucode', 'kmod-mt7915e', 'base-files=1720~981c978eff', 'kernel=6.12.115~b5431106-r1', 'custompkg@custom']) {
    assert.ok(got.includes(same), same);
  }
  assert.ok(!got.some((l) => l.startsWith('ucode=') || l.startsWith('adguardhome@')));
});

test('one installed as another’s dependency, not in the world, is added pinned', () => {
  const got = lines(run(world).world);
  assert.ok(got.includes('wifi-scripts=1.0-r2'));
  // and one in neither the lists nor the world isn't
  assert.equal(got.length, lines(world).length + 1);
});

test('an entry the world already gives a version or a conflict is left alone, and not added again', () => {
  const r = run('hostapd-common>=2025\n!wpad-basic-mbedtls\ngawk~5.3\n');
  const got = lines(r.world);
  assert.ok(got.includes('hostapd-common>=2025'));
  assert.ok(got.includes('!wpad-basic-mbedtls'));
  assert.ok(got.includes('gawk~5.3'));
  assert.ok(!got.some((l) => l.startsWith('hostapd-common=') || l.startsWith('wpad-basic-mbedtls=') || l.startsWith('gawk=')));
});

test('a second run changes nothing', () => {
  const once = run(world).world;
  assert.equal(run(once).world, once);
});

test('a version is taken from its own package, not the next one in the database', () => {
  // a package without a version line (a broken record) isn't pinned, and doesn't lend the next one its fields
  const r = run('gawk\nucode\n', [
    { name: 'gawk', version: '', origin: 'feeds/base/milkflint/gawk' },
    { name: 'ucode', version: '2026.01.16~85922056-r2', origin: 'feeds/base/utils/ucode' },
  ]);
  assert.deepEqual(lines(r.world), ['gawk', 'ucode']);
});

test('without a package database it leaves the world alone, and succeeds', () => {
  const r = run(world, []);
  assert.equal(r.status, 0);
  assert.equal(r.world, world);
});

test('its lists: hostapd’s folder, the overrides (including AdGuard Home) by name and banIP; not kernel modules', () => {
  const block = /# BEGIN generated\n([\s\S]*?)# END generated/.exec(script)?.[1] ?? '';
  for (const want of [HOSTAPD, 'feeds/base/network/config/firewall4', 'adguardhome', 'gawk', 'sqm-scripts', 'banip']) {
    assert.ok(block.split(/\s+/).includes(want), want);
  }
  assert.ok(!block.includes('feeds/base/kernel/'));
});
