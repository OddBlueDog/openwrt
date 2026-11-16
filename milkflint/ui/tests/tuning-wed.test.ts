// Hardware offloading with Wireless Ethernet Dispatch: the page's model
// (src/features/tuning/wed.ts) and the router's script
// (features/tuning/bin/wed), run for real against a pretend uci, /sys, fw4 and
// nft. What each turns off, turns on, remembers and puts back, that a second
// run changes nothing, and that the page's save and the router's guard leave
// the same settings behind.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Change, Section } from '../src/lib/api/uci.ts';
import {
  queuesTurnedOff,
  speedsText,
  type WedConfig,
  wedEffects,
  wedNeedsRestart,
  wedNow,
  wedOffChanges,
  wedOn,
  wedOnChanges,
  wedRestores,
} from '../src/features/tuning/wed.ts';

/** A pretend router's settings: config, then section, then option; a section's type is its ".type". */
type Options = Record<string, string>;
interface State {
  milkflint: Record<string, Options>;
  sqm: Record<string, Options>;
  firewall: Record<string, Options>;
}
type Config = keyof State;

/** a section's options; fails the test if it isn't there */
function sec(state: State, config: Config, name: string): Options {
  const s = state[config][name];
  assert.ok(s !== undefined, `no section ${config}.${name}`);
  return s;
}

/** the sections of a config without one of them */
function without(sections: Record<string, Options>, name: string): Record<string, Options> {
  return Object.fromEntries(Object.entries(sections).filter(([n]) => n !== name));
}

/** a section's options without one of them */
function unset(options: Options, option: string): Options {
  return Object.fromEntries(Object.entries(options).filter(([o]) => o !== option));
}

/** A household's: Smart Queue on the internet port, a guest speed limit, a VPN's queue, software offloading. */
function household(): State {
  return {
    milkflint: { wifi: { '.type': 'wifi', aql_be: '3000 8000' }, steering: { '.type': 'steering', rx_delay: '20' } },
    sqm: {
      eth1: { '.type': 'queue', enabled: '1', interface: 'eth1', download: '600000', upload: '60000' },
      guest: { '.type': 'queue', enabled: '1', interface: 'br-guest', download: '25000', upload: '0' },
      vpn: { '.type': 'queue', enabled: '1', interface: 'wg_out', download: '50000', upload: '20000' },
      spare: { '.type': 'queue', enabled: '0', interface: 'eth2', download: '1000', upload: '1000' },
    },
    firewall: { cfg01: { '.type': 'defaults', flow_offloading: '1', syn_flood: '1' }, lan: { '.type': 'zone', name: 'lan' } },
  };
}

function sections(state: State, config: Config): Section[] {
  return Object.entries(state[config]).map(([name, options]) => ({ ...options, '.name': name, '.type': options['.type'] ?? '' }));
}

function configOf(state: State): WedConfig {
  return { milkflint: sections(state, 'milkflint'), sqm: sections(state, 'sqm'), firewall: sections(state, 'firewall') };
}

/** The settings after a save's changes, as rpcd applies them. */
function applied(state: State, changes: readonly Change[]): State {
  const next = structuredClone(state);
  for (const c of changes) {
    assert.ok(c.config === 'milkflint' || c.config === 'sqm' || c.config === 'firewall', c.config);
    const config = c.config;
    switch (c.op) {
      case 'set':
        Object.assign(sec(next, config, c.section), c.values);
        break;
      case 'unset':
        next[config][c.section] = c.options.reduce(unset, sec(next, config, c.section));
        break;
      case 'add':
        next[config][c.name ?? 'cfg'] = { '.type': c.type, ...(c.values as Options) };
        break;
      case 'delete':
        next[config] = without(next[config], c.section);
        break;
      case 'order':
        break;
    }
  }
  return next;
}

// --- the page's model -------------------------------------------------------

