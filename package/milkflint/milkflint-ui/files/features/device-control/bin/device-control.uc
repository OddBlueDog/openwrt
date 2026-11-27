// Device control's shared code (ui feature "device-control"), for its rpcd
// plugin, its service (device-control) and fw4's include
// (device-control-restore).
//
// The times a device's internet is off are fw4 rules (/etc/config/firewall,
// written by the page); pause and extra time are the members of two fw4
// sets, devctl_paused (one rule blocks them) and devctl_extra (each Device
// control rule skips them), each member with the time it has left. STATE
// keeps when each ends (Unix time; 0: until resumed), so the sets can be
// filled again after fw4 restarts or the router boots, with the right time
// left. A reload keeps the members as they are; the include sets them from
// STATE either way.
'use strict';

import { readfile, writefile, open, rename, mkdir, popen } from 'fs';
import { cursor } from 'uci';
import { addresses_of, cut as ct_cut } from '/usr/libexec/milkflint/conntrack.uc';

export const STATE = '/etc/milkflint/device-control.json';
export const RUN = '/var/run/milkflint';
// the time zone's offset fw4 last loaded its ruleset with (nft turns a rule's
// local times into UTC as it loads them)
export const LOADED = `${RUN}/device-control-offset`;
// each device's nlbwmon totals at local midnight, for "used today"
export const TODAY = `${RUN}/device-control-today.json`;
// what ntpd last said (its hotplug): { synced, stratum, at }
export const CLOCK = `${RUN}/device-control-clock.json`;
export const PID = `${RUN}/device-control.pid`;
export const PAUSED = 'devctl_paused';
export const EXTRA = 'devctl_extra';
// the longest a pause or extra time may be set for (a week and a day)
export const MAX_S = 8 * 86400;

const MAC = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;

export function is_mac(m) {
	return type(m) == 'string' && length(m) == 17 && match(m, MAC) != null;
};

export function write_atomic(path, data, mode) {
	const tmp = `${path}.tmp`;
	const f = open(tmp, 'w', mode ?? 0o644);
	if (!f)
		return false;
	f.write(data);
	f.close();
	return rename(tmp, path);
};

function read_json(path) {
	try {
		return json(readfile(path) ?? 'null');
	}
	catch (e) {
		return null;
	}
}

export function read_clock() {
	return read_json(CLOCK);
};

export function write_clock(v) {
	mkdir(RUN);
	return write_atomic(CLOCK, sprintf('%J\n', v));
};

export function read_today() {
	return read_json(TODAY);
};

// The time zone's offset from UTC (seconds) at Unix time t, by /etc/TZ.
export function offset(t) {
	return timegm(localtime(t)) - t;
};

// { paused: { mac: until }, extra: { mac: until } }, with what has ended taken
// out (0: until resumed). `changed` says whether anything was.
export function load_state(now) {
	const raw = read_json(STATE);
	const out = { paused: {}, extra: {}, changed: false };
	for (let kind in [ 'paused', 'extra' ]) {
		for (let mac, until in (type(raw?.[kind]) == 'object' ? raw[kind] : {})) {
			mac = lc(mac);
			until = +until;
			if (!is_mac(mac) || until != until || until < 0)
				out.changed = true;
			else if (until == 0 ? kind == 'paused' : until > now)
				out[kind][mac] = until;
			else
				out.changed = true;
		}
	}
	return out;
};

export function save_state(st) {
	mkdir('/etc/milkflint');
	return write_atomic(STATE, sprintf('%J\n', { paused: st.paused, extra: st.extra }), 0o600);
};

function element(mac, until, now) {
	return until == 0 ? mac : `${mac} timeout ${max(1, until - now)}s`;
}

// Whether fw4's ruleset has the two sets (Device control is set up, and the
// router isn't between a firewall stop and start).
export function sets_ready() {
	return system(`nft list set inet fw4 ${PAUSED} >/dev/null 2>&1`) == 0;
};

