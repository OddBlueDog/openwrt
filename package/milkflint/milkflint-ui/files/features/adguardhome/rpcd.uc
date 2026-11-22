// rpcd plugin for the "adguardhome" feature (ubus milkflint.adguardhome):
// AdGuard Home's state for its page and the Dashboard, its first settings,
// on and off, its sign-in (MilkFlint's router login or its own password),
// putting back the settings the DNS chain needs, and its updates from
// MilkFlint's package feed. The filtering itself is set in AdGuard Home's own
// web interface. Shared code: bin/adguardhome.uc.
'use strict';

import { readfile, writefile, access, mkdir, unlink, lsdir, stat } from 'fs';
import { cursor } from 'uci';
import * as agh from '/usr/libexec/milkflint/adguardhome.uc';

const PAUSE = '/var/run/milkflint/adguardhome.pause';
const UPDATE = '/var/run/milkflint/adguardhome-update.json';
const UPDATER = '/usr/libexec/milkflint/adguardhome-update';
// its own pid file: start-stop-daemon would otherwise take the monitor (also
// ucode) for it already running
const UPDATE_PID = '/var/run/milkflint/adguardhome-update.pid';
const LICENSES = '/licenses/adguardhome/';

const USER = /^[A-Za-z0-9._@-]{1,64}$/;

// AdGuard Home's /control/stats reply, kept 15 s: the page polls every 5 s and
// Home every 30 s, and each reading of it adds up its whole window
let stats_raw = null, stats_at = 0;

function running_pid() {
	for (let p in lsdir('/proc') ?? [])
		if (match(p, /^[0-9]+$/) && trim(readfile(`/proc/${p}/comm`) ?? '') == 'AdGuardHome')
			return +p;
	return null;
}

function memory_kb(pid) {
	const m = match(readfile(`/proc/${pid}/status`) ?? '', /VmRSS:[ \t]*([0-9]+)/);
	return m ? +m[1] : null;
}

function procd_running() {
	const svc = agh.ubus_call('service', 'list', { name: 'adguardhome' });
	for (let name, inst in svc?.adguardhome?.instances ?? {})
		if (inst.running)
			return true;
	return false;
}

function enabled() {
	return cursor().get('adguardhome', 'config', 'enabled') == '1';
}

// its statistics: one reply for every caller within 15 s
function stats_reply() {
	if (stats_raw && time() - stats_at < 15)
		return stats_raw;
	const s = agh.api('GET', '/control/stats');
	if (type(s) != 'object')
		return null;
	stats_raw = s;
	stats_at = time();
	return stats_raw;
}

// what it blocked in a list (or one slot of its series): filters, safe
// browsing and parental control
const blocked_of = (s) => (s.num_blocked_filtering ?? 0) + (s.num_replaced_safebrowsing ?? 0) + (s.num_replaced_parental ?? 0);

// lookups in its statistics' window (24 hours), and how many it blocked
function stats() {
	const s = stats_reply();
	if (s == null)
		return null;
	return {
		queries: s.num_dns_queries ?? 0,
		blocked: blocked_of(s),
		hours: (s.time_units == 'days') ? length(s.dns_queries ?? []) * 24 : length(s.dns_queries ?? []),
		avg_ms: (s.avg_processing_time != null) ? int(s.avg_processing_time * 100000 + 0.5) / 100.0 : null
	};
}

// a top list as it gives it ([ { "example.com": 12 }, ... ], most first):
// the first `n`, as { name, count }
function top_of(list, n) {
	const out = [];
	for (let e in (type(list) == 'array') ? list : []) {
		if (length(out) >= n)
			break;
		for (let k, v in (type(e) == 'object') ? e : {}) {
			if (type(k) == 'string' && k != '' && type(v) == 'int')
				push(out, { name: substr(k, 0, 253), count: v });
			break;
		}
	}
	return out;
}

