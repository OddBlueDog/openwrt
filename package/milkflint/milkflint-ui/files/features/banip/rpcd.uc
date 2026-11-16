// rpcd plugin for the "banip" feature (ubus milkflint.banip): banIP's state
// for its page and the Dashboard (cheap enough to poll: files only, and one
// nft call), its settings (each value checked against banIP's own,
// bin/banip-options.json; a feed selection the router hasn't the memory for,
// allowlist-only mode with nothing allowed, and blocklist entries that would
// reach this browser, the router's own networks, its gateway, DNS or time
// servers or package feed, are refused), its runs (one at a time, after a
// run in progress: bin/banip-action), its allowlist and blocklist (the file
// and the loaded sets at once), the page's own feeds (banIP's custom feed
// file), searching its sets, a set's contents (paged), its report, the drops
// MilkFlint's monitor keeps, an address's registry record (RDAP), ending a
// blocked address's open connections (conntrack), and the extra packages and
// mail settings for it. Shared code: bin/banip.uc.
'use strict';

import { readfile, writefile, access, mkdir, unlink, lsdir, stat, popen, open } from 'fs';
import { connect } from 'ubus';
import { cursor } from 'uci';
import * as b from '/usr/libexec/milkflint/banip.uc';

const ACTION = '/usr/libexec/milkflint/banip-action';
const INSTALLER = '/usr/libexec/milkflint/banip-install';
const MSMTPRC = '/etc/msmtprc';
const REPLY = 900 * 1024;
// the license texts the image carries (features/banip/licenses, gawk's package), served at /licenses/
const LICENSES = '/www/licenses';

// banIP's package version, read again only when apk's database changes (an
// upgrade from a package feed, without a restart of rpcd)
const APK_DB = '/lib/apk/db/installed';
let version_cache = null;

function package_version() {
	const mtime = stat(APK_DB)?.mtime ?? null;
	if (version_cache?.mtime !== mtime)
		version_cache = { mtime, version: b.package_version() };
	return version_cache.version;
}

const ok = (x) => ({ ok: true, ...(x ?? {}) });
const fail = (error, x) => ({ error, ...(x ?? {}) });
const str = (v, max) => type(v) == 'string' && length(v) <= (max ?? 4096);

function background(action) {
	system(`${ACTION} ${action} > /dev/null 2>&1 &`);
}

function service_running() {
	const svc = connect()?.call('service', 'list', { name: 'banip' });
	for (let name, inst in svc?.banip?.instances ?? {})
		if (inst.running)
			return true;
	return false;
}

function monitor_running() {
	const svc = connect()?.call('service', 'list', { name: 'milkflint-banip' });
	return svc?.['milkflint-banip']?.instances?.monitor?.running == true;
}

// "31 641 (chains: 7, sets: 15, rules: 59)"
function counts(s) {
	const m = match(s ?? '', /^([0-9 ]+)( \(chains: ([0-9]+), sets: ([0-9]+), rules: ([0-9]+)\))?/);
	return m ? { elements: +replace(m[1], / /g, ''), chains: +(m[3] ?? 0), sets: +(m[4] ?? 0), rules: +(m[5] ?? 0) } : null;
}

// "key: value, key: value" (banIP's runtime strings)
function pairs(s) {
	const out = {};
	for (let p in split(s ?? '', ', ')) {
		const i = index(p, ': ');
		if (i > 0)
			out[substr(p, 0, i)] = substr(p, i + 2);
	}
	return out;
}

function seconds(d) {
	const m = match(d ?? '', /^([0-9]+)m ([0-9]+)s$/);
	return m ? +m[1] * 60 + +m[2] : null;
}

function runtime_info() {
	const rt = b.runtime();
	if (!rt)
		return null;
	const last = pairs(rt.last_run);
	const nft = pairs(rt.nft_info);
	const sys = pairs(rt.system_info);
	const listed = (a) => filter(a ?? [], (x) => x != '-');
	return {
		status: rt.status,
		version: rt.backend_ver,
		counts: counts(rt.element_count),
		sets: listed(rt.active_feeds),
		devices: listed(rt.wan_devices),
		interfaces: listed(rt.wan_interfaces),
		triggers: listed(rt.trigger_interfaces),
		vlan_allow: listed(rt.vlan_allow),
		vlan_block: listed(rt.vlan_block),
		uplink: listed(rt.active_uplink),
		nft: { version: nft.ver, priority: nft.priority, policy: nft.policy, loglevel: nft.loglevel, expiry: nft.expiry, limits: nft['limit (icmp/syn/udp)'], loglimit: nft['loglimit (rate/burst)'] },
		flags: rt.run_flags,
		dirs: rt.run_info,
		last: (rt.last_run == '-' || rt.last_run == null) ? null : { mode: last.mode, at: last['date / time'], duration: seconds(last.duration), memory: last.memory },
		system: { cores: +(sys.cores ?? 0), log: sys.log, fetch: sys.fetch }
	};
}

// banIP's sets loaded now (names only)
function loaded_sets() {
	return map(b.sets(), (s) => s.name);
}

// a run's progress: the lists it has done of those it has to do. A start
// makes its table again, so its sets appear as they load; a reload keeps them,
// and writes each list's backup as it downloads it.
function progress(c, run) {
	const o = b.current(c);
	const fams = [];
	if (o.ban_protov4 == '1')
		push(fams, 'v4');
	if (o.ban_protov6 == '1')
		push(fams, 'v6');
	const cat = {};
	for (let f in b.catalogue().feeds)
		cat[f.name] = f;
	let expected = 0;
	for (let f in o.ban_feed) {
		const x = cat[f];
		if (!x)
			continue;
		for (let v in fams)
			if (x[`url_${substr(v, 1)}`])
				expected++;
	}
	let done = 0;
	if (run.action == 'reload') {
		const dir = c.get('banip', 'global', 'ban_backupdir') ?? '/tmp/banIP-backup';
		for (let n in lsdir(dir) ?? [])
			if (match(n, /^banIP\.[a-z0-9]+(\.[a-z0-9]+)?\.v[46]\.gz$/) && !match(n, /^banIP\.(allowlist|blocklist)\./) && (stat(`${dir}/${n}`)?.mtime ?? 0) >= run.started)
				done++;
	}
	else
		for (let s in loaded_sets())
			if (!match(s, /^(allowlist|blocklist)\./) && s != 'syn_flood_v4' && s != 'syn_flood_v6')
				done++;
	return { done: min(done, expected), expected };
}

function sum(a, from) {
	let n = 0;
	for (let i = max(0, length(a ?? []) - from); i < length(a ?? []); i++)
		n += a[i];
	return n;
}

