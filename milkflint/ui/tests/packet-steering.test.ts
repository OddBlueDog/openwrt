// The router's packet steering run for real against a pretend /proc and /sys as
// on the GL-MT6000 with four RX rings, which no VM has (mtk_eth is hardware):
// where each interrupt and thread goes, in each layout. The pretend files are
// what the router has; ethtool, taskset and rtprio are logged, not run.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../../package/milkflint/milkflint-ui/files/packet-steering.sh', import.meta.url));

// NAPI ids around 9 and 10 too: they're sorted as numbers, TX's first
const THREADS: Record<string, string> = {
  '699': 'napi/mtk_eth-9',
  '700': 'napi/mtk_eth-10',
  '701': 'napi/mtk_eth-11',
  '702': 'napi/mtk_eth-12',
  '703': 'napi/mtk_eth-13',
  '1156': 'napi/phy0-10',
  '1157': 'napi/phy0-15',
  '1183': 'mt76-tx phy0',
  '900': 'kworker/0:1',
};
const TX = '699';
const RING0 = '700';
const RING1 = '701';
const RING2 = '702';
const RING3 = '703';
const WIFI = ['1156', '1157', '1183'];

const INTERRUPTS = `           CPU0       CPU1       CPU2       CPU3
119:      65580          0          0          0     GICv3 221 Level     15100000.ethernet
120:          0    4625019          0          0     GICv3 222 Level     15100000.ethernet
121:          0          0    3555013          0     GICv3 223 Level     15100000.ethernet
122:          0          0          0    3590472     GICv3 224 Level     15100000.ethernet
123:    3991841          0          0          0     GICv3 229 Level     15100000.ethernet
130:          1          0          0          0     GICv3 230 Level     other.device
`;
const IRQS = ['119', '120', '121', '122'];

interface Result {
  /** each thread's CPU mask, from taskset */
  mask: Record<string, string>;
  /** rtprio calls, as "<pid> <policy> [prio]" */
  rtprio: string[];
  /** ethtool's -X calls */
  rss: string[];
  affinity: Record<string, string>;
  rps: Record<string, string>;
  /** packet-steering.uc's arguments, when it was handed over to */
  openwrt: string | undefined;
  /** xps_cpus of ifb4pppoe-wan's queues 0-3 and ifb4eth1's queue 0, with pppIfb */
  xps: Record<string, string>;
}

interface Setup {
  arg?: string;
  uci?: Record<string, string>;
  /** the Ethernet has four rings (ethtool -x says so) */
  rings?: boolean;
  /** ethtool -X refuses */
  rssRefused?: boolean;
  noEthtool?: boolean;
  threads?: Record<string, string>;
  interrupts?: string;
  /** devices on top of another (802.1Q VLANs, as netifd names them): name → the device under it */
  vlans?: Record<string, string>;
  /** a PPPoE session up with Smart Queue on it: pppoe-wan (a PPP device) and its four-queue ifb, plus eth1's ifb */
  pppIfb?: boolean;
}

