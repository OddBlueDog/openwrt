// banIP on MilkFlint (ui feature "banip"): what the page's rpcd methods
// (milkflint.banip), the monitor (banip-monitor), the init script and the
// first-boot defaults share. banIP itself (/etc/init.d/banip,
// /usr/lib/banip-functions.sh) does the blocking, in its own nftables table
// (inet banIP) and its own files; MilkFlint sets it up, checks every value
// against banIP's own (banip-options.json), keeps its custom feed file as
// banIP's catalogue plus the page's own feeds, changes its allowlist and
// blocklist in the files and the loaded sets at once, and refuses what would
// lock the household out or leave the router short of memory.
'use strict';

import { readfile, writefile, rename, open, access, mkdir, unlink, stat, popen, lsdir, glob } from 'fs';
import { cursor } from 'uci';
import { connect } from 'ubus';

export const INIT = '/etc/init.d/banip';
export const SERVICE = '/usr/bin/banip-service.sh';
export const FEEDS = '/etc/banip/banip.feeds';
export const CUSTOM = '/etc/banip/banip.custom.feeds';
export const COUNTRIES = '/etc/banip/banip.countries';
export const LISTS = { allowlist: '/etc/banip/banip.allowlist', blocklist: '/etc/banip/banip.blocklist' };
export const RUNTIME = '/var/run/banIP/banIP.runtime.json';
export const PIDFILE = '/var/run/banIP/banIP.pid';
export const OWN_FEEDS = '/etc/milkflint/banip-feeds.json';
export const DIR = '/tmp/milkflint-banip';
export const STATE = DIR + '/state.json';
export const DROPS = DIR + '/drops.tsv';
export const DROPS_OLD = DIR + '/drops.old.tsv';
export const EVENTS = DIR + '/events.tsv';
export const PROTECTED = DIR + '/protected.json';
export const LOOKUPS = DIR + '/lookups.json';
export const INSTALL = DIR + '/install.json';
export const LIBEXEC = '/usr/libexec/milkflint';
// a list line MilkFlint keeps up itself (the inside networks): "<net>  # milkflint: inside network <name>"
export const MANAGED = 'milkflint: ';

// ---- small helpers ---------------------------------------------------------------

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
	const f = open(tmp, 'w', mode ?? 0o644);
	if (!f)
		return false;
	f.write(data);
	f.close();
	return rename(tmp, path);
};

export function read_json(path) {
	try {
		return json(readfile(path) ?? 'null');
	}
	catch (e) {
		return null;
	}
};

export function as_list(v) {
	return (type(v) == 'array') ? v : (v != null && v != '') ? split(trim(`${v}`), /[ \t]+/) : [];
};

// FNV-1a, 32 bits: enough to tell a file MilkFlint wrote from one edited by hand
export function hash(s) {
	let h = 0x811c9dc5;
	for (let i = 0; i < length(s); i++) {
		h = h ^ ord(s, i);
		h = (h * 0x01000193) & 0xffffffff;
	}
	return sprintf('%08x', h);
};

export function installed() {
	return access(SERVICE, 'x') == true && access(INIT, 'x') == true;
};

export function router_mode(c) {
	return (c ?? cursor()).get('milkflint', 'mode', 'mode') == 'ap' ? 'ap' : 'router';
};

export function package_version() {
	const db = readfile('/lib/apk/db/installed') ?? '';
	const m = match(db, /(^|\n)P:banip\nV:([^\n]+)/);
	return m ? m[2] : null;
};

export function meminfo() {
	const t = readfile('/proc/meminfo') ?? '';
	const kb = (k) => +(match(t, regexp(`(^|\n)${k}:[ \t]+([0-9]+)`))?.[2] ?? 0);
	return { total_kb: kb('MemTotal'), available_kb: kb('MemAvailable') };
};

export function cpus() {
	let n = 0;
	for (let l in split(readfile('/proc/cpuinfo') ?? '', '\n'))
		if (match(l, /^processor[ \t]*:/))
			n++;
	return n || 1;
};

// ---- the run ---------------------------------------------------------------------

export function runtime() {
	return read_json(RUNTIME);
};

export function read_state() {
	return read_json(STATE);
};

// How many entries banIP's table holds (its last run's count), and whether
// that's "big": nft then takes seconds for every call that touches an
// element (it reads all of them first), so the page's changes and copies
// run in the background rather than holding up rpcd.
export const BIG = 100000;

export function entries() {
	return +replace(split(runtime()?.element_count ?? '0', '(')[0], /[^0-9]/g, '');
};

export function big() {
	return entries() > BIG;
};

// banIP's run in progress: its service process (banip-service.sh) is alive
export function processing() {
	return read_json(RUNTIME)?.status == 'processing';
};

// ---- options --------------------------------------------------------------------

let spec_cache = null;
export function spec() {
	if (!spec_cache)
		spec_cache = read_json(`${LIBEXEC}/banip-options.json`) ?? { options: {}, items: {}, milkflint: {} };
	return spec_cache;
};

let meta_cache = null;
export function meta() {
	if (!meta_cache)
		meta_cache = read_json(`${LIBEXEC}/banip-meta.json`) ?? { bytes: {}, feeds: {}, countries: {} };
	return meta_cache;
};

// banIP's country file: "<code>\t<registry>\t<name>"
export function countries() {
	const out = [];
	for (let l in split(readfile(COUNTRIES) ?? '', '\n')) {
		const f = split(l, '\t');
		if (length(f) >= 3 && match(f[0], /^[a-z]{2}$/))
			push(out, { code: f[0], region: f[1], name: f[2] });
	}
	return out;
};

function ports_ok(v) {
	for (let t in split(v, ' ')) {
		const m = match(t, /^([0-9]+)(-([0-9]+))?$/);
		if (!m)
			continue;
		const a = +m[1], b = (m[3] != null) ? +m[3] : a;
		if (a < 1 || a > 65535 || b < a || b > 65535)
			return false;
	}
	return true;
}

function regex_ok(term) {
	const t = replace(term, /^(first|last):/, '');
	if (t == '')
		return false;
	try {
		regexp(t);
		return true;
	}
	catch (e) {
		return false;
	}
}

function address_ok(v) {
	return iptoarr(v) != null;
}

function int_ok(v, o) {
	if (!match(v, /^-?[0-9]{1,9}$/))
		return false;
	const n = +v;
	return n >= (o.min ?? -2147483648) && n <= (o.max ?? 2147483647);
}

