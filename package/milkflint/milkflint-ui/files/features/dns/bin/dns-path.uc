// Where devices' DNS lookups go on this router (ui feature "dns"), worked out
// from what's running rather than the DNS page's settings alone: dnsmasq's
// config as OpenWrt generated it, with the files it includes (where DNS
// programs set up outside MilkFlint, such as ctrld, add their servers), and
// the UDP sockets in /proc for which program listens on which port. Shared
// by the DNS page (rpcd.uc: a program from outside handling DNS), Network
// Quality (netquality: the servers it times) and the test bench (bench-dns:
// dnsmasq's upstream). It only reads.
//
// `root` (tests only: ui-test-files/dns-path-test.uc) goes in front of every
// path.
'use strict';

import { readfile, lsdir, readlink } from 'fs';

// the DNS page's dnsproxy (encrypted DNS) listens here
export const DNSPROXY_PORT = 5453;
const RESOLV_AUTO = '/tmp/resolv.conf.d/resolv.conf.auto';
const MAX_TARGETS = 4;

// encrypted DNS hosts whose addresses don't answer plain DNS, and a name of
// the same resolver that does (Cloudflare's DoH name is served by its web
// front ends; its DoT name is the 1.1.1.1 resolver itself)
const PLAIN_HOST = {
	'cloudflare-dns.com': 'one.one.one.one'
};

function as_list(v) {
	return (type(v) == 'array') ? v : (v != null && v != '') ? [ v ] : [];
}

function unquote(v) {
	const m = match(v, /^"(.*)"$/);
	return m ? m[1] : v;
}

function ends(s, e) {
	return length(s) >= length(e) && substr(s, length(s) - length(e)) == e;
}

function is_loopback(a) {
	return match(a, /^127\./) != null || a == '::1';
}