export function nft(text) {
	if (text == '')
		return true;
	const f = `${RUN}/device-control.nft`;
	mkdir(RUN);
	writefile(f, text);
	return system(`nft -f ${f} 2>/dev/null`) == 0;
};

// The sets made to hold exactly STATE, with each member's time left by the
// clock now. One nftables transaction: all of it or none.
export function fill(st, now) {
	let text = `flush set inet fw4 ${PAUSED}\nflush set inet fw4 ${EXTRA}\n`;
	for (let mac, until in st.paused)
		text += `add element inet fw4 ${PAUSED} { ${element(mac, until, now)} }\n`;
	for (let mac, until in st.extra)
		text += `add element inet fw4 ${EXTRA} { ${element(mac, until, now)} }\n`;
	return nft(text);
};

// One device's members set as `st` has them now (taken out of either set
// where it isn't).
export function put(st, macs, now) {
	let text = '';
	for (let mac in macs) {
		text += `destroy element inet fw4 ${PAUSED} { ${mac} }\ndestroy element inet fw4 ${EXTRA} { ${mac} }\n`;
		if (mac in st.paused)
			text += `add element inet fw4 ${PAUSED} { ${element(mac, st.paused[mac], now)} }\n`;
		if (mac in st.extra)
			text += `add element inet fw4 ${EXTRA} { ${element(mac, st.extra[mac], now)} }\n`;
	}
	return nft(text);
};

export function cmd(c) {
	const p = popen(c, 'r');
	if (!p)
		return null;
	const out = p.read('all');
	p.close();
	return out;
};

const as_list = (v) => (type(v) == 'array') ? v : (v != null && v != '') ? split(trim(v), /[ \t]+/) : [];

// Ends every connection of these devices that's open now (conntrack.uc's
// cut, on the addresses they use).
export function cut(macs) {
	return ct_cut(addresses_of(macs));
};

// ---- the rules, as fw4 runs them ----

