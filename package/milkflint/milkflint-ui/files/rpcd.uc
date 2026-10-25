// rpcd plugin for milkflint-ui: read-only figures LuCI's API doesn't expose.
// Reads files under /proc and /sys and runs `tc -s -j qdisc show` and
// `ethtool -x`; it never changes anything. ubus object "milkflint".
'use strict';

import { readfile, lsdir, popen, realpath } from 'fs';

let rtnl = null;
try {
	rtnl = require('rtnl');
}
catch (e) {
	// without ucode-mod-rtnl, "neighbors" just returns nothing
}

function num(s) {
	const n = +trim(s ?? '');
	return (n == n) ? n : null;   // NaN -> null
}

// Per-CPU jiffies from /proc/stat: the app turns two samples into a usage %.
function cpu_times() {
	const out = [];
	for (let line in split(readfile('/proc/stat') ?? '', '\n')) {
		const f = split(trim(line), /[ \t]+/);
		if (!match(f[0], /^cpu[0-9]*$/))
			continue;
		let total = 0;
		for (let i = 1; i <= 8 && i < length(f); i++)
			total += +f[i];
		push(out, { name: f[0], total, idle: +f[4] + +(f[5] ?? 0), softirq: +(f[7] ?? 0) });
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

// Which CPUs do the network work (MilkFlint's packet steering): the CPUs
// the Ethernet receive (mtk_eth NAPI) threads may run on, and the CPUs the
// packets a port receives are spread over (RPS). `dev` is SQM's WAN device.
function steering(dev) {
	let napi = [];
	for (let pid in lsdir('/proc') ?? []) {
		if (!match(pid, /^[0-9]+$/) || !match(readfile(`/proc/${pid}/comm`) ?? '', /^napi\/mtk_eth-/))
			continue;
		const m = match(readfile(`/proc/${pid}/status`) ?? '', /Cpus_allowed_list:[ \t]*([0-9,-]+)/);
		for (let c in cpu_list(m?.[1]))
			if (!(c in napi))
				push(napi, c);
	}
	let rps = [];
	for (let q in (dev ? lsdir(`/sys/class/net/${dev}/queues`) : null) ?? [])
		if (match(q, /^rx-/))
			for (let c in cpu_mask(readfile(`/sys/class/net/${dev}/queues/${q}/rps_cpus`)))
				if (!(c in rps))
					push(rps, c);
	let cpus = 0;
	for (let line in split(readfile('/proc/stat') ?? '', '\n'))
		if (match(line, /^cpu[0-9]+ /))
			cpus++;
	return { cpus, napi: sort(napi), rps: sort(rps) };
}

// The MT7986 frame engine's interrupts by GIC number: its four receive rings
// (pdma0-3) and the QDMA send side.
const RING_GIC = [221, 222, 223, 224];
const TX_GIC = 229;
// the RSS table is the frame engine's, shared by its ports (packet-steering.sh)
const RSS_DEV = 'eth1';

// Interrupts from /proc/interrupts: { irq, gic, name, count } for each
// numbered line, `count` summed over the CPUs.
function interrupts() {
	const out = [];
	const lines = split(readfile('/proc/interrupts') ?? '', '\n');
	const ncpu = length(split(trim(lines[0] ?? ''), /[ \t]+/));
	for (let line in lines) {
		const f = split(trim(line), /[ \t]+/);
		if (!match(f[0], /^[0-9]+:$/) || length(f) < ncpu + 3)
			continue;
		let count = 0;
		for (let i = 1; i <= ncpu; i++)
			count += +f[i];
		push(out, { irq: +substr(f[0], 0, -1), gic: +f[length(f) - 3], name: f[length(f) - 1], count });
	}
	return out;
}

// Where an interrupt is delivered (the kernel's effective affinity).
function irq_cpus(irq) {
	return cpu_list(readfile(`/proc/irq/${irq}/effective_affinity_list`) ?? readfile(`/proc/irq/${irq}/smp_affinity_list`));
}

// Kernel threads of the network drivers: the frame engine's NAPI threads
// (napi/mtk_eth-<id>) and mt76's (napi/phyN-*, mt76-tx), each with the CPUs
// it may run on and its CPU time in clock ticks (USER_HZ, 100 a second).
// With a kernel that keeps scheduler statistics (SCHED_INFO), also how long
// it has waited for a CPU while ready to run, in ns, and how many times it
// got one; null without them (/proc/<pid>/schedstat is missing).
function net_threads() {
	const out = [];
	for (let pid in lsdir('/proc') ?? []) {
		if (!match(pid, /^[0-9]+$/))
			continue;
		const comm = trim(readfile(`/proc/${pid}/comm`) ?? '');
		if (!match(comm, /^(napi\/mtk_eth-|napi\/phy[0-9]+-|mt76-tx)/))
			continue;
		const stat = readfile(`/proc/${pid}/stat`) ?? '';
		// after "(comm) ", whose name may have spaces: state is field 0,
		// utime 11 and stime 12
		const f = split(substr(stat, rindex(stat, ')') + 2), ' ');
		const m = match(readfile(`/proc/${pid}/status`) ?? '', /Cpus_allowed_list:[ \t]*([0-9,-]+)/);
		// "<run ns> <wait ns> <times run>"
		const s = match(readfile(`/proc/${pid}/schedstat`) ?? '', /^([0-9]+) ([0-9]+) ([0-9]+)/);
		push(out, {
			name: comm, pid: +pid, cpus: cpu_list(m?.[1]), time: +(f[11] ?? 0) + +(f[12] ?? 0),
			wait: s ? +s[2] : null, runs: s ? +s[3] : null
		});
	}
	return out;
}

// The RSS indirection table (ethtool -x): how many of its entries point at
// each ring, and the hash function. null without ethtool or RSS.
function rss_table() {
	const fd = popen(`ethtool -x ${RSS_DEV} 2>/dev/null`, 'r');
	if (!fd)
		return null;
	const text = fd.read('all') ?? '';
	fd.close();
	const rings = match(text, /with ([0-9]+) RX ring/);
	if (!rings)
		return null;
	const table = [];
	for (let i = 0; i < +rings[1]; i++)
		push(table, 0);
	for (let line in split(text, '\n')) {
		const row = match(line, /^[ \t]*[0-9]+:[ \t]+([0-9 \t]+)$/);
		for (let r in (row ? split(trim(row[1]), /[ \t]+/) : []))
			if (+r < length(table))
				table[+r]++;
	}
	const hash = match(text, /\n[ \t]+([a-z0-9-]+): on/);
	return { dev: RSS_DEV, rings: +rings[1], table, hash: hash?.[1] };
}

// Where the network work runs, for the Tuning and Smart Queue pages: each
// receive ring's interrupt and NAPI thread, the send side, the Wi-Fi
// driver's interrupts and threads, RPS on the wired ports, the RSS table and
// per-CPU times. Counters, so the app turns two samples into rates.
function pipeline() {
	const irqs = interrupts();
	const threads = net_threads();
	// NAPI ids follow netif_napi_add() order: TX's first, then the rings
	const eth = sort(filter(threads, (t) => match(t.name, /^napi\/mtk_eth-/)),
		(a, b) => +substr(a.name, 13) - +substr(b.name, 13));
	const rings_napi = length(eth) == length(RING_GIC) + 1;
	const thread = (t) => t ? { name: t.name, cpus: t.cpus, time: t.time, wait: t.wait, runs: t.runs } : null;
	const irq = (i) => i ? { irq: i.irq, cpus: irq_cpus(i.irq), count: i.count } : null;
	const rings = [];
	for (let n = 0; n < length(RING_GIC); n++) {
		const i = filter(irqs, (x) => x.gic == RING_GIC[n] && match(x.name, /ethernet/))[0];
		if (i)
			push(rings, { ring: n, irq: irq(i), thread: rings_napi ? thread(eth[n + 1]) : null });
	}
	const rps = [];
	for (let dev in lsdir('/sys/class/net') ?? []) {
		if (!match(realpath(`/sys/class/net/${dev}/device/driver`) ?? '', /mtk_soc_eth$/))
			continue;
		const queues = [];
		for (let q in sort(filter(lsdir(`/sys/class/net/${dev}/queues`) ?? [], (q) => match(q, /^rx-/))))
			push(queues, cpu_mask(readfile(`/sys/class/net/${dev}/queues/${q}/rps_cpus`)));
		push(rps, { dev, queues });
	}
	return {
		cpu: cpu_times(),
		rss: length(rings) == length(RING_GIC) ? rss_table() : null,
		rings,
		tx: {
			irq: irq(filter(irqs, (x) => x.gic == TX_GIC && match(x.name, /ethernet/))[0]),
			thread: rings_napi ? thread(eth[0]) : null
		},
		// without the rings (an older image), the frame engine's threads unsorted
		eth_threads: rings_napi ? [] : map(eth, thread),
		wifi: {
			irqs: map(filter(irqs, (x) => match(x.name, /^mt79|^mt76/)), (i) => ({ name: i.name, ...irq(i) })),
			threads: map(filter(threads, (t) => !match(t.name, /^napi\/mtk_eth-/)), thread)
		},
		rps
	};
}

// The network port an Ethernet PHY serves: the one whose device-tree node
// points at the PHY's (on the Flint 2, mdio-bus:01 is eth1's, the WAN port,
// and mdio-bus:07 lan1's, its 2.5G LAN port).
function phy_port(dev) {
	const phandle = readfile(`${dev}/of_node/phandle`);
	if (phandle == null)
		return null;
	for (let n in lsdir('/sys/class/net') ?? [])
		if (readfile(`/sys/class/net/${n}/of_node/phy-handle`) == phandle)
			return n;
	return null;
}

// Thermal zones and hwmon sensors (on the MT7986: the SoC, each Wi-Fi band's
// phy and the 2.5G Ethernet PHYs), with what each one measures: `wiphy` for
// a radio, `port` for an Ethernet PHY.
function temperatures() {
	const out = [];
	for (let tz in lsdir('/sys/class/thermal') ?? []) {
		if (!match(tz, /^thermal_zone[0-9]+$/))
			continue;
		const t = num(readfile(`/sys/class/thermal/${tz}/temp`));
		if (t != null)
			push(out, { name: trim(readfile(`/sys/class/thermal/${tz}/type`) ?? tz), celsius: t / 1000.0 });
	}
	for (let hw in lsdir('/sys/class/hwmon') ?? []) {
		const base = `/sys/class/hwmon/${hw}`;
		const name = trim(readfile(`${base}/name`) ?? hw);
		const dev = realpath(`${base}/device`) ?? '';
		// a thermal zone's own hwmon (cpu_thermal): the same sensor, listed above
		if (match(dev, /\/virtual\/thermal\//))
			continue;
		const wiphy = match(dev, /\/ieee80211\/(phy[0-9]+)$/)?.[1];
		const port = match(dev, /\/mdio_bus\//) ? phy_port(dev) : null;
		for (let f in lsdir(base) ?? []) {
			const m = match(f, /^temp([0-9]+)_input$/);
			if (!m)
				continue;
			const t = num(readfile(`${base}/${f}`));
			const label = trim(readfile(`${base}/temp${m[1]}_label`) ?? '');
			if (t != null)
				push(out, { name: label ? `${name} ${label}` : name, celsius: t / 1000.0, wiphy, port });
		}
	}
	return out;
}

const methods = {
	// IPv4 neighbours with the kernel's reachability state (NUD_*): a device
	// is "online" when it answered recently, not just when it's remembered.
	neighbors: {
		call: function() {
			const out = [];
			for (let n in (rtnl ? rtnl.request(rtnl.const.RTM_GETNEIGH, rtnl.const.NLM_F_DUMP, { family: rtnl.const.AF_INET }) : null) ?? []) {
				if (n.dev == 'lo' || !n.lladdr || n.lladdr == '00:00:00:00:00:00')
					continue;
				push(out, { ip: n.dst, mac: n.lladdr, dev: n.dev, state: n.state });
			}
			return { neighbors: out };
		}
	},

	stats: {
		call: function() {
			return {
				cpu: cpu_times(),
				temperatures: temperatures(),
				conntrack: {
					count: num(readfile('/proc/sys/net/netfilter/nf_conntrack_count')),
					max: num(readfile('/proc/sys/net/netfilter/nf_conntrack_max'))
				}
			};
		}
	},

	// CAKE queues currently installed (SQM's egress on the WAN device and its
	// ingress on an ifb device), with tc's statistics. In multi-queue mode
	// each device has a cake_mq root and one cake per transmit queue under
	// it (`parent` is the root's handle and the queue's number). `steering`
	// says which CPUs handle the WAN port's packets.
	sqm_status: {
		call: function() {
			const fd = popen('tc -s -j qdisc show 2>/dev/null', 'r');
			if (!fd)
				return { qdiscs: [] };
			let parsed;
			try {
				parsed = json(fd.read('all'));
			}
			catch (e) {
				parsed = [];
			}
			fd.close();
			const qdiscs = filter(parsed ?? [], (q) => q?.kind == 'cake' || q?.kind == 'cake_mq');
			const wan = filter(qdiscs, (q) => !match(q.dev ?? '', /^ifb/))[0]?.dev;
			return { qdiscs, steering: steering(wan) };
		}
	},

	pipeline: {
		call: function() {
			return pipeline();
		}
	}
};

return { milkflint: methods };