test('turning WED on: Smart Queue and the guest limit off, the VPN’s queue left, flow offloading on, all remembered', () => {
  const before = household();
  const cfg = configOf(before);
  assert.equal(wedOn(cfg.milkflint), false);
  assert.deepEqual(
    queuesTurnedOff(cfg.sqm).map((q) => q['.name']),
    ['eth1', 'guest'],
  );
  assert.deepEqual(wedEffects(cfg), {
    queues: [
      { section: 'eth1', device: 'eth1', download: 600_000, upload: 60_000 },
      { section: 'guest', device: 'br-guest', download: 25_000, upload: 0 },
    ],
    offload: false,
    offloadHw: true,
  });
  const after = applied(before, wedOnChanges(cfg));
  assert.equal(after.milkflint['wifi']?.['wed'], '1');
  assert.equal(after.milkflint['wifi']['aql_be'], '3000 8000');
  assert.equal(after.sqm['eth1']?.['enabled'], '0');
  assert.equal(after.sqm['guest']?.['enabled'], '0');
  assert.equal(after.sqm['vpn']?.['enabled'], '1');
  assert.equal(after.sqm['spare']?.['enabled'], '0');
  // its speeds and the rest stay, for when it comes back
  assert.equal(after.sqm['eth1']['download'], '600000');
  assert.deepEqual(after.firewall['cfg01'], {
    '.type': 'defaults',
    flow_offloading: '1',
    syn_flood: '1',
    flow_offloading_hw: '1',
  });
  assert.deepEqual(after.milkflint['wed'], { '.type': 'wed', sqm: 'eth1 guest', offload: '1', offload_hw: '0' });
});

test('a save that changes nothing makes no changes: on when it’s on and in order, off when it’s off', () => {
  const on = applied(household(), wedOnChanges(configOf(household())));
  assert.deepEqual(wedOnChanges(configOf(on)), []);
  assert.deepEqual(wedOffChanges(configOf(household())), []);
});

test('turning WED off puts back exactly what it turned off, and forgets it', () => {
  const before = household();
  const on = applied(before, wedOnChanges(configOf(before)));
  assert.deepEqual(wedRestores(configOf(on)), {
    queues: [
      { section: 'eth1', device: 'eth1' },
      { section: 'guest', device: 'br-guest' },
    ],
    offload: undefined,
    offloadHw: false,
  });
  const off = applied(on, wedOffChanges(configOf(on)));
  // as before, but for hardware offloading set to "0" where it was unset: the firewall reads both as off
  assert.deepEqual(off, {
    ...before,
    firewall: { ...before.firewall, cfg01: { ...sec(before, 'firewall', 'cfg01'), flow_offloading_hw: '0' } },
  });
  assert.deepEqual(wedOffChanges(configOf(off)), []);
});

test('software offloading that was off before WED is off again after it', () => {
  const before = household();
  before.firewall['cfg01'] = unset(sec(before, 'firewall', 'cfg01'), 'flow_offloading');
  const on = applied(before, wedOnChanges(configOf(before)));
  assert.equal(on.firewall['cfg01']?.['flow_offloading'], '1');
  assert.deepEqual(on.milkflint['wed'], { '.type': 'wed', sqm: 'eth1 guest', offload: '0', offload_hw: '0' });
  const off = applied(on, wedOffChanges(configOf(on)));
  assert.equal(off.firewall['cfg01']?.['flow_offloading'], '0');
  assert.equal(off.firewall['cfg01']['flow_offloading_hw'], '0');
});

test('hardware offloading that was on before WED stays on after it', () => {
  const before = household();
  Object.assign(sec(before, 'firewall', 'cfg01'), { flow_offloading_hw: '1' });
  const on = applied(before, wedOnChanges(configOf(before)));
  // nothing of the firewall to remember: it was as WED needs it
  assert.deepEqual(on.milkflint['wed'], { '.type': 'wed', sqm: 'eth1 guest' });
  const off = applied(on, wedOffChanges(configOf(on)));
  assert.equal(off.firewall['cfg01']?.['flow_offloading_hw'], '1');
  assert.deepEqual(off, before);
});

