// Smart Queue's scripts as the image has them: upstream sqm-scripts with
// package/milkflint/sqm-scripts/patches (put together by the package's
// test-tree.sh), run for real by dash, an ash like
// the router's, against a pretend /sys, uci config and kernel. The pretend
// tc and ip keep each device's qdiscs, its download redirect and its ifb,
// give qdisc handles and device indexes as the kernel does, and refuse what
// it refuses: a word tc doesn't know, autorate-ingress with cake_mq, cake_mq
// on one queue.
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { functionsSh, uciExport } from './openwrt-shell.ts';

const testTree = fileURLToPath(new URL('../../../package/milkflint/sqm-scripts/test-tree.sh', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'sqm-scripts-'));
after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

// the patched tree; without one (no copy of upstream and no network) every test here is skipped, saying why
const tree = join(scratch, 'tree');
let unavailable: string | false = false;
try {
  execFileSync('sh', [testTree, tree], { stdio: 'pipe' });
} catch (e) {
  unavailable = `no sqm-scripts tree: ${e instanceof Error ? e.message : String(e)}`;
}

// The pretend kernel's qdiscs, per device under /sys/class/net/<dev>/.tc:
// root (kind, handle, options), leaves, ingress, redirect.
const TC = `#!/bin/dash
R=$SQM_ROOT
NET=$R/sys/class/net
echo "tc $*" >> $R/calls.log
while :; do case "$1" in -p | -s | -d) shift ;; *) break ;; esac; done
obj=$1 cmd=$2
shift 2
dev= parent= handle= where=
while [ $# -gt 0 ]; do
	case "$1" in
	dev) dev=$2; shift 2 ;;
	parent) parent=$2; shift 2 ;;
	handle) handle=$2; shift 2 ;;
	root) where=root; shift ;;
	*) break ;;
	esac
done
[ -d "$NET/$dev" ] || { echo "Cannot find device \\"$dev\\"" >&2; exit 1; }
T=$NET/$dev/.tc
if [ "$1" = stab ]; then
	shift
	while [ $# -gt 0 ]; do case "$1" in mtu | tsize | mpu | overhead | linklayer) shift 2 ;; *) break ;; esac; done
fi
kind=$1
[ $# -gt 0 ] && shift
args="$*"
usage() { echo "What is \\"$1\\"?" >&2; exit 1; }
check() {
	local k=$1
	shift
	if [ -f $R/refuse ]; then
		while read -r r; do [ "$r" = "$k" ] && { echo "Error: Specified qdisc kind is unknown." >&2; exit 2; }; done < $R/refuse
	fi
	case "$k" in
	cake | cake_mq)
		while [ $# -gt 0 ]; do
			case "$1" in
			bandwidth | rtt | memlimit | fwmark | overhead | mpu) [ $# -ge 2 ] || usage "$1"; shift ;;
			autorate-ingress) [ "$k" = cake ] || { echo "Error: Can't use autorate-ingress with cake_mq." >&2; exit 2; } ;;
			unlimited | besteffort | diffserv3 | diffserv4 | diffserv8 | precedence | nat | nonat | wash | nowash | \\
				split-gso | no-split-gso | ack-filter | ack-filter-aggressive | no-ack-filter | atm | ptm | noatm | raw | \\
				conservative | ethernet | docsis | flowblind | srchost | dsthost | hosts | flows | dual-srchost | \\
				dual-dsthost | triple-isolate | ingress | egress | datacentre | lan | metro | regional | internet | \\
				oceanic | satellite | interplanetary) ;;
			*) usage "$1" ;;
			esac
			shift
		done
		[ "$k" = cake ] || [ -d $NET/$dev/queues/tx-1 ] || { echo "Error: Operation not supported." >&2; exit 2; }
		;;
	fq_codel | codel | pie | sfq | fq_pie)
		while [ $# -gt 0 ]; do
			case "$1" in
			limit | target | interval | quantum | flows | memory_limit | ce_threshold | tupdate) [ $# -ge 2 ] || usage "$1"; shift ;;
			ecn | noecn) ;;
			*) usage "$1" ;;
			esac
			shift
		done
		;;
	htb | tbf | ingress) ;;
	*) echo "Error: Specified qdisc kind is unknown." >&2; exit 2 ;;
	esac
}
handle() {
	local n=32768
	[ -f $R/tc.handle ] && read -r n < $R/tc.handle
	n=$((n + 1))
	echo $n > $R/tc.handle
	printf '%x:' $n
}
case "$obj $cmd" in
"qdisc add" | "qdisc replace")
	if [ "$kind" = ingress ]; then
		[ "$cmd" = add ] && [ -f "$T/ingress" ] && { echo "Error: Exclusivity flag on, cannot modify." >&2; exit 2; }
		touch "$T/ingress"
		exit 0
	fi
	check "$kind" $args
	if [ "$where" = root ]; then
		[ "$cmd" = add ] && [ -f "$T/root" ] && { echo "Error: Exclusivity flag on, cannot modify." >&2; exit 2; }
		rm -f "$T/leaves"
		[ -n "$handle" ] || handle=$(handle)
		echo "$kind $handle $args" > "$T/root"
	else
		[ -f "$T/root" ] || { echo "Error: Failed to find specified qdisc." >&2; exit 2; }
		echo "$kind \${handle:-0:} $parent $args" >> "$T/leaves"
	fi
	;;
"qdisc del")
	if [ "$kind" = ingress ]; then
		[ -f "$T/ingress" ] || { echo "Error: Invalid handle." >&2; exit 2; }
		rm -f "$T/ingress" "$T/redirect"
	else
		[ -f "$T/root" ] || { echo "Error: Cannot delete qdisc with handle of zero." >&2; exit 2; }
		rm -f "$T/root" "$T/leaves"
	fi
	;;
"qdisc show")
	if [ "$kind" != ingress ]; then
		if [ -f "$T/root" ]; then
			read -r k h a < "$T/root"
			echo "qdisc $k $h root refcnt 2 $a"
			if [ -z "$where" ] && [ "$k" = cake_mq ]; then
				for q in $NET/$dev/queues/tx-*; do echo "qdisc cake 0: parent \${h%:}:$((\${q##*tx-} + 1)) $a"; done
			fi
		else
			echo "qdisc noqueue 0: root refcnt 2"
		fi
		[ -z "$where" ] && [ -f "$T/leaves" ] && while read -r k h p a; do echo "qdisc $k $h parent $p $a"; done < "$T/leaves"
	fi
	[ "$where" != root ] && [ -f "$T/ingress" ] && echo "qdisc ingress ffff: parent ffff:fff1 ----------------"
	;;
"class add")
	[ -f "$T/root" ] || { echo "Error: Failed to find qdisc with specified handle." >&2; exit 2; }
	;;
"filter add")
	if [ "$parent" = ffff: ]; then
		[ -f "$T/ingress" ] || { echo "Error: Parent Qdisc doesn't exists." >&2; exit 2; }
		rest="$kind $args"
		case "$rest" in
		*"redirect dev "*)
			to=\${rest##*redirect dev }
			to=\${to%% *}
			[ -d "$NET/$to" ] || { echo "Cannot find device \\"$to\\"" >&2; exit 1; }
			echo "$to" > "$T/redirect"
			;;
		esac
	else
		[ -f "$T/root" ] || { echo "Error: Parent Qdisc doesn't exists." >&2; exit 2; }
	fi
	;;
"filter show")
	if [ "$parent" = ffff: ] && [ -f "$T/redirect" ]; then
		echo "filter parent ffff: protocol all pref 10 u32 chain 0 "
		echo "filter parent ffff: protocol all pref 10 u32 chain 0 fh 800::800 order 2048 key ht 800 bkt 0 flowid 1:1 not_in_hw "
		echo "  match 00000000/00000000 at 0"
		read -r to < "$T/redirect"
		echo "	action order 1: mirred (Egress Redirect to device $to) stolen"
	fi
	;;
*)
	echo "pretend tc: $obj $cmd isn't pretended" >&2
	exit 1
	;;
esac
exit 0
`;

