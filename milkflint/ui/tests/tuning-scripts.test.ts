// The router's own scripts behind the Performance Tuning page's settings, run for
// real against a pretend /sys and uci: what they write for each setting, and
// that the page reads each setting the same way.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { aqlAutoTotal, aqlTotalOf, L4S_DEFAULT, readKnobs } from '../src/features/tuning/knobs.ts';

const scripts = fileURLToPath(new URL('../../../package/milkflint/milkflint-ui/files/features/tuning/bin/', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'tuning-scripts-'));
after(() => {
  rmSync(root, { recursive: true, force: true });
});

const cakeParams = join(root, 'sch_cake');
const ctParams = join(root, 'nf_conntrack');
const wifiParams = join(root, 'mt76_connac_lib');
const radio = join(root, 'ieee80211', 'phy0');
mkdirSync(cakeParams);
mkdirSync(ctParams);
mkdirSync(wifiParams);
mkdirSync(radio, { recursive: true });
mkdirSync(join(root, 'bin'));
// uci -q get <option>: from the environment, failing if unset, as uci does
writeFileSync(
  join(root, 'bin', 'uci'),
  `#!/bin/sh
n=$(echo "$3" | tr . _)
eval "[ -n \\"\\\${UCI_$n+x}\\" ]" || exit 1
eval "printf '%s\\n' \\"\\$UCI_$n\\""
`,
);
writeFileSync(join(root, 'bin', 'logger'), '#!/bin/sh\nexit 0\n');
// iw phy <phy> info: phy0 is 2.4 GHz, phy1 5 GHz, phy2 6 GHz
writeFileSync(
  join(root, 'bin', 'iw'),
  `#!/bin/sh
case "$2" in
phy0) echo "Wiphy phy0"; echo "	Band 1:" ;;
phy1) echo "Wiphy phy1"; echo "	Band 2:" ;;
phy2) echo "Wiphy phy2"; echo "	Band 4:" ;;
esac
`,
);
chmodSync(join(root, 'bin', 'uci'), 0o755);
chmodSync(join(root, 'bin', 'logger'), 0o755);
chmodSync(join(root, 'bin', 'iw'), 0o755);

/** Runs a script with /sys pointing at the pretend files; settings are uci option to value */
function run(name: string, settings: Record<string, string>, args: string[] = [], dir = scripts): void {
  const text = readFileSync(join(dir, name), 'utf8')
    .replaceAll('/sys/module/sch_cake/parameters', cakeParams)
    .replaceAll('/sys/module/nf_conntrack/parameters', ctParams)
    .replaceAll('/sys/module/mt76_connac_lib/parameters', wifiParams)
    .replaceAll('/sys/kernel/debug/ieee80211', join(root, 'ieee80211'));
  const env: Record<string, string> = { PATH: `${join(root, 'bin')}:${process.env['PATH'] ?? ''}` };
  for (const [option, value] of Object.entries(settings)) env[`UCI_${option.replaceAll('.', '_')}`] = value;
  const path = join(root, name);
  writeFileSync(path, text);
  execFileSync('sh', [path, ...args], { env, stdio: 'pipe' });
}

function aql(settings: Record<string, string>): { limits: string; total: number } {
  writeFileSync(join(radio, 'aql_txq_limit'), '');
  writeFileSync(join(radio, 'aql_threshold'), '');
  run('wifi-aql', settings);
  return {
    limits: readFileSync(join(radio, 'aql_txq_limit'), 'utf8').trim(),
    total: Number(readFileSync(join(radio, 'aql_threshold'), 'utf8')),
  };
}