test('with WED on, a queue turned on again elsewhere is turned off again, and remembered once', () => {
  const on = applied(household(), wedOnChanges(configOf(household())));
  Object.assign(sec(on, 'sqm', 'eth1'), { enabled: '1' });
  Object.assign(sec(on, 'firewall', 'cfg01'), { flow_offloading_hw: '0' });
  const again = applied(on, wedOnChanges(configOf(on)));
  assert.equal(again.sqm['eth1']?.['enabled'], '0');
  assert.equal(again.firewall['cfg01']?.['flow_offloading_hw'], '1');
  // what they were before WED, not what the edit made them
  assert.deepEqual(again.milkflint['wed'], { '.type': 'wed', sqm: 'eth1 guest', offload: '1', offload_hw: '0' });
});

test('turning WED off from a page that set the firewall itself leaves the firewall to it', () => {
  const on = applied(household(), wedOnChanges(configOf(household())));
  const changes = wedOffChanges(configOf(on), { keepFirewall: true });
  assert.ok(!changes.some((c) => c.config === 'firewall'));
  const off = applied(on, changes);
  assert.equal(off.sqm['eth1']?.['enabled'], '1');
  assert.equal(off.milkflint['wed'], undefined);
  assert.equal(off.milkflint['wifi']?.['wed'], undefined);
});

test('a queue removed while WED was on isn’t put back; one already on is left', () => {
  const on = applied(household(), wedOnChanges(configOf(household())));
  on.sqm = without(on.sqm, 'guest');
  Object.assign(sec(on, 'sqm', 'eth1'), { enabled: '1' });
  assert.deepEqual(wedRestores(configOf(on)).queues, []);
  const off = applied(on, wedOffChanges(configOf(on)));
  assert.equal(off.sqm['guest'], undefined);
});

test('a router without Smart Queue or a firewall defaults section: only the setting', () => {
  const bare: State = { milkflint: {}, sqm: {}, firewall: {} };
  const on = applied(bare, wedOnChanges(configOf(bare)));
  assert.deepEqual(on, { milkflint: { wifi: { '.type': 'wifi', wed: '1' } }, sqm: {}, firewall: {} });
  // the wifi section had only that: it goes with it
  assert.deepEqual(applied(on, wedOffChanges(configOf(on))), bare);
});

test('speeds in words', () => {
  assert.equal(speedsText(600_000, 60_000), '600 / 60 Mbit/s');
  assert.equal(speedsText(25_000, 0), '25 Mbit/s down');
  assert.equal(speedsText(0, 2500), '2.5 Mbit/s up');
  assert.equal(speedsText(0, 0), '');
});

test('what’s in effect now: the driver takes the setting at a restart', () => {
  assert.equal(wedNeedsRestart(true, undefined), false);
  assert.equal(wedNeedsRestart(true, { wanted: true, loaded: false, active: false }), true);
  assert.equal(wedNeedsRestart(false, { wanted: false, loaded: true, active: true }), true);
  assert.equal(wedNeedsRestart(true, { wanted: true, loaded: true, active: true }), false);
  assert.equal(wedNeedsRestart(true, { wanted: true, loaded: null, active: false }), false);
  assert.equal(wedNow(true, { wanted: true, loaded: true, active: true }), 'On');
  assert.equal(wedNow(false, { wanted: false, loaded: false, active: false }), 'Off');
  assert.match(wedNow(true, { wanted: true, loaded: false, active: false }), /once the router restarts/);
  assert.match(wedNow(false, { wanted: false, loaded: true, active: true }), /until the router restarts/);
  assert.match(wedNow(true, { wanted: true, loaded: true, active: false }), /no radio took it/);
});

// --- the router's script ----------------------------------------------------

const script = fileURLToPath(new URL('../../../package/milkflint/milkflint-ui/files/features/tuning/bin/wed', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'tuning-wed-'));
after(() => {
  rmSync(root, { recursive: true, force: true });
});
mkdirSync(join(root, 'bin'));
mkdirSync(join(root, 'etc'));
mkdirSync(join(root, 'var/run'), { recursive: true });
const stateFile = join(root, 'uci.json');
const callsFile = join(root, 'calls.log');