const DAYS = [ 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun' ];

// fw4's time (H[:M[:S]]) as seconds of the day
function seconds(v) {
	if (v == null)
		return null;
	const p = split(trim(v), ':');
	if (length(p) > 3)
		return null;
	const h = +p[0], m = +(p[1] ?? 0), s = +(p[2] ?? 0);
	if (h != h || m != m || s != s || h > 23 || m > 59 || s > 59)
		return null;
	return h * 3600 + m * 60 + s;
}

// fw4's weekdays: names (or prefixes of them), the whole list inverted by a
// leading "!"; { days: [0 Monday … 6 Sunday], invert }
function weekdays(v) {
	const list = as_list(v);
	if (!length(list))
		return null;
	let invert = false;
	if (substr(list[0], 0, 1) == '!') {
		invert = true;
		list[0] = substr(list[0], 1);
	}
	const days = [];
	for (let d in list) {
		if (d == '')
			continue;
		const i = index(DAYS, substr(lc(d), 0, 3));
		if (i < 0)
			return 'bad';
		push(days, i);
	}
	return { days, invert };
}

function internet_zones(c) {
	const out = {};
	c.foreach('firewall', 'zone', (z) => {
		const nets = as_list(z.network);
		if (z.name == 'wan' || ('wan' in nets) || ('wan6' in nets))
			out[z.name] = true;
	});
	return out;
}

const PLAIN = { name: true, enabled: true, src: true, dest: true, src_mac: true, proto: true, target: true,
	family: true, log: true, start_time: true, stop_time: true, weekdays: true, ipset: true };

// Every rule that keeps particular devices off the internet: on, from any
// zone (or one) to the internet, by MAC, every protocol, reject or drop,
// maybe at set times, and nothing else to match (the page's own
// deviceRules). Each: { macs, start, stop, days, invert, exempt }.
export function device_rules(c) {
	c ??= cursor();
	const wan = internet_zones(c);
	const out = [];
	c.foreach('firewall', 'rule', (r) => {
		if (r.enabled == '0' || !(uc(r.target ?? '') in [ 'REJECT', 'DROP' ]) || !wan[r.dest ?? ''])
			return;
		const macs = map(as_list(r.src_mac), lc);
		if (!length(macs))
			return;
		for (let k in r)
			if (substr(k, 0, 1) != '.' && !PLAIN[k])
				return;
		const proto = map(as_list(r.proto), lc);
		if (!('all' in proto) && !('any' in proto) && !('*' in proto))
			return;
		const exempt = r.ipset == `!${EXTRA}`;
		if (r.ipset != null && !exempt)
			return;
		const wd = weekdays(r.weekdays);
		if (wd == 'bad')
			return;
		push(out, { macs, start: seconds(r.start_time), stop: seconds(r.stop_time), days: wd?.days, invert: wd?.invert ?? false, exempt });
	});
	return out;
};

// Whether a rule blocks at second `sec` of weekday `day` (local), as
// nftables decides it for each packet: a range across midnight is "outside
// stop…start", bounds excluded.
function blocks(r, day, sec) {
	if (r.start != null && r.stop != null) {
		if (r.start <= r.stop ? (sec < r.start || sec > r.stop) : (sec <= r.start && sec >= r.stop))
			return false;
	}
	else if (r.start != null && sec < r.start)
		return false;
	else if (r.stop != null && sec > r.stop)
		return false;
	if (r.days == null)
		return true;
	const on = day in r.days;
	return r.invert ? !on : on;
}

// Local day (0 Monday) and second of the day for Unix time t at offset off.
export function local(t, off) {
	const l = t + off;
	const sec = l % 86400;
	return { day: (int(l / 86400) + 3) % 7, sec, midnight: t - sec };
};

// Whether a device is kept off the internet at t: paused, or a rule (a
// Device control rule only while it has no extra time).
export function blocked(mac, rules, st, t, off) {
	const p = st.paused[mac];
	if (p != null && (p == 0 || p > t))
		return true;
	const e = st.extra[mac];
	const extra = e != null && e > t;
	const l = local(t, off);
	for (let r in rules)
		if ((mac in r.macs) && !(r.exempt && extra) && blocks(r, l.day, l.sec))
			return true;
	return false;
};

// The next moment after `now` anything could change for these rules and
// overrides: a rule's start or end (today or tomorrow), a pause or extra
// time ending, local midnight.
export function next_edge(rules, st, now, off) {
	const l = local(now, off);
	let best = l.midnight + 86400;
	const take = (t) => { if (t > now && t < best) best = t; };
	for (let k in [ 0, 1 ]) {
		const day = l.midnight + k * 86400;
		for (let r in rules)
			for (let s in [ r.start, r.stop ])
				if (s != null) {
					take(day + s);
					take(day + s + 1);
				}
	}
	for (let mac, until in st.paused)
		if (until > 0)
			take(until);
	for (let mac, until in st.extra)
		take(until);
	return best;
};

// ---- nlbwmon's totals, for "used today" ----

// { mac: [ received, sent ] } so far this accounting period; null when
// nlbwmon isn't running
export function totals() {
	let t = null;
	try {
		t = json(cmd('nlbw -c json -g mac 2>/dev/null') ?? 'null');
	}
	catch (e) {
		return null;
	}
	if (type(t?.columns) != 'array' || type(t?.data) != 'array')
		return null;
	const cm = index(t.columns, 'mac'), crx = index(t.columns, 'rx_bytes'), ctx = index(t.columns, 'tx_bytes');
	if (cm < 0 || crx < 0 || ctx < 0)
		return null;
	const out = {};
	for (let row in t.data) {
		const mac = lc(row[cm] ?? '');
		if (!is_mac(mac))
			continue;
		const v = out[mac] ?? [ 0, 0 ];
		out[mac] = [ v[0] + (+row[crx] || 0), v[1] + (+row[ctx] || 0) ];
	}
	return out;
};