test('wifi-aql: the limits and the total for each setting', () => {
  const be = 'milkflint.wifi.aql_be';
  const total = 'milkflint.wifi.aql_threshold';
  assert.deepEqual(aql({}), { limits: '2 2500 5000', total: 6000 });
  assert.deepEqual(aql({ [be]: 'off' }), { limits: '2 5000 12000', total: 24_000 });
  assert.deepEqual(aql({ [be]: '3000 8000' }), { limits: '2 3000 8000', total: 9600 });
  assert.deepEqual(aql({ [be]: '03000 08000' }), { limits: '2 03000 08000', total: 9600 });
  assert.deepEqual(aql({ [be]: 'junk' }), { limits: '2 2500 5000', total: 6000 });
  assert.deepEqual(aql({ [total]: '8000' }), { limits: '2 2500 5000', total: 8000 });
  assert.deepEqual(aql({ [total]: '08000' }), { limits: '2 2500 5000', total: 8000 });
  assert.deepEqual(aql({ [total]: '24000' }), { limits: '2 2500 5000', total: 24_000 });
  assert.deepEqual(aql({ [be]: 'off', [total]: '12000' }), { limits: '2 5000 12000', total: 12_000 });
  // never under the high limit, so a device on its own isn't held back; automatic instead
  assert.deepEqual(aql({ [total]: '4999' }), { limits: '2 2500 5000', total: 6000 });
  assert.deepEqual(aql({ [be]: 'off', [total]: '9000' }), { limits: '2 5000 12000', total: 24_000 });
  assert.deepEqual(aql({ [be]: '3000 8000', [total]: '7999' }), { limits: '2 3000 8000', total: 9600 });
  assert.deepEqual(aql({ [total]: '50001' }), { limits: '2 2500 5000', total: 6000 });
  assert.deepEqual(aql({ [total]: 'abc' }), { limits: '2 2500 5000', total: 6000 });
  assert.deepEqual(aql({ [total]: '-1' }), { limits: '2 2500 5000', total: 6000 });
});

test('wifi-aql and the page agree on the automatic total, and on what is automatic', () => {
  assert.equal(aql({}).total, aqlAutoTotal(5000, false));
  assert.equal(aql({ 'milkflint.wifi.aql_be': 'off' }).total, aqlAutoTotal(12_000, true));
  assert.equal(aql({ 'milkflint.wifi.aql_be': '3000 8000' }).total, aqlAutoTotal(8000, false));
  for (const v of ['abc', '-1', '1234567', '']) {
    assert.equal(aqlTotalOf(v).aqlTotal, 'auto', v);
    assert.equal(aql({ 'milkflint.wifi.aql_threshold': v }).total, 6000, v);
  }
});

function cake(settings: Record<string, string>): { fail: number; ramp: number } {
  writeFileSync(join(cakeParams, 'ecn_fail_count'), '');
  writeFileSync(join(cakeParams, 'l4s_ramp'), '');
  run('cake-ecn', settings);
  return {
    fail: Number(readFileSync(join(cakeParams, 'ecn_fail_count'), 'utf8')),
    ramp: Number(readFileSync(join(cakeParams, 'l4s_ramp'), 'utf8')),
  };
}

test('cake-ecn: where L4S marking starts, for each setting, as the page reads it', () => {
  const pageRamp = (v: string): number => {
    const l4s = readKnobs((section, option) => (section === 'cake' && option === 'l4s' ? v : undefined)).l4s;
    return l4s === '' ? L4S_DEFAULT : Number(l4s);
  };
  for (const [v, want] of [
    ['100', 100],
    ['60', 60],
    ['060', 60],
    ['200', 200],
    ['20', 20],
    ['400', 400],
    ['0', 0],
    ['00', 0],
    ['19', 100],
    ['401', 100],
    ['off', 100],
    ['-1', 100],
    ['1234567', 100],
  ] as const) {
    assert.equal(cake({ 'milkflint.cake.l4s': v }).ramp, want, v);
    assert.equal(pageRamp(v), want, `page, ${v}`);
  }
  assert.equal(cake({}).ramp, 100);
});

