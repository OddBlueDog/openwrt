// rpcd plugin for the "device-control" feature (ubus milkflint.devicecontrol):
// what's paused and given extra time (and until when), the router's clock
// and whether it's set, each device's data today and when it was last seen,
// and pausing, extra time and resuming. The times a device is off are fw4
// rules the page writes through UCI; pause and extra time are members of two
// fw4 sets with a timeout each, set here at once, with no firewall reload.
// Shared code: bin/device-control.uc.
'use strict';

import { readfile, access } from 'fs';
import { cursor } from 'uci';
import * as dc from '/usr/libexec/milkflint/device-control.uc';

let rtnl = null;
try {
	rtnl = require('rtnl');
}
catch (e) {
	// without ucode-mod-rtnl, nothing is "last seen"
}

const MAX_DEVICES = 64;

function service_signal() {
	const pid = +(readfile(dc.PID) ?? '0');
	if (pid > 1)
		system(`kill -HUP ${pid} 2>/dev/null`);
}

// The devices asked for: MACs, lower case, each once; null if any isn't one.
function macs_of(v) {
	if (type(v) != 'array' || !length(v) || length(v) > MAX_DEVICES)
		return null;
	const out = [];
	for (let m in v) {
		m = lc(m ?? '');
		if (!dc.is_mac(m))
			return null;
		if (!(m in out))
			push(out, m);
	}
	return out;
}

// How long ago each device last answered the router (seconds), from the
// neighbour tables (centiseconds since it was confirmed).
function seen() {
	const out = {};
	if (!rtnl)
		return out;
	for (let family in [ rtnl.const.AF_INET, rtnl.const.AF_INET6 ]) {
		for (let n in rtnl.request(rtnl.const.RTM_GETNEIGH, rtnl.const.NLM_F_DUMP, { family }) ?? []) {
			const mac = lc(n.lladdr ?? '');
			// a device's own address: not all zeros, not a multicast group's (its first byte odd)
			if (!dc.is_mac(mac) || mac == '00:00:00:00:00:00' || (hex(substr(mac, 0, 2)) & 1) || n.dev == 'lo' || n.cacheinfo == null)
				continue;
			const ago = int(n.cacheinfo.confirmed / 100);
			if (out[mac] == null || ago < out[mac])
				out[mac] = ago;
		}
	}
	return out;
}

function today() {
	const t = dc.read_today();
	if (type(t?.totals) != 'object')
		return null;
	const now = dc.totals();
	if (now == null)
		return null;
	const devices = {};
	for (let mac, v in now) {
		const b = t.totals[mac] ?? [ 0, 0 ];
		// the month rolled over since midnight: all of it is today's
		devices[mac] = (v[0] < b[0] || v[1] < b[1]) ? v : [ v[0] - b[0], v[1] - b[1] ];
	}
	return { since: t.since, midnight: t.midnight, devices };
}

function clock() {
	const c = cursor();
	let ntp = false, servers = false;
	c.foreach('system', 'timeserver', (s) => {
		if (s.enabled != '0')
			ntp = true;
		if (s.server != null)
			servers = true;
	});
	const k = dc.read_clock();
	return {
		ntp: ntp && servers,
		synced: k == null ? null : k.synced == true,
		stratum: k?.stratum ?? null,
		at: k?.at ?? null,
		uptime: int(+split(readfile('/proc/uptime') ?? '0', ' ')[0])
	};
}

function adguard() {
	const c = cursor();
	const installed = access('/usr/bin/AdGuardHome', 'x') == true;
	let state = null;
	try {
		state = json(readfile('/var/run/milkflint/adguardhome.json') ?? 'null')?.state ?? null;
	}
	catch (e) {
		state = null;
	}
	return { installed, enabled: c.get('adguardhome', 'config', 'enabled') == '1', state };
}

function as_map(o) {
	const out = {};
	for (let k, v in o)
		out[k] = v;
	return out;
}

// pause / extra / resume: the devices' entries changed in the state file and
// the sets, then the service told (it ends connections and wakes at the end)
function change(req, fn, cut) {
	const macs = macs_of(req.args.macs);
	if (macs == null)
		return { error: 'devices' };
	const now = time();
	const st = dc.load_state(now);
	const err = fn(st, macs, now);
	if (err)
		return { error: err };
	if (!dc.save_state(st))
		return { error: 'write' };
	if (dc.sets_ready() && !dc.put(st, macs, now))
		return { error: 'nft' };
	// once the set has them, so nothing new gets through meanwhile
	if (cut)
		dc.cut(macs);
	service_signal();
	return { ok: true };
}

function until_of(v, now) {
	v = +(v ?? -1);
	if (v != v || v != int(v))
		return null;
	return (v == 0 || (v > now && v <= now + dc.MAX_S)) ? v : null;
}

return {
	'milkflint.devicecontrol': {
		status: {
			call: function() {
				const now = time();
				const st = dc.load_state(now);
				return {
					now,
					offset: dc.offset(now),
					paused: as_map(st.paused),
					extra: as_map(st.extra),
					// fw4's sets are there (someone's set up and the firewall is loaded)
					ready: dc.sets_ready(),
					today: today(),
					seen: seen(),
					clock: clock(),
					adguard: adguard()
				};
			}
		},
		// { macs, until: Unix time, 0 until resumed }: their internet off now,
		// open connections ended; any extra time they had is over
		pause: {
			args: { macs: [ 'aa:bb:cc:dd:ee:ff' ], until: 0 },
			call: function(req) {
				return change(req, (st, macs, now) => {
					const until = until_of(req.args.until, now);
					if (until == null)
						return 'until';
					for (let m in macs) {
						st.paused[m] = until;
						delete st.extra[m];
					}
					return null;
				}, true);
			}
		},
		// { macs, until }: their times lifted until then; ends any pause
		extra: {
			args: { macs: [ 'aa:bb:cc:dd:ee:ff' ], until: 0 },
			call: function(req) {
				return change(req, (st, macs, now) => {
					const until = until_of(req.args.until, now);
					if (until == null || until == 0)
						return 'until';
					for (let m in macs) {
						st.extra[m] = until;
						delete st.paused[m];
					}
					return null;
				});
			}
		},
		// { macs }: pause and extra time over; their times apply again
		resume: {
			args: { macs: [ 'aa:bb:cc:dd:ee:ff' ] },
			call: function(req) {
				return change(req, (st, macs) => {
					for (let m in macs) {
						delete st.paused[m];
						delete st.extra[m];
					}
					return null;
				});
			}
		}
	}
};