function schedule(c) {
	const s = c.get('milkflint', 'banip', 'schedule') ?? 'daily';
	const t = c.get('milkflint', 'banip', 'time') ?? '04:00';
	const d = c.get('milkflint', 'banip', 'day') ?? '0';
	return { schedule: s, time: t, day: +d, next: b.next_update(s, t, d) };
}

function as_codes(c) {
	const feeds = b.as_list(c.get('banip', 'global', 'ban_feed'));
	if (index(feeds, 'country') < 0)
		return [];
	const out = b.as_list(c.get('banip', 'global', 'ban_country'));
	const regions = b.as_list(c.get('banip', 'global', 'ban_region'));
	if (length(regions))
		for (let x in b.countries())
			if (index(regions, x.region) >= 0 && index(out, x.code) < 0)
				push(out, x.code);
	return out;
}

function status() {
	if (!b.installed())
		return { installed: false };
	const c = cursor();
	const enabled = c.get('banip', 'global', 'ban_enabled') == '1';
	const mode = b.router_mode(c);
	const rt = runtime_info();
	const st = b.read_state() ?? {};
	const loaded = b.table_loaded();
	const running = service_running();
	const version = package_version();
	let state;
	if (!enabled)
		state = 'off';
	else if (mode == 'ap')
		state = 'ap';
	else if (rt?.status == 'processing' || st.run)
		state = 'updating';
	else if (rt?.status == 'error' || st.last?.ok === false)
		state = 'error';
	else if (loaded && running)
		state = 'protecting';
	else if (rt?.status == 'active' && !loaded)
		state = 'error';
	else
		state = running ? 'updating' : 'stopped';
	const reason = (state == 'error') ? (st.last?.error ?? st.error?.message ?? ((rt?.status == 'active' && !loaded) ? 'table_missing' : null)) : null;
	const series = st.series ?? {};
	const counting = c.get('banip', 'global', 'ban_nftcount') == '1';
	const run = st.run ? { ...st.run, ...progress(c, st.run) } : null;
	const feeds = uniq(filter(map(rt?.sets ?? [], (s) => b.feed_of(s)), (f) => f != 'allowlist' && f != 'blocklist'));
	return {
		installed: true,
		version,
		// linked from the page when this image carries them (0.81a and earlier don't)
		licenses: {
			banip: access(`${LICENSES}/banip/COPYING`) ? '/licenses/banip/COPYING' : null,
			gawk: access(`${LICENSES}/gawk/COPYING`) ? '/licenses/gawk/COPYING' : null
		},
		enabled,
		mode,
		state,
		reason,
		table: loaded,
		service: running,
		monitor: monitor_running(),
		elements: rt?.counts?.elements ?? null,
		feeds,
		countries: as_codes(c),
		run,
		last: st.last ?? null,
		last_run: rt?.last ?? null,
		schedule: schedule(c),
		counting,
		logging: { inbound: c.get('banip', 'global', 'ban_loginbound') == '1', outbound: c.get('banip', 'global', 'ban_logoutbound') == '1' },
		drops: {
			step: series.step ?? 300,
			end: series.end ?? null,
			counted: series.counted ?? [],
			logged: series.logged ?? [],
			flood: series.flood ?? [],
			hour: sum(counting ? series.counted : series.logged, 12),
			day: sum(counting ? series.counted : series.logged, 288),
			source: counting ? 'counters' : 'log'
		},
		autoblocked: st.events?.autoblocked ?? 0,
		memory: b.meminfo(),
		now: time()
	};
}


// ---- the report ---------------------------------------------------------------------

function report_file(c) {
	return `${c.get('banip', 'global', 'ban_reportdir') ?? '/tmp/banIP-report'}/ban_report.jsn`;
}

function read_report(c) {
	const r = b.read_json(report_file(c));
	return (type(r) == 'object' && type(r.sets) == 'object') ? r : null;
}

// entries per set, from banIP's last report: { 'debl.v4': n }
function known_counts(c) {
	const out = {};
	for (let k, v in read_report(c)?.sets ?? {})
		out[k] = +(v.cnt_elements ?? 0);
	return out;
}

// ---- settings -----------------------------------------------------------------------

function ctx_for() {
	const feeds = {};
	for (let f in b.catalogue().feeds)
		feeds[f.name] = true;
	const countries = {};
	for (let x in b.countries())
		countries[x.code] = x.region;
	return { feeds, countries };
}

// the country codes a selection blocks: the chosen ones and their regions'
function expand(o, ctx) {
	const out = [ ...(o.ban_country ?? []) ];
	for (let code, region in ctx.countries)
		if (index(o.ban_region ?? [], region) >= 0 && index(out, code) < 0)
			push(out, code);
	return out;
}

function selection(o, ctx) {
	return {
		feeds: o.ban_feed ?? [],
		countries: expand(o, ctx),
		asns: o.ban_asn ?? [],
		counters: o.ban_nftcount == '1',
		split: +(o.ban_splitsize ?? 0),
		cores: o.ban_cores ? +o.ban_cores : null,
		v4: o.ban_protov4 != '0' || o.ban_autodetect != '0',
		v6: o.ban_protov6 != '0' || o.ban_autodetect != '0'
	};
}

// the allowlist's own entries: not MilkFlint's, not banIP's uplink lines
function own_allowed() {
	let n = 0;
	for (let e in b.parse_list(readfile(b.LISTS.allowlist) ?? ''))
		if (index([ 'v4', 'v6', 'mac', 'domain' ], e.kind) >= 0 && index(e.comment ?? '', b.MANAGED) != 0 && !match(e.comment ?? '', /^uplink added on /))
			n++;
	return n;
}

function config() {
	if (!b.installed())
		return { installed: false };
	const c = cursor();
	const cat = b.catalogue();
	const own = b.own_feeds();
	const mem = b.meminfo();
	const mf = {};
	for (let k, o in b.spec().milkflint)
		mf[k] = c.get('milkflint', 'banip', k) ?? o.default;
	const radios = [];
	c.foreach('wireless', 'wifi-device', (s) => {
		if (s.country)
			push(radios, lc(s.country));
	});
	return {
		installed: true,
		options: b.current(c),
		milkflint: mf,
		managed: {
			ports: b.as_list(c.get('milkflint', 'banip', 'managed_ports')),
			udp: c.get('milkflint', 'banip', 'managed_udp') == '1',
			wireguard: b.wireguard_ports(c)
		},
		catalogue: cat.feeds,
		custom: { state: cat.state, loads: cat.custom_loads, own: keys(own.feeds) },
		countries: b.countries(),
		meta: b.meta(),
		known: known_counts(c),
		memory: mem,
		cpus: b.cpus(),
		runtime: runtime_info(),
		wifi_country: radios[0] ?? null,
		inside: b.inside_networks(c),
		tools: {
			msmtp: access('/usr/bin/msmtp', 'x') == true,
			conntrack: access('/usr/sbin/conntrack', 'x') == true,
			curl: access('/usr/bin/curl', 'x') == true,
			wget: access('/usr/libexec/wget-ssl', 'x') == true || access('/usr/bin/wget-ssl', 'x') == true
		},
		install: b.read_json(b.INSTALL),
		cgi: access('/www/cgi-bin/banip', 'x') == true,
		mode: b.router_mode(c),
		enabled: c.get('banip', 'global', 'ban_enabled') == '1'
	};
}