// a device in the pretend /sys: mkdev <name> <transmit queues> <up|down> [mtu]
const MKDEV = `#!/bin/dash
R=$SQM_ROOT
n=10
[ -f $R/ifindex ] && read -r n < $R/ifindex
n=$((n + 1))
echo $n > $R/ifindex
d=$R/sys/class/net/$1
mkdir -p "$d/queues" "$d/.tc"
echo $n > "$d/ifindex"
echo "\${4:-1500}" > "$d/mtu"
if [ "$3" = up ]; then echo 0x1003 > "$d/flags"; else echo 0x1002 > "$d/flags"; fi
i=0
while [ $i -lt "$2" ]; do
	mkdir -p "$d/queues/tx-$i" "$d/queues/rx-$i"
	i=$((i + 1))
done
`;

const IP = `#!/bin/dash
R=$SQM_ROOT
NET=$R/sys/class/net
echo "ip $*" >> $R/calls.log
[ "$1" = link ] || { echo "pretend ip: $* isn't pretended" >&2; exit 1; }
cmd=$2
shift 2
case "$cmd" in
add)
	name= nq=1
	while [ $# -gt 0 ]; do
		case "$1" in
		name) name=$2; shift 2 ;;
		numtxqueues) nq=$2; shift 2 ;;
		type) shift 2 ;;
		*) name=\${name:-$1}; shift ;;
		esac
	done
	[ -d "$NET/$name" ] && { echo "RTNETLINK answers: File exists" >&2; exit 2; }
	mkdev "$name" "$nq" down
	;;
set | delete | del)
	[ "$1" = dev ] && shift
	name=$1
	[ -d "$NET/$name" ] || { echo "Cannot find device \\"$name\\"" >&2; exit 1; }
	read -r f < "$NET/$name/flags"
	case "$cmd $2" in
	"set up") printf '0x%x\\n' $((f | 1)) > "$NET/$name/flags" ;;
	"set down") printf '0x%x\\n' $((f & ~1)) > "$NET/$name/flags" ;;
	del* ) rm -rf "\${NET:?}/$name" ;;
	esac
	;;
esac
exit 0
`;

// flock -n <fd> as busybox's: the lock goes with the open file the fd is,
// which the calling shell keeps
const FLOCK = `#!/bin/sh
[ "$1" = -n ] && [ -n "$2" ] || exit 2
exec perl -e 'use Fcntl qw(:flock); open(my $fh, ">&=", $ARGV[0]) or exit 3; flock($fh, LOCK_EX | LOCK_NB) or exit 1; exit 0' "$2"
`;

// uci -q get <config>.<section>.<option>, for the hotplug
const UCI = `#!/bin/dash
[ "$1" = -q ] && shift
[ "$1" = get ] || exit 1
p=$2
cfg=\${p%%.*}
p=\${p#*.}
sec=\${p%%.*}
opt=\${p#*.}
[ -f "$SQM_ROOT/etc/config/$cfg" ] || exit 1
awk -v sec="$sec" -v opt="$opt" '
$1 == "config" { s = $3; gsub(/\\047/, "", s); next }
$1 == "option" && s == sec && $2 == opt { v = $3; gsub(/\\047/, "", v); print v; found = 1 }
END { exit !found }' "$SQM_ROOT/etc/config/$cfg"
`;