// uci as the script uses it, on the settings in uci.json: -q get, show, set,
// delete, commit. show prints as uci does: config.section=type, then its
// options quoted.
const UCI = `#!/usr/bin/env node
const fs = require('node:fs');
const file = process.env.UCI_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const args = process.argv.slice(2).filter((a) => a !== '-q');
const [cmd, arg = ''] = args;
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const path = (p) => p.split('.');
switch (cmd) {
  case 'get': {
    const [c, s, o] = path(arg);
    const v = o === undefined ? state[c]?.[s]?.['.type'] : state[c]?.[s]?.[o];
    if (v === undefined) process.exit(1);
    console.log(v);
    break;
  }
  case 'show': {
    const [c, s] = path(arg);
    if (state[c] === undefined || (s !== undefined && state[c][s] === undefined)) process.exit(1);
    for (const [name, options] of Object.entries(state[c])) {
      if (s !== undefined && s !== name) continue;
      console.log(c + '.' + name + '=' + options['.type']);
      for (const [o, v] of Object.entries(options)) if (o !== '.type') console.log(c + '.' + name + '.' + o + "='" + v + "'");
    }
    break;
  }
  case 'set': {
    const eq = arg.indexOf('=');
    const [c, s, o] = path(arg.slice(0, eq));
    const v = arg.slice(eq + 1);
    state[c] ??= {};
    if (o === undefined) state[c][s] = { '.type': v, ...(state[c][s] ?? {}) };
    else if (state[c][s] === undefined) process.exit(1);
    else state[c][s][o] = v;
    save();
    break;
  }
  case 'delete': {
    const [c, s, o] = path(arg);
    if (state[c]?.[s] === undefined || (o !== undefined && state[c][s][o] === undefined)) process.exit(1);
    if (o === undefined) delete state[c][s];
    else delete state[c][s][o];
    save();
    break;
  }
  case 'commit':
    fs.appendFileSync(process.env.CALLS, 'uci commit ' + arg + '\\n');
    break;
  default:
    process.exit(1);
}
`;
const exe = (name: string, text: string): void => {
  writeFileSync(join(root, 'bin', name), text);
  chmodSync(join(root, 'bin', name), 0o755);
};
exe('uci', UCI);
exe('logger', '#!/bin/sh\nwhile [ $# -gt 1 ]; do shift; done\necho "log $1" >> "$CALLS"\n');
exe('reload_config', '#!/bin/sh\necho reload_config >> "$CALLS"\n');
// fw4 print: the flow table the firewall would load; fw4 -q reload: noted
exe('fw4', '#!/bin/sh\nif [ "$1" = print ]; then cat "$WED_ROOT/fw4-print"; else echo "fw4 $*" >> "$CALLS"; fi\n');
exe('nft', '#!/bin/sh\ncat "$WED_ROOT/nft-flowtable"\n');

/** Runs the script on these settings; the settings after it, and what it called. */
function run(args: string[], state: State): { state: State; calls: string[]; out: string } {
  writeFileSync(stateFile, JSON.stringify(state));
  writeFileSync(callsFile, '');
  const out = execFileSync('sh', [script, ...args], {
    env: {
      PATH: `${join(root, 'bin')}:${process.env['PATH'] ?? ''}`,
      UCI_STATE: stateFile,
      CALLS: callsFile,
      WED_ROOT: root,
      WED_SETTLE: '0',
    },
    encoding: 'utf8',
  });
  return {
    state: JSON.parse(readFileSync(stateFile, 'utf8')) as State,
    calls: readFileSync(callsFile, 'utf8')
      .split('\n')
      .filter((l) => l !== ''),
    out,
  };
}

function withWed(state: State): State {
  const next = structuredClone(state);
  next.milkflint['wifi'] = { '.type': 'wifi', ...next.milkflint['wifi'], wed: '1' };
  return next;
}

