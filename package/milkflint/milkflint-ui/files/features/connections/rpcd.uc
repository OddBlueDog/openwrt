// rpcd plugin for the "connections" feature (ubus milkflint.connections):
// the router's tracked connections, with who each belongs to.
//
//   list { family?: 'ipv4' | 'ipv6', addrs?: string[], rows?: int,
//          search?: { text: string, owners?: string[] }[] }
//     -> { total, max, offloaded, partial, cost_ms, family, proto, devices,
//          rows, cut }
//
// The summary (total, offloaded, family, proto, devices) always describes the
// whole table (up to the reader's 16,384-line stop, then partial is true); the
// family, addrs and search filters change only rows, which are sorted by bytes
// and cut to `rows` (default 200, 0 to 500; 0 is summary only). search is the
// words of the page's search box: a connection is kept when every word is in
// its text (search_text(): what the page shows of it, in lower case) or the
// word named its owner, a device whose name holds it, which only the page
// knows (owners). Up to 8 words of up to 64 characters, 64 owners each; a word
// that isn't a string, or is empty, is left out. cut is the
// filtered count minus the rows returned. devices has one entry per owner
// address (and 'router'), busiest first: out is what it sent, in what it
// received. count is the kernel's own connection count (nf_conntrack_count),
// the table's real size when the reader stopped early. Out-of-range values are
// clamped: an unknown family string means both, rows is limited to 0..500,
// and addrs keeps only valid addresses (canonical) and the word 'router'.
// rpcd itself refuses mistyped arguments before this runs (rows "x" or 3.5,
// family 5, addrs as a string: Invalid argument), so the UI must send
// whole-number rows.
//
// Cost: cost_ms is this call's own CPU time (utime + stime from
// /proc/self/stat, 10 ms ticks, before and after), so the page can wait
// 100 x cost_ms before asking again and stay near 1% of a core. The target
// is 50 ms on an ordinary household table. Parsing is bin/conntrack.uc; it sums
// the owners itself, and builds no entry objects when no rows are wanted
// (rows 0 without a family). Rows are picked by a native sort of integer
// keys, not a comparator called per pair.
//
// Inside and outside come from the firewall zones, never interface names:
// the networks of every zone without masq '1' (LAN, guests, Remote access)
// (and not disabled) are inside, with fe80::/10; the WAN zone (PPPoE, wwan or not) and a VPN
// client's zone masquerade, so they are outside. A router address, from the
// kernel's address dump (fe80:: ones too), makes a connection the router's.
// With IPv6 relay (ra, ndp or dhcpv6 'relay' on a LAN) the devices live in the
// relay master's on-link prefixes, so those are inside too; the router's own
// addresses are still matched first.
'use strict';

import { readfile } from 'fs';
import { cursor } from 'uci';
import { connect } from 'ubus';
import * as ct from '/usr/libexec/milkflint/conntrack.uc';
import * as zones from '/usr/libexec/milkflint/zones.uc';

let rtnl = null;
try {
	rtnl = require('rtnl');
}
catch (e) {
	// without ucode-mod-rtnl, nothing is the router's
}

const DEFAULT_ROWS = 200, MAX_ROWS = 500;
// row sort keys are bytes x ct.MAX_LINES + the entry's index (below
// MAX_LINES), so bytes are capped where the key would pass the largest int
const KEY_CAP = 9223372036854775807 / ct.MAX_LINES - 1;

// utime + stime of this process in milliseconds (fields 14 and 15, 10 ms ticks)
function cpu_ms() {
	const s = readfile('/proc/self/stat') ?? '';
	// the name (field 2) may hold spaces: count from the last ')'
	const f = split(substr(s, rindex(s, ')') + 2), ' ');
	return (+(f[11] ?? 0) + +(f[12] ?? 0)) * 10;
}

// the router's addresses, canonical, as keys
function router_addresses() {
	const out = {};
	if (!rtnl)
		return out;
	for (let family in [ rtnl.const.AF_INET, rtnl.const.AF_INET6 ]) {
		for (let a in rtnl.request(rtnl.const.RTM_GETADDR, rtnl.const.NLM_F_DUMP, { family }) ?? []) {
			let addr = a.local ?? a.address;
			if (type(addr) != 'string')
				continue;
			const slash = index(addr, '/');
			if (slash >= 0)
				addr = substr(addr, 0, slash);
			out[ct.canonical(addr)] = true;
		}
	}
	return out;
}

// the prefixes of the networks whose zone doesn't masquerade, and fe80::/10
function inside_prefixes() {
	const inside_nets = zones.inside_networks();
	// IPv6 relay: the master's on-link prefixes hold the devices
	const masters = {};
	let relay = false;
	cursor().foreach('dhcp', 'dhcp', (d) => {
		if (d.master == '1' && d.interface)
			masters[d.interface] = true;
		else if (d.ra == 'relay' || d.ndp == 'relay' || d.dhcpv6 == 'relay')
			relay = true;
	});
	const out = [ ct.prefix('fe80::/10') ];
	const u = connect();
	const dump = u?.call('network.interface', 'dump');
	u?.disconnect();
	for (let i in dump?.interface ?? []) {
		if (relay && masters[i.interface])
			for (let a in i['ipv6-address'] ?? [])
				push(out, ct.prefix(`${a.address}/${a.mask}`));
		if (!inside_nets[i.interface])
			continue;
		for (let list in [ i['ipv4-address'], i['ipv6-address'], i['ipv6-prefix-assignment'] ])
			for (let a in list ?? [])
				push(out, ct.prefix(`${a.address}/${a.mask}`));
	}
	// a prefix that doesn't parse is left out: inside() throws on null
	return filter(out, (p) => p != null);
}