// Saves options (null: unset, back to banIP's default) and MilkFlint's own
// banIP settings, each checked; then banIP restarts if it's running and an
// option it builds its table from changed.
function set_options(req) {
	if (!b.installed())
		return fail('not_installed');
	const changes = req.args.options ?? {};
	const mchanges = req.args.milkflint ?? {};
	if (type(changes) != 'object' || type(mchanges) != 'object')
		return fail('args');
	if (length(changes) > 200 || length(mchanges) > 10)
		return fail('args');
	const c = cursor();
	const ctx = ctx_for();
	const spec = b.spec().options;
	const problems = [];
	for (let name, v in changes) {
		if (!spec[name] || spec[name].apply == 'own') {
			push(problems, { field: name, reason: 'not_settable' });
			continue;
		}
		if (v == null)
			continue;
		const why = b.check_value(name, v, ctx);
		if (why)
			push(problems, { field: name, reason: why });
	}
	for (let name, v in mchanges) {
		const why = b.check_milkflint(name, v);
		if (why)
			push(problems, { field: `milkflint.${name}`, reason: why });
	}
	if (length(problems))
		return fail('invalid', { problems });

	const before = b.current(c);
	const after = { ...before };
	for (let name, v in changes)
		after[name] = (v == null) ? ((spec[name].type == 'list') ? [] : null) : v;
	const same = (a, x) => sprintf('%J', a) == sprintf('%J', x);
	const changed = filter(keys(changes), (k) => !same(before[k], after[k]));

	// allowlist-only mode blocks everything the allowlist doesn't hold
	if (after.ban_allowlistonly == '1' && before.ban_allowlistonly != '1' && !own_allowed() && !length(after.ban_allowurl ?? []))
		return fail('allowlist_empty');

	// the memory the lists need, while banIP loads them, against what's free
	const sizing = [ 'ban_feed', 'ban_country', 'ban_region', 'ban_asn', 'ban_nftcount', 'ban_splitsize', 'ban_cores', 'ban_protov4', 'ban_protov6' ];
	let mem = null;
	if (length(filter(changed, (k) => index(sizing, k) >= 0))) {
		const est = b.estimate(selection(after, ctx), known_counts(c));
		const rt = runtime_info();
		const now_est = b.estimate(selection(before, ctx), known_counts(c));
		mem = b.memory_check(est, rt?.counts?.elements ?? 0, now_est.per_entry);
		if (!mem.ok)
			return fail('memory', { memory: { ...mem, kept_kb: est.kept_kb, load_kb: est.load_kb, entries: est.entries } });
	}

	for (let name in changed) {
		const v = after[name];
		if (v == null || (type(v) == 'array' && !length(v)))
			c.delete('banip', 'global', name);
		else
			c.set('banip', 'global', name, v);
	}
	if (length(changed))
		c.commit('banip');
	let mchanged = false;
	for (let name, v in mchanges) {
		if (c.get('milkflint', 'banip') == null)
			c.set('milkflint', 'banip', 'banip');
		if (c.get('milkflint', 'banip', name) != v) {
			c.set('milkflint', 'banip', name, v);
			mchanged = true;
		}
	}
	if (mchanged)
		c.commit('milkflint');

	// MilkFlint's part (the schedule's crontab, the always-allowed ports):
	// a commit from here doesn't tell procd, so its init is asked itself
	if (length(changed) || mchanged)
		system('/etc/init.d/milkflint-banip reload > /dev/null 2>&1 &');
	let action = null;
	const restart = filter(changed, (k) => spec[k].apply == 'restart');
	if (length(restart) && after.ban_enabled == '1' && b.router_mode(c) != 'ap') {
		const groups = uniq(filter(map(restart, (k) => spec[k].refetch), (g) => g != null));
		b.drop_backups(c, groups);
		background('restart');
		action = 'restart';
	}
	return ok({ action, changed, memory: mem });
}

function enable(req) {
	if (!b.installed())
		return fail('not_installed');
	const c = cursor();
	const on = req.args.on === true;
	if (on && b.router_mode(c) == 'ap')
		return fail('access_point');
	c.set('banip', 'global', 'ban_enabled', on ? '1' : '0');
	c.commit('banip');
	// banIP's init asks rpcd (rpc-sys) for its package list each time it's
	// run, and rpcd is busy with this call: it runs once the call is answered
	if (on) {
		// MilkFlint's init: banIP's start at boot, the schedule, the monitor,
		// and banIP itself (once)
		system('( /etc/init.d/milkflint-banip enable; /etc/init.d/milkflint-banip restart ) > /dev/null 2>&1 &');
	}
	else {
		// its rules go at once; its service and the rest right after
		system('nft delete table inet banIP > /dev/null 2>&1');
		system('( /etc/init.d/banip stop; nft delete table inet banIP; /etc/init.d/banip disable; /etc/init.d/milkflint-banip reload ) > /dev/null 2>&1 &');
	}
	return ok();
}

function action(req) {
	const a = req.args.name;
	if (index([ 'reload', 'restart', 'report' ], a) < 0)
		return fail('action');
	const c = cursor();
	if (a != 'report' && c.get('banip', 'global', 'ban_enabled') != '1')
		return fail('off');
	if (a != 'report' && b.router_mode(c) == 'ap')
		return fail('access_point');
	if (a == 'report' && !service_running())
		return fail('off');
	background(a);
	return ok();
}

// ---- the lists ------------------------------------------------------------------------

function list_path(list) {
	return (list == 'allowlist' || list == 'blocklist') ? b.LISTS[list] : null;
}

function list_get(req) {
	const p = list_path(req.args.list);
	if (!p)
		return fail('list');
	const text = readfile(p) ?? '';
	if (length(text) > REPLY)
		return ok({ text: '', size: length(text), too_big: true });
	return ok({ text, size: length(text), too_big: false });
}

const ADDRESS_KINDS = [ 'v4', 'v6', 'mac', 'domain' ];
const REASONS_MAX = 50;