type Section = Record<string, string>;

/** The internet queue as the GL-MT6000 has it: cake_mq on the download only */
const WAN: Section = {
  enabled: '1',
  interface: 'eth1',
  download: '650000',
  upload: '45000',
  qdisc: 'cake',
  script: 'piece_of_cake.qos',
  qdisc_advanced: '1',
  qdisc_really_really_advanced: '1',
  ingress_ecn: 'ECN',
  egress_ecn: 'ECN',
  itarget: 'auto',
  etarget: 'auto',
  linklayer: 'ethernet',
  overhead: '44',
  tcMPU: '84',
  linklayer_advanced: '1',
  use_mq: '1',
  use_mq_egress: '0',
  iqdisc_opts: 'no-split-gso',
  eqdisc_opts: 'ack-filter',
};
/** A guest network's speed limit, as the Guest Wi-Fi page writes it */
const GUEST: Section = {
  enabled: '1',
  interface: 'br-guest',
  download: '30000',
  upload: '200000',
  qdisc: 'cake',
  script: 'piece_of_cake.qos',
  linklayer: 'none',
  qdisc_advanced: '1',
  qdisc_really_really_advanced: '1',
  iqdisc_opts: 'dual-srchost nonat',
  eqdisc_opts: 'dual-dsthost nonat',
};

interface Qdiscs {
  /** the root qdisc's kind, handle and options, as the pretend kernel has them */
  root: { kind: string; handle: string; args: string } | undefined;
  ingress: boolean;
  redirect: string | undefined;
}

interface Run {
  status: number;
  out: string;
}

/** the scripts as the package installs them (its Makefile), their paths moved into a pretend root ($SQM_ROOT) */
function install(lib: string, dir: string): void {
  const exe = (path: string, text: string): void => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
    chmodSync(path, 0o755);
  };
  const copy = (from: string, to: string): void => {
    exe(
      join(dir, to),
      readFileSync(join(tree, from), 'utf8')
        .replace(/^#!\/bin\/sh/, '#!/bin/dash')
        .replaceAll('. /lib/functions.sh', `. ${join(shared, 'lib/functions.sh')}`)
        .replaceAll('/etc/sqm/sqm.conf', '${SQM_ROOT}/etc/sqm/sqm.conf')
        .replaceAll('/sys/class/net', '${SQM_ROOT}/sys/class/net')
        .replaceAll('/proc/cpuinfo', '${SQM_ROOT}/proc/cpuinfo')
        .replaceAll('/usr/lib/sqm', lib)
        .replaceAll('/etc/init.d/sqm', join(shared, 'etc/init.d/sqm')),
    );
  };
  for (const f of readdirSync(join(tree, 'src'))) copy(`src/${f}`, `usr/lib/sqm/${f}`);
  copy('src/run-openwrt.sh', 'usr/lib/sqm/run.sh');
  copy('platform/openwrt/sqm-hotplug', 'etc/hotplug.d/iface/11-sqm');
  copy('platform/openwrt/sqm-init', 'etc/init.d/sqm.init');
}

// The pretend tc, ip and the rest, and the scripts, written once: macOS
// checks a new executable the first time it runs, which costs more than the
// scripts themselves. Each router's own files are found by $SQM_ROOT.
const shared = join(scratch, 'shared');
if (unavailable === false) {
  const exe = (path: string, text: string): void => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
    chmodSync(path, 0o755);
  };
  exe(join(shared, 'bin/tc'), TC);
  exe(join(shared, 'bin/ip'), IP);
  exe(join(shared, 'bin/mkdev'), MKDEV);
  exe(join(shared, 'bin/flock'), FLOCK);
  exe(join(shared, 'bin/uci'), UCI);
  exe(join(shared, 'bin/logger'), '#!/bin/dash\nwhile [ $# -gt 1 ]; do shift; done\necho "$1" >> "$SQM_ROOT/syslog"\n');
  exe(join(shared, 'bin/modprobe'), '#!/bin/dash\nexit 0\n');
  exe(join(shared, 'bin/nft'), '#!/bin/dash\necho "nft $*" >> "$SQM_ROOT/calls.log"\n');
  exe(join(shared, 'etc/init.d/sqm'), '#!/bin/dash\n[ "$1" = enabled ]\n');
  exe(join(shared, 'lib/functions.sh'), functionsSh('${SQM_ROOT}/etc/config'));
  install(join(shared, 'usr/lib/sqm'), shared);
}

class Router {
  readonly root = mkdtempSync(join(scratch, 'router-'));
  private readonly net = join(this.root, 'sys/class/net');
  readonly state = join(this.root, 'var/run/sqm');
  /** where its scripts are: shared, or its own (to change them) */
  readonly lib: string;
  private readonly scripts: string;
  private readonly env: Record<string, string>;

  constructor({ ownScripts = false } = {}) {
    const r = this.root;
    this.scripts = ownScripts ? r : shared;
    this.lib = join(this.scripts, 'usr/lib/sqm');
    if (ownScripts) install(this.lib, r);
    this.env = { PATH: `${join(shared, 'bin')}:/usr/bin:/bin:/usr/sbin:/sbin`, LC_ALL: 'C', SQM_ROOT: r };
    for (const d of ['etc/config', 'etc/sqm', 'proc', 'var/run']) mkdirSync(join(r, d), { recursive: true });
    writeFileSync(join(r, 'proc/cpuinfo'), [0, 1, 2, 3].map((n) => `processor\t: ${n}\n`).join(''));
    writeFileSync(
      join(r, 'etc/sqm/sqm.conf'),
      readFileSync(join(tree, 'platform/openwrt/sqm.conf'), 'utf8').replaceAll('/usr/lib/sqm', this.lib).replaceAll('/var/run/sqm', this.state),
    );
    // the qdiscs found usable at the first run since boot, as a router has them
    for (const q of ['fq_codel', 'codel', 'pie', 'sfq', 'cake']) {
      mkdirSync(join(this.state, 'available_qdiscs'), { recursive: true });
      writeFileSync(join(this.state, 'available_qdiscs', q), '');
    }
    this.dev('eth1', 4);
    this.dev('br-guest', 1);
    this.network({
      wan: { device: 'eth1', proto: 'dhcp' },
      wan6: { device: '@wan', proto: 'dhcpv6' },
      guest: { device: 'br-guest', proto: 'static' },
    });
  }

