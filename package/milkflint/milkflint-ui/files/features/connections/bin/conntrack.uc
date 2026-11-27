// Reads /proc/net/nf_conntrack (its text, passed in) and decides each
// connection's owner: the device it belongs to, the router itself, or (for a
// connection coming in from outside) the device or router it reaches.
//
// Ownership is decided by the original source:
//   - a router address: the router, outbound;
//   - inside the LAN (an inside prefix): that address, outbound, remote =
//     the original destination;
//   - otherwise inbound: the owner is the reply source when it is inside and
//     not the router (a port forward), else the router; remote = the
//     original source.
// where.router keys must be canonical (canonical() output) for IPv6.
// Loopback to loopback lines are counted but not listed.
//
// Cost: this runs in rpcd (one thread) on every refresh, and on the router's
// CPU every ucode operation and builtin call counts: a regexp per line, or a
// loop over each of a line's ~35 fields, is many times slower than the few
// calls a line made here, so the parser leans on the kernel's fixed layout:
//   "%-8s %u %-8s %u " head (l3 name, number, l4 name padded to 8, number),
//   then the timeout and the state (neither on offloaded lines), then two
//   tuples "src=A dst=B " + "sport=X dport=Y " for port protocols (icmp has
//   type/code/id, gre srckey/dstkey) + "packets=N bytes=N " with accounting,
//   [UNREPLIED] after the first, [ASSURED] [OFFLOAD]|[HW_OFFLOAD] after the
//   second.
// A line is split at " src=" (head, original, reply) and " bytes=" (int()
// reads the number up to the next space), the original tuple at its first
// few spaces. Ports, the destination and the state are only cut out when an
// entry is built. Each address text's canonical form and kind (the router's,
// inside, outside, loopback) is worked out once: addresses repeat a lot.

import { readfile, open, popen } from 'fs';
import { cursor } from 'uci';

function cmd(c) {
	const p = popen(c, 'r');
	if (!p)
		return null;
	const out = p.read('all');
	p.close();
	return out;
}

const as_list = (v) => (type(v) == 'array') ? v : (v != null && v != '') ? split(trim(v), /[ \t]+/) : [];

// The addresses the devices with these MACs use now: IPv4 from dnsmasq's
// leases, the fixed ones (dhcp host sections) and the neighbour table, IPv6
// from the neighbour table (link-local ones too: a connection to the router
// itself can use one).
export function addresses_of(macs) {
	const want = {};
	for (let m in macs)
		want[lc(m)] = true;
	const out = {};
	for (let line in split(readfile('/tmp/dhcp.leases') ?? '', '\n')) {
		const f = split(trim(line), /[ \t]+/);
		if (length(f) >= 3 && want[lc(f[1])] && index(f[2], '.') > 0)
			out[f[2]] = true;
	}
	cursor().foreach('dhcp', 'host', (h) => {
		for (let m in as_list(h.mac))
			if (want[lc(m)] && h.ip && index(h.ip, '.') > 0)
				out[h.ip] = true;
	});
	for (let line in split(cmd('ip neigh show') ?? '', '\n')) {
		const f = split(line, ' ');
		const i = index(f, 'lladdr');
		if (i > 0 && want[lc(f[i + 1] ?? '')])
			out[f[0]] = true;
	}
	return sort(keys(out));
};

// Ends every connection of these devices that's open now, as conntrack
// tracks them: OpenWrt's kernel drops each connection with an address
// written to /proc/net/nf_conntrack. A connection the flow table had sped
// past the firewall goes with its conntrack entry (the flow table lets go of
// a flow whose entry is gone), so the next packet is a new connection, which
// the rules then refuse. Returns how many addresses it cleared.
export function cut(addrs) {
	let n = 0;
	for (let a in addrs) {
		const f = open('/proc/net/nf_conntrack', 'w');
		if (!f)
			break;
		if (f.write(`${a}\n`) != null)
			n++;
		f.close();
	}
	return n;
};

// lines read at most (then partial); there are at most as many entries, so
// an entry's index is below it (rpcd's row sort packs the index into its keys)
export const MAX_LINES = 16384;

// 'a.b.c.d/N' or 'x::/N' -> { net: [bytes], bits: N }; null when invalid
export function prefix(cidr) {
	const parts = split(cidr, '/');
	if (length(parts) != 2)
		return null;
	const net = iptoarr(parts[0]);
	const bits = int(parts[1]);
	// plain digits only: '' and ' 24' would otherwise read as 0 and 24
	if (net == null || bits == null || bits != bits || '' + bits != parts[1] || bits < 0 || bits > length(net) * 8)
		return null;
	return { net, bits };
};

// is addr (text) within one of the prefixes in list
export function inside(addr, list) {
	const a = iptoarr(addr);
	if (a == null)
		return false;
	for (let p in list) {
		if (length(p.net) != length(a))
			continue;
		let left = p.bits, i = 0, ok = true;
		while (left >= 8) {
			if (a[i] != p.net[i]) {
				ok = false;
				break;
			}
			i++;
			left -= 8;
		}
		if (ok && left > 0) {
			const mask = (0xff << (8 - left)) & 0xff;
			ok = (a[i] & mask) == (p.net[i] & mask);
		}
		if (ok)
			return true;
	}
	return false;
};

// canonical form: IPv6 zero-padding and runs dropped, as arrtoip prints it
export function canonical(addr) {
	return arrtoip(iptoarr(addr)) ?? addr;
};