// a series' numbers (lookups, or blocked, per hour or day), oldest first
function series_of(list) {
	return map((type(list) == 'array') ? list : [], (v) => (type(v) == 'int') ? v : 0);
}

// what its own dashboard shows most: the names asked for and blocked most,
// the devices asking most, and lookups and blocks per hour (or per day, for a
// window over a few days), from the same reply as stats()
function insights() {
	const s = stats_reply();
	if (s == null)
		return null;
	const queries = series_of(s.dns_queries);
	const f = series_of(s.blocked_filtering), sb = series_of(s.replaced_safebrowsing), pc = series_of(s.replaced_parental);
	const blocked = [];
	for (let i = 0; i < length(queries); i++)
		push(blocked, (f[i] ?? 0) + (sb[i] ?? 0) + (pc[i] ?? 0));
	return {
		at: stats_at,
		unit: (s.time_units == 'days') ? 'days' : 'hours',
		queries,
		blocked,
		total: s.num_dns_queries ?? 0,
		total_blocked: blocked_of(s),
		top_queried: top_of(s.top_queried_domains, 10),
		top_blocked: top_of(s.top_blocked_domains, 10),
		top_clients: top_of(s.top_clients, 10)
	};
}

// the networks whose devices it can tell apart, by subnet (for clients and
// rules in its own web interface): the home network, the guest networks,
// Remote access
function networks() {
	const c = cursor();
	const inside = {};
	c.foreach('firewall', 'zone', (z) => {
		if (z.masq == '1' || z.enabled == '0')
			return;
		for (let n in (type(z.network) == 'array') ? z.network : (z.network ? [ z.network ] : []))
			inside[n] = z.name;
	});
	const out = [];
	for (let i in agh.ubus_call('network.interface', 'dump')?.interface ?? []) {
		if (!inside[i.interface] || !i.up)
			continue;
		const v4 = map(i['ipv4-address'] ?? [], (a) => `${a.address}/${a.mask}`);
		const v6 = [];
		for (let p in i['ipv6-prefix-assignment'] ?? [])
			push(v6, `${p.address}/${p.mask}`);
		push(out, { interface: i.interface, zone: inside[i.interface], ipv4: v4, ipv6: v6 });
	}
	return out;
}

function update_info() {
	try {
		return json(readfile(UPDATE) ?? 'null');
	}
	catch (e) {
		return null;
	}
}

function pause(on) {
	mkdir('/var/run/milkflint', 0o755);
	if (on) {
		agh.write_atomic(PAUSE, `${time() + 180}`, 0o644);
		system('nft delete table inet milkflint_adguardhome 2>/dev/null');
		// Clear any prior "active" state at once so callers don't read a stale
		// state before the monitor's next 500 ms tick.
		const cur = agh.read_state() ?? {};
		agh.write_atomic(agh.STATE, sprintf('%J', { ...cur, state: 'starting', reason: 'restarting', answered: false, since: time(), checked: time() }), 0o644);
	}
	else {
		// Leave PAUSE set for one second so the monitor's 500 ms loop is sure
		// to see it, reset answered = false, and avoid falsely entering
		// blocking mode while AdGuard Home is still starting back up.
		agh.write_atomic(PAUSE, `${time() + 1}`, 0o644);
	}
}

function save_config(text) {
	mkdir('/etc/adguardhome', 0o700);
	if (!agh.write_atomic(agh.CONFIG, text, 0o600))
		return false;
	system(`chown -R adguardhome:adguardhome /etc/adguardhome`);
	return true;
}

// MilkFlint's own account's password (root only), made the first time
function api_key(make) {
	let key = trim(readfile(agh.KEY) ?? '');
	if (key == '' && make) {
		key = agh.random_token(32);
		mkdir('/etc/milkflint', 0o755);
		agh.write_atomic(agh.KEY, `${key}\n`, 0o600);
		unlink(agh.COOKIE);
	}
	return (key == '') ? null : key;
}

