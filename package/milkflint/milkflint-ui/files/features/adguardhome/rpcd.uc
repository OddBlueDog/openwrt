// rpcd plugin for the "adguardhome" feature (ubus milkflint.adguardhome):
// AdGuard Home's state for its page and the Dashboard, its first settings,
// on and off, its password, putting back the settings the DNS chain needs,
// and its updates from MilkFlint's package feed. The filtering itself is set
// in AdGuard Home's own web interface. Shared code: bin/adguardhome.uc.
'use strict';

import { readfile, writefile, access, mkdir, unlink, lsdir, stat } from 'fs';
import { connect } from 'ubus';
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

let stats_cache = null, stats_at = 0;

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
	const svc = connect()?.call('service', 'list', { name: 'adguardhome' });
	for (let name, inst in svc?.adguardhome?.instances ?? {})
		if (inst.running)
			return true;
	return false;
}

function enabled() {
	return cursor().get('adguardhome', 'config', 'enabled') == '1';
}

// lookups in its statistics' window (24 hours), and how many it blocked
function stats() {
	if (stats_cache && time() - stats_at < 15)
		return stats_cache;
	const s = agh.api('GET', '/control/stats');
	if (type(s) != 'object')
		return null;
	stats_cache = {
		queries: s.num_dns_queries ?? 0,
		blocked: (s.num_blocked_filtering ?? 0) + (s.num_replaced_safebrowsing ?? 0) + (s.num_replaced_parental ?? 0),
		hours: (s.time_units == 'days') ? length(s.dns_queries ?? []) * 24 : length(s.dns_queries ?? []),
		avg_ms: (s.avg_processing_time != null) ? int(s.avg_processing_time * 100000 + 0.5) / 100.0 : null
	};
	stats_at = time();
	return stats_cache;
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
	for (let i in connect()?.call('network.interface', 'dump')?.interface ?? []) {
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
		writefile(PAUSE, `${time() + 180}`);
		system('nft delete table inet milkflint_adguardhome 2>/dev/null');
	}
	else {
		unlink(PAUSE);
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
					user: users[0] ?? null,
					url: `http://${agh.web_address()}/`,
					dns_port: agh.DNS_PORT,
					// starting / active / fallback, and why (from the monitor)
					state: on ? (monitor?.state ?? 'starting') : 'off',
					reason: monitor?.reason ?? null,
					since: monitor?.since ?? null,
					checked: monitor?.checked ?? null,
					redirect: { home: monitor?.home ?? [], intercept: monitor?.intercept ?? [] },
					stats: st,
					settings: text ? agh.check_settings(tree, agh.web_address()) : [],
					networks: networks(),
					update: update_info(),
					licenses: { license: `${LICENSES}LICENSE.txt`, notices: `${LICENSES}THIRD-PARTY-NOTICES.txt` }
				};
			}
		},

		// The first time: AdGuard Home's settings (yaml_config), with the
		// page's user name and password and MilkFlint's own account; then on.
		// Settings already there (kept by an upgrade, say): only on.
		setup: {
			args: { user: '', password: '' },
			call: function(req) {
				if (!agh.installed())
					return { error: 'not_installed' };
				if (agh.router_mode() == 'ap')
					return { error: 'access_point' };
				if (readfile(agh.CONFIG) == null) {
					const bad = check_password(req.args.user, req.args.password);
					if (bad)
						return { error: bad };
					const hash = agh.bcrypt(req.args.password);
					const api_hash = agh.bcrypt(api_key(true));
					if (!hash || !api_hash)
						return { error: 'hash' };
					if (!save_config(agh.yaml_config({ user: req.args.user, hash, api_hash, address: agh.web_address() })))
						return { error: 'write' };
				}
				set_enabled(true);
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

		// its user name and password (every other account but MilkFlint's own
		// goes: this page is where they're set)
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
					return save_config(agh.set_users(now, req.args.user, hash, api_hash)) ? { ok: true } : { error: 'write' };
				});
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
					const fixes = agh.check_settings(agh.yaml_parse(text), agh.web_address());
					const api_hash = length(filter(fixes, (f) => f.key == 'users.api')) ? agh.bcrypt(api_key(true)) : null;
					const fixed = agh.repair_settings(text, fixes, api_hash);
					if (!save_config(fixed))
						return { error: 'write' };
					const left = agh.check_settings(agh.yaml_parse(fixed), agh.web_address());
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