test('cake-ecn: the ECN drop setting beside it is untouched', () => {
  assert.deepEqual(cake({}), { fail: 8, ramp: 100 });
  assert.deepEqual(cake({ 'milkflint.cake.ecn_drop': '0', 'milkflint.cake.l4s': '0' }), { fail: 0, ramp: 0 });
  assert.deepEqual(cake({ 'milkflint.cake.ecn_drop': '256', 'milkflint.cake.l4s': '60' }), { fail: 256, ramp: 60 });
});

test('cake-ecn: an image whose sch_cake has no L4S ramp is left alone', () => {
  rmSync(join(cakeParams, 'l4s_ramp'));
  writeFileSync(join(cakeParams, 'ecn_fail_count'), '');
  run('cake-ecn', { 'milkflint.cake.l4s': '60', 'milkflint.cake.ecn_drop': '16' });
  assert.equal(Number(readFileSync(join(cakeParams, 'ecn_fail_count'), 'utf8')), 16);
});

function dscp(settings: Record<string, string>): { learn: string; restore: string } {
  writeFileSync(join(ctParams, 'dscp_learn'), '');
  writeFileSync(join(cakeParams, 'dscp_restore'), '');
  run('cake-dscp', settings);
  return {
    learn: readFileSync(join(ctParams, 'dscp_learn'), 'utf8').trim(),
    restore: readFileSync(join(cakeParams, 'dscp_restore'), 'utf8').trim(),
  };
}

test('cake-dscp: conntrack and sch_cake go on and off together', () => {
  assert.deepEqual(dscp({ 'milkflint.cake.dscp_restore': '1' }), { learn: '1', restore: '1' });
  assert.deepEqual(dscp({ 'milkflint.cake.dscp_restore': '0' }), { learn: '0', restore: '0' });
  assert.deepEqual(dscp({}), { learn: '0', restore: '0' });
  assert.deepEqual(dscp({ 'milkflint.cake.dscp_restore': 'yes' }), { learn: '0', restore: '0' });
});

test('cake-dscp: the voice queue’s aggregation is wifi-vo-aggr’s', () => {
  writeFileSync(join(wifiParams, 'vo_aggr'), 'untouched');
  run('cake-dscp', { 'milkflint.cake.dscp_restore': '1' });
  assert.equal(readFileSync(join(wifiParams, 'vo_aggr'), 'utf8'), 'untouched');
});

function voAggr(settings: Record<string, string>): string {
  writeFileSync(join(wifiParams, 'vo_aggr'), '');
  run('wifi-vo-aggr', settings);
  return readFileSync(join(wifiParams, 'vo_aggr'), 'utf8').trim();
}

test('wifi-vo-aggr: on unless it is set to 0, whatever restored DSCP does', () => {
  const restore = 'milkflint.cake.dscp_restore';
  const setting = 'milkflint.wifi.vo_aggr';
  assert.equal(voAggr({}), '1');
  assert.equal(voAggr({ [restore]: '1' }), '1');
  assert.equal(voAggr({ [restore]: '0' }), '1');
  assert.equal(voAggr({ [setting]: '0' }), '0');
  assert.equal(voAggr({ [setting]: '0', [restore]: '1' }), '0');
  assert.equal(voAggr({ [setting]: '1', [restore]: '0' }), '1');
});

test('wifi-vo-aggr: anything but 0 is on, as the page reads it', () => {
  for (const v of ['1', '2', 'on', 'off', '0 ; reboot', '']) {
    assert.equal(voAggr({ 'milkflint.wifi.vo_aggr': v }), '1', v);
    assert.equal(readKnobs((section, option) => (section === 'wifi' && option === 'vo_aggr' ? v : undefined)).voAggr, '', v);
  }
  assert.equal(voAggr({ 'milkflint.wifi.vo_aggr': '0' }), '0');
  assert.equal(readKnobs((section, option) => (section === 'wifi' && option === 'vo_aggr' ? '0' : undefined)).voAggr, '0');
});