// AdGuard Home stopped (the monitor's redirect off meanwhile: dnsmasq
// answers) while `fn` changes its settings, then started again
function with_stopped(fn) {
	pause(true);
	const was = procd_running();
	system('/etc/init.d/adguardhome stop');
	const r = fn();
	if (was || enabled())
		system('/etc/init.d/adguardhome start');
	pause(false);
	unlink(agh.COOKIE);
	return r;
}

function start_all() {
	system('/etc/init.d/adguardhome enable; /etc/init.d/adguardhome start');
	system('/etc/init.d/milkflint-adguardhome enable; /etc/init.d/milkflint-adguardhome restart');
}

function set_enabled(on) {
	const c = cursor();
	c.set('adguardhome', 'config', 'enabled', on ? '1' : '0');
	c.commit('adguardhome');
	if (on) {
		start_all();
	}
	else {
		// the redirect goes first, so no lookup waits on it
		system('/etc/init.d/milkflint-adguardhome stop');
		system('/etc/init.d/adguardhome stop; /etc/init.d/adguardhome disable');
	}
}

function set_router_login_uci(on) {
	const c = cursor();
	if (c.get('milkflint', 'adguardhome') == null)
		c.set('milkflint', 'adguardhome', 'adguardhome');
	c.set('milkflint', 'adguardhome', 'router_login', on ? '1' : '0');
	c.commit('milkflint');
}

// Keep OPEN_DIR small: remove expired handoff tokens, and if too many are
// pending at once, drop the oldest so repeated calls can't fill /var/run.
function sweep_open() {
	const now = time();
	const live = [];
	for (let name in lsdir(agh.OPEN_DIR) ?? []) {
		const path = `${agh.OPEN_DIR}/${name}`;
		const st = stat(path);
		if (!st || st.type != 'file' || now - st.mtime > agh.OPEN_TTL_S || st.mtime > now + 60)
			unlink(path);
		else
			push(live, { path, mtime: st.mtime });
	}
	if (length(live) >= 16) {
		sort(live, (a, b) => a.mtime - b.mtime);
		for (let i = 0; i <= length(live) - 16; i++)
			unlink(live[i].path);
	}
}

function check_password(user, password) {
	if (type(user) != 'string' || !match(user, USER) || user == agh.API_USER)
		return 'user';
	if (type(password) != 'string' || length(password) < 8 || length(password) > 72 || match(password, /[\r\n]/))
		return 'password';
	return null;
}

