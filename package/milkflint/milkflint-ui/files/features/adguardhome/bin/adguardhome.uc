// AdGuard Home on MilkFlint (ui feature "adguardhome"): what the page's
// rpcd methods (milkflint.adguardhome) and the monitor (adguardhome-monitor)
// share. AdGuard Home does the filtering, in its own web interface; MilkFlint
// keeps the DNS chain around it:
//
//   devices ──53──> redirect ──> AdGuard Home :3053 ──> dnsmasq :53 ──> the DNS page's servers
//
// dnsmasq stays on port 53 (DHCP, names on the network, rebinding
// protection, the DNS page's servers and cache) and answers the router's own
// lookups; the monitor's nftables table sends the devices' port-53 lookups
// to AdGuard Home, keeping their address, while it answers, and takes the
// redirect away when it doesn't (dnsmasq answers them unfiltered meanwhile).
//
// MilkFlint writes AdGuard Home's settings the first time (yaml_config) and
// afterwards only the ones the chain needs (repair), with AdGuard Home
// stopped: it rewrites the whole file each time it starts and whenever its
// own settings change. MilkFlint reads AdGuard Home over its HTTP API as an
// account of its own (API_USER), whose password only root can read (KEY).
'use strict';

import { readfile, writefile, rename, open, access, mkdir, unlink, stat, popen } from 'fs';
import * as socket from 'socket';
import { connect } from 'ubus';
import { cursor } from 'uci';

export const CONFIG = '/etc/adguardhome/AdGuardHome.yaml';
export const KEY = '/etc/milkflint/adguardhome.key';
export const STATE = '/var/run/milkflint/adguardhome.json';
export const COOKIE = '/var/run/milkflint/adguardhome.cookie';
export const BIN = '/usr/bin/AdGuardHome';
export const BCRYPT = '/usr/libexec/milkflint/bcrypt';
export const DNS_PORT = 3053;
export const WEB_PORT = 3000;
// dnsmasq, which AdGuard Home asks for everything (and for devices' names)
export const DNSMASQ = '127.0.0.1:53';
export const API_USER = 'milkflint';
export const QUERYLOG_DIR = '/tmp/adguardhome';
// at most this many lookups a second from one address (each IPv6 address
// apart: a home network's devices share one /64)
export const RATELIMIT = 300;

// ---- small helpers ---------------------------------------------------------

// One ubus call on a connection of its own, closed straight after. A
// connection only dropped stays open until garbage collection, which a
// long-running ucode script (the monitor) never runs: each would hold a
// socket in ubusd until it ran out of files and refused every client
// (LuCI, the login, procd's services).
export function ubus_call(object, method, args) {
	const bus = connect();
	const r = bus?.call(object, method, args ?? {});
	bus?.disconnect();
	return r;
};

export function sh_quote(s) {
	return "'" + replace(`${s}`, "'", "'\\''") + "'";
};

// a command's stdout, trimmed (stderr dropped)
export function cmd(c) {
	const p = popen(`${c} 2>/dev/null`, 'r');
	if (!p)
		return null;
	const out = p.read('all');
	p.close();
	return trim(out ?? '');
};

// a command's exit code and its output, stdout and stderr together
export function run(c) {
	const p = popen(`${c} 2>&1`, 'r');
	if (!p)
		return { code: -1, out: '' };
	const out = p.read('all') ?? '';
	const code = p.close();
	return { code, out };
};

export function write_atomic(path, data, mode) {
	const tmp = `${path}.milkflint-tmp`;
	const f = open(tmp, 'w', mode ?? 0o600);
	if (!f)
		return false;
	f.write(data);
	f.close();
	return rename(tmp, path);
};

export function random_token(n) {
	const f = open('/dev/urandom', 'r');
	const b = f?.read(n) ?? '';
	f?.close();
	const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let s = '';
	for (let i = 0; i < length(b); i++)
		s += substr(abc, ord(b, i) % 62, 1);
	return s;
};

// a bcrypt hash of a password (cost 10), through milkflint-bcrypt; the
// password goes on its stdin, never on a command line
export function bcrypt(password) {
	const tmp = `/var/run/milkflint/bcrypt.${random_token(8)}`;
	mkdir('/var/run/milkflint', 0o700);
	if (!write_atomic(tmp, `${password}\n`, 0o600))
		return null;
	const hash = cmd(`${BCRYPT} < ${tmp}`);
	unlink(tmp);
	return (hash && match(hash, /^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$/)) ? hash : null;
};