// what a blocklist's new entries would block that mustn't be: refused
function lockout_check(entries) {
	if (!length(entries))
		return null;
	const hits = b.lockouts(entries, b.protected_addresses(cursor()));
	return length(hits) ? fail('lockout', { lockouts: slice(hits, 0, REASONS_MAX) }) : null;
}

function write_list(list, before, lines) {
	const text = length(lines) ? join('\n', lines) + '\n' : '';
	if (!b.write_atomic(list_path(list), text, 0o644))
		return null;
	return b.apply_list(list, before, b.parse_list(text));
}

function list_set(req) {
	const list = req.args.list;
	const p = list_path(list);
	if (!p)
		return fail('list');
	if (!str(req.args.text, 4 * 1024 * 1024))
		return fail('text');
	const before = b.parse_list(readfile(p) ?? '');
	const after = b.parse_list(req.args.text);
	const problems = [];
	for (let e in after)
		if (e.kind == 'invalid')
			push(problems, { line: e.line, reason: e.reason, text: substr(e.text, 0, 80) });
	if (length(problems))
		return fail('invalid', { problems: slice(problems, 0, REASONS_MAX), count: length(problems) });
	if (list == 'blocklist') {
		const had = {};
		for (let e in before)
			had[`${e.kind} ${e.value}`] = true;
		const err = lockout_check(filter(after, (e) => index(ADDRESS_KINDS, e.kind) >= 0 && !had[`${e.kind} ${e.value}`]));
		if (err)
			return err;
	}
	// banIP reads a line from its first column, the entry first
	const lines = map(after, (e) => (e.kind == 'blank') ? '' : rtrim(e.text));
	while (length(lines) && lines[-1] == '')
		pop(lines);
	const r = write_list(list, before, lines);
	if (!r)
		return fail('write');
	return ok(r);
}