return {
	'milkflint.adguardhome': {
		status: {
			call: function() {
				const installed = agh.installed();
				if (!installed)
					return { installed: false };
				const text = readfile(agh.CONFIG);
				const tree = text ? agh.yaml_parse(text) : null;
				const users = filter(map(agh.value(tree, 'users') ?? [], (u) => u?.name), (n) => n != null && n != agh.API_USER);
				const pid = running_pid();
				const on = enabled();
				const rlogin = agh.uses_router_login();
				const monitor = agh.read_state();
				const running = procd_running() && pid != null;
				const st = (on && running) ? stats() : null;
				return {
					installed: true,
					enabled: on,
					configured: text != null,
					mode: agh.router_mode(),
					running,
					pid,
					memory_kb: pid ? memory_kb(pid) : null,
					version: agh.package_version(),
					router_login: rlogin,
					user: users[0] ?? null,
					url: `http://${agh.web_address()}/`,
					dns_port: agh.DNS_PORT,
					// starting / active / fallback, and why (from the monitor)
					state: on ? (monitor?.state ?? 'starting') : 'off',
					reason: monitor?.reason ?? null,
					since: monitor?.since ?? null,
					checked: monitor?.checked ?? null,
					redirect: { home: monitor?.home ?? [], intercept: monitor?.intercept ?? [] },
					// once it has answered, lookups while it doesn't: answered
					// unfiltered (true) or left to fail (false)
					fallback: agh.falls_back(),
					stats: st,
					settings: text ? agh.check_settings(tree, agh.web_address(), rlogin) : [],
					networks: networks(),
					update: update_info(),
					licenses: {
						license: `${LICENSES}LICENSE.txt`,
						notices: access(`/www${LICENSES}THIRD-PARTY-NOTICES.txt`) ? `${LICENSES}THIRD-PARTY-NOTICES.txt` : null
					}
				};
			}
		},

		// what it's seeing (insights()), for its page: from the reply status
		// reads too, so asking adds nothing for AdGuard Home to work out
		insights: {
			call: function() {
				if (!agh.installed())
					return { running: false, error: 'not_installed' };
				if (!enabled() || running_pid() == null)
					return { running: false };
				const i = insights();
				return (i == null) ? { running: true, error: 'stats' } : { running: true, ...i };
			}
		},

		// The first time: AdGuard Home's settings (yaml_config), with MilkFlint's
		// router login (router_login: true, no separate password) or the page's
		// user name and password, plus MilkFlint's own account; then on.
		// Settings already there (kept by an upgrade, say): only on.
		setup: {
			args: { user: '', password: '', router_login: false },
			call: function(req) {
				if (!agh.installed())
					return { error: 'not_installed' };
				if (agh.router_mode() == 'ap')
					return { error: 'access_point' };
				if (readfile(agh.CONFIG) == null) {
					const use_router = req.args.router_login == true;
					let user = null, hash = null;
					if (!use_router) {
						const bad = check_password(req.args.user, req.args.password);
						if (bad)
							return { error: bad };
						user = req.args.user;
						hash = agh.bcrypt(req.args.password);
						if (!hash)
							return { error: 'hash' };
					}
					const api_hash = agh.bcrypt(api_key(true));
					if (!api_hash)
						return { error: 'hash' };
					if (!save_config(agh.yaml_config({ user, hash, api_hash, address: agh.web_address() })))
						return { error: 'write' };
					set_router_login_uci(use_router);
				}
				set_enabled(true);
				return { ok: true };
			}
		},

		// What devices' lookups do while it isn't answering (agh.falls_back):
		// the monitor reads it again at once (its init's reload: SIGHUP)
		fallback: {
			args: { on: false },
			call: function(req) {
				if (type(req.args.on) != 'bool')
					return { error: 'on' };
				const c = cursor();
				if (c.get('milkflint', 'adguardhome') == null)
					c.set('milkflint', 'adguardhome', 'adguardhome');
				c.set('milkflint', 'adguardhome', 'fallback', req.args.on ? '1' : '0');
				c.commit('milkflint');
				system('/etc/init.d/milkflint-adguardhome reload');
				return { ok: true };
			}
		},

		enable: {
			args: { on: false },
			call: function(req) {
				if (!agh.installed())
					return { error: 'not_installed' };
				if (req.args.on && readfile(agh.CONFIG) == null)
					return { error: 'not_configured' };
				if (req.args.on && agh.router_mode() == 'ap')
					return { error: 'access_point' };
				set_enabled(!!req.args.on);
				return { ok: true };
			}
		},

		// its user name and password (turns off router login, drops every
		// other account but MilkFlint's own, and clears old sessions)
		credentials: {
			args: { user: '', password: '' },
			call: function(req) {
				const bad = check_password(req.args.user, req.args.password);
				if (bad)
					return { error: bad };
				const text = readfile(agh.CONFIG);
				if (text == null)
					return { error: 'not_configured' };
				const hash = agh.bcrypt(req.args.password);
				const api_hash = agh.bcrypt(api_key(true));
				if (!hash || !api_hash)
					return { error: 'hash' };
				return with_stopped(() => {
					// read again: it may have written its settings as it stopped
					const now = readfile(agh.CONFIG) ?? text;
					if (!save_config(agh.set_users(now, req.args.user, hash, api_hash)))
						return { error: 'write' };
					agh.clear_sessions();
					set_router_login_uci(false);
					return { ok: true };
				});
			}
		},

		// Switch to MilkFlint's router login: drops the separate account,
		// keeps only MilkFlint's random-key account, and revokes old sessions.
		// Turning it off goes through `credentials` so a password is always set.
		router_login: {
			args: { on: false },
			call: function(req) {
				if (type(req.args.on) != 'bool')
					return { error: 'on' };
				if (!req.args.on)
					return { error: 'password' };
				const text = readfile(agh.CONFIG);
				if (text == null)
					return { error: 'not_configured' };
				const api_hash = agh.bcrypt(api_key(true));
				if (!api_hash)
					return { error: 'hash' };
				return with_stopped(() => {
					const now = readfile(agh.CONFIG) ?? text;
					if (!save_config(agh.set_users(now, null, null, api_hash)))
						return { error: 'write' };
					agh.clear_sessions();
					set_router_login_uci(true);
					return { ok: true };
				});
			}
		},

		// One-time 30 s handoff token for /cgi-bin/milkflint-adguardhome, which
		// sets AdGuard Home's HttpOnly session cookie without exposing it to JS.
		// Only allowed when router login is on and the caller has an admin session.
		open: {
			call: function() {
				if (!agh.installed())
					return { error: 'not_installed' };
				if (!agh.uses_router_login())
					return { error: 'router_login_off' };
				if (!enabled() || running_pid() == null)
					return { error: 'not_running' };
				const session = agh.open_session(5);
				if (!session)
					return { error: 'login' };
				mkdir('/var/run/milkflint', 0o755);
				mkdir(agh.OPEN_DIR, 0o700);
				sweep_open();
				const token = agh.random_token(32);
				if (length(token) != 32 || !agh.write_atomic(`${agh.OPEN_DIR}/${token}`, `${session}\n`, 0o600))
					return { error: 'write' };
				return { ok: true, token };
			}
		},

		// the chain's settings put back as MilkFlint needs them (see
		// check_settings), with AdGuard Home stopped meanwhile
		repair: {
			call: function() {
				if (readfile(agh.CONFIG) == null)
					return { error: 'not_configured' };
				return with_stopped(() => {
					const text = readfile(agh.CONFIG);
					const rlogin = agh.uses_router_login();
					const fixes = agh.check_settings(agh.yaml_parse(text), agh.web_address(), rlogin);
					const api_hash = length(filter(fixes, (f) => f.key == 'users.api')) ? agh.bcrypt(api_key(true)) : null;
					const fixed = agh.repair_settings(text, fixes, api_hash);
					if (!save_config(fixed))
						return { error: 'write' };
					const left = agh.check_settings(agh.yaml_parse(fixed), agh.web_address(), rlogin);
					return { ok: true, left: map(filter(left, (f) => f.breaks), (f) => f.key) };
				});
			}
		},

		// the versions MilkFlint's package feed has, in the background
		update_check: {
			call: function() {
				if (!agh.installed())
					return { error: 'not_installed' };
				system(`start-stop-daemon -S -b -m -p ${UPDATE_PID} -x /usr/bin/ucode -- ${UPDATER} check`);
				return { ok: true };
			}
		},

		// that version installed from it ('' for the newest), in the background;
		// AdGuard Home restarts on it (the monitor's redirect off meanwhile)
		update: {
			args: { version: '' },
			call: function(req) {
				const v = req.args.version ?? '';
				if (type(v) != 'string' || (v != '' && !match(v, /^[0-9][0-9a-z.]*-r[0-9]+$/)))
					return { error: 'version' };
				if (update_info()?.busy)
					return { error: 'busy' };
				system(`start-stop-daemon -S -b -m -p ${UPDATE_PID} -x /usr/bin/ucode -- ${UPDATER} install ${agh.sh_quote(v)}`);
				return { ok: true };
			}
		}
	}
};
