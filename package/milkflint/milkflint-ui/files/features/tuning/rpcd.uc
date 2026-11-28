// rpcd plugin for the "tuning" feature: what the Performance Tuning page's
// settings are doing right now. Each radio's best-effort AQL limits
// (mac80211's debugfs), where packet steering put the network work, how
// the internet port groups what it receives (GRO), and the drivers' latency
// settings (their module parameters), and whether the Wi-Fi driver runs with
// Wireless Ethernet Dispatch. Read-only: the settings
// are uci (milkflint, network.globals, sqm), and
// /etc/init.d/milkflint-tuning puts them into effect.
'use strict';

import { access, lsdir, popen, readfile, readlink } from 'fs';

function run(cmd) {
	const fd = popen(`${cmd} 2>/dev/null`, 'r');
	if (!fd)
		return '';
	const out = fd.read('all') ?? '';
	fd.close();
	return out;
}

// The internet port's GRO: what the settings resolve to
// (/usr/libexec/milkflint/gro show) and what the port does now (ethtool -k,
// ip -d link). A feature ethtool doesn't list is null.
function gro() {
	const out = [];
	for (let line in split(trim(run('/usr/libexec/milkflint/gro show')), '\n')) {
		const kv = {};
		for (let w in split(line, ' ')) {
			const m = match(w, /^([a-z]+)=(.*)$/);
			if (m)
				kv[m[1]] = m[2];
		}
		const dev = kv.dev;
		if (!dev || !match(dev, /^[A-Za-z0-9._@-]+$/))
			continue;
		const features = run(`ethtool -k '${dev}'`);
		const feature = (name) => {
			const m = match(features, regexp(`\n${name}: (on|off)`));
			return m ? m[1] == 'on' : null;
		};
		const size = match(run(`ip -d link show dev '${dev}'`), /gro_max_size ([0-9]+)/);
		push(out, {
			dev,
			mode: kv.mode, auto: kv.auto, udp: kv.udp == '1', max: +kv.max,
			whole: kv.whole == '1', offload: kv.offload == '1',
			now: {
				gro: feature('generic-receive-offload'),
				list: feature('rx-gro-list'),
				udp: feature('rx-udp-gro-forwarding'),
				max: size ? +size[1] : null,
			},
		});
	}
	return out;
}

// CPU numbers from a kernel list ("1-3,5") or a hex mask ("e").
function cpu_list(s) {
	const out = [];
	for (let part in split(trim(s ?? ''), ','))
		if (match(part, /^[0-9]+(-[0-9]+)?$/)) {
			const r = split(part, '-');
			for (let i = +r[0]; i <= +(r[1] ?? r[0]); i++)
				push(out, i);
		}
	return out;
}

function cpu_mask(s) {
	const out = [];
	let mask = hex(replace(trim(s ?? ''), ',', ''));
	for (let i = 0; mask > 0 && i < 64; i++, mask >>= 1)
		if (mask & 1)
			push(out, i);
	return out;
}

function add_all(set, cpus) {
	for (let c in cpus)
		if (!(c in set))
			push(set, c);
}

// a module parameter's number; null where the image doesn't have it (or
// sch_cake isn't loaded)
function param(path) {
	const v = trim(readfile(path) ?? '');
	return match(v, /^[0-9]+$/) ? +v : null;
}

// Each radio's best-effort (BE) limits, and the total that holds devices to
// the low one, in us
function radios() {
	const out = [];
	const phys = sort(filter(lsdir('/sys/kernel/debug/ieee80211') ?? [], (p) => match(p, /^phy[0-9]+$/)),
		(a, b) => +substr(a, 3) - +substr(b, 3));
	for (let phy in phys) {
		const m = match(readfile(`/sys/kernel/debug/ieee80211/${phy}/aql_txq_limit`) ?? '', /\nBE[ \t]+([0-9]+)[ \t]+([0-9]+)/);
		if (m)
			push(out, { phy, low: +m[1], high: +m[2], threshold: param(`/sys/kernel/debug/ieee80211/${phy}/aql_threshold`) });
	}
	return out;
}