test('wifi-vo-aggr: turned off, the sessions already running stop at once; turned on, nothing is stopped', () => {
  const dir = join(radio, 'netdev:phy0-ap0', 'stations', '02:00:00:00:00:01');
  mkdirSync(dir, { recursive: true });
  const status = join(dir, 'agg_status');
  writeFileSync(status, 'untouched');
  voAggr({});
  assert.equal(readFileSync(status, 'utf8'), 'untouched');
  voAggr({ 'milkflint.wifi.vo_aggr': '0' });
  // the last of the two: TIDs 6 and 7
  assert.equal(readFileSync(status, 'utf8').trim(), 'tx stop 7');
  rmSync(join(radio, 'netdev:phy0-ap0'), { recursive: true, force: true });
});

test('wifi-vo-aggr: an image whose driver has no such setting is left alone', () => {
  rmSync(join(wifiParams, 'vo_aggr'), { force: true });
  run('wifi-vo-aggr', { 'milkflint.wifi.vo_aggr': '1' });
  assert.throws(() => readFileSync(join(wifiParams, 'vo_aggr')));
});

test('cake-dscp: sch_cake not loaded yet, or an image without the parameters', () => {
  rmSync(join(cakeParams, 'dscp_restore'), { force: true });
  writeFileSync(join(ctParams, 'dscp_learn'), '');
  run('cake-dscp', { 'milkflint.cake.dscp_restore': '1' });
  assert.equal(readFileSync(join(ctParams, 'dscp_learn'), 'utf8').trim(), '1');
  rmSync(join(ctParams, 'dscp_learn'), { force: true });
  run('cake-dscp', { 'milkflint.cake.dscp_restore': '1' });
});

const wifiBin = fileURLToPath(new URL('../../../package/milkflint/milkflint-ui/files/features/wifi/bin/', import.meta.url));

function sprFile(phy: string): string {
  const dir = join(root, 'ieee80211', phy, 'mt76');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'spatial_reuse');
}

function spr(settings: Record<string, string>, args: string[] = []): Record<string, string> {
  const phys = ['phy0', 'phy1', 'phy2'];
  for (const phy of phys) writeFileSync(sprFile(phy), 'untouched');
  run('wifi-spr', settings, args, wifiBin);
  return Object.fromEntries(phys.map((phy) => [phy, readFileSync(sprFile(phy), 'utf8').trim()]));
}

test('wifi-spr: each radio by its band, every one with no argument', () => {
  assert.deepEqual(spr({ 'milkflint.wifi.spr_5g': 'off' }), { phy0: 'auto', phy1: 'off', phy2: 'auto' });
  assert.deepEqual(spr({ 'milkflint.wifi.spr_2g': 'fixed', 'milkflint.wifi.spr_5g': 'off', 'milkflint.wifi.spr_6g': 'fixed' }), {
    phy0: 'fixed',
    phy1: 'off',
    phy2: 'fixed',
  });
  assert.deepEqual(spr({}), { phy0: 'auto', phy1: 'auto', phy2: 'auto' });
});

test('wifi-spr: anything else is auto', () => {
  assert.deepEqual(spr({ 'milkflint.wifi.spr_5g': 'on' }), { phy0: 'auto', phy1: 'auto', phy2: 'auto' });
  assert.deepEqual(spr({ 'milkflint.wifi.spr_5g': 'off; reboot' }), { phy0: 'auto', phy1: 'auto', phy2: 'auto' });
});

test('wifi-spr: only the radios named', () => {
  assert.deepEqual(spr({ 'milkflint.wifi.spr_5g': 'off' }, ['phy1']), { phy0: 'untouched', phy1: 'off', phy2: 'untouched' });
});