// a `server=` value that serves every domain: { addr, port }, or null for a
// domain's own server (/domain/...) or one without an address
function parse_server(v) {
	v = trim(unquote(v ?? ''));
	if (v == '' || substr(v, 0, 1) == '/')
		return null;
	// @interface or @source address: not where the lookup goes
	v = split(v, '@')[0];
	const m = match(v, /^([0-9.]+|[0-9a-fA-F]*:[0-9a-fA-F:.]*)(#([0-9]{1,5}))?$/);
	return m ? { addr: m[1], port: m[3] ? int(m[3]) : 53 } : null;
}

// the files of a conf-dir=<dir>[,<extension>...] option, as dnsmasq picks
// them: never names starting with "." or ending in "~" or #...#; only
// *<extension> when given, never <extension>
function conf_dir_files(root, arg) {
	const parts = split(arg, ',');
	const dir = trim(parts[0]);
	const only = [], skip = [];
	for (let i = 1; i < length(parts); i++) {
		const e = trim(parts[i]);
		if (substr(e, 0, 1) == '*')
			push(only, substr(e, 1));
		else if (e != '')
			push(skip, e);
	}
	const out = [];
	for (let f in sort(lsdir(root + dir) ?? [])) {
		if (substr(f, 0, 1) == '.' || ends(f, '~') || (length(f) > 1 && substr(f, 0, 1) == '#' && ends(f, '#')))
			continue;
		if (length(only) && !length(filter(only, (e) => ends(f, e))))
			continue;
		if (length(filter(skip, (e) => ends(f, e))))
			continue;
		push(out, `${dir}/${f}`);
	}
	return out;
}

// the options that say where lookups go, from a dnsmasq config file and the
// ones it includes
function read_conf(root, path, conf, depth) {
	if (depth > 4 || conf.seen[path])
		return;
	conf.seen[path] = true;
	for (let line in split(readfile(root + path) ?? '', '\n')) {
		line = trim(line);
		if (line == '' || substr(line, 0, 1) == '#')
			continue;
		const eq = index(line, '=');
		const key = trim(eq < 0 ? line : substr(line, 0, eq));
		const val = eq < 0 ? null : trim(substr(line, eq + 1));
		if (key == 'port') {
			const p = int(val);
			if (p >= 0 && p <= 65535)
				conf.port = p;
		}
		else if (key == 'no-resolv')
			conf.noresolv = true;
		else if (key == 'resolv-file' && val)
			conf.resolvfile = unquote(val);
		else if (key == 'server') {
			const s = parse_server(val);
			if (s)
				push(conf.servers, { ...s, file: path });
		}
		else if ((key == 'conf-file' || key == 'servers-file') && val)
			read_conf(root, unquote(val), conf, depth + 1);
		else if (key == 'conf-dir' && val)
			for (let f in conf_dir_files(root, unquote(val)))
				read_conf(root, f, conf, depth + 1);
	}
}

// root: the pids of the dnsmasq processes found last time, checked first so
// a long-running caller doesn't look through /proc each time
let dnsmasq_pids = {};

// the configs running dnsmasqs were started with (-C): { path: true }. Found
// by their command lines: OpenWrt runs dnsmasq in a jail with a PID
// namespace of its own, so its pid file says 1. The jail (ujail) takes
// dnsmasq's name too, and its command line ends in dnsmasq's.
function running_confs(root) {
	const confs = {};
	const check = (pid) => {
		const argv = split(readfile(`${root}/proc/${pid}/cmdline`) ?? '', '\0');
		let at = false;
		for (let i, a in argv) {
			if (a == 'dnsmasq' || ends(a, '/dnsmasq'))
				at = true;
			else if (at && a == '-C' && argv[i + 1]) {
				confs[argv[i + 1]] = true;
				return true;
			}
		}
		return false;
	};
	if (length(filter(dnsmasq_pids[root] ?? [], check)))
		return confs;
	const found = [];
	for (let pid in lsdir(root + '/proc') ?? [])
		if (match(pid, /^[0-9]+$/) && trim(readfile(`${root}/proc/${pid}/comm`) ?? '') == 'dnsmasq' && check(pid))
			push(found, pid);
	dnsmasq_pids[root] = found;
	return confs;
}

// the running dnsmasq's DNS options: { cfg, port, noresolv, resolvfile,
// servers: [{ addr, port, file }] } (servers for every domain, in its
// order), or null when no dnsmasq runs from OpenWrt's generated config
// (access point mode stops it; its old config stays behind). With several
// instances, the first one with DNS on.
export function dnsmasq_config(root) {
	root ??= '';
	const running = running_confs(root);
	let best = null;
	for (let f in sort(lsdir(root + '/var/etc') ?? [])) {
		const m = match(f, /^dnsmasq\.conf\.(.+)$/);
		if (!m || !running[`/var/etc/${f}`])
			continue;
		const conf = { cfg: m[1], port: 53, noresolv: false, resolvfile: RESOLV_AUTO, servers: [], seen: {} };
		read_conf(root, `/var/etc/${f}`, conf, 0);
		delete conf.seen;
		if (best == null || (best.port == 0 && conf.port != 0))
			best = conf;
	}
	return best;
};

function v4_addr(h) {
	return sprintf('%d.%d.%d.%d', hex(substr(h, 6, 2)), hex(substr(h, 4, 2)), hex(substr(h, 2, 2)), hex(substr(h, 0, 2)));
}

// the UDP sockets listening on this router: [{ addr, port, inode }] (addr
// '::' for IPv6's any address, '::1' for its loopback, null for another
// IPv6 address)
function udp_sockets(root) {
	const out = [];
	for (let v6 in [ false, true ]) {
		for (let line in split(readfile(root + (v6 ? '/proc/net/udp6' : '/proc/net/udp')) ?? '', '\n')) {
			const f = split(trim(line), /[ \t]+/);
			// 07: unconnected, as a server's socket is; a query's is connected
			if (length(f) < 10 || f[3] != '07' || !match(f[2], /^0+:0000$/))
				continue;
			const l = match(f[1], /^([0-9A-Fa-f]+):([0-9A-Fa-f]{4})$/);
			if (!l)
				continue;
			const addr = !v6
				? (length(l[1]) == 8 ? v4_addr(l[1]) : null)
				: match(l[1], /^0+$/) ? '::' : (l[1] == '00000000000000000000000001000000') ? '::1' : null;
			push(out, { addr, port: hex(l[2]), inode: f[9] });
		}
	}
	return out;
}

// "<root>:<inode>": program, for the sockets named before (false: no
// process found), so a long-running caller only looks through /proc's file
// descriptors when a socket is new; emptied when it grows past OWNERS_MAX
let owner_cache = {};
const OWNERS_MAX = 64;

// the program (/proc/<pid>/comm) with each of these sockets open: { inode: name }
function owners(root, inodes) {
	const got = {}, want = {};
	let missing = 0;
	for (let i in inodes) {
		const c = owner_cache[`${root}:${i}`];
		if (c != null)
			got[i] = c;
		else if (!want[i]) {
			want[i] = true;
			missing++;
		}
	}
	if (missing) {
		for (let pid in lsdir(root + '/proc') ?? []) {
			if (!match(pid, /^[0-9]+$/))
				continue;
			let comm = null;
			for (let fd in lsdir(`${root}/proc/${pid}/fd`) ?? []) {
				const m = match(readlink(`${root}/proc/${pid}/fd/${fd}`) ?? '', /^socket:\[([0-9]+)\]$/);
				if (m && want[m[1]] && got[m[1]] == null) {
					comm ??= trim(readfile(`${root}/proc/${pid}/comm`) ?? '');
					got[m[1]] = (comm != '') ? comm : false;
					missing--;
				}
			}
			if (!missing)
				break;
		}
	}
	if (length(owner_cache) + length(inodes) > OWNERS_MAX)
		owner_cache = {};
	for (let i in inodes)
		owner_cache[`${root}:${i}`] = got[i] ?? false;
	return got;
}

// the socket on `port` a lookup to this router reaches: { program, addr }
// (addr: where to ask it), or null. Loopback first, then any address, then
// an address of its own (IPv4).
function listener(socks, progs, port, own_only) {
	let best = null, rank = 9;
	for (let s in socks) {
		if (s.port != port)
			continue;
		const r = (s.addr == '127.0.0.1') ? 0 : (s.addr == '0.0.0.0' || s.addr == '::') ? 1 : (s.addr == '::1') ? 2 : (s.addr != null && !own_only) ? 3 : 9;
		if (r < rank) {
			rank = r;
			best = { program: progs[s.inode] || null, addr: (r <= 1) ? '127.0.0.1' : s.addr };
		}
	}
	return best;
}

// Where devices' lookups go:
// - dnsmasq: dnsmasq_config()'s, or null;
// - front: what answers on port 53 when dnsmasq doesn't ({ program, addr,
//   port }, program null when nothing does: dnsmasq moved, DNS off), or null;
// - forwards: dnsmasq's servers for every domain [{ addr, port, file, local,
//   program }] (program: what listens there, for one on this router);
// - outside: a DNS program on this router that MilkFlint didn't set up,
//   which devices' lookups reach ({ how: 'front' | 'forward', program,
//   addr, port, file }: file, the dnsmasq config naming it), or null. The
//   DNS page's own dnsproxy and AdGuard Home (behind its redirect, with
//   dnsmasq on port 53) aren't.
export function lookups(root) {
	root ??= '';
	const dnsmasq = dnsmasq_config(root);
	const forwards = map(dnsmasq?.servers ?? [], (s) => ({ addr: s.addr, port: s.port, file: s.file, local: is_loopback(s.addr), program: null }));
	const front_open = !(dnsmasq != null && dnsmasq.port == 53);
	const ports = {};
	for (let f in forwards)
		if (f.local)
			ports[f.port] = true;
	if (front_open)
		ports[53] = true;
	const socks = filter(udp_sockets(root), (s) => ports[s.port]);
	const progs = length(socks) ? owners(root, map(socks, (s) => s.inode)) : {};
	for (let f in forwards)
		if (f.local)
			f.program = listener(socks, progs, f.port, true)?.program;

	let front = null;
	if (front_open) {
		const l = listener(socks, progs, 53, false);
		// dnsmasq itself, from a config not found above: as without dnsmasq's
		// details, never a program from outside
		if (l?.program == 'dnsmasq')
			front = null;
		else if (l != null)
			front = { program: l.program, addr: l.addr, port: 53 };
		else if (dnsmasq != null)
			front = { program: null, addr: '127.0.0.1', port: 53 };
	}

	let outside = null;
	if (front?.program != null)
		outside = { how: 'front', program: front.program, addr: front.addr, port: 53, file: null };
	else
		for (let f in forwards)
			if (f.local && !(f.port == DNSPROXY_PORT && (f.program == 'dnsproxy' || f.program == null))) {
				outside = { how: 'forward', program: f.program, addr: f.addr, port: f.port, file: f.file };
				break;
			}
	return { dnsmasq, front, forwards, outside };
};

// dnsmasq's upstream, for the test bench (bench-dns: its lookups straight
// there): the first server it forwards to, else the first resolver in the
// file it reads, { address, port, kind: 'dnsproxy' (the DNS page's) |
// 'server' }; null with neither, or with a program answering devices
// instead of dnsmasq (dnsmasq's upstream isn't on their way). `p`: a
// lookups() result, else worked out now.
export function upstream(p, root) {
	root ??= '';
	p ??= lookups(root);
	if (p.front != null)
		return null;
	const f = p.forwards[0];
	if (f != null)
		return {
			address: f.addr,
			port: f.port,
			kind: (f.local && f.port == DNSPROXY_PORT && (f.program == 'dnsproxy' || f.program == null)) ? 'dnsproxy' : 'server'
		};
	if (p.dnsmasq?.noresolv)
		return null;
	for (let line in split(readfile(root + (p.dnsmasq?.resolvfile ?? RESOLV_AUTO)) ?? '', '\n')) {
		const m = match(line, /^nameserver[ \t]+([0-9.]+|[0-9a-fA-F:]+)[ \t]*$/);
		if (m)
			return { address: m[1], port: 53, kind: 'server' };
	}
	return null;
};

// a program's name as one word for a key (the probe's history files are
// written without spaces)
function key_name(program) {
	return substr(replace(program, /[^A-Za-z0-9._-]/g, '_'), 0, 32);
}

// a DNS program on this router: keyed by its name and port
function local_target(addr, port, program) {
	const name = (program != null && program != '') ? key_name(program) : null;
	return {
		key: (name != null) ? `local:${name}:${port}` : `local:${port}`,
		host: name ?? `port ${port}`,
		addr: (port == 53) ? addr : `${addr}#${port}`
	};
}

function server_target(addr, port) {
	const a = (port == 53) ? addr : `${addr}#${port}`;
	return { key: a, host: addr, addr: a };
}

function first_nameserver(root, file) {
	for (let line in split(readfile(root + file) ?? '', '\n')) {
		const m = match(line, /^nameserver[ \t]+([0-9.]+)[ \t]*$/);
		if (m)
			return m[1];
	}
	return null;
}

// AdGuard Home filters in front of them (ui feature "adguardhome": its
// monitor's state)
function adguardhome_on(root) {
	try {
		return json(readfile(root + '/var/run/milkflint/adguardhome.json') ?? 'null')?.state == 'active';
	}
	catch (e) {
		return false;
	}
}

// The DNS servers Network Quality times, the main one (the score's) first,
// each { key, host, addr } (addr null while a host name hasn't resolved):
// - a server set in its settings (`manual`: an IPv4 address, #port
//   optional), else
// - a program answering devices on port 53 instead of dnsmasq, else
// - each server dnsmasq forwards to, in its order: the DNS page's dnsproxy
//   as its upstreams then its fallback, keyed by host name and asked over
//   plain DNS at its address (`resolve`: a host name's address; PLAIN_HOST's
//   at their other name's), the same resolver the encrypted lookups reach,
//   without the encryption; another program on this router, through it
//   ("local:<program>:<port>"); a server elsewhere at its address (IPv4);
// - and while dnsmasq reads the WAN's resolvers, the first of those (the
//   router's own resolv file when no dnsmasq runs: access point mode);
// at most four, then AdGuard Home's line while it filters (its devices'
// lookups go through it first; last, so the first server stays the score's).
// opts: { root, cursor (uci, for dnsproxy's servers), manual, resolve, path
// (a lookups() result, else worked out now) }
export function dns_targets(opts) {
	const root = opts.root ?? '';
	const c = opts.cursor;
	const resolve = opts.resolve ?? ((h) => null);
	const p = opts.path ?? lookups(root);
	let out = [];
	const add = (t) => {
		if (!length(filter(out, (x) => x.key == t.key)))
			push(out, t);
	};
	const manual = match(opts.manual ?? '', /^([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})(#([0-9]{1,5}))?$/);
	if (manual) {
		const port = manual[3] ? int(manual[3]) : 53;
		if (is_loopback(manual[1])) {
			const socks = filter(udp_sockets(root), (s) => s.port == port);
			const l = listener(socks, length(socks) ? owners(root, map(socks, (s) => s.inode)) : {}, port, true);
			add(local_target(manual[1], port, l?.program));
		}
		else
			add(server_target(manual[1], port));
	}
	else if (p.front != null)
		add(local_target(p.front.addr, 53, p.front.program));
	else {
		for (let f in p.forwards) {
			if (f.local && f.port == DNSPROXY_PORT && (f.program == 'dnsproxy' || (f.program == null && c?.get('dnsproxy', 'global', 'enabled') == '1'))) {
				const before = length(out);
				for (let url in [ ...as_list(c?.get('dnsproxy', 'servers', 'upstream')), ...as_list(c?.get('dnsproxy', 'servers', 'fallback')) ]) {
					// a DNS stamp (sdns://) or an IPv6 address can't be asked this way
					const m = match(url, /^(https|tls|quic):\/\/([A-Za-z0-9.-]+)/);
					if (m)
						add({ key: m[2], host: m[2], addr: resolve(PLAIN_HOST[m[2]] ?? m[2]) });
				}
				if (length(out) == before)
					add(local_target(f.addr, f.port, f.program ?? 'dnsproxy'));
			}
			else if (f.local)
				add(local_target(f.addr, f.port, f.program));
			else if (match(f.addr, /^[0-9.]+$/))
				add(server_target(f.addr, f.port));
		}
		// the WAN's resolvers while dnsmasq reads them; as before, also when
		// none of its servers can be asked (IPv6 only)
		if (p.dnsmasq == null || !p.dnsmasq.noresolv || !length(out)) {
			const ns = first_nameserver(root, p.dnsmasq?.resolvfile ?? RESOLV_AUTO);
			if (ns != null)
				add(server_target(ns, 53));
		}
	}
	if (!length(out))
		add(server_target('127.0.0.1', 53));
	out = slice(out, 0, MAX_TARGETS);
	if (adguardhome_on(root))
		push(out, { key: 'adguardhome', host: 'adguardhome', addr: '127.0.0.1#3053' });
	return out;
};