// The ports packet steering spreads: on the GL-MT6000 eth0 (the switch's)
// and eth1 (WAN); elsewhere too, every port with hardware under it that
// isn't Wi-Fi or stacked on another port (a DSA port, a VLAN).
function wired(dev) {
	const p = `/sys/class/net/${dev}`;
	return readlink(`${p}/device/driver`) != null && access(`${p}/phy80211`) != true &&
		length(filter(lsdir(p) ?? [], (f) => match(f, /^lower_/))) == 0;
}

// a port of the DSA switch (lan1-5: its one lower device, the switch port,
// has DSA's attributes), where packet-steering.sh sets RPS with mtk_eth's
// dsa_gro on
function dsa_port(dev) {
	const lower = filter(lsdir(`/sys/class/net/${dev}`) ?? [], (f) => match(f, /^lower_/));
	return length(lower) == 1 && access(`/sys/class/net/${substr(lower[0], 6)}/dsa`) == true;
}

// Where the network work runs: the CPUs the Ethernet receive (mtk_eth NAPI)
// threads and the Wi-Fi driver's threads may use, and the CPUs what the
// wired ports receive is spread over (RPS; empty: none, it stays where it
// arrives).
// a thread's scheduling policy: field 41 of /proc/<pid>/stat, after the
// command name, which may hold spaces (0 normal, 1 FIFO, 2 round-robin)
function policy(pid) {
	const stat = readfile(`/proc/${pid}/stat`) ?? '';
	const fields = split(substr(stat, rindex(stat, ')') + 2), ' ');
	return +(fields[38] ?? 0);
}

function steering() {
	const ethernet = [], wifi = [], rps = [];
	let realtime = false;
	for (let pid in lsdir('/proc') ?? []) {
		if (!match(pid, /^[0-9]+$/))
			continue;
		const comm = readfile(`/proc/${pid}/comm`) ?? '';
		const of_wifi = match(comm, /^(napi\/phy[0-9]+-|mt76-tx)/) != null;
		if (!of_wifi && !match(comm, /^napi\/mtk_eth-/))
			continue;
		const m = match(readfile(`/proc/${pid}/status`) ?? '', /Cpus_allowed_list:[ \t]*([0-9,-]+)/);
		add_all(of_wifi ? wifi : ethernet, cpu_list(m?.[1]));
		if (!of_wifi && policy(pid) > 0)
			realtime = true;
	}
	for (let dev in lsdir('/sys/class/net') ?? [])
		if (wired(dev) || dsa_port(dev))
			for (let q in lsdir(`/sys/class/net/${dev}/queues`) ?? [])
				if (match(q, /^rx-/))
					add_all(rps, cpu_mask(readfile(`/sys/class/net/${dev}/queues/${q}/rps_cpus`)));
	let cpus = 0;
	for (let line in split(readfile('/proc/stat') ?? '', '\n'))
		if (match(line, /^cpu[0-9]+ /))
			cpus++;
	return { cpus, ethernet: sort(ethernet), wifi: sort(wifi), rps: sort(rps), realtime };
}

// The kernel's tick rate (HZ), from /proc/timer_list: jiffies start at
// 2^32 - 300 * HZ (INITIAL_JIFFIES) and count HZ a second from boot, so
// HZ = (jiffies - 2^32) / (seconds since boot - 300). Too close to 300 s
// to tell, it's null; once known it doesn't change, so it's kept.
let hz = null;
function tick_rate() {
	if (hz != null)
		return hz;
	const t = readfile('/proc/timer_list') ?? '';
	const now = match(t, /\nnow at ([0-9]+) nsecs/);
	const jiffies = match(t, /\njiffies: ([0-9]+)/);
	if (!now || !jiffies)
		return null;
	const since = +now[1] / 1e9 - 300;
	if (since > -30 && since < 30)
		return null;
	const guess = (+jiffies[1] - 4294967296) / since;
	for (let h in [24, 48, 100, 128, 200, 250, 256, 300, 500, 1000, 1024])
		if (guess > h * 0.97 && guess < h * 1.03)
			return hz = h;
	return null;
}

// a module parameter that's on or off; null where the image doesn't have it
function flag(path) {
	const v = trim(readfile(path) ?? '');
	return (v == 'Y' || v == '1') ? true : ((v == 'N' || v == '0') ? false : null);
}