  private exec(args: string[], env: Record<string, string> = {}): Promise<Run> {
    return new Promise((resolve) => {
      execFile('dash', args, { env: { ...this.env, ...env } }, (error, stdout, stderr) => {
        resolve({ status: error === null ? 0 : typeof error.code === 'number' ? error.code : -1, out: `${stdout}${stderr}` });
      });
    });
  }

  /** a device that's up, with that many transmit queues */
  dev(name: string, queues = 1, mtu = 1500): void {
    execFileSync(join(shared, 'bin/mkdev'), [name, String(queues), 'up', String(mtu)], { env: this.env });
  }

  gone(name: string): void {
    rmSync(join(this.net, name), { recursive: true, force: true });
  }

  exists(name: string): boolean {
    return existsSync(join(this.net, name));
  }

  write(config: string, sections: Record<string, Section>, type: string): void {
    writeFileSync(join(this.root, 'etc/config', config), uciExport(config, type, sections));
  }

  sqm(sections: Record<string, Section>): void {
    this.write('sqm', sections, 'queue');
  }

  network(sections: Record<string, Section>): void {
    this.write('network', sections, 'interface');
  }

  /** run.sh <action> [iface] */
  run(...args: string[]): Promise<Run> {
    return this.exec([join(this.lib, 'run.sh'), ...args]);
  }

  /** the iface hotplug, as hotplug-call runs it (sourced, in a subshell) */
  hotplug(env: Record<string, string>): Promise<Run> {
    return this.exec(['-c', `. ${join(this.scripts, 'etc/hotplug.d/iface/11-sqm')}`], env);
  }

  /** the init script's reload_service, with rc.common's part left out */
  initReload(): Promise<Run> {
    return this.exec(['-c', `. ${join(this.scripts, 'etc/init.d/sqm.init')}; reload_service`]);
  }

  qdiscs(dev: string): Qdiscs {
    const tc = join(this.net, dev, '.tc');
    const read = (f: string): string | undefined => (existsSync(join(tc, f)) ? readFileSync(join(tc, f), 'utf8').trim() : undefined);
    const root = read('root')?.split(' ');
    return {
      root: root === undefined ? undefined : { kind: root[0] ?? '', handle: root[1] ?? '', args: root.slice(2).join(' ') },
      ingress: read('ingress') !== undefined,
      redirect: read('redirect'),
    };
  }

  ifbUp(dev: string): boolean {
    return (Number(readFileSync(join(this.net, dev, 'flags'), 'utf8')) & 1) === 1;
  }

  stateFile(iface: string): string | undefined {
    const f = join(this.state, `${iface}.state`);
    return existsSync(f) ? readFileSync(f, 'utf8') : undefined;
  }

  /** the tc and ip commands run since <mark> (calls().length before) */
  calls(mark = 0): string[] {
    const f = join(this.root, 'calls.log');
    return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l !== '').slice(mark) : [];
  }

  syslog(): string[] {
    const f = join(this.root, 'syslog');
    return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l !== '') : [];
  }

  /** the pretend tc and ip themselves, as someone at the router's shell */
  tc(...args: string[]): void {
    execFileSync(join(shared, 'bin/tc'), args, { env: this.env });
  }

  ip(...args: string[]): void {
    execFileSync(join(shared, 'bin/ip'), args, { env: this.env });
  }

  /** qdiscs the pretend kernel refuses from now on, as a missing module */
  refuse(kind: string): void {
    appendFileSync(join(this.root, 'refuse'), `${kind}\n`);
  }
}

/** what a start leaves: a CAKE each way, the download redirected to an ifb that's up */
function assertShaping(r: Router, iface: string, upKind = 'cake', downKind = 'cake'): void {
  const ifb = `ifb4${iface}`;
  const q = r.qdiscs(iface);
  assert.equal(q.root?.kind, upKind, `${iface}'s root`);
  assert.equal(q.ingress, true, `${iface}'s ingress qdisc`);
  assert.equal(q.redirect, ifb, `${iface}'s download redirect`);
  assert.equal(r.qdiscs(ifb).root?.kind, downKind, `${ifb}'s root`);
  assert.equal(r.ifbUp(ifb), true, `${ifb} up`);
  assert.notEqual(r.stateFile(iface), undefined, `${iface}'s state file`);
}

/** nothing of a queue left: no qdisc of its own, no redirect, no ifb, no state file */
function assertNothing(r: Router, iface: string): void {
  const q = r.qdiscs(iface);
  assert.equal(q.root, undefined, `${iface}'s root: ${JSON.stringify(q.root)}`);
  assert.equal(q.ingress, false, `${iface}'s ingress qdisc`);
  assert.equal(q.redirect, undefined, `${iface}'s redirect`);
  assert.equal(r.exists(`ifb4${iface}`), false, `ifb4${iface}`);
  assert.equal(r.stateFile(iface), undefined, `${iface}'s state file`);
}