test('wed guard, the setting turned on by hand: the same settings as the page’s save, each service told once, and said in the log', () => {
  const before = household();
  const r = run(['guard'], withWed(before));
  assert.deepEqual(r.state, applied(before, wedOnChanges(configOf(before))));
  assert.deepEqual(r.calls.filter((c) => !c.startsWith('log ')).sort(), [
    'reload_config',
    'uci commit firewall',
    'uci commit milkflint',
    'uci commit sqm',
  ]);
  const log = r.calls.filter((c) => c.startsWith('log ')).join('\n');
  assert.match(log, /Smart Queue on eth1 \(sqm\.eth1\) turned off: hardware offloading \(WED\) is on/);
  assert.match(log, /Smart Queue on br-guest \(sqm\.guest\) turned off/);
  assert.doesNotMatch(log, /wg_out/);
  assert.match(log, /software and hardware flow offloading turned on/);
  assert.equal(readFileSync(join(root, 'etc/modules.conf'), 'utf8'), 'options mt7915e wed_enable=Y\n');
});

test('wed guard after the page’s save, or a second time: nothing to change, nothing reloaded', () => {
  const saved = applied(household(), wedOnChanges(configOf(household())));
  const r = run(['guard'], saved);
  assert.deepEqual(r.state, saved);
  assert.deepEqual(r.calls, []);
});

test('wed guard holds the rule against a later edit: Smart Queue or hardware offloading set against it goes back, logged', () => {
  const saved = applied(household(), wedOnChanges(configOf(household())));
  const edited = structuredClone(saved);
  Object.assign(sec(edited, 'sqm', 'guest'), { enabled: '1' });
  Object.assign(sec(edited, 'firewall', 'cfg01'), { flow_offloading_hw: '0' });
  const r = run(['guard'], edited);
  assert.deepEqual(r.state, saved);
  assert.ok(r.calls.includes('reload_config'));
  assert.ok(r.calls.some((c) => c.startsWith('log Smart Queue on br-guest')));
  // the page makes the same of it
  assert.deepEqual(applied(edited, wedOnChanges(configOf(edited))), saved);
});

test('wed guard with the setting off puts back what’s remembered, as the page does, and takes the driver’s line out', () => {
  const saved = applied(household(), wedOnChanges(configOf(household())));
  writeFileSync(join(root, 'etc/modules.conf'), '# mine\noptions mt7915e wed_enable=Y\n');
  const off = structuredClone(saved);
  off.milkflint['wifi'] = unset(sec(off, 'milkflint', 'wifi'), 'wed');
  const r = run(['guard'], off);
  assert.deepEqual(r.state, applied(saved, wedOffChanges(configOf(saved))));
  assert.deepEqual(r.calls.filter((c) => !c.startsWith('log ')).sort(), [
    'reload_config',
    'uci commit firewall',
    'uci commit milkflint',
    'uci commit sqm',
  ]);
  assert.ok(r.calls.some((c) => c.startsWith('log Smart Queue on eth1 (sqm.eth1) turned back on')));
  assert.equal(readFileSync(join(root, 'etc/modules.conf'), 'utf8'), '# mine\n');
  // and once more: nothing
  assert.deepEqual(run(['guard'], r.state).calls, []);
});

test('wed guard: a queue removed meanwhile isn’t put back', () => {
  const saved = applied(household(), wedOnChanges(configOf(household())));
  saved.sqm = without(saved.sqm, 'guest');
  saved.milkflint['wifi'] = unset(sec(saved, 'milkflint', 'wifi'), 'wed');
  const r = run(['guard'], saved);
  assert.equal(r.state.sqm['guest'], undefined);
  assert.equal(r.state.sqm['eth1']?.['enabled'], '1');
  assert.equal(r.state.milkflint['wed'], undefined);
});

test('wed guard on an access point turns WED off again and puts back what it had turned off', () => {
  const saved = applied(household(), wedOnChanges(configOf(household())));
  saved.milkflint['mode'] = { '.type': 'mode', mode: 'ap' };
  const r = run(['guard'], saved);
  assert.equal(r.state.milkflint['wifi']?.['wed'], undefined);
  assert.equal(r.state.sqm['eth1']?.['enabled'], '1');
  assert.equal(r.state.milkflint['wed'], undefined);
  assert.ok(r.calls.some((c) => c.startsWith('log Hardware offloading (WED) turned off: as an access point')));
  assert.equal(
    existsSync(join(root, 'etc/modules.conf'))
      ? readFileSync(join(root, 'etc/modules.conf'), 'utf8').includes('wed_enable')
      : false,
    false,
  );
});