// one entry in or out (the one-click actions)
function entry(req) {
	const list = req.args.list;
	const p = list_path(list);
	const op = req.args.op;
	if (!p)
		return fail('list');
	if (op != 'add' && op != 'remove')
		return fail('op');
	if (!str(req.args.value, 200) || (req.args.comment != null && !str(req.args.comment, 120)) || match(req.args.comment ?? '', /[\r\n#]/))
		return fail('value');
	const e = b.parse_entry(req.args.value);
	if (index(ADDRESS_KINDS, e.kind) < 0)
		return fail('value', { reason: e.reason ?? e.kind });
	const before = b.parse_list(readfile(p) ?? '');
	const present = filter(before, (x) => x.kind == e.kind && x.value == e.value);
	if (op == 'add') {
		if (length(present))
			return ok({ applied: false, already: true });
		if (list == 'blocklist') {
			const err = lockout_check([ e ]);
			if (err)
				return err;
		}
		const lines = [ ...map(before, (x) => x.text), b.format_entry(e.value, req.args.comment) ];
		const r = write_list(list, before, lines);
		return r ? ok(r) : fail('write');
	}
	if (!length(present))
		return ok({ applied: false, missing: true });
	const lines = map(filter(before, (x) => !(x.kind == e.kind && x.value == e.value)), (x) => x.text);
	const r = write_list(list, before, lines);
	return r ? ok(r) : fail('write');
}

// An address out of the blocklist: its lines (an entry for it, or a network
// that holds it) and the element that holds it in the loaded set (the log
// monitor's, which aren't in the file while they expire). The feeds that
// still have it are said, for "Always allow".
function unblock_addr(addr) {
	const n = b.cidr(addr);
	const before = b.parse_list(readfile(b.LISTS.blocklist) ?? '');
	const gone = filter(before, (e) => (e.kind == 'v4' || e.kind == 'v6') && b.overlaps(b.cidr(e.value), n));
	let r = { applied: false };
	if (length(gone))
		r = write_list('blocklist', before, map(filter(before, (e) => index(gone, e) < 0), (e) => e.text)) ?? r;
	const fam = (n.fam == 4) ? 'v4' : 'v6';
	const hits = b.find(addr);
	// what's left in the loaded blocklist set (the log monitor's, a network)
	const el = filter(hits, (h) => h.set == `blocklist.${fam}`)[0];
	if (el)
		b.remove_element(`blocklist.${fam}`, el.element);
	const still = uniq(map(filter(hits, (h) => !b.is_local(h.set)), (h) => h.set));
	return { removed_lines: map(gone, (e) => e.value), removed_element: el?.element ?? null, still, ...r };
}

function unblock(req) {
	if (!str(req.args.address, 64) || !b.cidr(req.args.address))
		return fail('address');
	return ok(unblock_addr(req.args.address));
}

function cmd_date() {
	const t = localtime(time());
	return sprintf('%04d-%02d-%02d %02d:%02d', t.year, t.mon, t.mday, t.hour, t.min);
}

function allow(req) {
	if (!str(req.args.address, 64) || !b.cidr(req.args.address))
		return fail('address');
	const a = req.args.address;
	const out = unblock_addr(a);
	const given = req.args.comment;
	const r = entry({ args: { list: 'allowlist', op: 'add', value: a, comment: (str(given, 120) && trim(given) != '' && !match(given, /[\r\n#]/)) ? given : `allowed on the banIP page ${cmd_date()}` } });
	if (r.error)
		return r;
	return ok({ ...out, allowed: true });
}


// ---- searching -------------------------------------------------------------------------

function search(req) {
	const q = req.args.query;
	if (!str(q, 253) || q == '')
		return fail('query');
	const query = lc(trim(q));
	let addrs = [];
	let names = null;
	const e = b.parse_entry(query);
	if (b.cidr(query))
		addrs = [ query ];
	else if (e.kind == 'domain') {
		names = b.resolve([ query ])[query] ?? [];
		addrs = names;
	}
	else if (e.kind == 'mac')
		addrs = [];
	else
		return fail('query');
	addrs = slice(addrs, 0, 16);
	const rules = b.set_rules();
	const all = b.sets();
	const lists = {};
	for (let l in [ 'allowlist', 'blocklist' ])
		lists[l] = b.parse_list(readfile(b.LISTS[l]) ?? '');
	const results = [];
	const loaded = {};
	for (let s in all)
		loaded[s.name] = true;
	for (let a in addrs) {
		const n = b.cidr(a);
		const found = [];
		// banIP's lists from their copy (only those still loaded), the
		// allowlist and blocklist as they are now
		for (let h in b.find(a)) {
			if (!loaded[h.set])
				continue;
			const r = rules[h.set] ?? {};
			push(found, { set: h.set, feed: b.feed_of(h.set), element: h.element, packets: h.copy ? null : h.packets, expires: h.expires,
				inbound: r.in ?? false, outbound: r.out ?? false, ports: r.ports ?? null, verdict: r.verdict ?? null });
		}
		const line_of = (l) => map(filter(lists[l], (x) => (x.kind == 'v4' || x.kind == 'v6') && b.overlaps(b.cidr(x.value), n)), (x) => ({ line: x.line, value: x.value, comment: x.comment }));
		push(results, { address: a, sets: found, allowlist: line_of('allowlist'), blocklist: line_of('blocklist') });
	}
	// a MAC (or a name): the lines that have it
	const text_lines = (l) => map(filter(lists[l], (x) => x.value == query || (x.kind == 'mac' && x.mac == query)), (x) => ({ line: x.line, value: x.value, comment: x.comment }));
	return ok({
		query,
		kind: e.kind,
		resolved: names,
		results,
		allowlist: text_lines('allowlist'),
		blocklist: text_lines('blocklist'),
		loaded: length(all) > 0,
		// banIP's lists copied before their last update (being copied now)
		stale: length(all) > 0 && !b.dump_fresh()
	});
}

// a set's elements, a page at a time: one of banIP's lists from its copy
// (made after each update), the allowlist's and blocklist's (and a list
// with no copy yet) listed now into a file in RAM, and paged from there
const SURVEY_TTL = 120;

function survey(req) {
	const set = req.args.set;
	if (!str(set, 64) || !match(set, /^[A-Za-z0-9_.]{1,64}$/))
		return fail('set');
	if (index(map(b.sets(), (s) => s.name), set) < 0)
		return fail('no_set');
	const offset = +(req.args.offset ?? 0), limit = +(req.args.limit ?? 100);
	if (offset < 0 || offset > 100000000 || limit < 1 || limit > 500)
		return fail('range');
	const q = req.args.filter ?? '';
	if (!str(q, 64) || !match(q, /^[0-9A-Fa-f.:\/ -]*$/))
		return fail('filter');
	const hits = req.args.hits === true;
	mkdir(b.DIR, 0o755);
	const copy = `${b.SETS_DIR}/${set}.tsv`;
	let cache = `${b.DIR}/survey-${set}.tsv`;
	if (!b.is_local(set) && stat(copy) && b.dump_fresh())
		cache = copy;
	else {
		const st = stat(cache);
		if (!st || time() - st.mtime > SURVEY_TTL || req.args.fresh === true) {
			for (let f in lsdir(b.DIR) ?? [])
				if (match(f, /^survey-/))
					unlink(`${b.DIR}/${f}`);
			const lines = b.set_lines(set);
			b.write_atomic(cache, length(lines) ? join('\n', lines) + '\n' : '', 0o644);
		}
	}
	const out = b.cmd(`awk -F '\\t' -v q=${b.sh_quote(trim(q))} -v hits=${hits ? 1 : 0} -v off=${offset} -v lim=${limit} '(q == "" || index($1, q)) && (!hits || $2 + 0 > 0) { n++; if (n > off && n <= off + lim) print } END { print "#" NR " " n + 0 }' ${b.sh_quote(cache)}`) ?? '';
	const elements = [];
	let total = 0, matched = 0;
	for (let l in split(out, '\n')) {
		const m = match(l, /^#([0-9]+) ([0-9]+)$/);
		if (m) {
			total = +m[1];
			matched = +m[2];
			continue;
		}
		const f = split(l, '\t');
		if (f[0] != '')
			push(elements, { value: f[0], packets: (f[1] != null && f[1] != '') ? +f[1] : null, expires: (f[2] != null && f[2] != '') ? f[2] : null });
	}
	return ok({ set, total, matched, offset, elements, listed: stat(cache)?.mtime ?? null });
}

// banIP's report, with the rules' counters now and the flood counters
function report(req) {
	const c = cursor();
	if (req.args.refresh === true && service_running() && !b.processing())
		background('report');
	const r = read_report(c);
	const rules = b.set_rules();
	const sets = {};
	for (let name, v in r?.sets ?? {}) {
		const live = rules[name] ?? {};
		sets[name] = {
			elements: +(v.cnt_elements ?? 0),
			inbound: v.inbound == 'ON',
			outbound: v.outbound == 'ON',
			in_packets: live.in_packets ?? ((v.cnt_inbound != '') ? +v.cnt_inbound : null),
			out_packets: live.out_packets ?? ((v.cnt_outbound != '') ? +v.cnt_outbound : null),
			ports: (v.port != '-') ? v.port : null,
			top: v.set_elements ?? []
		};
	}
	// a set loaded since the report: its rules
	for (let name, live in rules)
		if (!sets[name])
			sets[name] = { elements: null, inbound: live.in, outbound: live.out, in_packets: live.in_packets, out_packets: live.out_packets, ports: live.ports, top: [] };
	let flood = null;
	try {
		const j = json(b.cmd('nft -j list counters table inet banIP') || 'null');
		flood = {};
		for (let x in j?.nftables ?? [])
			if (x.counter && match(x.counter.name ?? '', /^cnt_/))
				flood[substr(x.counter.name, 4)] = x.counter.packets;
	}
	catch (e) {
		flood = null;
	}
	return ok({
		timestamp: r?.timestamp ?? null,
		generated: stat(report_file(c))?.mtime ?? null,
		autoadd: r ? { allow: +(r.autoadd_allow ?? 0), block: +(r.autoadd_block ?? 0) } : null,
		sets,
		flood,
		counting: c.get('banip', 'global', 'ban_nftcount') == '1'
	});
}

// ---- drops (the monitor's) ---------------------------------------------------------------

const DROP_FIELDS = [ 't', 'dir', 'kind', 'policy', 'set', 'in', 'out', 'src', 'dst', 'proto', 'sport', 'dport', 'mac' ];

function drops(req) {
	const offset = +(req.args.offset ?? 0), limit = +(req.args.limit ?? 50);
	if (offset < 0 || offset > 1000000 || limit < 1 || limit > 500)
		return fail('range');
	const f = req.args.filter ?? {};
	if (type(f) != 'object')
		return fail('filter');
	for (let k in [ 'dir', 'set', 'address', 'port', 'proto' ])
		if (f[k] != null && !str(f[k], 64))
			return fail('filter');
	const lines = [ ...split(readfile(b.DROPS_OLD) ?? '', '\n'), ...split(readfile(b.DROPS) ?? '', '\n') ];
	const rows = [];
	const tops = { src: {}, dst: {}, port: {}, set: {}, dir: {} };
	for (let i = length(lines) - 1; i >= 0; i--) {
		const x = split(lines[i], '\t');
		if (length(x) < 12)
			continue;
		const r = {};
		for (let j = 0; j < length(DROP_FIELDS); j++)
			r[DROP_FIELDS[j]] = x[j] ?? '';
		r.t = +r.t;
		if (f.dir && r.dir != f.dir)
			continue;
		if (f.set && r.set != f.set)
			continue;
		if (f.proto && r.proto != f.proto)
			continue;
		if (f.port && r.dport != f.port && r.sport != f.port)
			continue;
		if (f.address && index(r.src, f.address) != 0 && index(r.dst, f.address) != 0)
			continue;
		push(rows, r);
		const who = (r.dir == 'out') ? r.dst : r.src;
		tops.src[who] = (tops.src[who] ?? 0) + 1;
		if (r.dir == 'out')
			tops.dst[r.src] = (tops.dst[r.src] ?? 0) + 1;
		// ICMP's "ports" are its type and code: by protocol only
		const pk = match(r.proto, /^icmp/) ? r.proto : (r.dport != '') ? `${r.proto}/${r.dport}` : null;
		if (pk)
			tops.port[pk] = (tops.port[pk] ?? 0) + 1;
		if (r.set != '')
			tops.set[r.set] = (tops.set[r.set] ?? 0) + 1;
		tops.dir[r.dir] = (tops.dir[r.dir] ?? 0) + 1;
	}
	const top = (o, n) => slice(sort(map(keys(o), (k) => ({ key: k, count: o[k] })), (a, x) => x.count - a.count), 0, n);
	const events = [];
	const ev = split(readfile(b.EVENTS) ?? '', '\n');
	for (let i = length(ev) - 1; i >= 0 && length(events) < 100; i--) {
		const x = split(ev[i], '\t');
		if (length(x) >= 3)
			push(events, { t: +x[0], kind: x[1], address: x[2], set: x[3] ?? '', detail: x[4] ?? '' });
	}
	return ok({
		total: length(rows),
		offset,
		rows: slice(rows, offset, offset + limit),
		top: { sources: top(tops.src, 10), devices: top(tops.dst, 10), ports: top(tops.port, 10), sets: top(tops.set, 10), directions: tops.dir },
		first: length(rows) ? rows[-1].t : null,
		events
	});
}

// banIP's own lines in the system log (its processing log)
function log(req) {
	const n = +(req.args.lines ?? 200);
	if (n < 1 || n > 2000)
		return fail('lines');
	const out = b.cmd(`logread -e 'banIP-' | tail -n ${n}`) ?? '';
	const lines = split(out, '\n');
	let size = 0, from = length(lines);
	while (from > 0 && size + length(lines[from - 1]) < REPLY) {
		size += length(lines[from - 1]) + 1;
		from--;
	}
	return ok({ lines: filter(slice(lines, from), (l) => l != ''), truncated: from > 0 });
}

// ---- the page's own feeds ------------------------------------------------------------

function selected(c, name) {
	return index(b.as_list(c.get('banip', 'global', 'ban_feed')), name) >= 0;
}

function after_feed_change(c, names) {
	// a selected feed's list is downloaded again
	const hit = filter(names, (n) => selected(c, n));
	if (length(hit) && c.get('banip', 'global', 'ban_enabled') == '1' && service_running()) {
		b.drop_backups(c, hit);
		background('restart');
		return 'restart';
	}
	return null;
}

function feed(req) {
	const op = req.args.op;
	const c = cursor();
	const own = b.own_feeds();
	const state = b.custom_state(own);
	if (op == 'set') {
		const name = req.args.name, f = req.args.feed;
		const why = b.check_feed(name, f);
		if (why)
			return fail('invalid', { field: why });
		if (state == 'edited')
			return fail('edited');
		own.feeds[name] = f;
		mkdir('/etc/milkflint', 0o755);
		b.write_atomic(b.OWN_FEEDS, sprintf('%.J\n', own), 0o644);
		const s = b.sync_custom(true);
		return (s == 'error') ? fail('write') : ok({ action: after_feed_change(c, [ name ]) });
	}
	if (op == 'remove') {
		const name = req.args.name;
		if (!str(name, 15) || !own.feeds[name])
			return fail('name');
		if (state == 'edited')
			return fail('edited');
		delete own.feeds[name];
		b.write_atomic(b.OWN_FEEDS, sprintf('%.J\n', own), 0o644);
		const s = b.sync_custom(true);
		if (s == 'error')
			return fail('write');
		// a feed of its own gone (not banIP's): out of the selection too
		const builtin = b.builtin_feeds();
		if (!builtin[name]) {
			for (let o in [ 'ban_feed', 'ban_feedin', 'ban_feedout', 'ban_feedinout', 'ban_feedreset', 'ban_feedcomplete' ]) {
				const l = b.as_list(c.get('banip', 'global', o));
				if (index(l, name) >= 0) {
					const rest = filter(l, (x) => x != name);
					if (length(rest))
						c.set('banip', 'global', o, rest);
					else
						c.delete('banip', 'global', o);
				}
			}
			c.commit('banip');
		}
		return ok({ action: after_feed_change(c, [ name ]) });
	}
	if (op == 'import') {
		if (!str(req.args.text, 512 * 1024))
			return fail('text');
		let j = null;
		try {
			j = json(req.args.text);
		}
		catch (e) {
			return fail('json');
		}
		if (type(j) != 'object' || !length(j) || length(j) > 500)
			return fail('json');
		const builtin = b.builtin_feeds();
		const take = {};
		for (let name, f in j) {
			const why = b.check_feed(name, f);
			if (why)
				return fail('invalid', { name, field: why });
			// the same as banIP's own: not one of the page's
			if (!builtin[name] || sprintf('%J', builtin[name]) != sprintf('%J', f))
				take[name] = f;
		}
		for (let n, f in take)
			own.feeds[n] = f;
		b.write_atomic(b.OWN_FEEDS, sprintf('%.J\n', own), 0o644);
		const s = b.sync_custom(true);
		return (s == 'error') ? fail('write') : ok({ imported: keys(take), action: after_feed_change(c, keys(take)) });
	}
	if (op == 'adopt') {
		// a custom file edited elsewhere becomes the page's: its feeds that
		// differ from banIP's (or aren't banIP's)
		let j = null;
		try {
			j = json(readfile(b.CUSTOM) ?? '');
		}
		catch (e) {
			return fail('json');
		}
		if (type(j) != 'object')
			return fail('json');
		const builtin = b.builtin_feeds();
		own.feeds = {};
		for (let name, f in j)
			if (!b.check_feed(name, f) && (!builtin[name] || sprintf('%J', builtin[name]) != sprintf('%J', f)))
				own.feeds[name] = f;
		b.write_atomic(b.OWN_FEEDS, sprintf('%.J\n', own), 0o644);
		const s = b.sync_custom(true);
		return (s == 'error') ? fail('write') : ok({ own: keys(own.feeds) });
	}
	if (op == 'reset') {
		own.feeds = {};
		b.write_atomic(b.OWN_FEEDS, sprintf('%.J\n', own), 0o644);
		const s = b.sync_custom(true);
		return (s == 'error') ? fail('write') : ok();
	}
	return fail('op');
}

// A feed's URL fetched (its first 2 MB at most), and what its rule finds
// in it: does it work before it's saved
function count_rule(text, rule) {
	const parts = split(rule, ' ');
	let col = 1, sep = null, prefix = null, col2 = null;
	const a = parts[1] ?? '1';
	if (match(a, /^[0-9][0-9]$/)) {
		col = +substr(a, 0, 1);
		col2 = +substr(a, 1, 1);
		sep = parts[2];
	}
	else if (match(a, /^[0-9]$/)) {
		col = +a;
		sep = parts[2];
	}
	else {
		prefix = a;
		col = +(parts[2] ?? 1);
		sep = parts[3];
	}
	const sur = parts[0] == 'suricata';
	let v4 = 0, v6 = 0;
	const sample = [];
	for (let l in split(text, '\n')) {
		let ip = null;
		if (sur) {
			const m = match(l, /content:"(([0-9]{1,3}\.){3}[0-9]{1,3})"/);
			ip = m ? m[1] : null;
		}
		else {
			if (prefix && index(l, prefix) != 0)
				continue;
			const f = sep ? split(l, sep) : split(trim(l), /[ \t]+/);
			ip = trim(f[col - 1] ?? '');
			if (col2 && f[col2 - 1] != null)
				ip = `${ip}/${trim(f[col2 - 1])}`;
		}
		if (!ip || ip == '' || substr(ip, 0, 1) == '#')
			continue;
		const e = b.parse_entry(lc(ip));
		if (e.kind == 'v4')
			v4++;
		else if (e.kind == 'v6')
			v6++;
		else
			continue;
		if (length(sample) < 5)
			push(sample, e.value);
	}
	return { v4, v6, sample };
}

function feed_test(req) {
	const f = { url_4: req.args.url, rule: req.args.rule, descr: 'test', flag: req.args.flag };
	if (f.flag == null || f.flag == '')
		delete f.flag;
	const why = b.check_feed('test', f);
	if (why)
		return fail('invalid', { field: why });
	mkdir(b.DIR, 0o755);
	const raw = `${b.DIR}/feed-test.raw`;
	const err = `${b.DIR}/feed-test.err`;
	const gz = match(f.flag ?? '', /(^| )gz( |$)/) != null;
	const rc = system(`( uclient-fetch -q --timeout=15 -O - ${b.sh_quote(f.url_4)} 2> ${b.sh_quote(err)} ) | head -c 2097152 > ${b.sh_quote(raw)}`);
	const got = stat(raw)?.size ?? 0;
	const msg = trim(readfile(err) ?? '');
	unlink(err);
	if (!got) {
		unlink(raw);
		return ok({ reachable: false, error: substr(msg, 0, 300) || 'empty', bytes: 0 });
	}
	const text = gz ? b.cmd(`gunzip -c ${b.sh_quote(raw)} | head -c 4194304`) : readfile(raw);
	unlink(raw);
	return ok({ reachable: true, bytes: got, truncated: got >= 2097152, ...count_rule(text ?? '', f.rule), rc });
}

// ---- an address's registry record (RDAP, from the router) -------------------------

function lookup(req) {
	const a = req.args.address;
	if (!str(a, 64) || !b.cidr(a) || index(a, '/') >= 0)
		return fail('address');
	const cache = b.read_json(b.LOOKUPS) ?? {};
	const hit = cache[a];
	if (hit && time() - hit.at < 86400)
		return ok(hit);
	mkdir(b.DIR, 0o755);
	const out = b.cmd(`uclient-fetch -q --timeout=10 -O - ${b.sh_quote(`https://rdap.db.ripe.net/ip/${a}`)} | head -c 262144`);
	let j = null;
	try {
		j = json(out || 'null');
	}
	catch (e) {
		j = null;
	}
	if (type(j) != 'object')
		return fail('lookup');
	let country = j.country ?? null;
	let org = null;
	for (let e in j.entities ?? []) {
		const vc = e.vcardArray?.[1] ?? [];
		for (let f in vc)
			if (f[0] == 'fn' && !org && index(e.roles ?? [], 'registrant') >= 0)
				org = f[3];
	}
	const c0 = j.cidr0_cidrs?.[0];
	const r = {
		at: time(),
		address: a,
		network: c0 ? `${c0.v4prefix ?? c0.v6prefix}/${c0.length}` : ((j.startAddress && j.endAddress) ? `${j.startAddress}-${j.endAddress}` : null),
		name: j.name ?? null,
		country: (type(country) == 'string' && match(country, /^[A-Z]{2}$/)) ? country : null,
		org: (type(org) == 'string') ? substr(org, 0, 120) : null,
		registry: replace(j.port43 ?? '', /^whois\./, '') || null,
		handle: j.handle ?? null
	};
	cache[a] = r;
	// the newest 500
	const ks = sort(keys(cache), (x, y) => cache[y].at - cache[x].at);
	const kept = {};
	for (let k in slice(ks, 0, 500))
		kept[k] = cache[k];
	b.write_atomic(b.LOOKUPS, sprintf('%J', kept), 0o644);
	return ok(r);
}

// ---- open connections ------------------------------------------------------------------

// Ends the connections an address (or a network) has open through the
// router: conntrack deletes their entries, so their next packets are new
// ones and meet banIP's rules (an offloaded one leaves the fast path with
// its entry). Without conntrack (not in the image): says so.
function flush(req) {
	const a = req.args.address;
	const n = b.cidr(a);
	if (!str(a, 64) || !n)
		return fail('address');
	if (access('/usr/sbin/conntrack', 'x') != true)
		return fail('no_conntrack');
	const pairs_ = {};
	for (let l in split(readfile('/proc/net/nf_conntrack') ?? '', '\n')) {
		const m = match(l, /src=([0-9a-f.:]+) dst=([0-9a-f.:]+) .*src=([0-9a-f.:]+) dst=([0-9a-f.:]+)/);
		if (!m)
			continue;
		for (let i = 1; i <= 4; i++)
			if (b.overlaps(b.cidr(m[i]), n)) {
				pairs_[`${m[1]} ${m[2]}`] = true;
				break;
			}
	}
	let ended = 0;
	for (let p in keys(pairs_)) {
		const x = split(p, ' ');
		const out = b.cmd(`conntrack -D -s ${b.sh_quote(x[0])} -d ${b.sh_quote(x[1])} 2>&1`) ?? '';
		const m = match(out, /([0-9]+) flow entries have been deleted/);
		ended += m ? +m[1] : 0;
	}
	return ok({ ended, pairs: length(pairs_) });
}

// ---- packages and mail -----------------------------------------------------------------

function install(req) {
	const p = req.args.package;
	if (p != 'msmtp' && p != 'conntrack')
		return fail('package');
	if (b.read_json(b.INSTALL)?.busy && time() - (b.read_json(b.INSTALL)?.started ?? 0) < 600)
		return fail('busy');
	system(`${INSTALLER} ${p} > /dev/null 2>&1 &`);
	return ok();
}

const MAIL_BEGIN = '# milkflint-banip begin (managed by the web interface)';
const MAIL_END = '# milkflint-banip end';

function mail_block(text) {
	const out = { inside: [], outside: [] };
	let on = false;
	for (let l in split(text ?? '', '\n')) {
		if (l == MAIL_BEGIN)
			on = true;
		else if (l == MAIL_END)
			on = false;
		else
			push(on ? out.inside : out.outside, l);
	}
	return out;
}

function mail_get() {
	const c = cursor();
	const profile = c.get('banip', 'global', 'ban_mailprofile') ?? 'ban_notify';
	const blk = mail_block(readfile(MSMTPRC));
	const v = {};
	for (let l in blk.inside) {
		const m = match(l, /^([a-z_]+)[ \t]+(.*)$/);
		if (m)
			v[m[1]] = m[2];
	}
	return ok({
		installed: access('/usr/bin/msmtp', 'x') == true,
		profile,
		account: v.account ?? null,
		host: v.host ?? null,
		port: v.port ? +v.port : null,
		tls: (v.tls == 'off') ? 'off' : (v.tls_starttls == 'off') ? 'tls' : (v.tls == 'on') ? 'starttls' : null,
		user: v.user ?? null,
		from: v.from ?? null,
		password: v.password != null,
		elsewhere: length(filter(blk.outside, (l) => match(l, regexp(`^account[ \t]+${profile}([ \t]|$)`)))) > 0
	});
}

function mail_set(req) {
	const a = req.args;
	const c = cursor();
	const profile = c.get('banip', 'global', 'ban_mailprofile') ?? 'ban_notify';
	if (!str(a.host, 253) || !match(a.host, /^[A-Za-z0-9.-]{1,253}$/))
		return fail('host');
	if (type(a.port) != 'int' || a.port < 1 || a.port > 65535)
		return fail('port');
	if (index([ 'starttls', 'tls', 'off' ], a.tls) < 0)
		return fail('tls');
	if (a.user != null && a.user != '' && (!str(a.user, 128) || match(a.user, /[\s"'\\]/)))
		return fail('user');
	if (a.password != null && (!str(a.password, 128) || match(a.password, /[\r\n]/)))
		return fail('password');
	if (!str(a.from, 254) || !match(a.from, /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}$/))
		return fail('from');
	const old = readfile(MSMTPRC) ?? '';
	const blk = mail_block(old);
	// the password kept when none is given
	let pw = (a.password == null || a.password == '') ? null : a.password;
	if (pw == null)
		for (let l in blk.inside) {
			const m = match(l, /^password[ \t]+(.*)$/);
			if (m)
				pw = m[1];
		}
	const lines = [ MAIL_BEGIN, `account ${profile}`, `host ${a.host}`, `port ${a.port}`,
		'tls ' + ((a.tls == 'off') ? 'off' : 'on'), 'tls_trust_file /etc/ssl/certs/ca-certificates.crt' ];
	if (a.tls != 'off')
		push(lines, `tls_starttls ${(a.tls == 'starttls') ? 'on' : 'off'}`);
	push(lines, `from ${a.from}`);
	if (a.user != null && a.user != '') {
		push(lines, 'auth on', `user ${a.user}`);
		if (pw != null && pw != '')
			push(lines, `password ${pw}`);
	}
	else
		push(lines, 'auth off');
	push(lines, 'syslog LOG_MAIL', MAIL_END);
	const outside = blk.outside;
	while (length(outside) && outside[-1] == '')
		pop(outside);
	const text = join('\n', [ ...outside, ...(length(outside) ? [ '' ] : []), ...lines ]) + '\n';
	if (!b.write_atomic(MSMTPRC, text, 0o600))
		return fail('write');
	return ok();
}

function mail_test() {
	const c = cursor();
	if (access('/usr/bin/msmtp', 'x') != true)
		return fail('no_msmtp');
	if (!c.get('banip', 'global', 'ban_mailreceiver'))
		return fail('no_receiver');
	if (!service_running())
		return fail('off');
	system('/etc/init.d/banip report mail > /dev/null 2>&1 &');
	return ok();
}

// ---- the methods -----------------------------------------------------------------------

function guarded(fn) {
	return function(req) {
		try {
			return fn(req);
		}
		catch (e) {
			warn(`milkflint.banip: ${e.message}\n`);
			return fail('internal');
		}
	};
}

return {
	'milkflint.banip': {
		status: { call: guarded(status) },
		config: { call: guarded(config) },
		set: { args: { options: {}, milkflint: {} }, call: guarded(set_options) },
		enable: { args: { on: false }, call: guarded(enable) },
		action: { args: { name: '' }, call: guarded(action) },
		list_get: { args: { list: '' }, call: guarded(list_get) },
		list_set: { args: { list: '', text: '' }, call: guarded(list_set) },
		entry: { args: { list: '', op: '', value: '', comment: '' }, call: guarded(entry) },
		unblock: { args: { address: '' }, call: guarded(unblock) },
		allow: { args: { address: '', comment: '' }, call: guarded(allow) },
		search: { args: { query: '' }, call: guarded(search) },
		survey: { args: { set: '', offset: 0, limit: 100, filter: '', hits: false, fresh: false }, call: guarded(survey) },
		report: { args: { refresh: false }, call: guarded(report) },
		drops: { args: { offset: 0, limit: 50, filter: {} }, call: guarded(drops) },
		log: { args: { lines: 200 }, call: guarded(log) },
		feed: { args: { op: '', name: '', feed: {}, text: '' }, call: guarded(feed) },
		feed_test: { args: { url: '', rule: '', flag: '' }, call: guarded(feed_test) },
		lookup: { args: { address: '' }, call: guarded(lookup) },
		flush: { args: { address: '' }, call: guarded(flush) },
		install: { args: { package: '' }, call: guarded(install) },
		mail_get: { call: guarded(mail_get) },
		mail_set: { args: { host: '', port: 587, tls: '', user: '', password: '', from: '' }, call: guarded(mail_set) },
		mail_test: { call: guarded(mail_test) }
	}
};