test('wifi-spr: a radio whose driver refuses it doesn’t stop the others', () => {
  for (const phy of ['phy1', 'phy2']) writeFileSync(sprFile(phy), 'untouched');
  // a write that fails, as the driver's does when the firmware refuses
  rmSync(sprFile('phy0'), { force: true });
  mkdirSync(sprFile('phy0'));
  run('wifi-spr', { 'milkflint.wifi.spr_5g': 'off', 'milkflint.wifi.spr_6g': 'fixed' }, [], wifiBin);
  assert.equal(readFileSync(sprFile('phy1'), 'utf8').trim(), 'off');
  assert.equal(readFileSync(sprFile('phy2'), 'utf8').trim(), 'fixed');
  rmSync(sprFile('phy0'), { recursive: true, force: true });
});

test('wifi-spr: a driver without the file is left alone', () => {
  rmSync(join(root, 'ieee80211', 'phy1'), { recursive: true, force: true });
  mkdirSync(join(root, 'ieee80211', 'phy1'));
  run('wifi-spr', { 'milkflint.wifi.spr_5g': 'off' }, ['phy1'], wifiBin);
  assert.throws(() => readFileSync(join(root, 'ieee80211', 'phy1', 'mt76', 'spatial_reuse')));
});

function twtFile(phy: string): string {
  const dir = join(root, 'ieee80211', phy, 'mt76');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'twt_policy');
}

function twt(settings: Record<string, string>, phy = 'phy1'): string[] {
  rmSync(twtFile(phy), { force: true });
  writeFileSync(twtFile(phy), '');
  run('wifi-twt', settings, [phy], wifiBin);
  return readFileSync(twtFile(phy), 'utf8').trim().split('\n');
}

const TWT_DEFAULTS = ['min_interval_ms 0', 'max_interval_ms 60000', 'min_interval_ms 0', 'min_wake_dur 64', 'max_flows 16', 'max_sta_flows 8', 'trigger allow'];

test('wifi-twt: nothing set writes the driver’s defaults, so that clearing a setting takes', () => {
  assert.deepEqual(twt({}), TWT_DEFAULTS);
});

test('wifi-twt: the radio’s band’s settings, the shortest cleared first as the driver checks it against the longest', () => {
  assert.deepEqual(
    twt({
      'milkflint.wifi.twt_5g_max_interval': '5000',
      'milkflint.wifi.twt_5g_min_interval': '100',
      'milkflint.wifi.twt_5g_min_wake': '128',
      'milkflint.wifi.twt_5g_flows': '4',
      'milkflint.wifi.twt_5g_sta_flows': '2',
      'milkflint.wifi.twt_5g_trigger': 'never',
      'milkflint.wifi.twt_2g_max_interval': '100',
    }),
    ['min_interval_ms 0', 'max_interval_ms 5000', 'min_interval_ms 100', 'min_wake_dur 128', 'max_flows 4', 'max_sta_flows 2', 'trigger never'],
  );
  assert.equal(twt({ 'milkflint.wifi.twt_2g_max_interval': '100' }, 'phy0')[1], 'max_interval_ms 100');
});

test('wifi-twt: what the driver couldn’t take isn’t written', () => {
  assert.deepEqual(
    twt({
      'milkflint.wifi.twt_5g_max_interval': '1; reboot',
      'milkflint.wifi.twt_5g_min_interval': '99999999999',
      'milkflint.wifi.twt_5g_min_wake': '256',
      'milkflint.wifi.twt_5g_flows': '17',
      'milkflint.wifi.twt_5g_sta_flows': '9',
      'milkflint.wifi.twt_5g_trigger': 'sometimes; reboot',
    }),
    TWT_DEFAULTS,
  );
});

test('wifi-twt: a driver without the file is left alone', () => {
  rmSync(join(root, 'ieee80211', 'phy1'), { recursive: true, force: true });
  mkdirSync(join(root, 'ieee80211', 'phy1'));
  run('wifi-twt', { 'milkflint.wifi.twt_5g_flows': '4' }, ['phy1'], wifiBin);
  assert.throws(() => readFileSync(join(root, 'ieee80211', 'phy1', 'mt76', 'twt_policy')));
});
