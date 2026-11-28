// The router's own scripts behind the Performance Tuning page's settings, run for
// real against a pretend /sys and uci: what they write for each setting, and
// that the page reads each setting the same way.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cakeExtrasOf } from '../src/features/sqm/cake-extras.ts';
import { aqlAutoTotal, aqlTotalOf, L4S_DEFAULT, RX_DELAY_DEFAULT, readKnobs } from '../src/features/tuning/knobs.ts';
import { functionsSh, uciExport } from './openwrt-shell.ts';

const scripts = fileURLToPath(new URL('../../../package/milkflint/milkflint-ui/files/features/tuning/bin/', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'tuning-scripts-'));
after(() => {
  rmSync(root, { recursive: true, force: true });
});

const cakeParams = join(root, 'sch_cake');
const ctParams = join(root, 'nf_conntrack');
const wifiParams = join(root, 'mt76_connac_lib');
const ethParams = join(root, 'mtk_eth');
// ifb's module folder (/sys/module/ifb), its parameters in it
const ifbModule = join(root, 'ifb');
const ifbParams = join(ifbModule, 'parameters');
const radio = join(root, 'ieee80211', 'phy0');
mkdirSync(cakeParams);
mkdirSync(ctParams);
mkdirSync(wifiParams);
mkdirSync(ethParams);
mkdirSync(ifbParams, { recursive: true });
mkdirSync(radio, { recursive: true });
mkdirSync(join(root, 'bin'));
// uci -q get <option>: from the environment, failing if unset, as uci does;
// uci -q show <config>.<section>: every option of it that's set
writeFileSync(
  join(root, 'bin', 'uci'),
  `#!/bin/sh
if [ "$2" = show ]; then
	p="UCI_$(echo "$3" | tr . _)_"
	env | while IFS='=' read -r k v; do
		case "$k" in "$p"*) printf "%s.%s='%s'\\n" "$3" "\${k#"$p"}" "$v" ;; esac
	done
	exit 0
fi
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

/** A script's copy with /sys pointing at the pretend files; its path */
function stage(name: string, dir = scripts): string {
  const text = readFileSync(join(dir, name), 'utf8')
    .replaceAll('/sys/module/sch_cake/parameters', cakeParams)
    .replaceAll('/sys/module/nf_conntrack/parameters', ctParams)
    .replaceAll('/sys/module/mt76_connac_lib/parameters', wifiParams)
    .replaceAll('/sys/module/mtk_eth/parameters', ethParams)
    .replaceAll('/sys/module/ifb', ifbModule)
    .replaceAll('/sys/kernel/debug/ieee80211', join(root, 'ieee80211'));
  const path = join(root, name);
  writeFileSync(path, text);
  return path;
}

/** The environment a script runs in: the pretend tools first; settings are uci option to value */
function envOf(settings: Record<string, string>, more: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = { PATH: `${join(root, 'bin')}:${process.env['PATH'] ?? ''}`, ...more };
  for (const [option, value] of Object.entries(settings)) env[`UCI_${option.replaceAll('.', '_')}`] = value;
  return env;
}

/** Runs a script with /sys pointing at the pretend files; settings are uci option to value */
function run(name: string, settings: Record<string, string>, args: string[] = [], dir = scripts): void {
  execFileSync('sh', [stage(name, dir), ...args], { env: envOf(settings), stdio: 'pipe' });
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

function rxDelay(settings: Record<string, string>): number {
  writeFileSync(join(ethParams, 'rx_dim_max_us'), '');
  run('rx-delay', settings);
  return Number(readFileSync(join(ethParams, 'rx_dim_max_us'), 'utf8'));
}

test('rx-delay: unset is the default, 80 µs, as the page shows it; a choice is written as set', () => {
  assert.equal(rxDelay({}), 80);
  assert.equal(rxDelay({}), RX_DELAY_DEFAULT);
  assert.equal(readKnobs(() => undefined).rxDelay, '');
  // 40, the driver's own default and MilkFlint's earlier one, now a choice
  for (const [v, want] of [
    ['40', 40],
    ['160', 160],
    ['0', 0],
    ['060', 60],
  ] as const) {
    assert.equal(rxDelay({ 'milkflint.steering.rx_delay': v }), want, v);
  }
  // what the script would ignore is the default, and the page reads it so too
  for (const v of ['abc', '-5', '1001', '2.5']) {
    assert.equal(rxDelay({ 'milkflint.steering.rx_delay': v }), 80, v);
    assert.equal(readKnobs((s, o) => (s === 'steering' && o === 'rx_delay' ? v : undefined)).rxDelay, '', `page, ${v}`);
  }
});

function ethDim(settings: Record<string, string>): { perRing: string; qdma: string } {
  writeFileSync(join(ethParams, 'rx_dim_per_ring'), '');
  writeFileSync(join(ethParams, 'qdma_tx_dim'), '');
  run('eth-dim', settings);
  return {
    perRing: readFileSync(join(ethParams, 'rx_dim_per_ring'), 'utf8').trim(),
    qdma: readFileSync(join(ethParams, 'qdma_tx_dim'), 'utf8').trim(),
  };
}

test('eth-dim: each switch on only with "1", as the page reads it; off otherwise, so clearing it takes', () => {
  assert.deepEqual(ethDim({}), { perRing: 'N', qdma: 'N' });
  assert.deepEqual(ethDim({ 'milkflint.steering.rx_dim_per_ring': '1' }), { perRing: 'Y', qdma: 'N' });
  assert.deepEqual(ethDim({ 'milkflint.steering.qdma_tx_dim': '1' }), { perRing: 'N', qdma: 'Y' });
  for (const v of ['0', 'Y', 'yes', 'on', '1; reboot', '']) {
    assert.deepEqual(ethDim({ 'milkflint.steering.rx_dim_per_ring': v, 'milkflint.steering.qdma_tx_dim': v }), {
      perRing: 'N',
      qdma: 'N',
    });
    const k = readKnobs((section) => (section === 'steering' ? v : undefined));
    assert.equal(k.rxDimPerRing || k.qdmaTxDim, false, v);
  }
});

test('eth-dim: an image without a parameter: the other is still set, and nothing is made', () => {
  rmSync(join(ethParams, 'rx_dim_per_ring'), { force: true });
  writeFileSync(join(ethParams, 'qdma_tx_dim'), '');
  run('eth-dim', { 'milkflint.steering.rx_dim_per_ring': '1', 'milkflint.steering.qdma_tx_dim': '1' });
  assert.equal(existsSync(join(ethParams, 'rx_dim_per_ring')), false);
  assert.equal(readFileSync(join(ethParams, 'qdma_tx_dim'), 'utf8').trim(), 'Y');
  rmSync(join(ethParams, 'qdma_tx_dim'), { force: true });
  run('eth-dim', { 'milkflint.steering.qdma_tx_dim': '1' });
  assert.equal(existsSync(join(ethParams, 'qdma_tx_dim')), false);
});

function shaper(settings: Record<string, string>): { drop: string; ahead: number } {
  writeFileSync(join(cakeParams, 'drop_one_segment'), '');
  writeFileSync(join(cakeParams, 'sparse_ahead_us'), '');
  run('cake-shaper', settings);
  return {
    drop: readFileSync(join(cakeParams, 'drop_one_segment'), 'utf8').trim(),
    ahead: Number(readFileSync(join(cakeParams, 'sparse_ahead_us'), 'utf8')),
  };
}

test('cake-shaper: nothing set is off for both, so clearing a setting takes', () => {
  assert.deepEqual(shaper({}), { drop: 'N', ahead: 0 });
  assert.deepEqual(shaper({ 'milkflint.cake.drop_one_segment': '1', 'milkflint.cake.sparse_ahead': '250' }), {
    drop: 'Y',
    ahead: 250,
  });
});

test('cake-shaper: one packet of a group only with "1", as the page reads it', () => {
  for (const v of ['0', 'Y', 'on', '1 ', '']) {
    assert.equal(shaper({ 'milkflint.cake.drop_one_segment': v }).drop, 'N', v);
    assert.equal(cakeExtrasOf(v, undefined).dropOneSegment, false, `page, ${v}`);
  }
  assert.equal(cakeExtrasOf('1', undefined).dropOneSegment, true);
});

test('cake-shaper: how far ahead, 1 to 1000 µs, as the page reads it; anything else off', () => {
  for (const [v, want] of [
    ['100', 100],
    ['250', 250],
    ['500', 500],
    ['0500', 500],
    ['1', 1],
    ['1000', 1000],
    ['0', 0],
    ['00', 0],
    ['1001', 0],
    ['01000', 0],
    ['99999', 0],
    ['-1', 0],
    ['2.5', 0],
    ['250us', 0],
    ['1; reboot', 0],
  ] as const) {
    assert.equal(shaper({ 'milkflint.cake.sparse_ahead': v }).ahead, want, v);
    const page = cakeExtrasOf(undefined, v).sparseAhead;
    assert.equal(page === '' ? 0 : Number(page), want, `page, ${v}`);
  }
});

test('cake-shaper: a sch_cake without a parameter: the other is still set, and nothing is made', () => {
  rmSync(join(cakeParams, 'drop_one_segment'), { force: true });
  writeFileSync(join(cakeParams, 'sparse_ahead_us'), '');
  run('cake-shaper', { 'milkflint.cake.drop_one_segment': '1', 'milkflint.cake.sparse_ahead': '100' });
  assert.equal(existsSync(join(cakeParams, 'drop_one_segment')), false);
  assert.equal(readFileSync(join(cakeParams, 'sparse_ahead_us'), 'utf8').trim(), '100');
});

function ifbDirect(settings: Record<string, string>): string {
  writeFileSync(join(ifbParams, 'direct_xmit'), '');
  run('ifb-direct', settings);
  return readFileSync(join(ifbParams, 'direct_xmit'), 'utf8').trim();
}

test('ifb-direct: on only with "1", as the page reads it; off otherwise, so clearing it takes', () => {
  assert.equal(ifbDirect({}), 'N');
  assert.equal(ifbDirect({ 'milkflint.cake.ifb_direct': '1' }), 'Y');
  assert.equal(cakeExtrasOf(undefined, undefined, '1').ifbDirect, true);
  for (const v of ['0', 'Y', 'yes', 'on', '1 ', '1; reboot', '']) {
    assert.equal(ifbDirect({ 'milkflint.cake.ifb_direct': v }), 'N', v);
    assert.equal(cakeExtrasOf(undefined, undefined, v).ifbDirect, false, `page, ${v}`);
  }
});

test('ifb-direct: ifb not loaded, nothing set (exit 1); loaded without the parameter, done and nothing made', () => {
  const away = `${ifbModule}.away`;
  renameSync(ifbModule, away);
  try {
    assert.equal(status('ifb-direct', { 'milkflint.cake.ifb_direct': '1' }), 1);
    assert.equal(existsSync(ifbModule), false);
  } finally {
    renameSync(away, ifbModule);
  }
  rmSync(join(ifbParams, 'direct_xmit'), { force: true });
  assert.equal(status('ifb-direct', { 'milkflint.cake.ifb_direct': '1' }), 0);
  assert.equal(existsSync(join(ifbParams, 'direct_xmit')), false);
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

/** A script's exit status, run as run() runs it */
function status(name: string, settings: Record<string, string>): number {
  try {
    run(name, settings);
    return 0;
  } catch (err) {
    return (err as { status?: number }).status ?? -1;
  }
}

/** Runs @f with sch_cake not loaded: its parameters folder gone, back after */
function withoutCake(f: () => void): void {
  const away = `${cakeParams}.away`;
  renameSync(cakeParams, away);
  try {
    f();
  } finally {
    renameSync(away, cakeParams);
  }
}

test('cake-ecn and cake-dscp: sch_cake not loaded, they say nothing of it was set (exit 1); conntrack’s side still is', () => {
  withoutCake(() => {
    writeFileSync(join(ctParams, 'dscp_learn'), '');
    assert.equal(status('cake-ecn', { 'milkflint.cake.ecn_drop': '16', 'milkflint.cake.l4s': '60' }), 1);
    assert.equal(status('cake-dscp', { 'milkflint.cake.dscp_restore': '1' }), 1);
    assert.equal(status('cake-shaper', { 'milkflint.cake.sparse_ahead': '250' }), 1);
    assert.equal(readFileSync(join(ctParams, 'dscp_learn'), 'utf8').trim(), '1');
  });
  // loaded: done
  writeFileSync(join(cakeParams, 'ecn_fail_count'), '');
  writeFileSync(join(cakeParams, 'l4s_ramp'), '');
  writeFileSync(join(cakeParams, 'dscp_restore'), '');
  assert.equal(status('cake-ecn', { 'milkflint.cake.ecn_drop': '16' }), 0);
  assert.equal(status('cake-dscp', {}), 0);
  assert.equal(status('cake-shaper', {}), 0);
});

const tuningInit = fileURLToPath(new URL('../../../package/milkflint/milkflint-ui/files/features/tuning/init', import.meta.url));

/**
 * milkflint-tuning's apply(), as a start (force) or a reload runs it: the
 * real cake-ecn, cake-dscp, cake-shaper and eth-dim against the pretend /sys, every other command
 * it runs a stand-in that does nothing
 */
function tuningApply(settings: Record<string, string>, force = false): void {
  const libexec = join(root, 'libexec');
  const initd = join(root, 'init.d');
  mkdirSync(libexec, { recursive: true });
  mkdirSync(initd, { recursive: true });
  for (const name of ['cake-ecn', 'cake-dscp', 'cake-shaper', 'eth-dim', 'ifb-direct']) {
    writeFileSync(join(libexec, name), readFileSync(stage(name), 'utf8'));
    chmodSync(join(libexec, name), 0o755);
  }
  for (const name of [
    'wed',
    'wifi-aql',
    'rx-delay',
    'wifi-vo-aggr',
    'wifi-spr',
    'wifi-twt',
    'wifi-muru',
    'wifi-retries',
    'gro',
  ]) {
    writeFileSync(join(libexec, name), '#!/bin/sh\nexit 0\n');
    chmodSync(join(libexec, name), 0o755);
  }
  // packet_steering disabled: nothing reloaded
  writeFileSync(join(initd, 'packet_steering'), '#!/bin/sh\nexit 1\n');
  chmodSync(join(initd, 'packet_steering'), 0o755);
  const text = readFileSync(tuningInit, 'utf8')
    .replaceAll('/var/run/milkflint-tuning', join(root, 'tuning-run'))
    .replaceAll('/usr/libexec/milkflint/', `${libexec}/`)
    .replaceAll('/etc/init.d/', `${initd}/`);
  writeFileSync(join(root, 'tuning-init'), text);
  execFileSync('sh', ['-c', `. "${join(root, 'tuning-init')}"; ${force ? 'FORCE=1; ' : ''}apply`], {
    env: envOf(settings),
    stdio: 'pipe',
  });
}

/** sch_cake's five parameters, as the module has them */
function cakeNow(): string[] {
  return ['ecn_fail_count', 'l4s_ramp', 'dscp_restore', 'drop_one_segment', 'sparse_ahead_us'].map((p) =>
    readFileSync(join(cakeParams, p), 'utf8').trim(),
  );
}

// sch_cake loads at boot (/etc/modules.d/sched-cake), before milkflint-tuning;
// were it loaded later, a run before then must not count as done
test('milkflint-tuning: CAKE’s settings from a run without sch_cake aren’t kept as done; the next reload puts them in', () => {
  const settings = {
    'milkflint.cake.ecn_drop': '16',
    'milkflint.cake.l4s': '60',
    'milkflint.cake.dscp_restore': '1',
    'milkflint.cake.drop_one_segment': '1',
    'milkflint.cake.sparse_ahead': '250',
  };
  rmSync(join(root, 'tuning-run'), { recursive: true, force: true });
  withoutCake(() => {
    tuningApply(settings, true);
  });
  assert.equal(existsSync(join(root, 'tuning-run', 'cake_ecn')), false);
  assert.equal(existsSync(join(root, 'tuning-run', 'cake_dscp')), false);
  assert.equal(existsSync(join(root, 'tuning-run', 'cake_shaper')), false);
  // another setting it ran is kept as done, as before
  assert.equal(existsSync(join(root, 'tuning-run', 'rx_delay')), true);

  // sch_cake loaded, with its defaults; a reload (the same settings) puts them in
  writeFileSync(join(cakeParams, 'ecn_fail_count'), '8');
  writeFileSync(join(cakeParams, 'l4s_ramp'), '100');
  writeFileSync(join(cakeParams, 'dscp_restore'), '0');
  writeFileSync(join(cakeParams, 'drop_one_segment'), 'N');
  writeFileSync(join(cakeParams, 'sparse_ahead_us'), '0');
  tuningApply(settings);
  assert.deepEqual(cakeNow(), ['16', '60', '1', 'Y', '250']);
  assert.equal(readFileSync(join(root, 'tuning-run', 'cake_ecn'), 'utf8').trim(), '16 60');
  assert.equal(readFileSync(join(root, 'tuning-run', 'cake_dscp'), 'utf8').trim(), '1');
  assert.equal(readFileSync(join(root, 'tuning-run', 'cake_shaper'), 'utf8').trim(), '1 250');

  // done: a reload with nothing changed leaves sch_cake alone
  writeFileSync(join(cakeParams, 'ecn_fail_count'), 'untouched');
  tuningApply(settings);
  assert.equal(readFileSync(join(cakeParams, 'ecn_fail_count'), 'utf8').trim(), 'untouched');
  // a changed setting goes in at the next reload
  tuningApply({ ...settings, 'milkflint.cake.ecn_drop': '32' });
  assert.equal(cakeNow()[0], '32');
  // and one cleared is off again, the others left alone
  writeFileSync(join(cakeParams, 'ecn_fail_count'), 'untouched');
  tuningApply({ ...settings, 'milkflint.cake.ecn_drop': '32', 'milkflint.cake.sparse_ahead': '' });
  assert.deepEqual(cakeNow().slice(3), ['Y', '0']);
  assert.equal(cakeNow()[0], 'untouched');
});

test('milkflint-tuning: the Ethernet’s moderation switches go in when they change, and only then', () => {
  rmSync(join(root, 'tuning-run'), { recursive: true, force: true });
  writeFileSync(join(ethParams, 'rx_dim_per_ring'), 'N');
  writeFileSync(join(ethParams, 'qdma_tx_dim'), 'N');
  const eth = (): string[] => ['rx_dim_per_ring', 'qdma_tx_dim'].map((p) => readFileSync(join(ethParams, p), 'utf8').trim());
  tuningApply({ 'milkflint.steering.qdma_tx_dim': '1' }, true);
  assert.deepEqual(eth(), ['N', 'Y']);
  writeFileSync(join(ethParams, 'qdma_tx_dim'), 'untouched');
  tuningApply({ 'milkflint.steering.qdma_tx_dim': '1' });
  assert.deepEqual(eth(), ['N', 'untouched']);
  tuningApply({ 'milkflint.steering.rx_dim_per_ring': '1' });
  assert.deepEqual(eth(), ['Y', 'N']);
});

// ifb autoloads at boot (/etc/modules.d/34-ifb), before milkflint-tuning;
// were it loaded later, a run before then must not count as done
test('milkflint-tuning: the ifb hand-back from a run without ifb isn’t kept as done; the next reload puts it in', () => {
  rmSync(join(root, 'tuning-run'), { recursive: true, force: true });
  const away = `${ifbModule}.away`;
  renameSync(ifbModule, away);
  try {
    tuningApply({ 'milkflint.cake.ifb_direct': '1' }, true);
  } finally {
    renameSync(away, ifbModule);
  }
  assert.equal(existsSync(join(root, 'tuning-run', 'ifb_direct')), false);
  writeFileSync(join(ifbParams, 'direct_xmit'), 'N');
  tuningApply({ 'milkflint.cake.ifb_direct': '1' });
  assert.equal(readFileSync(join(ifbParams, 'direct_xmit'), 'utf8').trim(), 'Y');
  assert.equal(readFileSync(join(root, 'tuning-run', 'ifb_direct'), 'utf8').trim(), '1');
  // kept as done: unchanged, not written again; cleared, off
  writeFileSync(join(ifbParams, 'direct_xmit'), 'untouched');
  tuningApply({ 'milkflint.cake.ifb_direct': '1' });
  assert.equal(readFileSync(join(ifbParams, 'direct_xmit'), 'utf8').trim(), 'untouched');
  tuningApply({});
  assert.equal(readFileSync(join(ifbParams, 'direct_xmit'), 'utf8').trim(), 'N');
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

const TWT_DEFAULTS = [
  'min_interval_ms 0',
  'max_interval_ms 60000',
  'min_interval_ms 0',
  'min_wake_dur 64',
  'max_flows 16',
  'max_sta_flows 8',
  'trigger allow',
];

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
    [
      'min_interval_ms 0',
      'max_interval_ms 5000',
      'min_interval_ms 100',
      'min_wake_dur 128',
      'max_flows 4',
      'max_sta_flows 2',
      'trigger never',
    ],
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

function muruFile(phy: string): string {
  const dir = join(root, 'ieee80211', phy, 'mt76');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'muru');
}

function muru(settings: Record<string, string>, args: string[] = []): Record<string, string> {
  const phys = ['phy0', 'phy1', 'phy2'];
  for (const phy of phys) writeFileSync(muruFile(phy), 'untouched');
  run('wifi-muru', settings, args, wifiBin);
  return Object.fromEntries(phys.map((phy) => [phy, readFileSync(muruFile(phy), 'utf8').trim()]));
}

const MURU_DEFAULT_LINE = 'ofdma_dl=1 ofdma_ul=0 mimo_dl=1 mimo_ul=0';

test('wifi-muru: defaults have download on and upload off, per band', () => {
  assert.deepEqual(muru({}), {
    phy0: MURU_DEFAULT_LINE,
    phy1: MURU_DEFAULT_LINE,
    phy2: MURU_DEFAULT_LINE,
  });
  assert.deepEqual(
    muru({
      'milkflint.wifi.muru_5g_ofdma_dl': '0',
      'milkflint.wifi.muru_5g_mimo_dl': '0',
      'milkflint.wifi.muru_2g_mimo_ul': '1',
      'milkflint.wifi.muru_6g_ofdma_ul': '1',
    }),
    {
      phy0: 'ofdma_dl=1 ofdma_ul=0 mimo_dl=1 mimo_ul=1',
      phy1: 'ofdma_dl=0 ofdma_ul=0 mimo_dl=0 mimo_ul=0',
      phy2: 'ofdma_dl=1 ofdma_ul=1 mimo_dl=1 mimo_ul=0',
    },
  );
});

test('wifi-muru: invalid values fall back to safe defaults', () => {
  assert.deepEqual(
    muru({
      'milkflint.wifi.muru_5g_ofdma_dl': '0; reboot',
      'milkflint.wifi.muru_5g_mimo_ul': '1; reboot',
      'milkflint.wifi.muru_5g_ofdma_ul': 'yes',
    }),
    { phy0: MURU_DEFAULT_LINE, phy1: MURU_DEFAULT_LINE, phy2: MURU_DEFAULT_LINE },
  );
});

test('wifi-muru: only the radios named, and a driver refusal does not stop the others', () => {
  assert.deepEqual(muru({ 'milkflint.wifi.muru_5g_mimo_dl': '0' }, ['phy1']), {
    phy0: 'untouched',
    phy1: 'ofdma_dl=1 ofdma_ul=0 mimo_dl=0 mimo_ul=0',
    phy2: 'untouched',
  });
  for (const phy of ['phy1', 'phy2']) writeFileSync(muruFile(phy), 'untouched');
  rmSync(muruFile('phy0'), { force: true });
  mkdirSync(muruFile('phy0'));
  run('wifi-muru', { 'milkflint.wifi.muru_5g_ofdma_dl': '0', 'milkflint.wifi.muru_6g_mimo_ul': '1' }, [], wifiBin);
  assert.equal(readFileSync(muruFile('phy1'), 'utf8').trim(), 'ofdma_dl=0 ofdma_ul=0 mimo_dl=1 mimo_ul=0');
  assert.equal(readFileSync(muruFile('phy2'), 'utf8').trim(), 'ofdma_dl=1 ofdma_ul=0 mimo_dl=1 mimo_ul=1');
  rmSync(muruFile('phy0'), { recursive: true, force: true });
});

test('wifi-muru: a driver without the file is left alone', () => {
  rmSync(join(root, 'ieee80211', 'phy1'), { recursive: true, force: true });
  mkdirSync(join(root, 'ieee80211', 'phy1'));
  run('wifi-muru', { 'milkflint.wifi.muru_5g_mimo_dl': '0' }, ['phy1'], wifiBin);
  assert.throws(() => readFileSync(join(root, 'ieee80211', 'phy1', 'mt76', 'muru')));
});

const wifiHotplug = fileURLToPath(
  new URL('../../../package/milkflint/milkflint-ui/files/features/wifi/hotplug.d/ieee80211/', import.meta.url),
);

/**
 * The ieee80211 hotplug, sourced as hotplug-call does, against the pretend /sys; it
 * runs wifi-muru in the background, which here it does in the foreground.
 * What each radio's muru file holds after.
 */
function muruHotplug(env: Record<string, string>, settings: Record<string, string> = {}): Record<string, string> {
  const phys = ['phy0', 'phy1', 'phy2'];
  for (const phy of phys) writeFileSync(muruFile(phy), 'untouched');
  const helper = stage('wifi-muru', wifiBin);
  const original = readFileSync(join(wifiHotplug, '35-milkflint-muru-flags'), 'utf8');
  const text = original
    .replaceAll('/sys/kernel/debug/ieee80211', join(root, 'ieee80211'))
    .replaceAll('/usr/libexec/milkflint/wifi-muru', `sh ${helper}`)
    .replace(') > /dev/null 2>&1 &\n', ') > /dev/null 2>&1\n');
  assert.notEqual(text, original);
  assert.ok(!text.includes('2>&1 &'), 'the hotplug still leaves its job in the background');
  const path = join(root, 'muru.hotplug');
  writeFileSync(path, text);
  execFileSync('sh', ['-c', `. ${path}`], { env: envOf(settings, env), stdio: 'pipe' });
  return Object.fromEntries(phys.map((phy) => [phy, readFileSync(muruFile(phy), 'utf8').trim()]));
}

const UNTOUCHED = { phy0: 'untouched', phy1: 'untouched', phy2: 'untouched' };

test('muru hotplug: only a radio that appears, and only with a setting of its own', () => {
  const set = { 'milkflint.wifi.muru_5g_mimo_dl': '0' };
  assert.deepEqual(muruHotplug({ ACTION: 'remove', DEVICENAME: 'phy1' }, set), UNTOUCHED);
  // none set: the driver starts on the defaults, nothing to write
  assert.deepEqual(muruHotplug({ ACTION: 'add', DEVICENAME: 'phy1' }), UNTOUCHED);
  // another feature's settings don't count
  assert.deepEqual(muruHotplug({ ACTION: 'add', DEVICENAME: 'phy1' }, { 'milkflint.wifi.twt_5g_flows': '4' }), UNTOUCHED);
  assert.deepEqual(muruHotplug({ ACTION: 'add', DEVICENAME: 'phy1' }, set), {
    ...UNTOUCHED,
    phy1: 'ofdma_dl=1 ofdma_ul=0 mimo_dl=0 mimo_ul=0',
  });
});

test('muru hotplug: the radio from DEVPATH when there is no DEVICENAME', () => {
  assert.deepEqual(
    muruHotplug(
      { ACTION: 'add', DEVPATH: '/devices/platform/soc/18000000.wifi/ieee80211/phy2' },
      { 'milkflint.wifi.muru_6g_mimo_ul': '1' },
    ),
    { ...UNTOUCHED, phy2: 'ofdma_dl=1 ofdma_ul=0 mimo_dl=1 mimo_ul=1' },
  );
});

/** gro show, against a pretend /etc/config/sqm (each section a queue) and a wan on eth1 */
function groShow(queues: Record<string, Record<string, string>>): string {
  const r = join(root, 'gro');
  rmSync(r, { recursive: true, force: true });
  for (const d of [
    'etc/config',
    'lib/functions',
    'sys/class/net/eth1/device',
    'sys/class/net/br-guest',
    'sys/class/net/wg_out',
    'var/run',
  ])
    mkdirSync(join(r, d), { recursive: true });
  writeFileSync(join(r, 'etc/config/sqm'), uciExport('sqm', 'queue', queues));
  writeFileSync(join(r, 'lib/functions.sh'), functionsSh(join(r, 'etc/config')));
  writeFileSync(join(r, 'lib/functions/network.sh'), 'network_get_physdev() { eval "$1=eth1"; }\n');
  const text = readFileSync(join(scripts, 'gro'), 'utf8')
    .replaceAll('. /lib/functions.sh', `. ${join(r, 'lib/functions.sh')}`)
    .replaceAll('. /lib/functions/network.sh', `. ${join(r, 'lib/functions/network.sh')}`)
    .replaceAll('/sys/class/net', join(r, 'sys/class/net'))
    .replaceAll('/var/run/milkflint-tuning', join(r, 'var/run'));
  writeFileSync(join(r, 'gro'), text);
  return execFileSync('dash', [join(r, 'gro'), 'show'], {
    env: { PATH: `${join(root, 'bin')}:/usr/bin:/bin` },
    encoding: 'utf8',
  }).trim();
}

const NO_QUEUE = 'dev=eth1 mode=fraglist auto=fraglist udp=0 max=65536 whole=0 offload=0';
const WHOLE = 'dev=eth1 mode=plain auto=plain udp=1 max=16384 whole=1 offload=0';
const wanQueue = { enabled: '1', interface: 'eth1', download: '650000', iqdisc_opts: 'no-split-gso' };
const vpnQueue = { enabled: '1', interface: 'wg_out', download: '70000', iqdisc_opts: 'dual-dsthost nat' };
const guestQueue = { enabled: '1', interface: 'br-guest', download: '25000', iqdisc_opts: 'dual-srchost' };

test('gro: the internet queue’s download options decide, whatever comes before it', () => {
  assert.equal(groShow({}), NO_QUEUE);
  assert.equal(groShow({ wan: wanQueue }), WHOLE);
  assert.equal(groShow({ guest: guestQueue, vpn: vpnQueue, wan: wanQueue }), WHOLE);
});

test('gro: with the internet queue off, a guest network’s or the VPN’s options don’t count', () => {
  const off = { ...wanQueue, enabled: '0' };
  assert.equal(groShow({ wan: off, vpn: { ...vpnQueue, iqdisc_opts: 'no-split-gso' } }), NO_QUEUE);
  assert.equal(groShow({ wan: off, guest: { ...guestQueue, iqdisc_opts: 'no-split-gso' } }), NO_QUEUE);
});