// A connection as the page's search reads it, lower case: the same text as
// connSearchText() in ui/src/features/lan/connections.ts, which builds it
// for the rows it shows (and adds the device's name).
function search_text(e) {
	const state = e.state == null ? '' : replace(lc(e.state), '_', ' ');
	const remote = e.rport == null ? e.remote : (e.l3 == 'ipv6' ? `[${e.remote}]:${e.rport}` : `${e.remote}:${e.rport}`);
	return lc(`${e.l3} ${e.l4} ${state} ${e.inbound ? 'inbound' : ''} ${e.offloaded ? 'offloaded' : ''} ${e.owner} ${remote} ${e.lport ?? ''}`);
}

// the search words to keep, each { text, owners: { addr: true } }; null = no search
function search_terms(v) {
	if (type(v) != 'array')
		return null;
	const out = [];
	for (let w in v) {
		if (length(out) >= 8)
			break;
		if (type(w) != 'object' || type(w.text) != 'string')
			continue;
		const text = lc(trim(substr(w.text, 0, 64)));
		if (text == '')
			continue;
		const owners = {};
		let n = 0;
		for (let a in (type(w.owners) == 'array' ? w.owners : [])) {
			if (n >= 64)
				break;
			if (a == 'router')
				owners.router = true;
			else if (type(a) == 'string' && iptoarr(a) != null)
				owners[ct.canonical(a)] = true;
			else
				continue;
			n++;
		}
		push(out, { text, owners });
	}
	return length(out) ? out : null;
}

function found(e, terms) {
	const t = search_text(e);
	for (let w in terms)
		if (index(t, w.text) < 0 && !w.owners[e.owner])
			return false;
	return true;
}

function clamp_rows(v) {
	if (v == null)
		return DEFAULT_ROWS;
	v = int(v);
	if (v == null || v != v)
		return DEFAULT_ROWS;
	return v < 0 ? 0 : (v > MAX_ROWS ? MAX_ROWS : v);
}

// the addresses to keep: canonical, valid ones and 'router'; null = no filter
function wanted(v) {
	if (type(v) != 'array')
		return null;
	const out = {};
	for (let a in v) {
		if (a == 'router')
			out.router = true;
		else if (type(a) == 'string' && iptoarr(a) != null)
			out[ct.canonical(a)] = true;
	}
	return out;
}

return {
	'milkflint.connections': {
		list: {
			args: { family: 'ipv4', addrs: [ 'router' ], rows: 0, search: [ { text: 'tcp', owners: [ 'router' ] } ] },
			call: function(req) {
				const t0 = cpu_ms();
				const fam = req.args.family == 'ipv4' || req.args.family == 'ipv6' ? req.args.family : null;
				const keep = wanted(req.args.addrs);
				const terms = search_terms(req.args.search);
				const nrows = clamp_rows(req.args.rows);
				// entries only when rows are wanted or a family or search is
				// counted: the owners' sums alone give an addrs-only count
				const want = nrows > 0 || fam != null || terms != null;
				const r = ct.parse(readfile('/proc/net/nf_conntrack'), {
					router: router_addresses(),
					inside: inside_prefixes()
				}, { entries: want });

				const list = sort(values(r.owners), (a, b) => b.bytes - a.bytes);
				const shown = [];
				let matched = 0;
				if (want) {
					// busiest first without a comparator per pair: a native sort of
					// bytes x MAX_LINES + index (see KEY_CAP)
					const all = r.entries, ks = [], m = ct.MAX_LINES;
					let i = 0;
					for (let e in all) {
						if ((fam == null || e.l3 == fam) && (keep == null || keep[e.owner]) && (terms == null || found(e, terms))) {
							const s = e.out_bytes + e.in_bytes;
							push(ks, (s < KEY_CAP ? s : KEY_CAP) * m + i);
						}
						i++;
					}
					sort(ks);
					matched = length(ks);
					for (let j = matched - 1; j >= 0 && j >= matched - nrows; j--)
						push(shown, all[ks[j] % m]);
				} else
					for (let d in list)
						if (keep == null || keep[d.addr])
							matched += d.n;
				return {
					total: r.total,
					count: +trim(readfile('/proc/sys/net/netfilter/nf_conntrack_count') ?? '0'),
					max: +trim(readfile('/proc/sys/net/netfilter/nf_conntrack_max') ?? '0'),
					offloaded: r.offloaded,
					partial: r.partial,
					cost_ms: cpu_ms() - t0,
					family: r.family,
					proto: r.proto,
					devices: list,
					rows: shown,
					cut: matched - length(shown)
				};
			}
		}
	}
};