// parse(text, where, opts?) -> { total, offloaded, family, proto, partial,
//   entries, owners }: owners has one { addr, n, bytes, out, in } per owner
// over every listed line; opts.entries false leaves entries empty (the
// summary and owners are the same).
export function parse(text, where, opts) {
	const router = where?.router ?? {}, nets = where?.inside ?? [];
	const build = opts?.entries ?? true;
	// the original tuple is cut at its first spaces: [ src, "dst=B", "sport=X",
	// "dport=Y", rest ]; src and dst (for loopback) when no entry is built
	const cut = build ? 5 : 3;
	const entries = [], owners = {};
	// per address: canonical form (IPv6 text as printed -> canonical) and kind
	// (1 the router's, 2 inside, 0 outside, + 4 when it is a loopback address)
	const canon = {}, kind = {};
	function kind_of(a, v6) {
		return (router[a] ? 1 : (inside(a, nets) ? 2 : 0)) +
			((v6 ? a == '::1' : substr(a, 0, 4) == '127.') ? 4 : 0);
	}
	let lines = split(text ?? '', '\n'), partial = false;
	if (length(lines) > MAX_LINES) {
		lines = filter(lines, (l) => l != '');
		if (length(lines) > MAX_LINES) {
			partial = true;
			lines = slice(lines, 0, MAX_LINES);
		}
	}
	let empty = 0, offloaded = 0, v6n = 0, tcp = 0, udp = 0;
	for (let l in lines) {
		if (l == '') {
			empty++;
			continue;
		}
		// the head with the l4 name: tcp and udp are most lines
		const hd = substr(l, 0, 16);
		let v6 = false, l4 = null;
		if (hd == 'ipv4     2 udp  ') {
			udp++;
			l4 = 'udp';
		} else if (hd == 'ipv4     2 tcp  ') {
			tcp++;
			l4 = 'tcp';
		} else if (hd == 'ipv6     10 udp ') {
			v6 = true;
			udp++;
			l4 = 'udp';
		} else if (hd == 'ipv6     10 tcp ') {
			v6 = true;
			tcp++;
			l4 = 'tcp';
		} else
			// "ipv6 ..." sorts after "ipv5" and "ipv4 ..." before it
			v6 = l > 'ipv5';
		if (v6)
			v6n++;
		const off = index(l, 'OFFLOAD]') >= 0;
		if (off)
			offloaded++;
		// [ head, original tuple, reply tuple ]; one tuple only: not listed
		const p = split(l, ' src=');
		if (p[2] == null)
			continue;
		const q = split(p[1], ' ', cut);
		let s0 = q[0];
		if (v6)
			s0 = canon[s0] ?? (canon[s0] = canonical(s0));
		let k = kind[s0];
		if (k == null)
			k = kind[s0] = kind_of(s0, v6);
		let d0 = null;
		if (k >= 4) {
			d0 = substr(q[1], 4);
			if (v6)
				d0 = canon[d0] ?? (canon[d0] = canonical(d0));
			if (v6 ? d0 == '::1' : substr(d0, 0, 4) == '127.')
				continue;
			k -= 4;
		}
		// int() reads the number up to the space; none without accounting
		const b = split(l, ' bytes=');
		let ob = int(b[1]), ib = int(b[2]);
		let owner, r = null, inbound = false;
		if (k)
			owner = k == 1 ? 'router' : s0;
		else {
			// from outside: a port forward's device, else the router's
			inbound = true;
			r = split(p[2], ' ', 4);
			let rs = r[0];
			if (v6)
				rs = canon[rs] ?? (canon[rs] = canonical(rs));
			let kr = kind[rs];
			if (kr == null)
				kr = kind[rs] = kind_of(rs, v6);
			owner = (kr & 3) == 2 ? rs : 'router';
			const t = ob;
			ob = ib;
			ib = t;
		}
		let d = owners[owner];
		if (!d)
			d = owners[owner] = { addr: owner, n: 0, bytes: 0, out: 0, in: 0 };
		d.n++;
		d.out += ob;
		d.in += ib;
		if (!build)
			continue;

		// ports: tcp and udp always, sctp/dccp/udplite when the tuple has them
		const ports = l4 != null || substr(q[2] ?? '', 0, 6) == 'sport=';
		if (l4 == null)
			l4 = rtrim(substr(l, v6 ? 12 : 11, 8));
		let remote, rport = null, lport = null;
		if (inbound) {
			remote = s0;
			if (ports) {
				rport = +substr(q[2], 6);
				lport = +substr(r[2], 6);
			}
		} else {
			if (d0 == null) {
				d0 = substr(q[1], 4);
				if (v6)
					d0 = canon[d0] ?? (canon[d0] = canonical(d0));
			}
			remote = d0;
			if (ports) {
				rport = +substr(q[3], 6);
				lport = +substr(q[2], 6);
			}
		}
		// the state: the upper-case word just before the first src= (udp has none)
		let state = null;
		if (l4 != 'udp') {
			const h = p[0], w = rindex(h, ' ') + 1, c = ord(h, w);
			if (c >= 0x41 && c <= 0x5a)
				state = substr(h, w);
		}
		push(entries, {
			l3: v6 ? 'ipv6' : 'ipv4', l4, state, owner, remote, rport, lport,
			out_bytes: ob, in_bytes: ib, offloaded: off, inbound
		});
	}
	for (let a, d in owners)
		d.bytes = d.out + d.in;
	const total = length(lines) - empty;
	return {
		total, offloaded,
		family: { ipv4: total - v6n, ipv6: v6n },
		proto: { tcp, udp, other: total - tcp - udp },
		partial, entries, owners
	};
};