// One value: null when banIP takes it, else what's wrong. ctx: the feed
// names (catalogue), the country codes.
export function check_value(name, value, ctx) {
	const o = spec().options[name];
	if (!o)
		return 'unknown';
	const items = spec().items;
	if (o.type == 'list') {
		if (type(value) != 'array')
			return 'type';
		if (length(value) > 1000)
			return 'too_many';
		const re = items[o.item] ? regexp(items[o.item]) : null;
		const seen = {};
		for (let v in value) {
			if (type(v) != 'string' || !re || !match(v, re))
				return 'item';
			if (seen[v])
				return 'duplicate';
			seen[v] = true;
			if (o.item == 'feed' && ctx?.feeds && v != 'allowlist' && v != 'blocklist' && !ctx.feeds[v])
				return 'feed';
			if (o.item == 'country' && ctx?.countries && !ctx.countries[v])
				return 'country';
			if (o.item == 'asn' && +v > 4294967295)
				return 'item';
			if (o.item == 'logterm' && !regex_ok(v))
				return 'regex';
		}
		return null;
	}
	if (type(value) != 'string')
		return 'type';
	switch (o.type) {
	case 'bool':
		return (value == '0' || value == '1') ? null : 'bool';
	case 'int':
		return int_ok(value, o) ? null : 'range';
	case 'enum':
		return (index(o.values, value) >= 0) ? null : 'value';
	case 'path':
		return (match(value, /^\/[A-Za-z0-9._\/-]{1,120}$/) && index(value, '..') < 0) ? null : 'path';
	case 'string':
		if (!match(value, regexp(o.pattern)))
			return 'format';
		if (o.check == 'ports' && !ports_ok(value))
			return 'range';
		if (o.check == 'address' && !address_ok(value))
			return 'format';
		return null;
	}
	return 'type';
};

export function check_milkflint(name, value) {
	const o = spec().milkflint[name];
	if (!o)
		return 'unknown';
	if (type(value) != 'string')
		return 'type';
	if (o.type == 'enum')
		return (index(o.values, value) >= 0) ? null : 'value';
	if (o.type == 'int')
		return int_ok(value, o) ? null : 'range';
	return match(value, regexp(o.pattern)) ? null : 'format';
};

// banip.global as it is now: every option the spec knows, set or not
export function current(c) {
	c ??= cursor();
	const out = {};
	for (let name, o in spec().options) {
		const v = c.get('banip', 'global', name);
		out[name] = (o.type == 'list') ? as_list(v) : v;
	}
	return out;
};

// ---- the feed catalogue -----------------------------------------------------------

export function builtin_feeds() {
	return read_json(FEEDS) ?? {};
};

// the page's own feeds: { feeds: { name: feed }, hash: <of the custom file we wrote> }
export function own_feeds() {
	const r = read_json(OWN_FEEDS);
	return (type(r) == 'object' && type(r.feeds) == 'object') ? r : { feeds: {}, hash: null };
};