/** the tc and ip commands since <mark> that changed <dev>'s qdiscs or its ifb */
function touched(r: Router, mark: number, dev: string): string[] {
  return r.calls(mark).filter((c) => /^(tc qdisc (add|del|replace)|tc filter add|ip link)/.test(c) && c.includes(` ${dev}`));
}

const skip = unavailable;

// each test has a pretend router of its own, so they run side by side
void describe('sqm-scripts', { concurrency: 8 }, () => {
  test('a start shapes both ways, as the router does, and records what it started with', { skip }, async () => {
    const r = new Router();
    r.sqm({ eth1: WAN });
    const run = await r.run('start');
    assert.equal(run.status, 0, run.out);
    assertShaping(r, 'eth1', 'cake', 'cake_mq');
    assert.match(r.qdiscs('eth1').root?.args ?? '', /bandwidth 45000kbit .*overhead 44 mpu 84 .*ack-filter/);
    assert.match(r.qdiscs('ifb4eth1').root?.args ?? '', /bandwidth 650000kbit .*no-split-gso/);
    assert.match(r.stateFile('eth1') ?? '', /^SQM_INPUTS="[0-9a-f]{32}"$/m);
    assert.match(r.stateFile('eth1') ?? '', /^SQM_QDISCS="[0-9a-f]{32}"$/m);
    assert.ok(r.syslog().some((l) => l.includes('piece_of_cake.qos was started on eth1 successfully')));
  });

  // a failed qdisc add used to leave the ifb up and the download redirected into it, unshaped, reported as started
  for (const [what, options] of [
    ['a word tc does not know in the download options', { iqdisc_opts: 'no-split-gso bogus' }],
    ['a word tc does not know in the upload options', { eqdisc_opts: 'ack-filter bogus' }],
    ['autorate-ingress on a multi-queue download, which cake_mq refuses', { iqdisc_opts: 'autorate-ingress' }],
    ['layer_cake, a word tc does not know', { script: 'layer_cake.qos', iqdisc_opts: 'bogus' }],
    ['simple.qos with cake, a word tc does not know', { script: 'simple.qos', iqdisc_opts: 'bogus' }],
    ['simple.qos with fq_codel, a word tc does not know', { script: 'simple.qos', qdisc: 'fq_codel', iqdisc_opts: 'bogus' }],
    ['simple.qos with fq_codel, DSCP kept on the download', { script: 'simple.qos', qdisc: 'fq_codel', squash_ingress: '0', iqdisc_opts: 'bogus' }],
    ['simplest.qos with fq_codel, a word tc does not know', { script: 'simplest.qos', qdisc: 'fq_codel', iqdisc_opts: 'bogus' }],
    ['simplest.qos with cake, a word tc does not know', { script: 'simplest.qos', iqdisc_opts: 'bogus' }],
    ['simplest_tbf.qos, a word tc does not know', { script: 'simplest_tbf.qos', qdisc: 'fq_codel', iqdisc_opts: 'bogus' }],
    ['simplest_tbf.qos, the upload', { script: 'simplest_tbf.qos', qdisc: 'fq_codel', eqdisc_opts: 'bogus' }],
  ] as const) {
    test(`a start that fails leaves nothing running and says so: ${what}`, { skip }, async () => {
      const r = new Router();
      r.sqm({ eth1: { ...WAN, ...options } });
      const run = await r.run('start');
      assert.notEqual(run.status, 0, 'run.sh start fails');
      assertNothing(r, 'eth1');
      assert.ok(
        r.syslog().some((l) => /ERROR: .* failed to start on eth1/.test(l)),
        r.syslog().join('\n'),
      );
      assert.ok(!r.syslog().some((l) => l.includes('started on eth1 successfully')));
    });
  }

  test('a start that fails on one queue: the others start, and run.sh fails', { skip }, async () => {
    const r = new Router();
    r.sqm({ eth1: WAN, guest: { ...GUEST, iqdisc_opts: 'bogus' } });
    const run = await r.run('start');
    assert.notEqual(run.status, 0);
    assertShaping(r, 'eth1', 'cake', 'cake_mq');
    assertNothing(r, 'br-guest');
  });

  test('a queue changed to settings that fail: what ran with the old ones is taken down too', { skip }, async () => {
    const r = new Router();
    r.sqm({ eth1: WAN });
    await r.run('start');
    r.sqm({ eth1: { ...WAN, upload: '70000', iqdisc_opts: 'bogus' } });
    assert.notEqual((await r.run('reload')).status, 0);
    assertNothing(r, 'eth1');
  });

  test('a qdisc remembered as working that stops working: the start fails and leaves nothing', { skip }, async () => {
    const r = new Router();
    r.sqm({ eth1: WAN });
    await r.run('start');
    assert.ok(existsSync(join(r.state, 'verified_qdiscs/cake')));
    await r.run('stop');
    r.refuse('cake');
    assert.notEqual((await r.run('start')).status, 0);
    assertNothing(r, 'eth1');
  });

  test('a second start checks no qdisc again: fewer commands while downloads are unshaped', { skip }, async () => {
    const r = new Router();
    r.sqm({ eth1: WAN });
    const throwaway = (calls: string[]): number => calls.filter((c) => c.startsWith('ip link add name SQM_IFB_')).length;
    await r.run('start');
    const first = r.calls();
    assert.ok(throwaway(first) >= 3, `the first start checks cake, ingress and cake_mq: ${String(throwaway(first))}`);
    await r.run('stop');
    const mark = r.calls().length;
    await r.run('start');
    const second = r.calls(mark);
    assert.equal(throwaway(second), 0);
    assert.ok(second.length < first.length, `${String(second.length)} commands, the first time ${String(first.length)}`);
    assertShaping(r, 'eth1', 'cake', 'cake_mq');
  });

  test('upload multi-queue on with download multi-queue off: cake_mq on the port, one CAKE on the ifb', { skip }, async () => {
    const r = new Router();
    r.sqm({ eth1: { ...WAN, use_mq: '0', use_mq_egress: '1' } });
    assert.equal((await r.run('start')).status, 0);
    assertShaping(r, 'eth1', 'cake_mq', 'cake');
    assert.ok(!r.syslog().some((l) => l.includes('NOT useable')), r.syslog().join('\n'));
  });

  test('download multi-queue on, upload off: one CAKE on the port, cake_mq on the ifb; both off: one CAKE each', { skip }, async () => {
    const r = new Router();
    r.sqm({ eth1: WAN });
    await r.run('start');
    assertShaping(r, 'eth1', 'cake', 'cake_mq');
    r.sqm({ eth1: { ...WAN, use_mq: '0' } });
    await r.run('reload');
    assertShaping(r, 'eth1', 'cake', 'cake');
  });

  test('an ifup with nothing changed leaves the queue as it is (wan6 coming up on wan’s device)', { skip }, async () => {
    const r = new Router();
    r.sqm({ eth1: WAN, guest: GUEST });
    await r.run('start');
    const before = [r.qdiscs('eth1'), r.qdiscs('ifb4eth1')];
    const mark = r.calls().length;
    for (const iface of ['wan', 'wan6']) assert.equal((await r.hotplug({ ACTION: 'ifup', INTERFACE: iface, DEVICE: 'eth1' })).status, 0);
    assert.deepEqual(touched(r, mark, 'eth1'), []);
    assert.deepEqual([r.qdiscs('eth1'), r.qdiscs('ifb4eth1')], before);
    assert.equal(r.syslog().filter((l) => l.includes('SQM on eth1 runs as set')).length, 2);
  });

  test('an ifup on a device with no queue, or none running yet, starts what is set', { skip }, async () => {
    const r = new Router();
    r.sqm({ eth1: WAN });
    await r.hotplug({ ACTION: 'ifup', INTERFACE: 'lan', DEVICE: 'br-lan' });
    assert.equal(r.stateFile('eth1'), undefined);
    await r.hotplug({ ACTION: 'ifup', INTERFACE: 'wan', DEVICE: 'eth1' });
    assertShaping(r, 'eth1', 'cake', 'cake_mq');
  });

  test('a save of a guest network’s speed restarts its queue and leaves the internet’s alone', { skip }, async () => {
    const r = new Router();
    r.sqm({ eth1: WAN, guest: GUEST });
    await r.run('start');
    const wan = [r.qdiscs('eth1'), r.qdiscs('ifb4eth1')];
    const guest = r.qdiscs('br-guest').root?.handle;
    r.sqm({ eth1: WAN, guest: { ...GUEST, upload: '100000' } });
    const mark = r.calls().length;
    assert.equal((await r.initReload()).status, 0);
    assert.deepEqual(touched(r, mark, 'eth1'), []);
    assert.deepEqual([r.qdiscs('eth1'), r.qdiscs('ifb4eth1')], wan);
    assertShaping(r, 'br-guest');
    assert.notEqual(r.qdiscs('br-guest').root?.handle, guest);
    assert.match(r.qdiscs('br-guest').root?.args ?? '', /bandwidth 100000kbit/);
  });

  test('the init script’s reload is run.sh reload: no stop of every queue first', { skip }, () => {
    const text = readFileSync(join(tree, 'platform/openwrt/sqm-init'), 'utf8');
    const body = /reload_service\(\)\s*\{([^}]*)\}/.exec(text)?.[1] ?? '';
    assert.match(body, /\/usr\/lib\/sqm\/run\.sh reload/);
    assert.doesNotMatch(body, /\bstop\b/);
  });

  // for each option start_sqm_section reads, another value
  const ALTERNATIVE: Section = {
    upload: '84000',
    download: '749000',
    linklayer_adaptation_mechanism: 'cake',
    linklayer: 'atm',
    overhead: '40',
    tcMTU: '2000',
    tcTSIZE: '256',
    tcMPU: '64',
    ilimit: '500',
    elimit: '500',
    itarget: '10ms',
    etarget: '10ms',
    ingress_ecn: 'NOECN',
    egress_ecn: 'NOECN',
    iqdisc_opts: 'no-split-gso rtt 50ms',
    eqdisc_opts: 'ack-filter rtt 50ms',
    target: '10ms',
    qdisc: 'fq_codel',
    script: 'layer_cake.qos',
    use_mq: '0',
    use_mq_egress: '1',
    squash_dscp: '0',
    squash_ingress: '0',
    debug_logging: '0',
    verbosity: '5',
  };

  test('every option a start reads stops and starts its queue again when it changes, never leaves it running as it was', { skip }, async () => {
    const options = readFileSync(join(tree, 'src/run-openwrt.sh'), 'utf8').matchAll(/config_get "\$section" (\w+)\)/g);
    const read = [...new Set([...options].map((m) => m[1] ?? ''))].filter((o) => o !== 'interface' && o !== 'enabled');
    assert.ok(read.length >= 24 && read.includes('use_mq_egress'), read.join(' '));
    const r = new Router();
    r.sqm({ eth1: WAN });
    await r.run('start');
    for (const option of read) {
      const value = ALTERNATIVE[option];
      assert.notEqual(value, undefined, `a value to try for ${option}`);
      r.sqm({ eth1: { ...WAN, [option]: value ?? '' } });
      const mark = r.calls().length;
      const lines = r.syslog().length;
      await r.run('reload');
      assert.ok(
        touched(r, mark, 'eth1').some((c) => c.startsWith('tc qdisc del dev eth1')),
        `${option}: stopped and started again`,
      );
      assert.ok(!r.syslog().slice(lines).some((l) => l.includes('runs as set')), option);
      // back as it was, for the next
      r.sqm({ eth1: WAN });
      await r.run('reload');
    }
  });

  test('an option nothing reads (LuCI’s) restarts it too: what counts is the whole section', { skip }, async () => {
    const r = new Router();
    r.sqm({ eth1: WAN });
    await r.run('start');
    const handle = r.qdiscs('eth1').root?.handle;
    r.sqm({ eth1: { ...WAN, qdisc_really_really_advanced: '0' } });
    await r.run('reload');
    assertShaping(r, 'eth1', 'cake', 'cake_mq');
    assert.notEqual(r.qdiscs('eth1').root?.handle, handle);
  });

  test('a queue turned off or removed is stopped; one moved to another device starts there', { skip }, async () => {
    const r = new Router();
    r.dev('eth2', 4);
    r.sqm({ eth1: WAN, guest: GUEST });
    await r.run('start');
    r.sqm({ eth1: { ...WAN, enabled: '0' }, guest: GUEST });
    await r.run('reload');
    assertNothing(r, 'eth1');
    assertShaping(r, 'br-guest');
    r.sqm({ eth1: WAN });
    await r.run('reload');
    assertShaping(r, 'eth1', 'cake', 'cake_mq');
    assertNothing(r, 'br-guest');
    r.sqm({ eth1: { ...WAN, interface: 'eth2' } });
    await r.run('reload');
    assertNothing(r, 'eth1');
    assertShaping(r, 'eth2', 'cake', 'cake_mq');
  });

  test('two sections on one device: the first that is on runs, and a switch to the other restarts it', { skip }, async () => {
    const r = new Router();
    r.sqm({ a: { ...WAN, upload: '1000' }, b: { ...WAN, upload: '2000' } });
    await r.run('start');
    assert.match(r.qdiscs('eth1').root?.args ?? '', /bandwidth 1000kbit/);
    await r.run('reload');
    assert.match(r.qdiscs('eth1').root?.args ?? '', /bandwidth 1000kbit/);
    assert.ok(r.syslog().some((l) => l.includes('runs as set')));
    r.sqm({ a: { ...WAN, upload: '1000', enabled: '0' }, b: { ...WAN, upload: '2000' } });
    await r.run('reload');
    assert.match(r.qdiscs('eth1').root?.args ?? '', /bandwidth 2000kbit/);
  });

  for (const [what, change, ownScripts] of [
    [
      'its root qdisc replaced by someone else',
      (r: Router): void => {
        r.tc('qdisc', 'replace', 'dev', 'eth1', 'root', 'cake');
      },
    ],
    [
      'its ifb’s qdisc replaced',
      (r: Router): void => {
        r.tc('qdisc', 'replace', 'dev', 'ifb4eth1', 'root', 'cake');
      },
    ],
    [
      'its ifb taken down',
      (r: Router): void => {
        r.ip('link', 'set', 'dev', 'ifb4eth1', 'down');
      },
    ],
    [
      'its ifb deleted',
      (r: Router): void => {
        r.ip('link', 'delete', 'ifb4eth1', 'type', 'ifb');
      },
    ],
    [
      'its download redirect gone',
      (r: Router): void => {
        r.tc('qdisc', 'del', 'dev', 'eth1', 'ingress');
      },
    ],
    [
      'its device made again (pppoe-wan after a reconnect)',
      (r: Router): void => {
        r.gone('eth1');
        r.dev('eth1', 4);
      },
    ],
    [
      'its device’s MTU changed',
      (r: Router): void => {
        writeFileSync(join(r.root, 'sys/class/net/eth1/mtu'), '1492\n');
      },
    ],
    [
      'a new version of the scripts',
      (r: Router): void => {
        appendFileSync(join(r.lib, 'functions.sh'), '\n# a new version\n');
      },
      true,
    ],
    [
      'a new version of run.sh (it reads the section)',
      (r: Router): void => {
        appendFileSync(join(r.lib, 'run.sh'), '\n# a new version\n');
      },
      true,
    ],
    [
      'a state file from before reloads knew it',
      (r: Router): void => {
        writeFileSync(join(r.state, 'eth1.state'), (r.stateFile('eth1') ?? '').replace(/^SQM_(INPUTS|QDISCS)=.*\n/gm, ''));
      },
    ],
  ] as const) {
    test(`a queue whose start no longer holds is started again by an ifup: ${what}`, { skip }, async () => {
      const r = new Router({ ownScripts: ownScripts === true });
      r.sqm({ eth1: WAN });
      await r.run('start');
      change(r);
      const mark = r.calls().length;
      assert.equal((await r.hotplug({ ACTION: 'ifup', INTERFACE: 'wan', DEVICE: 'eth1' })).status, 0);
      assert.ok(touched(r, mark, 'eth1').some((c) => c.startsWith('tc qdisc add dev eth1 root')), 'started again');
      assertShaping(r, 'eth1', 'cake', 'cake_mq');
      // and then it holds
      const again = r.calls().length;
      await r.hotplug({ ACTION: 'ifup', INTERFACE: 'wan6', DEVICE: 'eth1' });
      assert.deepEqual(touched(r, again, 'eth1'), []);
    });
  }

  test('an ifup on one device leaves the other queues as they are, changed or not', { skip }, async () => {
    const r = new Router();
    r.sqm({ eth1: WAN, guest: GUEST });
    await r.run('start');
    r.sqm({ eth1: WAN, guest: { ...GUEST, upload: '1000' } });
    const mark = r.calls().length;
    await r.hotplug({ ACTION: 'ifup', INTERFACE: 'wan', DEVICE: 'eth1' });
    assert.deepEqual(touched(r, mark, 'br-guest'), []);
    assert.deepEqual(touched(r, mark, 'eth1'), []);
  });

  test('ifdown (netifd names no device): a queue whose device went with it is stopped, its ifb and state with it', { skip }, async () => {
    const r = new Router();
    r.dev('pppoe-wan', 1, 1492);
    r.sqm({ wan: { ...WAN, interface: 'pppoe-wan', use_mq: '0' }, guest: GUEST });
    await r.run('start');
    assertShaping(r, 'pppoe-wan');
    r.gone('pppoe-wan');
    const mark = r.calls().length;
    assert.equal((await r.hotplug({ ACTION: 'ifdown', INTERFACE: 'wan' })).status, 0);
    assert.equal(r.exists('ifb4pppoe-wan'), false);
    assert.equal(r.stateFile('pppoe-wan'), undefined);
    // the guest network's queue is on a device that's still there
    assert.deepEqual(touched(r, mark, 'br-guest'), []);
    assertShaping(r, 'br-guest');
    assert.ok(!r.syslog().some((l) => l.startsWith('ERROR')), r.syslog().join('\n'));
  });

  test('ifdown of an interface whose device stays (wan6 on eth1): the queue keeps running', { skip }, async () => {
    const r = new Router();
    r.sqm({ eth1: WAN });
    await r.run('start');
    const mark = r.calls().length;
    await r.hotplug({ ACTION: 'ifdown', INTERFACE: 'wan6' });
    assert.deepEqual(touched(r, mark, 'eth1'), []);
    assertShaping(r, 'eth1', 'cake', 'cake_mq');
  });

  for (const [what, options, gone] of [
    ['both ways', {}, false],
    ['a queue without a download', { download: '0' }, false],
    ['a queue without an upload (a guest network limiting only uploads)', { upload: '0' }, false],
    ['a device that is gone', {}, true],
  ] as const) {
    test(`a stop takes down everything and logs no errors: ${what}`, { skip }, async () => {
      const r = new Router();
      r.sqm({ eth1: { ...WAN, ...options } });
      assert.equal((await r.run('start')).status, 0);
      if (gone) r.gone('eth1');
      const lines = r.syslog().length;
      assert.equal((await r.run('stop')).status, 0);
      const errors = r.syslog().slice(lines).filter((l) => l.startsWith('ERROR'));
      assert.deepEqual(errors, []);
      if (!gone) assertNothing(r, 'eth1');
      assert.equal(r.exists('ifb4eth1'), false);
      assert.equal(r.stateFile('eth1'), undefined);
    });
  }

  test('a stop of a queue without a download leaves an ingress qdisc that isn’t its own', { skip }, async () => {
    const r = new Router();
    r.sqm({ eth1: { ...WAN, download: '0' } });
    await r.run('start');
    r.tc('qdisc', 'add', 'dev', 'eth1', 'handle', 'ffff:', 'ingress');
    await r.run('stop');
    assert.equal(r.qdiscs('eth1').ingress, true);
  });

  test('a run killed while it held the lock doesn’t hold up the next one', { skip }, async () => {
    const r = new Router();
    r.sqm({ eth1: WAN });
    mkdirSync(r.state, { recursive: true });
    const holder = spawn('perl', ['-e', 'use Fcntl qw(:flock); $| = 1; open(F, ">", $ARGV[0]) or die; flock(F, LOCK_EX) or die; print "held\\n"; sleep 60', join(r.state, 'run.lock')]);
    await new Promise<void>((resolve) => holder.stdout.once('data', () => {
        resolve();
      }));
    holder.kill('SIGKILL');
    await new Promise<void>((resolve) => holder.once('exit', () => {
        resolve();
      }));
    const t0 = Date.now();
    assert.equal((await r.run('start')).status, 0);
    // the lock's 10 tries, had it stayed taken, would take 10 s and fail
    assert.ok(Date.now() - t0 < 9000, `${String(Date.now() - t0)} ms`);
    assert.ok(!r.syslog().some((l) => l.includes('run lock')), r.syslog().join('\n'));
    assertShaping(r, 'eth1', 'cake', 'cake_mq');
  });

  test('a run waits for one in progress, then goes ahead', { skip }, async () => {
    const r = new Router();
    r.sqm({ eth1: WAN });
    mkdirSync(r.state, { recursive: true });
    // holds the lock until told to let go (a line on its stdin)
    const holder = spawn('perl', ['-e', 'use Fcntl qw(:flock); $| = 1; open(F, ">", $ARGV[0]) or die; flock(F, LOCK_EX) or die; print "held\\n"; <STDIN>', join(r.state, 'run.lock')]);
    await new Promise<void>((resolve) => holder.stdout.once('data', () => {
        resolve();
      }));
    const run = r.run('start');
    while (!r.syslog().some((l) => l.includes('Unable to get run lock'))) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(r.stateFile('eth1'), undefined, 'nothing started while the lock was held');
    holder.stdin.end('\n');
    assert.equal((await run).status, 0);
    assertShaping(r, 'eth1', 'cake', 'cake_mq');
  });

  test('a lock directory the old lock left behind holds nothing up', { skip }, async () => {
    const r = new Router();
    r.sqm({ eth1: WAN });
    mkdirSync(join(r.state, 'sqm-run.lock'), { recursive: true });
    writeFileSync(join(r.state, 'sqm-run.lock/pid'), '99999\n');
    assert.equal((await r.run('start')).status, 0);
    assertShaping(r, 'eth1', 'cake', 'cake_mq');
  });
});