test('wed conf: the driver’s line follows the setting and leaves the rest of the file alone', () => {
  const conf = join(root, 'etc/modules.conf');
  const on = withWed(household());
  const off = household();
  const text = (): string => readFileSync(conf, 'utf8');

  rmSync(conf, { force: true });
  run(['conf'], off);
  assert.equal(existsSync(conf), false);
  run(['conf'], on);
  assert.equal(text(), 'options mt7915e wed_enable=Y\n');
  run(['conf'], on);
  assert.equal(text(), 'options mt7915e wed_enable=Y\n');
  run(['conf'], off);
  assert.equal(text(), '\n');

  // OpenWrt's own file, and someone's options
  writeFileSync(conf, '# examples:\n# options mod1 option=val\nblacklist mod2\noptions mt76 foo=1\n');
  run(['conf'], on);
  assert.equal(
    text(),
    '# examples:\n# options mod1 option=val\nblacklist mod2\noptions mt76 foo=1\noptions mt7915e wed_enable=Y\n',
  );
  run(['conf'], off);
  assert.equal(text(), '# examples:\n# options mod1 option=val\nblacklist mod2\noptions mt76 foo=1\n');

  // the option written by hand, in whatever form: one line of ours, or none
  writeFileSync(conf, 'options  mt7915e\twed_enable=1\noptions mt7915e foo=2 wed_enable=N bar=3\n');
  run(['conf'], on);
  assert.equal(text(), 'options mt7915e foo=2 bar=3\noptions mt7915e wed_enable=Y\n');
  run(['conf'], off);
  assert.equal(text(), 'options mt7915e foo=2 bar=3\n');
});

test('wed flowtable: the firewall loads again only when its flow table would list other interfaces', () => {
  const hw = applied(household(), wedOnChanges(configOf(household())));
  const table = (devices: string): string =>
    `table inet fw4 {\n\tflowtable ft {\n\t\thook ingress priority filter\n\t\tdevices = { ${devices} }\n\t\tflags offload\n\t}\n}\n`;
  // a Wi-Fi interface made after the firewall loaded
  writeFileSync(join(root, 'nft-flowtable'), table('"eth1", "lan1", "lan2"'));
  writeFileSync(
    join(root, 'fw4-print'),
    `\tflowtable ft {\n\t\thook ingress priority 0;\n\t\tdevices = { "eth1", "lan1", "lan2", "phy1-ap0" };\n\t\tflags offload;\n\t}\n`,
  );
  assert.deepEqual(
    run(['flowtable'], hw).calls.filter((c) => !c.startsWith('log ')),
    ['fw4 -q reload'],
  );
  // the same interfaces, in another order
  writeFileSync(join(root, 'nft-flowtable'), table('"phy1-ap0", "eth1", "lan2", "lan1"'));
  assert.deepEqual(run(['flowtable'], hw).calls, []);
  // hardware offloading off: the table lists bridges, which don't change
  writeFileSync(join(root, 'nft-flowtable'), table('"eth1"'));
  assert.deepEqual(run(['flowtable'], household()).calls, []);
  assert.equal(existsSync(join(root, 'var/run/milkflint-wed-flowtable.lock')), false);
});

test('wed status: the setting, the loaded driver’s parameter, and whether a radio is attached', () => {
  const param = join(root, 'sys/module/mt7915e/parameters');
  const debug = join(root, 'sys/kernel/debug/wed0');
  assert.equal(run(['status'], household()).out, 'wanted=0\nloaded=\nactive=0\n');
  mkdirSync(param, { recursive: true });
  mkdirSync(debug, { recursive: true });
  writeFileSync(join(param, 'wed_enable'), 'N\n');
  writeFileSync(join(debug, 'txinfo'), '');
  assert.equal(run(['status'], withWed(household())).out, 'wanted=1\nloaded=N\nactive=0\n');
  writeFileSync(join(param, 'wed_enable'), 'Y\n');
  writeFileSync(join(debug, 'txinfo'), 'WED TX DMA:\n');
  assert.equal(run(['status'], withWed(household())).out, 'wanted=1\nloaded=Y\nactive=1\n');
});