function run(setup: Setup = {}): Result {
  const root = mkdtempSync(join(tmpdir(), 'steering-'));
  try {
    const bin = join(root, 'bin');
    const log = join(root, 'log');
    mkdirSync(bin);
    for (const name of ['proc', 'sys/class/net', 'usr/libexec/milkflint', 'usr/libexec/network'])
      mkdirSync(join(root, name), { recursive: true });
    const exe = (path: string, text: string): void => {
      writeFileSync(path, `#!/bin/sh\n${text}\n`);
      chmodSync(path, 0o755);
    };
    writeFileSync(join(root, 'proc/interrupts'), setup.interrupts ?? INTERRUPTS);
    writeFileSync(join(root, 'proc/cpuinfo'), 'processor : 0\nprocessor : 1\nprocessor : 2\nprocessor : 3\n');
    for (const [pid, comm] of Object.entries(setup.threads ?? THREADS)) {
      mkdirSync(join(root, 'proc', pid));
      writeFileSync(join(root, 'proc', pid, 'comm'), `${comm}\n`);
    }
    for (const irq of IRQS) {
      mkdirSync(join(root, 'proc/irq', irq), { recursive: true });
      writeFileSync(join(root, 'proc/irq', irq, 'smp_affinity'), '0\n');
    }
    // eth1: the MAC with RSS; lan1: the switch's; phy1-ap0: Wi-Fi, no driver link
    const driver = join(root, 'drivers/mtk_soc_eth');
    mkdirSync(driver, { recursive: true });
    for (const [dev, queues, isEth] of [
      ['eth0', 1, true],
      ['eth1', 4, true],
      ['lan1', 1, false],
      ['phy1-ap0', 1, false],
    ] as const) {
      for (let q = 0; q < queues; q++) {
        mkdirSync(join(root, 'sys/class/net', dev, 'queues', `rx-${String(q)}`), { recursive: true });
        writeFileSync(join(root, 'sys/class/net', dev, 'queues', `rx-${String(q)}`, 'rps_cpus'), 'unset\n');
      }
      if (isEth) {
        mkdirSync(join(root, 'sys/class/net', dev, 'device'));
        symlinkSync(driver, join(root, 'sys/class/net', dev, 'device/driver'));
      }
    }
    for (const [vlan, under] of Object.entries(setup.vlans ?? {})) {
      mkdirSync(join(root, 'sys/class/net', vlan, 'queues/rx-0'), { recursive: true });
      writeFileSync(join(root, 'sys/class/net', vlan, 'queues/rx-0/rps_cpus'), 'unset\n');
      symlinkSync(join(root, 'sys/class/net', under), join(root, 'sys/class/net', vlan, `lower_${under}`));
    }
    if (setup.pppIfb === true) {
      mkdirSync(join(root, 'sys/class/net/pppoe-wan/queues/rx-0'), { recursive: true });
      writeFileSync(join(root, 'sys/class/net/pppoe-wan/type'), '512\n');
      for (const [ifb, queues] of [
        ['ifb4pppoe-wan', 4],
        ['ifb4eth1', 4],
      ] as const)
        for (let q = 0; q < queues; q++) {
          mkdirSync(join(root, 'sys/class/net', ifb, 'queues', `tx-${String(q)}`), { recursive: true });
          writeFileSync(join(root, 'sys/class/net', ifb, 'queues', `tx-${String(q)}`, 'xps_cpus'), 'unset\n');
        }
      writeFileSync(join(root, 'sys/class/net/ifb4eth1/type'), '1\n');
    }
    // uci -q get <key>, and uci -q show <config> (each key='value')
    const uci = Object.entries(setup.uci ?? {})
      .map(([k, v]) => `[ "$3" = "${k}" ] && { echo "${v}"; exit 0; }`)
      .join('\n');
    const show = Object.entries(setup.uci ?? {})
      .map(([k, v]) => `[ "$3" = "${k.split('.')[0] ?? ''}" ] && echo "${k}='${v}'"`)
      .join('\n');
    exe(join(bin, 'uci'), `if [ "$2" = show ]; then\n${show}\nexit 0\nfi\n${uci}\nexit 1`);
    if (setup.noEthtool !== true) {
      exe(
        join(bin, 'ethtool'),
        `case "$1" in
-x) ${setup.rings === false ? 'echo "RX flow hash indirection table for $2 with 1 RX ring(s):"' : 'echo "RX flow hash indirection table for $2 with 4 RX ring(s):"'} ;;
-X) echo "ethtool $*" >> ${log}; exit ${setup.rssRefused === true ? '1' : '0'} ;;
esac`,
      );
    }
    exe(join(bin, 'taskset'), `echo "taskset $*" >> ${log}`);
    exe(join(root, 'usr/libexec/milkflint/rtprio'), `echo "rtprio $*" >> ${log}`);
    exe(join(root, 'usr/libexec/milkflint/ports'), 'echo eth1');
    exe(join(root, 'usr/libexec/network/packet-steering.uc'), `echo "openwrt $*" >> ${log}`);

    const text = readFileSync(script, 'utf8')
      .replaceAll('/proc/', `${root}/proc/`)
      .replaceAll('/sys/class/net', `${root}/sys/class/net`)
      .replaceAll('/usr/libexec/', `${root}/usr/libexec/`);
    const scriptCopy = join(root, 'steer.sh');
    writeFileSync(scriptCopy, text);
    writeFileSync(log, '');
    execFileSync('/bin/sh', [scriptCopy, ...(setup.arg === undefined ? [] : [setup.arg])], {
      env: { PATH: `${bin}:/usr/bin:/bin` },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const lines = readFileSync(log, 'utf8')
      .split('\n')
      .filter((l) => l !== '');
    const mask: Record<string, string> = {};
    for (const l of lines) {
      const m = /^taskset -p (\S+) (\d+)$/.exec(l);
      if (m?.[1] !== undefined && m[2] !== undefined) mask[m[2]] = m[1];
    }
    const rps: Record<string, string> = {};
    for (const [dev, q] of [
      ['eth0', 0],
      ['eth1', 0],
      ['eth1', 3],
      ['lan1', 0],
      ['phy1-ap0', 0],
    ] as const) {
      rps[`${dev}/${String(q)}`] = readFileSync(
        join(root, 'sys/class/net', dev, 'queues', `rx-${String(q)}`, 'rps_cpus'),
        'utf8',
      ).trim();
    }
    return {
      mask,
      rtprio: lines.filter((l) => l.startsWith('rtprio ')).map((l) => l.slice(7)),
      rss: lines.filter((l) => l.startsWith('ethtool ')).map((l) => l.slice(8)),
      affinity: Object.fromEntries(
        IRQS.map((irq) => [irq, readFileSync(join(root, 'proc/irq', irq, 'smp_affinity'), 'utf8').trim()]),
      ),
      rps,
      openwrt: lines.find((l) => l.startsWith('openwrt '))?.slice(8),
      xps:
        setup.pppIfb === true
          ? Object.fromEntries(
              [...[0, 1, 2, 3].map((q) => `ifb4pppoe-wan/${String(q)}`), 'ifb4eth1/0'].map((k) => {
                const [ifb = '', q = ''] = k.split('/');
                return [k, readFileSync(join(root, 'sys/class/net', ifb, 'queues', `tx-${q}`, 'xps_cpus'), 'utf8').trim()];
              }),
            )
          : {},
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const NO_RPS = { 'eth0/0': '0', 'eth1/0': '0', 'eth1/3': '0', 'lan1/0': '0', 'phy1-ap0/0': '0' };

test('with four rings: flows on rings 1-3, each ring on its own CPU, no RPS', () => {
  const r = run();
  assert.deepEqual(r.rss, ['-X eth1 weight 0 1 1 1']);
  assert.deepEqual(r.affinity, { '119': '1', '120': '2', '121': '4', '122': '8' });
  assert.equal(r.mask[TX], '1');
  assert.equal(r.mask[RING0], '1');
  assert.equal(r.mask[RING1], '2');
  assert.equal(r.mask[RING2], '4');
  assert.equal(r.mask[RING3], '8');
  assert.deepEqual(r.rps, NO_RPS);
  assert.equal(r.openwrt, undefined);
});

test('with four rings: rings 1-3 at SCHED_FIFO, TX’s and ring 0’s left alone', () => {
  assert.deepEqual(run().rtprio, [`${RING1} fifo 1`, `${RING2} fifo 1`, `${RING3} fifo 1`]);
});

test('with four rings: the Wi-Fi threads may use every CPU, and only they and the rings move', () => {
  const r = run();
  for (const pid of WIFI) assert.equal(r.mask[pid], 'f', pid);
  assert.equal(r.mask['900'], undefined);
});

test('the Performance Tuning switches: Wi-Fi on CPUs 1-3, rings at normal priority', () => {
  const wifi = run({ uci: { 'milkflint.steering.wifi_all': '0' } });
  for (const pid of WIFI) assert.equal(wifi.mask[pid], 'e', pid);
  assert.equal(wifi.mask[RING1], '2');
  const rt = run({ uci: { 'milkflint.steering.rings_rt': '0' } });
  assert.deepEqual(rt.rtprio, [`${RING1} other`, `${RING2} other`, `${RING3} other`]);
  assert.equal(rt.mask[RING1], '2', 'still on their CPUs');
});

function assertRpsLayout(r: Result): void {
  assert.deepEqual(r.rss, ['-X eth1 equal 1']);
  assert.deepEqual(r.affinity, { '119': 'f', '120': 'f', '121': 'f', '122': 'f' });
  for (const pid of [TX, RING0, RING1, RING2, RING3]) assert.equal(r.mask[pid], '1', 'the Ethernet NAPI on CPU0');
  for (const pid of WIFI) assert.equal(r.mask[pid], 'e', pid);
  // received packets spread over CPUs 1-3, on the Ethernet's ports only
  assert.deepEqual(r.rps, { 'eth0/0': 'e', 'eth1/0': 'e', 'eth1/3': 'e', 'lan1/0': '0', 'phy1-ap0/0': '0' });
  assert.deepEqual(r.rtprio, [`${RING1} other`, `${RING2} other`, `${RING3} other`]);
}

test('RSS turned off: the RPS layout, every flow on ring 0', () => {
  assertRpsLayout(run({ uci: { 'milkflint.steering.rss': '0' } }));
});

test('an Ethernet without the rings: the RPS layout', () => {
  const r = run({ rings: false });
  assertRpsLayout(r);
});

test('RSS the driver refuses: the RPS layout, not half of each', () => {
  const r = run({ rssRefused: true });
  assert.deepEqual(r.rss, ['-X eth1 weight 0 1 1 1', '-X eth1 equal 1']);
  assert.deepEqual(r.affinity, { '119': 'f', '120': 'f', '121': 'f', '122': 'f' });
  assert.equal(r.rps['eth1/0'], 'e');
});

test('too few NAPI threads, or no fourth ring’s interrupt: no RSS', () => {
  const threads = { ...THREADS };
  Reflect.deleteProperty(threads, RING3);
  assert.ok(!run({ threads }).rss.includes('-X eth1 weight 0 1 1 1'));
  const interrupts = INTERRUPTS.split('\n')
    .filter((l) => !l.includes(' 224 '))
    .join('\n');
  assert.ok(!run({ interrupts }).rss.includes('-X eth1 weight 0 1 1 1'));
});

test('no ethtool in the image: the RPS layout, no failure', () => {
  const r = run({ noEthtool: true });
  assert.equal(r.rss.length, 0);
  assert.equal(r.rps['eth1/0'], 'e');
});

test('off: every thread on every CPU, no RPS, one ring', () => {
  const r = run({ arg: '0' });
  assert.deepEqual(r.rss, ['-X eth1 equal 1']);
  assert.deepEqual(r.affinity, { '119': 'f', '120': 'f', '121': 'f', '122': 'f' });
  for (const pid of [TX, RING0, RING1, RING2, RING3, ...WIFI]) assert.equal(r.mask[pid], 'f', pid);
  assert.deepEqual(r.rps, NO_RPS);
  assert.deepEqual(r.rtprio, [`${RING1} other`, `${RING2} other`, `${RING3} other`]);
});

// RSS can't hash inside PPPoE: a PPPoE session's packets all arrive on its
// port's ring 0, on CPU0, as the switch's (eth0's) do anyway
const PPPOE = { 'network.wan.proto': 'pppoe', 'network.wan.device': 'eth1' };
// RSS chosen on the page, whatever the line
const RSS = { 'milkflint.steering.rss': '1' };

test('a PPPoE WAN, automatic: the RPS layout, as RSS would spread nothing', () => {
  assertRpsLayout(run({ uci: PPPOE }));
});

test('a PPPoE interface by another name than wan, or on a VLAN device: the RPS layout too', () => {
  assertRpsLayout(run({ uci: { 'network.fttp.proto': 'pppoe', 'network.fttp.device': 'eth1', 'network.wan.proto': 'dhcp' } }));
  assertRpsLayout(run({ uci: { ...PPPOE, 'network.wan.device': 'wan_vlan' }, vlans: { wan_vlan: 'eth1' } }));
});

test('a DHCP WAN, automatic or RSS chosen: RSS', () => {
  for (const uci of [{ 'network.wan.proto': 'dhcp', 'network.wan.device': 'eth1' }, RSS]) {
    const r = run({ uci });
    assert.deepEqual(r.rss, ['-X eth1 weight 0 1 1 1']);
    assert.deepEqual(r.rps, NO_RPS);
  }
});

test('RSS chosen on a PPPoE WAN: RSS, with its port’s ring 0 spread over CPUs 1-3, rings 1-3 still without RPS', () => {
  const r = run({ uci: { ...PPPOE, ...RSS } });
  assert.deepEqual(r.rss, ['-X eth1 weight 0 1 1 1']);
  assert.deepEqual(r.affinity, { '119': '1', '120': '2', '121': '4', '122': '8' });
  assert.deepEqual(r.rps, { ...NO_RPS, 'eth1/0': 'e' });
});

test('RSS chosen on a PPPoE WAN on a VLAN: the port under the VLAN', () => {
  assert.equal(run({ uci: { ...PPPOE, ...RSS, 'network.wan.device': 'eth1.101' } }).rps['eth1/0'], 'e');
});

test('RSS chosen on a PPPoE WAN on a VLAN device with a name of its own: the port under it', () => {
  const r = run({ uci: { ...PPPOE, ...RSS, 'network.wan.device': 'wan_vlan' }, vlans: { wan_vlan: 'eth1' } });
  assert.deepEqual(r.rps, { ...NO_RPS, 'eth1/0': 'e' });
});

test('RSS chosen, a PPPoE interface by another name than wan: its port too', () => {
  const r = run({
    uci: { 'network.fttp.proto': 'pppoe', 'network.fttp.device': 'eth1', 'network.wan.proto': 'dhcp', ...RSS },
  });
  assert.deepEqual(r.rps, { ...NO_RPS, 'eth1/0': 'e' });
});

// sqm-scripts' 109 gives a PPP device's ifb a sub-queue per CPU, which holds
// only while each flow stays on one CPU
test('a PPPoE session’s ifb: a sub-queue per CPU while steering is on; others’ ifbs left alone', () => {
  const r = run({ uci: PPPOE, pppIfb: true });
  assert.deepEqual(r.xps, {
    'ifb4pppoe-wan/0': '1',
    'ifb4pppoe-wan/1': '2',
    'ifb4pppoe-wan/2': '4',
    'ifb4pppoe-wan/3': '8',
    'ifb4eth1/0': 'unset',
  });
});

test('a PPPoE session’s ifb with steering off: no sub-queue per CPU (the threads move between CPUs)', () => {
  const off = {
    'ifb4pppoe-wan/0': '0',
    'ifb4pppoe-wan/1': '0',
    'ifb4pppoe-wan/2': '0',
    'ifb4pppoe-wan/3': '0',
    'ifb4eth1/0': 'unset',
  };
  assert.deepEqual(run({ uci: PPPOE, pppIfb: true, arg: '0' }).xps, off);
  assert.deepEqual(run({ uci: { ...PPPOE, 'milkflint.steering.layout': 'openwrt' }, pppIfb: true, arg: '0' }).xps, off);
});

test('a PPPoE WAN in the RPS layout: as every Ethernet queue', () => {
  assertRpsLayout(run({ uci: { ...PPPOE, 'milkflint.steering.rss': '0' } }));
});

test('a PPPoE WAN, steering off: no RPS', () => {
  assert.deepEqual(run({ uci: PPPOE, arg: '0' }).rps, NO_RPS);
});

test('OpenWrt’s layout: handed over, one ring, normal priority', () => {
  const r = run({ uci: { 'milkflint.steering.layout': 'openwrt' }, arg: '1' });
  assert.equal(r.openwrt, '1');
  assert.deepEqual(r.rss, ['-X eth1 equal 1']);
  assert.deepEqual(r.mask, {}, 'nothing of ours moved');
  assert.deepEqual(r.rtprio, [`${RING1} other`, `${RING2} other`, `${RING3} other`]);
  assert.deepEqual(
    run({ uci: { 'milkflint.steering.layout': 'openwrt', 'network.@globals[0].steering_flows': '128' }, arg: '2' }).openwrt,
    '-l 128 2',
  );
});