const FEED_KEYS = [ 'url_4', 'url_6', 'rule', 'chain', 'descr', 'flag' ];
const URL_RE = /^https?:\/\/[]A-Za-z0-9[{}\/.?&+_@%=:~#-]+$/;

// a feed as luci-app-banip's custom feed editor checks it; null when fine
export function check_feed(name, f) {
	if (type(name) != 'string' || !match(name, /^[a-z0-9]{3,15}$/) || name == 'allowlist' || name == 'blocklist')
		return 'name';
	if (type(f) != 'object')
		return 'feed';
	for (let k, v in f)
		if (index(FEED_KEYS, k) < 0 || type(v) != 'string')
			return 'field';
	if (type(f.descr) != 'string' || length(f.descr) < 3 || length(f.descr) > 40 || match(f.descr, /[\x01-\x1f"\\]/))
		return 'descr';
	if (!f.url_4 && !f.url_6)
		return 'url';
	for (let k in [ 'url_4', 'url_6' ])
		if (f[k] && (length(f[k]) > 400 || !match(f[k], URL_RE)))
			return k;
	if (type(f.rule) != 'string' || !match(f.rule, /^(feed|suricata)( [^ "\\\x01-\x1f]{1,40}| "){1,3}$/))
		return 'rule';
	if (f.chain && index([ 'in', 'out', 'inout' ], f.chain) < 0)
		return 'chain';
	if (f.flag && !match(f.flag, /^(gz|tcp|udp|[0-9]{1,5}(-[0-9]{1,5})?)( (gz|tcp|udp|[0-9]{1,5}(-[0-9]{1,5})?))*$/))
		return 'flag';
	return null;
};

function clean_feed(f) {
	const out = {};
	for (let k in FEED_KEYS)
		if (f[k] != null && f[k] != '')
			out[k] = f[k];
	return out;
}

// What banIP's custom feed file should hold: nothing while the page has no
// feeds of its own (banIP then uses its own catalogue), else its catalogue
// with the page's feeds added (a feed of the same name replaces banIP's):
// banIP reads the custom file instead of its own when it isn't empty.
export function custom_text(builtin, own) {
	if (!length(own.feeds))
		return '';
	const all = {};
	for (let k, v in builtin)
		all[k] = v;
	for (let k, v in own.feeds)
		all[k] = clean_feed(v);
	return sprintf('%.J\n', all);
};

// 'builtin': banIP's own catalogue; 'ours': the custom file is the one this
// page wrote; 'edited': someone else changed it (by hand, or LuCI's editor)
export function custom_state(own, text) {
	text ??= readfile(CUSTOM) ?? '';
	if (trim(text) == '')
		return length(own.feeds) ? 'edited' : 'builtin';
	return (own.hash != null && hash(text) == own.hash) ? 'ours' : 'edited';
};

// Writes the custom file from banIP's (maybe newer) catalogue and the page's
// feeds, unless it was edited by hand (then it's left: the page offers to
// take it over). After an upgrade the first-boot defaults call this.
export function sync_custom(force) {
	const own = own_feeds();
	const text = readfile(CUSTOM) ?? '';
	if (!force && custom_state(own, text) == 'edited')
		return 'edited';
	const want = custom_text(builtin_feeds(), own);
	if (want != text && !write_atomic(CUSTOM, want, 0o644))
		return 'error';
	own.hash = (want == '') ? null : hash(want);
	mkdir('/etc/milkflint', 0o755);
	write_atomic(OWN_FEEDS, sprintf('%.J\n', own), 0o644);
	return (want == '') ? 'builtin' : 'ours';
};

// the feeds banIP uses: its custom file when that loads, else its own
export function catalogue() {
	const builtin = builtin_feeds();
	const own = own_feeds();
	const text = readfile(CUSTOM) ?? '';
	let custom = null;
	if (trim(text) != '') {
		try {
			custom = json(text);
		}
		catch (e) {
			custom = null;
		}
	}
	const used = (type(custom) == 'object' && length(custom)) ? custom : builtin;
	const feeds = [];
	for (let name, f in used) {
		if (type(f) != 'object')
			continue;
		push(feeds, {
			name,
			url_4: f.url_4, url_6: f.url_6, rule: f.rule, chain: f.chain ?? 'in', flag: f.flag, descr: f.descr,
			builtin: builtin[name] != null,
			own: own.feeds[name] != null,
			changed: builtin[name] != null && sprintf('%J', clean_feed(builtin[name])) != sprintf('%J', clean_feed(f))
		});
	}
	return { feeds, state: custom_state(own, text), custom_loads: (trim(text) == '' || custom != null) };
};

// ---- addresses --------------------------------------------------------------------

// "1.2.3.0/24", "2001:db8::/32", "1.2.3.4": { fam, bytes, bits }, else null
export function cidr(s) {
	if (type(s) != 'string')
		return null;
	const m = match(s, /^([0-9A-Fa-f:.]+)(\/([0-9]{1,3}))?$/);
	if (!m)
		return null;
	const a = iptoarr(m[1]);
	if (!a)
		return null;
	const max = length(a) * 8;
	const bits = (m[3] != null) ? +m[3] : max;
	if (bits > max)
		return null;
	return { fam: (length(a) == 4) ? 4 : 6, bytes: a, bits };
};

function prefix_equal(a, b, bits) {
	for (let i = 0; bits > 0; i++) {
		const mask = (bits >= 8) ? 0xff : ((0xff << (8 - bits)) & 0xff);
		if ((a[i] & mask) != (b[i] & mask))
			return false;
		bits -= 8;
	}
	return true;
}

// whether two networks (or addresses) share any address
export function overlaps(a, b) {
	return a != null && b != null && a.fam == b.fam && prefix_equal(a.bytes, b.bytes, min(a.bits, b.bits));
};

// the network address of an address and its prefix length: "192.168.1.0/24"
export function network(addr, bits) {
	const a = iptoarr(addr);
	if (!a)
		return null;
	let left = bits;
	for (let i = 0; i < length(a); i++) {
		const keep = (left >= 8) ? 0xff : (left > 0) ? ((0xff << (8 - left)) & 0xff) : 0;
		a[i] = a[i] & keep;
		left -= 8;
	}
	return `${arrtoip(a)}/${bits}`;
};

// ---- the lists' lines, as banIP reads them --------------------------------------
//
// banIP (banip-functions.sh) reads the first word of each line: an IPv4 or
// IPv6 address or network (f_chkip: no leading zeros, a /32 or /128 at most,
// not loopback, 0.0.0.0, ::, ::ffff:… or link-local), a MAC address (with an
// optional /0-48 range) followed by an IPv4 or IPv6 address it's bound to, or
// a domain name (looked up at each run). "#" starts a comment.

const V4 = /^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}(\/([0-9]|[12][0-9]|3[0-2]))?$/;
const MAC = /^([0-9a-f]{2}(:[0-9a-f]{2}){5})(\/([0-9]|[1-3][0-9]|4[0-8]))?$/;
const DOMAIN = /^([a-z0-9_-]{1,63}\.)+[a-z]+$/;

function v6_ok(s) {
	const m = match(s, /^([0-9a-f:]+)(\/([0-9]{1,3}))?$/);
	if (!m || index(m[1], ':') < 0 || (m[3] != null && +m[3] > 128))
		return false;
	const a = iptoarr(m[1]);
	if (!a || length(a) != 16)
		return false;
	if (m[1] == '::' || m[1] == '::1' || match(m[1], /^::ffff:/) || match(m[1], /^fe80:/))
		return false;
	return true;
}

function v4_ok(s) {
	if (!match(s, V4))
		return false;
	const base = split(s, '/')[0];
	return !match(base, /^127\./) && base != '0.0.0.0';
}

// one line: { kind: 'blank' | 'comment' | 'v4' | 'v6' | 'mac' | 'domain' | 'invalid', ... }
export function parse_entry(line) {
	line = rtrim(`${line}`, '\r');
	if (match(line, /^[ \t]*$/))
		return { kind: 'blank' };
	if (match(line, /^[ \t]*#/))
		return { kind: 'comment', comment: ltrim(substr(ltrim(line), 1)) };
	if (match(line, /^[ \t]/))
		return { kind: 'invalid', reason: 'indent' };
	const hashpos = index(line, '#');
	const comment = (hashpos >= 0) ? trim(substr(line, hashpos + 1)) : null;
	const body = trim((hashpos >= 0) ? substr(line, 0, hashpos) : line);
	const words = split(body, /[ \t]+/);
	const first = lc(words[0]);
	if (v4_ok(first))
		return (length(words) == 1) ? { kind: 'v4', value: first, comment } : { kind: 'invalid', reason: 'extra' };
	if (index(first, ':') >= 0 && !match(first, MAC)) {
		if (v6_ok(first))
			return (length(words) == 1) ? { kind: 'v6', value: first, comment } : { kind: 'invalid', reason: 'extra' };
		return { kind: 'invalid', reason: 'address' };
	}
	const mac = match(first, MAC);
	if (mac) {
		if (length(words) > 2)
			return { kind: 'invalid', reason: 'extra' };
		const ip = lc(words[1] ?? '');
		if (ip == '')
			return { kind: 'mac', value: first, mac: mac[1], ip4: null, ip6: null, comment };
		if (v4_ok(ip))
			return { kind: 'mac', value: `${first} ${ip}`, mac: mac[1], ip4: ip, ip6: null, comment };
		if (v6_ok(ip))
			return { kind: 'mac', value: `${first} ${ip}`, mac: mac[1], ip4: null, ip6: ip, comment };
		return { kind: 'invalid', reason: 'address' };
	}
	if (match(first, DOMAIN) && length(first) <= 253)
		return (length(words) == 1) ? { kind: 'domain', value: first, comment } : { kind: 'invalid', reason: 'extra' };
	if (match(first, /^[0-9.\/]+$/))
		return { kind: 'invalid', reason: 'address' };
	return { kind: 'invalid', reason: 'unknown' };
};

// a list's text as lines and entries
export function parse_list(text) {
	const out = [];
	const lines = split(`${text ?? ''}`, '\n');
	if (length(lines) && lines[-1] == '')
		pop(lines);
	for (let i = 0; i < length(lines); i++) {
		const e = parse_entry(lines[i]);
		e.line = i + 1;
		e.text = rtrim(lines[i], '\r');
		push(out, e);
	}
	return out;
};

// a line as banIP writes them: the entry, padded, then the comment
export function format_entry(value, comment) {
	return (comment != null && comment != '') ? sprintf('%-45s# %s', value, comment) : value;
};

// ---- banIP's table and sets ------------------------------------------------------

export function table_loaded() {
	return system('nft -t list chain inet banIP _reject > /dev/null 2>&1') == 0;
};

// the table's sets: [ { name, type } ] (the set types: ipv4_addr, ipv6_addr, or concatenations)
export function sets() {
	const out = [];
	const j = (() => {
		try {
			return json(cmd('nft -tj list sets table inet banIP') || 'null');
		}
		catch (e) {
			return null;
		}
	})();
	for (let x in j?.nftables ?? [])
		if (x.set && x.set.table == 'banIP' && match(x.set.name, /^[A-Za-z0-9_.]{1,64}$/))
			push(out, { name: x.set.name, type: (type(x.set.type) == 'array') ? join(' . ', x.set.type) : x.set.type });
	return out;
};

// The elements a list entry puts in banIP's sets: [ [ set, element ] ].
// A domain's are its addresses (resolved: looked up now).
export function elements_of(list, e, resolved) {
	const out = [];
	if (e.kind == 'v4')
		push(out, [ `${list}.v4`, e.value ]);
	else if (e.kind == 'v6')
		push(out, [ `${list}.v6`, e.value ]);
	else if (e.kind == 'mac') {
		const m = split(e.value, ' ')[0];
		if (e.ip6 == null)
			push(out, [ `${list}.v4MAC`, `${m} . ${e.ip4 ?? '0.0.0.0/0'}` ]);
		if (e.ip4 == null)
			push(out, [ `${list}.v6MAC`, `${m} . ${e.ip6 ?? '::/0'}` ]);
	}
	else if (e.kind == 'domain') {
		for (let a in resolved?.[e.value] ?? [])
			push(out, [ (index(a, ':') >= 0) ? `${list}.v6` : `${list}.v4`, a ]);
	}
	return out;
};

// a name's addresses in resolv's answer: a CNAME's come under the name it points to
function follow(r, name, depth) {
	const n = r?.[name];
	if (!n || depth > 8)
		return [];
	let a = [ ...(n.A ?? []), ...(n.AAAA ?? []) ];
	for (let c in n.CNAME ?? [])
		a = [ ...a, ...follow(r, c, depth + 1) ];
	return a;
}

// A and AAAA addresses of names (through the router's own DNS): { name: [ addresses ] }
export function resolve(names) {
	const out = {};
	if (!length(names))
		return out;
	let r = null;
	try {
		const resolv = require('resolv');
		r = resolv.query(names, { type: [ 'A', 'AAAA' ], timeout: 2500 });
	}
	catch (e) {
		r = null;
	}
	for (let n in names)
		out[n] = uniq(follow(r, n, 0));
	return out;
};

// nft commands as one batch (one transaction, and one read of banIP's
// table: with a big list loaded, each nft call that touches elements reads
// all of them first, which takes seconds); true when it went through
function nft_batch(lines) {
	if (!length(lines))
		return true;
	mkdir(DIR, 0o755);
	const f = `${DIR}/batch.nft`;
	writefile(f, join('\n', lines) + '\n');
	const ok = system(`nft -f ${f} > /dev/null 2>&1`) == 0;
	unlink(f);
	return ok;
}

// the same in the background, for a big table: the whole batch, else line
// by line (an element that isn't there refuses the batch)
let bg_n = 0;
function nft_batch_bg(lines) {
	if (!length(lines))
		return;
	mkdir(DIR, 0o755);
	const f = `${DIR}/batch-${time()}-${bg_n++}.nft`;
	writefile(f, join('\n', lines) + '\n');
	system(`( nft -f ${f} || while IFS= read -r l; do printf '%s\\n' "$l" | nft -f -; done < ${f}; rm -f ${f} ) > /dev/null 2>&1 &`);
}

// One element out of a loaded set (one that holds an address: the log
// monitor's, a network): at once, or with big lists in the background
export function remove_element(set, element) {
	const cmd_ = `destroy element inet banIP ${set} { ${element} }`;
	if (big()) {
		nft_batch_bg([ cmd_ ]);
		return true;
	}
	return nft_batch([ cmd_ ]);
};

// Applies the change of a list's entries to banIP's loaded sets (the file
// is written by the caller): what's gone is taken out, what's new put in,
// each as one batch (one at a time only when a batch is refused: an
// element that isn't there). Nothing while banIP's table isn't loaded: it
// reads the file when it starts.
export function apply_list(list, before, after) {
	if (!table_loaded())
		return { applied: false };
	const key = (e) => `${e.kind} ${e.value}`;
	const was = {}, now = {};
	for (let e in before)
		if (index([ 'v4', 'v6', 'mac', 'domain' ], e.kind) >= 0)
			was[key(e)] = e;
	for (let e in after)
		if (index([ 'v4', 'v6', 'mac', 'domain' ], e.kind) >= 0)
			now[key(e)] = e;
	const names = [];
	for (let k, e in was)
		if (!now[k] && e.kind == 'domain')
			push(names, e.value);
	for (let k, e in now)
		if (!was[k] && e.kind == 'domain')
			push(names, e.value);
	const resolved = resolve(uniq(names));
	const have = {};
	for (let s in sets())
		have[s.name] = true;
	const gone = [], add = [];
	for (let k, e in was)
		if (!now[k])
			for (let x in elements_of(list, e, resolved))
				if (have[x[0]])
					push(gone, x);
	for (let k, e in now)
		if (!was[k])
			for (let x in elements_of(list, e, resolved))
				if (have[x[0]])
					push(add, x);
	let removed = 0, added = 0, failed = 0;
	const cmd_of = (verb, x) => `${verb} element inet banIP ${x[0]} { ${x[1]} }`;
	if (big()) {
		// seconds a call with big lists loaded: in the background, in order
		nft_batch_bg([ ...map(gone, (x) => cmd_of('destroy', x)), ...map(add, (x) => cmd_of('add', x)) ]);
		return { applied: true, pending: true, added: length(add), removed: length(gone), failed: 0 };
	}
	if (nft_batch(map(gone, (x) => cmd_of('destroy', x))))
		removed = length(gone);
	else
		for (let x in gone)
			if (nft_batch([ cmd_of('destroy', x) ]))
				removed++;
	if (nft_batch(map(add, (x) => cmd_of('add', x))))
		added = length(add);
	else
		for (let x in add)
			if (nft_batch([ cmd_of('add', x) ]))
				added++;
			else
				failed++;
	return { applied: true, added, removed, failed };
};

// ---- finding an address in banIP's sets ----------------------------------------
//
// nft looks an element up only after reading every element of the table, so
// with big lists loaded that takes seconds a set. Instead: banIP's own sets
// (the downloaded lists) are copied once after each update, one file a set
// in RAM (SETS_DIR: "<element>\t<packets>\t<expires>"), and the small sets
// of the allowlist and blocklist, which change any time, are read as they
// are now (listing one set reads only that set).

export const SETS_DIR = DIR + '/sets';

// "<element>\t<packets>\t<expires>" lines from nft's listing, per set, into
// files named after the sets in `dir` (a MAC set's element is
// "<mac> . <address>")
const DUMP_AWK = `
/^\\tset [A-Za-z0-9_.]+ \\{$/ { name = $2; on = 0; next }
name != "" && /elements = \\{/ { on = 1; sub(/.*elements = \\{/, "") }
on {
	end = index($0, "}") > 0
	gsub(/[{}\\t]/, " ")
	n = split($0, parts, ",")
	for (i = 1; i <= n; i++) {
		m = split(parts[i], w, " ")
		if (m == 0) continue
		v = w[1]; k = 2
		while (k <= m && w[k] != "counter" && w[k] != "timeout" && w[k] != "expires") { v = v " " w[k]; k++ }
		p = ""; e = ""
		for (; k < m; k++) { if (w[k] == "packets") p = w[k + 1]; if (w[k] == "expires") e = w[k + 1] }
		out = (dir == "-") ? "/dev/stdout" : (dir "/" name ".tsv")
		print v "\\t" p "\\t" e > out
	}
	if (end) { on = 0; if (dir != "-") close(dir "/" name ".tsv"); name = "" }
}`;

export function is_local(set) {
	return match(set, /^(allowlist|blocklist)\./) != null;
};

// Copies banIP's sets (all but the allowlist's and blocklist's) to SETS_DIR,
// with the run they're from: after each update, by the monitor.
export function dump_sets() {
	if (!table_loaded())
		return false;
	mkdir(DIR, 0o755);
	const tmp = `${SETS_DIR}.new`;
	system(`rm -rf ${tmp} && mkdir -p ${tmp}`);
	writefile(`${DIR}/dump.awk`, DUMP_AWK);
	const ok = system(`nft list table inet banIP 2> /dev/null | gawk -v dir=${tmp} -f ${DIR}/dump.awk`) == 0;
	unlink(`${DIR}/dump.awk`);
	for (let f in lsdir(tmp) ?? [])
		if (is_local(f))
			unlink(`${tmp}/${f}`);
	if (!ok) {
		system(`rm -rf ${tmp}`);
		return false;
	}
	writefile(`${tmp}/.stamp`, sprintf('%J', { at: time(), run: runtime()?.last_run ?? null }));
	system(`rm -rf ${SETS_DIR} && mv ${tmp} ${SETS_DIR}`);
	return true;
};

// whether the copy is of the sets loaded now (the last run's)
export function dump_fresh() {
	const st = read_json(`${SETS_DIR}/.stamp`);
	return st != null && st.run == (runtime()?.last_run ?? null);
};

function v4_int(a) {
	const b = iptoarr(a);
	return b ? ((b[0] * 256 + b[1]) * 256 + b[2]) * 256 + b[3] : null;
}

function cmp_bytes(a, b) {
	for (let i = 0; i < length(a); i++)
		if (a[i] != b[i])
			return a[i] - b[i];
	return 0;
}

// whether an element (an address, a network "a/len", a range "a-b") shares
// an address with n ({ fam, bytes, bits })
export function element_matches(n, value) {
	const r = match(value, /^([0-9A-Fa-f:.]+)-([0-9A-Fa-f:.]+)$/);
	if (!r)
		return overlaps(n, cidr(value));
	const lo = iptoarr(r[1]), hi = iptoarr(r[2]);
	if (!lo || !hi || length(lo) != length(n.bytes))
		return false;
	// the query's first and last address, byte by byte
	const first = [ ...n.bytes ], last = [ ...n.bytes ];
	let left = n.bits;
	for (let i = 0; i < length(first); i++) {
		const keep = (left >= 8) ? 0xff : (left > 0) ? ((0xff << (8 - left)) & 0xff) : 0;
		first[i] = first[i] & keep;
		last[i] = (last[i] & keep) | (~keep & 0xff);
		left -= 8;
	}
	return cmp_bytes(first, hi) <= 0 && cmp_bytes(last, lo) >= 0;
};

// "<element>\t<packets>\t<expires>" lines of a set as loaded now (listing
// one set reads only that one: quick for the allowlist's and blocklist's)
export function set_lines(set) {
	if (!match(set, /^[A-Za-z0-9_.]{1,64}$/))
		return [];
	mkdir(DIR, 0o755);
	const awk = `${DIR}/dump-set.awk`;
	writefile(awk, DUMP_AWK);
	// a set listed alone is indented one step more than in the table's listing
	const out = cmd(`nft list set inet banIP ${sh_quote(set)} 2> /dev/null | sed 's/^\\t\\tset /\\tset /' | gawk -v dir=- -f ${awk}`);
	unlink(awk);
	return filter(split(out ?? '', '\n'), (l) => l != '');
};

// Where an address (or a network) is in banIP's sets: [ { set, element,
// packets, expires, copy } ]: banIP's own sets from the copy (IPv4 scanned by
// gawk), the allowlist's and blocklist's as they are now.
export function find(addr) {
	const n = cidr(addr);
	if (!n)
		return [];
	// right after an update, before the monitor has copied its lists: now,
	// or with big lists (seconds) in the background, the old copy meanwhile
	if (!dump_fresh() && runtime()?.status == 'active') {
		if (big())
			system(`/usr/bin/ucode -e 'import * as b from "${LIBEXEC}/banip.uc"; b.dump_sets();' > /dev/null 2>&1 &`);
		else
			dump_sets();
	}
	const out = [];
	const fam = (n.fam == 4) ? 'v4' : 'v6';
	const row = (set, x, copy) => ({ set, element: x[0], packets: (x[1] != null && x[1] != '') ? +x[1] : null, expires: (x[2] != null && x[2] != '') ? x[2] : null, copy });
	if (n.fam == 4 && length(glob(`${SETS_DIR}/*.v4.tsv`) ?? [])) {
		const lo = v4_int(arrtoip(n.bytes));
		const size = 2 ** (32 - n.bits);
		const qlo = lo - (lo % size), qhi = qlo + size - 1;
		const prog = 'function ip(s, a) { split(s, a, "."); return ((a[1] * 256 + a[2]) * 256 + a[3]) * 256 + a[4] } ' +
			'{ v = $1; if (index(v, "-")) { split(v, r, "-"); a = ip(r[1]); b = ip(r[2]) } ' +
			'else if (index(v, "/")) { split(v, r, "/"); a = ip(r[1]); s = 2 ^ (32 - r[2]); a = a - a % s; b = a + s - 1 } else { a = ip(v); b = a } ' +
			'if (lo <= b && hi >= a) { f = FILENAME; sub(/.*\\//, "", f); sub(/\\.tsv$/, "", f); print f "\\t" $0 } }';
		const res = cmd(`gawk -F '\\t' -v lo=${qlo} -v hi=${qhi} ${sh_quote(prog)} ${SETS_DIR}/*.v4.tsv 2> /dev/null`) ?? '';
		for (let l in split(res, '\n')) {
			const f = split(l, '\t');
			if (length(f) >= 2)
				push(out, row(f[0], slice(f, 1), true));
		}
	}
	else if (n.fam == 6)
		for (let f in glob(`${SETS_DIR}/*.v6.tsv`) ?? []) {
			const set = replace(replace(f, /.*\//, ''), /\.tsv$/, '');
			for (let l in split(readfile(f) ?? '', '\n')) {
				const x = split(l, '\t');
				if (x[0] != '' && element_matches(n, x[0]))
					push(out, row(set, x, true));
			}
		}
	for (let list in [ 'allowlist', 'blocklist' ])
		for (let l in set_lines(`${list}.${fam}`)) {
			const x = split(l, '\t');
			if (element_matches(n, x[0]))
				push(out, row(`${list}.${fam}`, x, false));
		}
	return out;
};

// ---- the networks around ---------------------------------------------------------

function inside_zones(c) {
	const zones = {};
	c.foreach('firewall', 'zone', (z) => {
		if (z.enabled == '0')
			return;
		for (let n in as_list(z.network))
			zones[n] = { zone: z.name, inside: z.masq != '1' };
	});
	return zones;
}

function dump() {
	return connect()?.call('network.interface', 'dump')?.interface ?? [];
}

// The router's inside networks (every interface of a zone without
// masquerading: home, guests, Remote access): [ { iface, zone, net } ]
export function inside_networks(c, d) {
	c ??= cursor();
	d ??= dump();
	const zones = inside_zones(c);
	const out = [];
	for (let i in d) {
		const z = zones[i.interface];
		if (!z?.inside || !i.up)
			continue;
		for (let a in i['ipv4-address'] ?? [])
			push(out, { iface: i.interface, zone: z.zone, net: network(a.address, a.mask) });
		for (let p in i['ipv6-prefix-assignment'] ?? [])
			push(out, { iface: i.interface, zone: z.zone, net: network(p.address, p.mask) });
		for (let a in i['ipv6-address'] ?? [])
			if (a.mask < 128)
				push(out, { iface: i.interface, zone: z.zone, net: network(a.address, a.mask) });
	}
	const seen = {};
	return filter(out, (x) => x.net && !seen[x.net] && (seen[x.net] = true));
};

// UDP ports WireGuard listens on (Remote access, and any other WireGuard
// server): banIP lets them through whatever the lists say, so devices away
// from home can still connect
export function wireguard_ports(c) {
	c ??= cursor();
	const out = [];
	c.foreach('network', 'interface', (s) => {
		if (s.proto == 'wireguard' && s.disabled != '1' && match(s.listen_port ?? '', /^[0-9]{1,5}$/) && +s.listen_port > 0 && +s.listen_port < 65536)
			push(out, s.listen_port);
	});
	return uniq(out);
};

// Devices with the router's pages open now (connections to its web
// server): their addresses, from /proc/net/tcp{,6}, and MACs
function hex_v4(h) {
	return sprintf('%d.%d.%d.%d', hex(substr(h, 6, 2)), hex(substr(h, 4, 2)), hex(substr(h, 2, 2)), hex(substr(h, 0, 2)));
}

function hex_v6(h) {
	const b = [];
	for (let w = 0; w < 4; w++)
		for (let i = 3; i >= 0; i--)
			push(b, hex(substr(h, w * 8 + i * 2, 2)));
	if (b[0] == 0 && b[1] == 0 && b[2] == 0 && b[3] == 0 && b[4] == 0 && b[5] == 0 && b[6] == 0 && b[7] == 0 &&
	    b[8] == 0 && b[9] == 0 && b[10] == 0xff && b[11] == 0xff)
		return sprintf('%d.%d.%d.%d', b[12], b[13], b[14], b[15]);
	return arrtoip(b);
}

export function web_clients(c) {
	c ??= cursor();
	const ports = {};
	for (let o in [ 'listen_http', 'listen_https' ])
		for (let l in as_list(c.get('uhttpd', 'main', o)))
			if (match(l, /:([0-9]+)$/))
				ports[sprintf('%04X', +match(l, /:([0-9]+)$/)[1])] = true;
	if (!length(ports))
		ports['0050'] = ports['01BB'] = true;
	const out = [];
	for (let f in [ '/proc/net/tcp', '/proc/net/tcp6' ]) {
		for (let l in split(readfile(f) ?? '', '\n')) {
			const m = match(l, /^ *[0-9]+: ([0-9A-F]+):([0-9A-F]{4}) ([0-9A-F]+):[0-9A-F]{4} 01 /);
			if (!m || !ports[m[2]])
				continue;
			const a = (length(m[3]) == 8) ? hex_v4(m[3]) : hex_v6(m[3]);
			if (a && !match(a, /^127\./) && a != '::1')
				push(out, a);
		}
	}
	return uniq(out);
};

// the MACs of addresses on the router's networks (its neighbour tables)
export function macs_of(addrs) {
	const want = {};
	for (let a in addrs)
		want[a] = true;
	const out = {};
	for (let l in split(readfile('/proc/net/arp') ?? '', '\n')) {
		const f = split(l, /[ \t]+/);
		if (want[f[0]] && match(f[3] ?? '', /^[0-9a-f:]{17}$/) && f[3] != '00:00:00:00:00:00')
			out[f[0]] = f[3];
	}
	for (let l in split(cmd('ip -6 neigh show') ?? '', '\n')) {
		const m = match(l, /^([0-9a-f:]+) .* lladdr ([0-9a-f:]{17})/);
		if (m && want[m[1]])
			out[m[1]] = m[2];
	}
	return out;
};

function host_of(u) {
	let s = replace(u, /^[a-z0-9+]+:\/\//, '');
	if (match(s, /^\[/))
		return match(s, /^\[([0-9a-fA-F:]+)\]/)?.[1];
	s = split(split(s, '/')[0], '@')[-1];
	// "9.9.9.9:53", "dns.quad9.net:853", "1.1.1.1"
	if (index(s, ':') >= 0 && iptoarr(s) == null)
		s = split(s, ':')[0];
	return s;
}

// What blocking mustn't reach: [ { address, what } ], 'address' an address
// or a network. The devices with the router's pages open come from now; the
// rest (names looked up) is kept ten minutes.
export function protected_addresses(c) {
	c ??= cursor();
	const out = [];
	const clients = web_clients(c);
	const macs = macs_of(clients);
	for (let a in clients)
		push(out, { address: a, what: 'browser', mac: macs[a] });
	const cached = read_json(PROTECTED);
	if (cached && cached.until > time() && type(cached.list) == 'array')
		return [ ...out, ...cached.list ];

	const list = [];
	const d = dump();
	for (let n in inside_networks(c, d))
		push(list, { address: n.net, what: 'inside', name: n.iface });
	const zones = inside_zones(c);
	for (let i in d) {
		const z = zones[i.interface];
		if (!i.up || z?.inside)
			continue;
		for (let a in i['ipv4-address'] ?? [])
			push(list, { address: a.address, what: 'wan', name: i.interface });
		for (let a in i['ipv6-address'] ?? [])
			push(list, { address: a.address, what: 'wan', name: i.interface });
		for (let r in i.route ?? [])
			if (r.mask == 0 && r.nexthop && r.nexthop != '0.0.0.0' && r.nexthop != '::')
				push(list, { address: r.nexthop, what: 'gateway', name: i.interface });
		for (let s in i['dns-server'] ?? [])
			push(list, { address: s, what: 'dns', name: i.interface });
	}
	const names = {};
	const add = (v, what) => {
		const h = host_of(`${v}`);
		if (!h || h == '')
			return;
		if (iptoarr(h)) {
			if (!match(h, /^127\./) && h != '::1')
				push(list, { address: h, what, name: h });
		}
		else if (match(h, /^[A-Za-z0-9.-]{1,253}$/) && index(h, '.') > 0)
			push(names[h] ??= [], what);
	};
	c.foreach('dhcp', 'dnsmasq', (s) => {
		for (let v in as_list(s.server)) {
			// "/domain/1.2.3.4#53", "1.2.3.4#53"
			const ip = split(split(v, '/')[-1], '#')[0];
			add(ip, 'dns');
		}
	});
	for (let v in as_list(c.get('milkflint', 'dns', 'managed')))
		add(split(v, '#')[0], 'dns');
	for (let o in [ 'upstream', 'fallback', 'bootstrap' ])
		for (let v in as_list(c.get('dnsproxy', 'servers', o)))
			if (!match(v, /^sdns:/))
				add(v, 'dns');
	c.foreach('system', 'timeserver', (s) => {
		for (let v in as_list(s.server))
			add(v, 'ntp');
	});
	for (let f in [ ...(glob('/etc/apk/repositories.d/*.list') ?? []), '/etc/apk/repositories' ])
		for (let l in split(readfile(f) ?? '', '\n')) {
			const m = match(l, /(https?:\/\/[^ \/]+)/);
			if (m)
				add(m[1], 'feed');
		}
	const resolved = resolve(keys(names));
	for (let n, whats in names)
		for (let a in resolved[n] ?? [])
			for (let w in uniq(whats))
				push(list, { address: a, what: w, name: n });
	mkdir(DIR, 0o755);
	write_atomic(PROTECTED, sprintf('%J', { until: time() + 600, list }), 0o600);
	return [ ...out, ...list ];
};

// Entries of a blocklist that would block something on the protected list:
// [ { entry, what, name, address } ]. MAC entries: the devices with the
// router's pages open. Domains: their addresses now.
export function lockouts(entries, prot) {
	const out = [];
	const names = [];
	for (let e in entries)
		if (e.kind == 'domain')
			push(names, e.value);
	const resolved = resolve(uniq(names));
	const nets = map(prot, (p) => ({ ...p, net: cidr(p.address) }));
	for (let e in entries) {
		let targets = [];
		if (e.kind == 'v4' || e.kind == 'v6')
			targets = [ e.value ];
		else if (e.kind == 'domain')
			targets = resolved[e.value] ?? [];
		else if (e.kind == 'mac') {
			for (let p in prot)
				if (p.what == 'browser' && p.mac && lc(p.mac) == e.mac)
					push(out, { entry: e.value, line: e.line, what: 'browser', name: p.address, address: p.mac });
			continue;
		}
		for (let t in targets) {
			const n = cidr(t);
			for (let p in nets)
				if (overlaps(n, p.net)) {
					push(out, { entry: e.value, line: e.line, what: p.what, name: p.name ?? p.address, address: p.address });
					break;
				}
		}
	}
	return out;
};

// ---- memory ----------------------------------------------------------------------

// What a selection of lists costs: { entries, kept_kb, load_kb, ... }.
// sel: { feeds: [ name ], countries: [ code ], asns: [ n ], counters, split,
// cores, v4, v6 }; known: entries per set from banIP's report ({ 'debl.v4': n }).
export function estimate(sel, known) {
	const m = meta();
	const b = m.bytes ?? {};
	const ncpu = cpus();
	const per = (b.kept ?? 125) + (b.copy ?? 24) + (sel.counters ? (b.counter_base ?? 34) + (b.counter_per_cpu ?? 16) * ncpu : 0);
	const sizes = [];
	const fams = [];
	if (sel.v4 !== false)
		push(fams, 'v4');
	if (sel.v6 !== false)
		push(fams, 'v6');
	for (let f in sel.feeds ?? []) {
		if (f == 'country' || f == 'asn')
			continue;
		for (let v in fams) {
			const k = `${f}.${v}`;
			const n = known?.[k] ?? m.feeds?.[f]?.[v] ?? ((v == 'v4' && !m.feeds?.[f]) ? (m.unknown_entries ?? 5000) : 0);
			if (n > 0)
				push(sizes, n);
		}
	}
	if (index(sel.feeds ?? [], 'country') >= 0) {
		let c4 = 0, c6 = 0;
		for (let c in sel.countries ?? []) {
			c4 += m.countries?.[c]?.v4 ?? 0;
			c6 += m.countries?.[c]?.v6 ?? 0;
		}
		if (index(fams, 'v4') >= 0 && c4)
			push(sizes, c4);
		if (index(fams, 'v6') >= 0 && c6)
			push(sizes, c6);
	}
	if (index(sel.feeds ?? [], 'asn') >= 0 && length(sel.asns ?? []))
		push(sizes, length(sel.asns) * (m.asn_entries ?? 500) * length(fams));
	let entries = 0;
	for (let n in sizes)
		entries += n;
	sort(sizes, (x, y) => y - x);
	const cores = max(1, sel.cores ?? ncpu);
	const chunk = (sel.split >= 512) ? sel.split : 0;
	let load = 0;
	for (let i = 0; i < min(cores, length(sizes)); i++)
		load += (chunk ? min(sizes[i], chunk) : sizes[i]) * (b.load ?? 400) + (b.load_base ?? 6000000);
	load += b.run ?? 32000000;
	return { entries, per_entry: per, kept_kb: int(entries * per / 1024), load_kb: int(load / 1024) };
};

// Whether the router can take a selection: what stays free while banIP
// loads it (the lists already loaded are dropped first), against a reserve
// for everything else (15 % of memory, 96 MB at least).
export function memory_check(est, now_entries, now_per) {
	const mem = meminfo();
	const reserve_kb = max(98304, int(mem.total_kb * 0.15));
	const freed_kb = int((now_entries ?? 0) * (now_per ?? 0) / 1024);
	const left_kb = mem.available_kb + freed_kb - est.kept_kb - est.load_kb;
	return { ...mem, reserve_kb, freed_kb, left_kb, ok: left_kb >= reserve_kb };
};

// ---- the update schedule (cron) ------------------------------------------------

// "M H * * D" for milkflint.banip's schedule, time and day; null when off
export function cron_spec(schedule, time_, day) {
	const t = match(time_ ?? '', /^([01][0-9]|2[0-3]):([0-5][0-9])$/);
	const h = t ? +t[1] : 4, mi = t ? +t[2] : 0;
	switch (schedule) {
	case '6h':
		return `${mi} ${join(',', map([ 0, 6, 12, 18 ], (x) => (h + x) % 24))} * * *`;
	case '12h':
		return `${mi} ${h},${(h + 12) % 24} * * *`;
	case 'daily':
		return `${mi} ${h} * * *`;
	case 'weekly':
		return `${mi} ${h} * * ${(+day >= 0 && +day <= 6) ? +day : 0}`;
	}
	return null;
};

// the next time the schedule runs, in seconds since the epoch (the router's
// local time, as cron runs it)
export function next_update(schedule, time_, day, now) {
	const spec_ = cron_spec(schedule, time_, day);
	if (!spec_)
		return null;
	const f = split(spec_, ' ');
	const mi = +f[0];
	const hours = map(split(f[1], ','), (x) => +x);
	const dow = (f[4] == '*') ? null : +f[4];
	now ??= time();
	// whole minutes ahead, at most a week and a day (ucode's wday is 1-7 from
	// Monday, cron's 0-6 from Sunday)
	for (let t = now - (now % 60) + 60; t < now + 8 * 86400; t += 60) {
		const tm = localtime(t);
		if (tm.min == mi && index(hours, tm.hour) >= 0 && (dow == null || tm.wday % 7 == dow))
			return t;
		// jump to the next whole hour while the minute can't match
		if (tm.min != mi)
			t += ((mi - tm.min + 60) % 60 - 1) * 60;
	}
	return null;
};

// banIP's rules, by the set they match: { set: { in, out, in_packets,
// out_packets, ports, verdict } } (in: the inbound chain, out: the outbound;
// packets only count with ban_nftcount)
export function set_rules() {
	const out = {};
	for (let chain in [ '_inbound', '_outbound' ]) {
		let j = null;
		try {
			j = json(cmd(`nft -t -j list chain inet banIP ${chain}`) || 'null');
		}
		catch (e) {
			j = null;
		}
		for (let x in j?.nftables ?? []) {
			const r = x.rule;
			if (!r)
				continue;
			let set = null, packets = null, verdict = null, ports = null, invert = false;
			for (let e in r.expr ?? []) {
				if (type(e.match?.right) == 'string' && substr(e.match.right, 0, 1) == '@') {
					set = substr(e.match.right, 1);
					invert = e.match.op == '!=';
				}
				if (e.match?.left?.payload?.field == 'dport' || e.match?.left?.th?.field == 'dport') {
					const r_ = e.match.right;
					ports = (type(r_) == 'object' && r_.set) ? join(' ', map(r_.set, (p) => (type(p) == 'object' && p.range) ? join('-', p.range) : `${p}`)) : `${r_}`;
				}
				if (e.counter)
					packets = e.counter.packets;
				if (exists(e, 'accept'))
					verdict = 'accept';
				if (exists(e, 'drop'))
					verdict = 'drop';
				if (e.goto?.target == '_reject' || exists(e, 'reject'))
					verdict = 'reject';
			}
			if (!set || !verdict)
				continue;
			const s = out[set] ??= { in: false, out: false, in_packets: null, out_packets: null, ports: null, verdict: null };
			const k = (chain == '_inbound') ? 'in' : 'out';
			s[k] = true;
			s[`${k}_packets`] = (s[`${k}_packets`] ?? 0) + (packets ?? 0);
			if (packets == null)
				s[`${k}_packets`] = null;
			s.verdict = invert ? 'allow-only' : verdict;
			if (ports)
				s.ports = ports;
		}
	}
	return out;
};

// the feed a set belongs to: "debl.v4" → "debl", "country.de.v4" → "country"
export function feed_of(set) {
	return split(set, '.')[0];
};