// the home network's router address (network.lan.ipaddr: 192.168.1.1, or
// the first of a list, or 192.168.1.1/24)
export function lan_ip() {
	let a = cursor().get('network', 'lan', 'ipaddr');
	if (type(a) == 'array')
		a = a[0];
	return split(a ?? '192.168.1.1', '/')[0];
};

export function web_address() {
	return `${lan_ip()}:${WEB_PORT}`;
};

// ---- the first settings ----------------------------------------------------

const yq = (s) => '"' + replace(replace(`${s}`, '\\', '\\\\'), '"', '\\"') + '"';

// AdGuard Home's settings as MilkFlint first writes them: what the chain
// needs, safe defaults for the rest, no lists (they're chosen in its own web
// interface). Anything left out takes AdGuard Home's own default; it writes
// the whole file out when it starts. o: { user, hash, api_hash, address }
export function yaml_config(o) {
	return join('\n', [
		'# MilkFlint wrote these first settings (its AdGuard Home page). AdGuard Home',
		'# rewrites this file: change its settings in its own web interface.',
		'http:',
		`  address: ${o.address}`,
		'  session_ttl: 720h',
		'users:',
		`  - name: ${yq(o.user)}`,
		`    password: ${yq(o.hash)}`,
		`  - name: ${yq(API_USER)}`,
		`    password: ${yq(o.api_hash)}`,
		'auth_attempts: 5',
		'block_auth_min: 15',
		'theme: auto',
		'dns:',
		'  bind_hosts:',
		'    - 0.0.0.0',
		`  port: ${DNS_PORT}`,
		'  anonymize_client_ip: false',
		`  ratelimit: ${RATELIMIT}`,
		'  ratelimit_subnet_len_ipv4: 32',
		'  ratelimit_subnet_len_ipv6: 128',
		'  ratelimit_whitelist:',
		'    - 127.0.0.1',
		'    - ::1',
		'  refuse_any: true',
		'  upstream_dns:',
		`    - ${DNSMASQ}`,
		'  upstream_dns_file: ""',
		'  bootstrap_dns:',
		`    - ${DNSMASQ}`,
		'  fallback_dns: []',
		'  upstream_mode: load_balance',
		// its own cache, in front of dnsmasq's: a repeated lookup is answered
		// at once rather than after a round trip to dnsmasq
		'  cache_enabled: true',
		'  cache_size: 4194304',
		'  cache_optimistic: false',
		'  enable_dnssec: false',
		'  edns_client_subnet:',
		'    custom_ip: ""',
		'    enabled: false',
		'    use_custom: false',
		'  handle_ddr: false',
		'  use_private_ptr_resolvers: true',
		'  local_ptr_upstreams:',
		`    - ${DNSMASQ}`,
		'  use_dns64: false',
		'  serve_http3: false',
		'  use_http3_upstreams: false',
		'  serve_plain_dns: true',
		'  hostsfile_enabled: false',
		'tls:',
		'  enabled: false',
		'  port_https: 0',
		'  port_dns_over_tls: 0',
		'  port_dns_over_quic: 0',
		'querylog:',
		`  dir_path: ${QUERYLOG_DIR}`,
		'  interval: 24h',
		'  size_memory: 1000',
		'  enabled: true',
		'  file_enabled: true',
		'statistics:',
		'  interval: 24h',
		'  enabled: true',
		'filters: []',
		'whitelist_filters: []',
		'user_rules: []',
		'dhcp:',
		'  enabled: false',
		'filtering:',
		'  protection_enabled: true',
		'  filtering_enabled: true',
		'  filters_update_interval: 24',
		'clients:',
		'  runtime_sources:',
		'    whois: false',
		'    arp: true',
		'    rdns: true',
		'    dhcp: false',
		'    hosts: true',
		'  persistent: []',
		'log:',
		'  enabled: true',
		'  verbose: false',
		'schema_version: 34',
		''
	]);
};

// ---- reading and patching the settings AdGuard Home writes ---------------
//
// A reader for the YAML AdGuard Home writes (go-yaml's block style: maps,
// lists, one-line scalars), enough to check the chain's settings and change
// them in place: each value keeps the lines it came from, so a change
// rewrites only those lines and leaves everything else as AdGuard Home wrote
// it. Scalars stay as written (raw), quotes and all; value() unquotes.