// The CPUs the switch port (the frame engine's MAC with dsa/, the DSA
// conduit) hands on what its first receive queue gets (RPS), where
// everything the LAN ports receive lands with RSS: [] for none; null
// without such a port (a VM). With mtk_eth's dsa_gro on, packet-steering.sh
// moves that to the LAN ports' own first queues (the ports stacked on the
// switch port), so it's read from the first of them.
function lan_rps() {
	const devs = sort(lsdir('/sys/class/net') ?? []);
	for (let dev in devs) {
		const p = `/sys/class/net/${dev}`;
		if (access(`${p}/dsa`) != true || readlink(`${p}/device/driver`) == null)
			continue;
		if (flag('/sys/module/mtk_eth/parameters/dsa_gro') == true)
			for (let port in devs)
				if (access(`/sys/class/net/${port}/lower_${dev}`) == true)
					return cpu_mask(readfile(`/sys/class/net/${port}/queues/rx-0/rps_cpus`));
		return cpu_mask(readfile(`${p}/queues/rx-0/rps_cpus`));
	}
	return null;
}

// the drivers' latency settings as they are now: the Ethernet's longest RX
// interrupt delay (µs, 0: no limit), its moderation's and the LAN ports'
// experimental switches, sch_cake's count at which an ECN download that
// ignores its marks is dropped (0: never; null with sch_cake not loaded, or
// without the parameter: cake_loaded tells which), its experimental
// download settings and the count of what one of them dropped (the same),
// ifb's experimental hand-back (null with ifb not loaded, or without it:
// ifb_loaded tells which), and the Wi-Fi driver's sends of a data frame
function knobs() {
	return {
		rx_delay: param('/sys/module/mtk_eth/parameters/rx_dim_max_us'),
		rx_dim_per_ring: flag('/sys/module/mtk_eth/parameters/rx_dim_per_ring'),
		qdma_tx_dim: flag('/sys/module/mtk_eth/parameters/qdma_tx_dim'),
		lan_rps: lan_rps(),
		pdma_stag: flag('/sys/module/mtk_eth/parameters/pdma_stag'),
		dsa_gro: flag('/sys/module/mtk_eth/parameters/dsa_gro'),
		cake_drop_one_segment: flag('/sys/module/sch_cake/parameters/drop_one_segment'),
		cake_sparse_ahead: param('/sys/module/sch_cake/parameters/sparse_ahead_us'),
		// read-only: packets dropped one of a group since sch_cake loaded
		cake_one_segment_drops: param('/sys/module/sch_cake/parameters/one_segment_drops'),
		cake_ecn: param('/sys/module/sch_cake/parameters/ecn_fail_count'),
		cake_l4s: param('/sys/module/sch_cake/parameters/l4s_ramp'),
		cake_loaded: access('/sys/module/sch_cake') == true,
		ifb_direct: flag('/sys/module/ifb/parameters/direct_xmit'),
		ifb_loaded: access('/sys/module/ifb') == true,
		wifi_retries: param('/sys/module/mt76_connac_lib/parameters/data_tx_count'),
		wifi_vo_aggr: flag('/sys/module/mt76_connac_lib/parameters/vo_aggr'),
	};
}

// Hardware offloading with WED (/usr/libexec/milkflint/wed status): whether the
// setting asks for it, how the loaded Wi-Fi driver has it (null without the
// driver; it takes the setting when the router starts), and whether a radio
// is attached to the SoC's WED right now
function wed() {
	const kv = {};
	for (let line in split(trim(run('/usr/libexec/milkflint/wed status')), '\n')) {
		const m = match(line, /^([a-z]+)=(.*)$/);
		if (m)
			kv[m[1]] = m[2];
	}
	return {
		wanted: kv.wanted == '1',
		loaded: kv.loaded == 'Y' ? true : (kv.loaded == 'N' ? false : null),
		active: kv.active == '1',
	};
}

function kernel() {
	return {
		hz: tick_rate(),
		// whether the threads' waits are recorded (SCHED_INFO); the figures
		// themselves come with milkflint.pipeline's threads
		waits: access('/proc/self/schedstat') == true,
	};
}

return {
	'milkflint.tuning': {
		status: {
			call: function() {
				return { radios: radios(), steering: steering(), gro: gro(), kernel: kernel(), knobs: knobs(), wed: wed() };
			}
		}
	}
};