function lines_of(text) {
	const out = [];
	for (let i, l in split(text ?? '', '\n')) {
		if (match(l, /^[ ]*(#.*)?$/) || match(l, /^(---|\.\.\.)[ ]*$/))
			continue;
		const m = match(l, /^( *)(.*?)[ ]*$/);
		push(out, { n: i, indent: length(m[1]), text: m[2] });
	}
	return out;
}

const KEY_LINE = /^([A-Za-z0-9_]+):( +(.*))?$/;

function scalar_node(raw, n) {
	return { kind: 'scalar', raw, start: n, end: n + 1 };
}

// (ucode looks names up as it compiles: these call each other)
let parse_map, parse_list;

// the block at lines[i] (indent `ind`): a map, a list, or nothing
function parse_block(lines, i, ind) {
	if (i >= length(lines) || lines[i].indent < ind)
		return [ null, i ];
	if (substr(lines[i].text, 0, 1) == '-' && match(lines[i].text, /^-( |$)/))
		return parse_list(lines, i, lines[i].indent);
	return parse_map(lines, i, lines[i].indent);
}

function parse_value(lines, i, key_line_ind, raw, n) {
	if (raw != null && raw != '')
		return [ scalar_node(raw, n), i ];
	// "key:" then a deeper block, or a list at the key's own indent
	if (i < length(lines) && (lines[i].indent > key_line_ind ||
	    (lines[i].indent == key_line_ind && match(lines[i].text, /^-( |$)/)))) {
		const r = parse_block(lines, i, lines[i].indent);
		return r;
	}
	return [ scalar_node('', n), i ];
}

parse_map = function(lines, i, ind) {
	const node = { kind: 'map', keys: {}, order: [], start: lines[i].n, end: lines[i].n + 1, indent: ind };
	while (i < length(lines) && lines[i].indent == ind) {
		const m = match(lines[i].text, KEY_LINE);
		if (!m)
			break;
		const n = lines[i].n;
		const r = parse_value(lines, i + 1, ind, m[3], n);
		const v = r[0] ?? scalar_node('', n);
		v.key_line = n;
		v.key_indent = ind;
		node.keys[m[1]] = v;
		push(node.order, m[1]);
		i = r[1];
		node.end = max(node.end, v.end ?? (n + 1));
	}
	return [ node, i ];
};

parse_list = function(lines, i, ind) {
	const node = { kind: 'list', items: [], start: lines[i].n, end: lines[i].n + 1, indent: ind };
	while (i < length(lines) && lines[i].indent == ind && match(lines[i].text, /^-( |$)/)) {
		const rest = ltrim(substr(lines[i].text, 1));
		const n = lines[i].n;
		if (match(rest, KEY_LINE)) {
			// "- key: value": a map whose keys sit where this one's does
			const off = length(lines[i].text) - length(rest);
			lines[i] = { n, indent: ind + off, text: rest };
			const r = parse_map(lines, i, ind + off);
			push(node.items, r[0]);
			i = r[1];
			node.end = max(node.end, r[0].end);
		}
		else {
			push(node.items, scalar_node(rest, n));
			i++;
			node.end = max(node.end, n + 1);
		}
	}
	return [ node, i ];
};

function range(n) {
	const r = [];
	for (let i = 0; i < n; i++)
		push(r, i);
	return r;
}

// the settings' tree, or null if it isn't one
export function yaml_parse(text) {
	const lines = lines_of(text);
	if (!length(lines))
		return null;
	const r = parse_map(lines, 0, lines[0].indent);
	return r[0];
};

// the node at a dotted path ("dns.port"), or null
export function node_at(tree, path) {
	let n = tree;
	for (let k in split(path, '.')) {
		if (n?.kind != 'map')
			return null;
		n = n.keys[k];
	}
	return n;
};

// a scalar's value without its quotes; "[]" and "{}" are empty
export function unquote(raw) {
	raw = trim(raw ?? '');
	if (match(raw, /^"(.*)"$/))
		return replace(replace(substr(raw, 1, -1), '\\"', '"'), '\\\\', '\\');
	if (match(raw, /^'(.*)'$/))
		return replace(substr(raw, 1, -1), "''", "'");
	return raw;
};

// a value as plain data: strings, lists, objects (null if it's not there)
export function value(tree, path) {
	const n = (path == null) ? tree : node_at(tree, path);
	if (n == null)
		return null;
	if (n.kind == 'scalar') {
		const raw = trim(n.raw);
		if (raw == '[]')
			return [];
		if (raw == '{}')
			return {};
		// a flow list, as in [a, b]
		const fl = match(raw, /^\[(.*)\]$/);
		if (fl)
			return map(filter(split(fl[1], ','), (s) => trim(s) != ''), (s) => unquote(s));
		return unquote(raw);
	}
	if (n.kind == 'list')
		return map(n.items, (it) => value(it));
	const o = {};
	for (let k in n.order)
		o[k] = value(n.keys[k]);
	return o;
};

// The settings with `path`'s value replaced by `raw` (one line: "key: raw")
// or by a list of raw items (lines: "key:" then "- item"); null if `path`'s
// parent isn't in the file. A key that isn't there yet is added at the end
// of its parent map.
export function yaml_set(text, path, repl) {
	const tree = yaml_parse(text);
	if (!tree)
		return null;
	const lines = split(text, '\n');
	const keys = split(path, '.');
	const key = pop(keys);
	const parent = length(keys) ? node_at(tree, join('.', keys)) : tree;
	if (parent?.kind != 'map')
		return null;
	const node = parent.keys[key];
	const ind = node?.key_indent ?? parent.indent;
	const pad = (n) => join('', map(range(n), () => ' '));
	let block;
	if (type(repl) == 'array')
		block = length(repl) ? [ `${pad(ind)}${key}:`, ...map(repl, (r) => `${pad(ind + 2)}- ${r}`) ] : [ `${pad(ind)}${key}: []` ];
	else
		block = [ `${pad(ind)}${key}: ${repl}` ];
	if (node) {
		const from = node.key_line, to = max(node.end, node.key_line + 1);
		splice(lines, from, to - from, ...block);
	}
	else {
		splice(lines, parent.end, 0, ...block);
	}
	return join('\n', lines);
};

// ---- what the chain needs from the settings --------------------------------

const eq = (a, b) => sprintf('%J', a) == sprintf('%J', b);

// The chain's settings as AdGuard Home's file has them, each one that's not
// as MilkFlint needs it: { key, have, want: raw value(s) to put back,
// breaks: whether lookups or the router suffer (else it's a note), what }.
// `address`: the web interface's address MilkFlint expects (LAN:3000).
export function check_settings(tree, address) {
	const out = [];
	const add = (key, have, want, breaks, what) => push(out, { key, have, want, breaks, what });
	if (!tree)
		return [ { key: 'file', have: null, want: null, breaks: true, what: 'AdGuard Home’s settings file is missing or unreadable.' } ];
	const port = value(tree, 'dns.port');
	if (port != `${DNS_PORT}`)
		add('dns.port', port, `${DNS_PORT}`, true, `Its DNS port is ${port ?? 'not set'}, not ${DNS_PORT}: your devices’ lookups don’t reach it.`);
	const binds = value(tree, 'dns.bind_hosts');
	if (!eq(binds, [ '0.0.0.0' ]))
		add('dns.bind_hosts', binds, [ '0.0.0.0' ], true, 'It listens for DNS on chosen addresses only: lookups from some of your networks don’t reach it.');
	const web = value(tree, 'http.address');
	if (web != address)
		add('http.address', web, address, true, `Its web interface is at ${web ?? 'no address'}, not ${address}: it should be on the home network’s address only.`);
	if (value(tree, 'dhcp.enabled') == 'true')
		add('dhcp.enabled', 'true', 'false', true, 'Its DHCP server is on: the router already gives your devices their addresses, and two DHCP servers hand out clashing ones.');
	const ups = value(tree, 'dns.upstream_dns');
	const ups_file = value(tree, 'dns.upstream_dns_file');
	if (!eq(ups, [ DNSMASQ ]) || (ups_file != null && ups_file != ''))
		add('dns.upstream_dns', ups, [ DNSMASQ ], true, 'Its upstream DNS servers were changed: lookups skip the DNS page’s servers, the names on your network and rebinding protection.');
	const boot = value(tree, 'dns.bootstrap_dns');
	const fall = value(tree, 'dns.fallback_dns');
	if (!eq(boot, [ DNSMASQ ]) || (length(fall ?? []) > 0))
		add('dns.bootstrap_dns', { bootstrap: boot, fallback: fall }, [ DNSMASQ ], true, 'Its bootstrap or fallback DNS servers were changed: some lookups go out past the DNS page’s servers.');
	const ptr = value(tree, 'dns.local_ptr_upstreams');
	if (!eq(ptr, [ DNSMASQ ]) || value(tree, 'dns.use_private_ptr_resolvers') != 'true')
		add('dns.local_ptr_upstreams', ptr, [ DNSMASQ ], false, 'Its private reverse DNS servers were changed: it may not show your devices’ names.');
	if (value(tree, 'tls.enabled') == 'true') {
		const https = value(tree, 'tls.port_https');
		if (https == '443' || https == '80')
			add('tls.port_https', https, '0', true, `Its HTTPS server uses port ${https}, the router’s own web interface’s.`);
	}
	if (value(tree, 'dns.cache_enabled') == 'false')
		add('dns.cache_enabled', 'false', 'true', false, 'Its own cache is off: every lookup it lets through waits for the router’s DNS, even one it answered a moment ago.');
	const users = map(value(tree, 'users') ?? [], (u) => u?.name);
	if (!(API_USER in users))
		add('users.api', null, null, false, 'MilkFlint’s own account in it is gone: this page can’t show its figures.');
	if (!length(filter(users, (u) => u != API_USER)))
		add('users', null, null, true, 'It has no account of yours: anyone on your network can open it. Set a user name and password below.');
	return out;
};

// the settings with an account `name` (added, or its password replaced)
function add_user(text, name, hash) {
	const tree = yaml_parse(text);
	const users = value(tree, 'users') ?? [];
	const node = node_at(tree, 'users');
	const lines = split(text, '\n');
	const block = [ 'users:' ];
	for (let u in users)
		if (u?.name != name && u?.name != null && u?.password != null)
			push(block, `  - name: ${yq(u.name)}`, `    password: ${yq(u.password)}`);
	push(block, `  - name: ${yq(name)}`, `    password: ${yq(hash)}`);
	if (node)
		splice(lines, node.key_line, max(node.end, node.key_line + 1) - node.key_line, ...block);
	else
		splice(lines, tree?.end ?? length(lines), 0, ...block);
	return join('\n', lines);
}

// The settings with each of `fixes` (from check_settings) put back.
// `users.api` comes back with api_hash; `users` can't (no password): the
// page asks for one.
export function repair_settings(text, fixes, api_hash) {
	for (let f in fixes) {
		if (f.want == null && f.key != 'users.api')
			continue;
		let t = text;
		if (f.key == 'dns.upstream_dns') {
			t = yaml_set(t, 'dns.upstream_dns', f.want);
			t = t && yaml_set(t, 'dns.upstream_dns_file', '""');
		}
		else if (f.key == 'dns.bootstrap_dns') {
			t = yaml_set(t, 'dns.bootstrap_dns', f.want);
			t = t && yaml_set(t, 'dns.fallback_dns', []);
		}
		else if (f.key == 'dns.local_ptr_upstreams') {
			t = yaml_set(t, 'dns.local_ptr_upstreams', f.want);
			t = t && yaml_set(t, 'dns.use_private_ptr_resolvers', 'true');
		}
		else if (f.key == 'users.api') {
			if (!api_hash)
				continue;
			t = add_user(t, API_USER, api_hash);
		}
		else if (type(f.want) == 'array') {
			t = yaml_set(t, f.key, f.want);
		}
		else {
			t = yaml_set(t, f.key, f.want);
		}
		if (t)
			text = t;
	}
	return text;
};

// The settings with the users replaced: `user` with `hash`, and MilkFlint's
// own account with `api_hash` (each other account is dropped: MilkFlint's
// page is where its password is set)
export function set_users(text, user, hash, api_hash) {
	const tree = yaml_parse(text);
	const node = node_at(tree, 'users');
	const lines = split(text, '\n');
	const block = [
		'users:',
		`  - name: ${yq(user)}`,
		`    password: ${yq(hash)}`,
		`  - name: ${yq(API_USER)}`,
		`    password: ${yq(api_hash)}`
	];
	if (node)
		splice(lines, node.key_line, max(node.end, node.key_line + 1) - node.key_line, ...block);
	else
		splice(lines, tree?.end ?? length(lines), 0, ...block);
	return join('\n', lines);
};

// ---- is it answering ---------------------------------------------------------

// AdGuard Home answers healthcheck.adguardhome.test. itself (NODATA), so
// this asks nothing upstream. True when a reply comes in `ms`.
export function mono_ms() {
	const c = clock(true);
	return c[0] * 1000 + c[1] / 1000000.0;
};

// Whether `s` has something to read (or an error) within `ms`. ucode's
// poll() lists every socket it's given, with the events that came (0: none
// in time), so the list is never empty; and its recv() ignores SO_RCVTIMEO,
// so a read without this waits for as long as AdGuard Home hangs.
function ready(s, ms) {
	const r = socket.poll(max(1, int(ms)), [ s, socket.POLLIN ]);
	return (r?.[0]?.[1] ?? 0) != 0;
}

// true: it answered; 'refused': nothing listens on its port (it's gone: the
// kernel says so at once, on a connected socket); false: no answer in `ms`
export function dns_alive(ms) {
	const s = socket.connect('127.0.0.1', `${DNS_PORT}`, { socktype: socket.SOCK_DGRAM });
	if (!s)
		return false;
	const id = ord(random_token(1) || 'x', 0) * 256 + 7;
	let q = chr(id >> 8, id & 255, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0);
	for (let label in [ 'healthcheck', 'adguardhome', 'test' ])
		q += chr(length(label)) + label;
	q += chr(0, 0, 1, 0, 1);
	if (s.send(q) == null) {
		s.close();
		return 'refused';
	}
	const until = mono_ms() + (ms ?? 1000);
	for (;;) {
		const left = until - mono_ms();
		if (left <= 0)
			break;
		if (!ready(s, left))
			continue;
		const d = s.recv(1500);
		if (d == null) {
			// the port-unreachable reply to the query
			s.close();
			return 'refused';
		}
		if (length(d) >= 12 && ((ord(d, 0) << 8) | ord(d, 1)) == id && (ord(d, 2) & 0x80)) {
			s.close();
			return true;
		}
	}
	s.close();
	return false;
};

// ---- its HTTP API ---------------------------------------------------------------

// One HTTP/1.0 request to its web interface (HTTP/1.0: no chunked replies);
// { status, headers, body } or null if the whole reply hasn't come within
// `secs` (5). A hung AdGuard Home still gets its connections (the kernel
// answers), so each read waits (ready) for what's left of the time: else
// the monitor, and rpcd (this runs inside it), would wait for as long as
// AdGuard Home hangs.
function http(method, path, body, cookie, secs) {
	secs ??= 5;
	const until = mono_ms() + secs * 1000;
	const addr = split(web_address(), ':');
	const s = socket.connect(addr[0], addr[1], { socktype: socket.SOCK_STREAM }, min(3000, secs * 1000));
	if (!s)
		return null;
	s.setopt(socket.SOL_SOCKET, socket.SO_SNDTIMEO, { tv_sec: secs, tv_usec: 0 });
	const data = (body == null) ? '' : sprintf('%J', body);
	let req = `${method} ${path} HTTP/1.0\r\nHost: ${web_address()}\r\nAccept: application/json\r\n`;
	if (cookie)
		req += `Cookie: ${cookie}\r\n`;
	if (body != null)
		req += `Content-Type: application/json\r\nContent-Length: ${length(data)}\r\n`;
	s.send(`${req}\r\n${data}`);
	let resp = '', whole = false;
	for (let n = 0; n < 4096; n++) {
		const left = until - mono_ms();
		if (left <= 0)
			break;
		if (!ready(s, left))
			continue;
		const chunk = s.recv(65536);
		if (chunk == null || chunk == '') {
			whole = (chunk == '');
			break;
		}
		resp += chunk;
		// more than enough: what's there is read as it is
		if (length(resp) > 4194304) {
			whole = true;
			break;
		}
	}
	s.close();
	if (!whole)
		return null;
	const at = index(resp, '\r\n\r\n');
	if (at < 0)
		return null;
	const head = split(substr(resp, 0, at), '\r\n');
	const st = match(head[0], /^HTTP\/[0-9.]+ ([0-9]+)/);
	const headers = {};
	for (let i = 1; i < length(head); i++) {
		const hm = match(head[i], /^([^:]+):[ ]*(.*)$/);
		if (hm)
			headers[lc(hm[1])] = (headers[lc(hm[1])] != null && lc(hm[1]) == 'set-cookie') ? headers[lc(hm[1])] + '\n' + hm[2] : hm[2];
	}
	return { status: st ? +st[1] : 0, headers, body: substr(resp, at + 4) };
}

function login(secs) {
	const key = trim(readfile(KEY) ?? '');
	if (key == '')
		return null;
	const r = http('POST', '/control/login', { name: API_USER, password: key }, null, secs);
	if (r?.status != 200)
		return null;
	for (let c in split(r.headers['set-cookie'] ?? '', '\n')) {
		const m = match(c, /(agh_session=[^;]+)/);
		if (m) {
			mkdir('/var/run/milkflint', 0o700);
			write_atomic(COOKIE, m[1], 0o600);
			return m[1];
		}
	}
	return null;
}

// a call to its API as MilkFlint's account: the reply's JSON (true for an
// empty 200), or null. Each read waits up to `secs` (5).
export function api(method, path, body, secs) {
	let cookie = trim(readfile(COOKIE) ?? '');
	let r = (cookie != '') ? http(method, path, body, cookie, secs) : null;
	// no reply at all: it's down or hung, not signed out
	if (cookie != '' && r == null)
		return null;
	if (r == null || r.status == 401 || r.status == 403) {
		cookie = login(secs);
		if (!cookie)
			return null;
		r = http(method, path, body, cookie, secs);
	}
	if (r?.status != 200)
		return null;
	if (trim(r.body) == '')
		return true;
	try {
		return json(r.body);
	}
	catch (e) {
		return true;
	}
};

// ---- devices sent through the VPN (the VPN client page, wg_out) -------------
//
// Their lookups mustn't go out past the tunnel. AdGuard Home knows devices by
// address only (its own DHCP server isn't on), so MilkFlint keeps a client in
// it, VPN_CLIENT, with their addresses (their networks' subnets, or the
// chosen devices' addresses), whose upstream is a dnsproxy of its own
// (VPN_PORT, run as VPN_USER by milkflint-adguardhome) whose traffic carries
// the VPN's mark, so it goes through the tunnel as theirs does. Names on the
// network still come from dnsmasq. "Every device but…": the excepted ones are
// a second client, NOVPN_CLIENT, on the global upstreams (an address beats a
// subnet in AdGuard Home).

export const VPN_PORT = 5454;
export const VPN_USER = 'adguardvpn';
export const VPN_CLIENT = 'Through the VPN (MilkFlint)';
export const NOVPN_CLIENT = 'Not through the VPN (MilkFlint)';
// the router itself (its own checks of the DNS path), not counted
export const ROUTER_CLIENT = 'This router (MilkFlint)';
// Device control's people with SafeSearch on: "Device control: Sam"
export const DEVCTL_PREFIX = 'Device control: ';

// MilkFlint's own clients, kept up by the monitor (anything else was made in
// AdGuard Home's web interface and is left alone)
export function own_client(name) {
	return name in [ VPN_CLIENT, NOVPN_CLIENT, ROUTER_CLIENT ] || index(name ?? '', DEVCTL_PREFIX) == 0;
};
export const VPN_MARK = '0x10000000';
export const VPN_MASK = '0xf0000000';

const as_list = (v) => (type(v) == 'array') ? v : (v != null && v != '') ? [ v ] : [];

// What the VPN client page marks for the tunnel, from its firewall rules:
// { home: 'all' | 'only' | null, macs: [only those], skip: [all but those],
//   guests: [zones], kill: kill switch } — null if the VPN is off.
export function vpn_devices(c) {
	if (!c)
		c = cursor();
	const iface = c.get_all('network', 'wg_out');
	if (!iface || iface.disabled == '1' || iface.proto != 'wireguard')
		return null;
	const out = { home: null, macs: [], skip: [], guests: [], kill: false };
	c.foreach('firewall', 'rule', (r) => {
		if (r.enabled == '0')
			return;
		const m = match(r['.name'], /^wg_out_mark_([a-z0-9_]+)$/);
		if (m) {
			if (r.src == 'lan') {
				out.macs = map(as_list(r.src_mac), lc);
				out.home = length(out.macs) ? 'only' : 'all';
			}
			else if (r.src) {
				push(out.guests, r.src);
			}
		}
		else if (r['.name'] == 'wg_out_skip') {
			out.skip = map(as_list(r.src_mac), lc);
		}
		else if (match(r['.name'], /^wg_out_leak_/)) {
			out.kill = true;
		}
	});
	return (out.home || length(out.guests)) ? out : null;
};

function net4(addr, bits) {
	const p = map(split(addr, '.'), (x) => +x);
	let n = ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3];
	const size = 2 ** (32 - bits);
	n = n - n % size;
	return sprintf('%d.%d.%d.%d/%d', int(n / 16777216) % 256, int(n / 65536) % 256, int(n / 256) % 256, n % 256, bits);
}

// The subnets of a firewall zone's networks (IPv4 and the IPv6 prefixes
// handed to them), from netifd.
export function zone_subnets(zone, dump) {
	const c = cursor();
	const nets = [];
	c.foreach('firewall', 'zone', (z) => {
		if (z.name == zone)
			push(nets, ...as_list(z.network));
	});
	const out = [];
	for (let i in dump ?? [])
		if (i.interface in nets && i.up) {
			for (let a in i['ipv4-address'] ?? [])
				push(out, net4(a.address, a.mask));
			for (let p in i['ipv6-prefix-assignment'] ?? [])
				push(out, `${p.address}/${p.mask}`);
		}
	return out;
};


// The addresses the home network's devices with these MACs use now: IPv4
// from dnsmasq's leases, the fixed ones (dhcp host sections) and the
// neighbour table (an address set on the device), IPv6 from the neighbour
// table (not link-local: AdGuard Home can't match those).
export function addresses_of(macs) {
	const want = {};
	for (let m in macs)
		want[lc(m)] = true;
	const out = [];
	const add = (a) => { if (a && !(a in out)) push(out, a); };
	for (let line in split(readfile('/tmp/dhcp.leases') ?? '', '\n')) {
		const f = split(trim(line), /[ \t]+/);
		if (length(f) >= 3 && want[lc(f[1])] && match(f[2], /^[0-9.]+$/))
			add(f[2]);
	}
	cursor().foreach('dhcp', 'host', (h) => {
		for (let m in as_list(h.mac))
			if (want[lc(m)] && h.ip && match(h.ip, /^[0-9.]+$/))
				add(h.ip);
	});
	// the neighbour tables: addresses set on the device itself, and IPv6's
	for (let line in split(cmd('ip neigh show') ?? '', '\n')) {
		const m = match(line, /^([0-9a-f:.]+) dev \S+ lladdr ([0-9a-f:]+)/);
		if (m && want[m[2]] && !match(m[1], /^fe80:/) && m[2] != '00:00:00:00:00:00')
			add(m[1]);
	}
	return sort(out);
};

// The DNS page's servers, for the VPN's dnsproxy: { upstream, fallback,
// bootstrap, mode } as dnsproxy takes them, or null when the DNS page uses
// the internet provider's servers (they don't answer through a VPN).
export function vpn_upstreams(c) {
	if (!c)
		c = cursor();
	const mode = c.get('milkflint', 'dns', 'mode');
	if (mode == 'encrypted' && c.get('dnsproxy', 'global', 'enabled') == '1') {
		const up = as_list(c.get('dnsproxy', 'servers', 'upstream'));
		if (!length(up))
			return null;
		return {
			upstream: up,
			fallback: as_list(c.get('dnsproxy', 'servers', 'fallback')),
			bootstrap: as_list(c.get('dnsproxy', 'servers', 'bootstrap')),
			mode: c.get('dnsproxy', 'global', 'upstream_mode')
		};
	}
	if (mode == 'static') {
		const plain = [];
		for (let s in as_list(c.get('milkflint', 'dns', 'managed'))) {
			const m = match(s, /^([0-9a-fA-F:.]+)(#([0-9]+))?$/);
			if (m)
				push(plain, index(m[1], ':') >= 0 ? `[${m[1]}]:${m[3] ?? 53}` : `${m[1]}:${m[3] ?? 53}`);
		}
		return length(plain) ? { upstream: plain, fallback: [], bootstrap: [], mode: (c.get('dhcp', '@dnsmasq[0]', 'allservers') == '1') ? 'parallel' : null } : null;
	}
	return null;
};

// ---- the service -----------------------------------------------------------------

export function installed() {
	return access(BIN, 'x') == true && access('/etc/init.d/adguardhome', 'x') == true;
};

// the installed package's version ("0.107.80-r1"), from apk's database
export function package_version() {
	const db = readfile('/lib/apk/db/installed') ?? '';
	const m = match(db, /(^|\n)P:adguardhome\nV:([^\n]+)/);
	return m ? m[2] : null;
};

export function read_state() {
	try {
		return json(readfile(STATE) ?? 'null');
	}
	catch (e) {
		return null;
	}
};

// While AdGuard Home isn't answering, once it has answered since it started
// (milkflint.adguardhome.fallback): true, the router answers devices'
// lookups itself, unfiltered; false (unset: a new install), they go on to
// AdGuard Home and fail until it's back, so nothing gets through unfiltered.
// While it starts (a boot, its lists loading after a restart) the router
// answers either way.
export function falls_back(c) {
	return (c ?? cursor()).get('milkflint', 'adguardhome', 'fallback') == '1';
};

export function router_mode() {
	return cursor().get('milkflint', 'mode', 'mode') == 'ap' ? 'ap' : 'router';
};
