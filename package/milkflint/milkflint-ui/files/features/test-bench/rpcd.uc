// rpcd plugin for the "test-bench" feature: a bench that devices on the LAN
// join to run one test plan together, at the same moments, while the router
// records what it does (/usr/libexec/milkflint/bench-runner). Three objects:
//   milkflint.bench         the admin's: open, close and look after a bench,
//                           and read the stored runs
//   milkflint.bench.member  a joined device's: everything a member does;
//                           start, handoff and kick only for the coordinator
//   milkflint.bench.join    the join CGI's (/www/cgi-bin/milkflint-test-bench),
//                           in no ACL: only root on the router reaches it
// Joined devices get their rpcd session from that CGI, allowed only the
// member methods: rpcd can't create a session for one of its own plugins'
// callers, since it answers one call at a time. Times are the router's
// monotonic clock in ms, which NTP can't step.
'use strict';

import { lsdir, mkdir, open, readfile, readlink, rename, rmdir, stat, unlink, writefile } from 'fs';
import { cursor } from 'uci';

let rtnl = null, nl80211 = null;
try {
	rtnl = require('rtnl');
}
catch (e) {
	// without ucode-mod-rtnl, members' cards show no link
}
try {
	nl80211 = require('nl80211');
}
catch (e) {
	// without ucode-mod-nl80211, Wi-Fi members show no signal or rate
}

const DIR = '/tmp/milkflint-bench';
const STATE = DIR + '/bench.json';
const RUNS = DIR + '/runs';
// the run the runner is to start, and the members' last sign of life during a run
const REQUEST = DIR + '/request.json';
const HEARTBEAT = DIR + '/heartbeat';
const RUNNER = '/usr/libexec/milkflint/bench-runner';
const SESSIONS = '/usr/libexec/milkflint/bench-sessions';

// what a member's session may call (the CGI grants exactly these)
const MEMBER_METHODS = [ 'sync', 'poll', 'rename', 'report', 'signal', 'stop', 'leave', 'runs', 'run_get', 'start', 'handoff', 'kick' ];
// a member's session ends after this long without a call; polls keep it alive
const SESSION_S = 60;
const MAX_MEMBERS = 12;
const MAX_CODE_FAILURES = 10;
// a bench closes this long after it opened, or when no run is on and the
// coordinator hasn't been heard from for IDLE_MS
const BENCH_MS = 4 * 3600 * 1000;
const IDLE_MS = 30 * 60 * 1000;
// members not heard from for this long leave the bench
const AWAY_MS = 15 * 60 * 1000;
// a run starts this long after Start, so every member has seen its schedule
const LEAD_MS = 4000;
// limits on a run's schedule
const MAX_PHASES = 40;
const MIN_PHASE_MS = 3000;
const MAX_PHASE_MS = 60000;
const MAX_RUN_MS = 600000;
const MAX_SCHEDULE = 24 * 1024;
// after a run ends, members have this long to send what they still hold
const COLLECT_MS = 30000;
// a runner that hasn't said it started within this long never will
const RUNNER_START_MS = 10000;
// stored runs: the newest KEEP_RUNS, at most KEEP_BYTES in all
const KEEP_RUNS = 5;
const KEEP_BYTES = 32 * 1024 * 1024;
// what members send: one report at most REPORT_BYTES (a /ubus request is
// at most 64 KB, batches included), at most MEMBER_BYTES per run
const REPORT_BYTES = 32 * 1024;
const MEMBER_BYTES = 2 * 1024 * 1024;
// WebRTC signalling: an offer or answer, and what a member's mailbox
// holds (messages, and bytes, so a poll's reply stays small)
const MAX_SDP = 16 * 1024;
const MAILBOX = 32;
const MAILBOX_BYTES = 128 * 1024;
// a run_get reply: well under the 1 MB ubus carries in a message
const PAGE_BYTES = 256 * 1024;
const PHASE_KINDS = [ 'idle', 'wan_down', 'wan_up', 'wan_both', 'connect', 'd2d', 'dns', 'household', 'cooldown' ];
// where members' WAN loads go: Cloudflare's speed test, or (the UI's
// development server only) the page's own server
const ENDPOINTS = [ 'cloudflare', 'dev' ];
// the internet hosts members and the router measure latency to (Vultr's,
// as Network Quality's routes; bench-prober has their names)
const LATENCY_TARGETS = [ 'uk', 'eu', 'us' ];
// a plan's own sites for DNS and page loads, besides the fixed list
const MAX_CUSTOM_SITES = 8;
const valid_host = (s) => type(s) == 'string' && length(s) <= 253 &&
	match(s, /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/);
// Crockford's base32: no I, L, O or U, so a typed code can't be misread
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function now_ms() {
	const c = clock(true);
	return c[0] * 1000 + c[1] / 1000000.0;
}

function random_bytes(n) {
	const b = readfile('/dev/urandom', n);
	if (b == null || length(b) != n)
		die('no random bytes');
	return b;
}

function random_hex(n) {
	const b = random_bytes(n);
	let s = '';
	for (let i = 0; i < n; i++)
		s += sprintf('%02x', ord(b, i));
	return s;
}

// 128 random bits, base64url: the QR code's join token
function new_token() {
	return replace(replace(replace(b64enc(random_bytes(16)), /\+/g, '-'), /\//g, '_'), /=+$/, '');
}

// 40 random bits as 8 base32 characters: the code to type
function new_code() {
	const b = random_bytes(5);
	let v = 0;
	for (let i = 0; i < 5; i++)
		v = v * 256 + ord(b, i);
	let s = '';
	for (let i = 0; i < 8; i++) {
		s = substr(CODE_ALPHABET, v & 31, 1) + s;
		v = v >> 5;
	}
	return s;
}

// a typed code as the bench keeps it: upper case, without the dash, the
// look-alikes base32 leaves out read as what they look like
function typed_code(s) {
	s = uc(replace(s, /[- ]/g, ''));
	return replace(replace(s, /O/g, '0'), /[IL]/g, '1');
}

function save_json(path, v) {
	writefile(path + '.tmp', sprintf('%J', v));
	rename(path + '.tmp', path);
}

function load_json(path) {
	try {
		return json(readfile(path) ?? 'null');
	}
	catch (e) {
		return null;
	}
}

// the bench, kept in memory and in STATE (rpcd restarts with the UI's
// updates; members' sessions don't survive that, so they join again with
// their key)
let B = load_json(STATE);
let saved_at = 0;

function save() {
	mkdir(DIR);
	if (B)
		save_json(STATE, B);
	else
		unlink(STATE);
	saved_at = now_ms();
}

function valid_name(s) {
	return type(s) == 'string' && length(trim(s)) > 0 && length(s) <= 48 && !match(s, /[[:cntrl:]]/);
}

const valid_member_id = (s) => type(s) == 'string' && match(s, /^m[0-9]{1,4}$/);
const valid_run_id = (s) => type(s) == 'string' && match(s, /^[0-9a-f]{12}$/);

// end these rpcd sessions, in the background: rpcd can't take a call to
// its own session object while it answers this one
function end_sessions(sids) {
	sids = filter(sids, (s) => type(s) == 'string' && match(s, /^[0-9a-f]{32}$/));
	if (length(sids))
		system(`${SESSIONS} ${join(' ', sids)} > /dev/null 2>&1 &`);
}

function alive(pid) {
	return type(pid) == 'int' && index(readfile(`/proc/${pid}/cmdline`) ?? '', 'bench-runner') >= 0;
}

// ---- Where each member is connected ----

// ip -> { kind: 'wifi' | 'wired', ... }, refreshed every 5 s at most
let links = {}, links_at = 0;

const WIDTH_MHZ = [ 20, 20, 40, 80, 80, 160, 5, 10, 1, 2, 4, 8, 16, 320 ];

function band(freq) {
	return freq < 3000 ? '2.4' : (freq < 5950 ? '5' : '6');
}

function channel(freq) {
	if (freq == 2484)
		return 14;
	if (freq < 3000)
		return (freq - 2407) / 5;
	return (freq < 5950 ? freq - 5000 : freq - 5950) / 5;
}

// the Wi-Fi generation a bit rate was sent with
function generation(rate) {
	if (rate?.eht_mcs != null)
		return 7;
	if (rate?.he_mcs != null)
		return 6;
	if (rate?.vht_mcs != null)
		return 5;
	return rate?.mcs != null ? 4 : null;
}

function wifi_link(dev, mac, ifaces) {
	const c = nl80211.const;
	const st = nl80211.request(c.NL80211_CMD_GET_STATION, 0, { dev, mac })?.sta_info;
	const i = ifaces[dev];
	if (!st || !i)
		return { kind: 'wifi', dev };
	return {
		kind: 'wifi', dev, ssid: i.ssid, band: band(i.freq), channel: channel(i.freq), width: i.width,
		signal: st.signal, tx_mbit: st.tx_bitrate?.bitrate != null ? st.tx_bitrate.bitrate / 10.0 : null,
		rx_mbit: st.rx_bitrate?.bitrate != null ? st.rx_bitrate.bitrate / 10.0 : null,
		generation: generation(st.tx_bitrate) ?? generation(st.rx_bitrate)
	};
}

function refresh_links() {
	const out = {};
	if (!B || !rtnl)
		return out;
	const c = rtnl.const;
	const neigh = {};
	for (let family in [ c.AF_INET, c.AF_INET6 ])
		for (let n in rtnl.request(c.RTM_GETNEIGH, c.NLM_F_DUMP, { family }) ?? [])
			if (n.dst && n.lladdr && n.lladdr != '00:00:00:00:00:00')
				neigh[n.dst] = n;
	// the bridge port each address was last seen on
	const port = {};
	for (let f in rtnl.request(c.RTM_GETNEIGH, c.NLM_F_DUMP, { family: c.AF_BRIDGE }) ?? [])
		if (f.master && f.lladdr && !(f.state & 128) && f.vlan == null)
			port[`${f.master} ${f.lladdr}`] = f.dev;
	let ifaces = null;
	for (let id, m in B.members) {
		const n = neigh[m.ip];
		if (!n)
			continue;
		const dev = port[`${n.dev} ${n.lladdr}`] ?? n.dev;
		const wifi = nl80211 && readfile(`/sys/class/net/${dev}/phy80211/name`) != null;
		if (wifi) {
			if (ifaces == null) {
				ifaces = {};
				const nc = nl80211.const;
				for (let i in nl80211.request(nc.NL80211_CMD_GET_INTERFACE, nc.NLM_F_DUMP) ?? [])
					if (i.ifname && i.wiphy_freq)
						ifaces[i.ifname] = { ssid: i.ssid, freq: i.wiphy_freq, width: WIDTH_MHZ[i.channel_width] };
			}
			out[m.ip] = { mac: n.lladdr, ...wifi_link(dev, n.lladdr, ifaces) };
		}
		else {
			const speed = +trim(readfile(`/sys/class/net/${dev}/speed`) ?? '');
			out[m.ip] = { kind: 'wired', mac: n.lladdr, dev, port: dev, speed: speed > 0 ? speed : null };
		}
	}
	return out;
}

function link_of(ip) {
	const t = now_ms();
	if (t - links_at > 5000) {
		links = refresh_links();
		links_at = t;
	}
	return links[ip];
}

// the DHCP leases' host names by address, for a member's first name
function lease_name(ip) {
	for (let line in split(readfile('/tmp/dhcp.leases') ?? '', '\n')) {
		const f = split(line, ' ');
		if (f[2] == ip && f[3] && f[3] != '*' && valid_name(f[3]))
			return f[3];
	}
	return null;
}

// ---- The bench ----

function bench_closed(why) {
	if (!B)
		return;
	if (B.run && !B.run.ended)
		writefile(`${RUNS}/${B.run.id}/stop`, why);
	end_sessions(map(values(B.members), (m) => m.sid));
	B = null;
	save();
}

function sid_member(sid) {
	if (!B || type(sid) != 'string')
		return null;
	for (let id, m in B.members)
		if (m.sid == sid)
			return m;
	return null;
}

// read what the runner says about the current run: started, ended, gone
function check_run(t) {
	const r = B?.run;
	if (!r || r.ended)
		return;
	const dir = `${RUNS}/${r.id}`;
	const end = load_json(`${dir}/end.json`);
	if (end) {
		r.ended = end;
	}
	else {
		if (r.pid == null) {
			const pid = +trim(readfile(`${dir}/runner.pid`) ?? '');
			r.pid = pid > 0 ? pid : null;
		}
		let why = null;
		if (r.pid && !alive(r.pid))
			why = 'the router stopped recording unexpectedly';
		else if (!r.pid && t - r.created > RUNNER_START_MS)
			why = "the router's recorder didn't start";
		// the runner and its watchdog both missed it
		else if (t > r.end + 60000)
			why = 'the run went past its end';
		if (!why)
			return;
		r.ended = { reason: why, at: t };
		save_json(`${dir}/end.json`, r.ended);
	}
	r.ended.at ??= t;
	save();
}

function run_state(r, t) {
	if (!r)
		return null;
	if (r.ended)
		return t < r.ended.at + COLLECT_MS ? 'collecting' : 'done';
	if (r.stop)
		return 'stopping';
	return t < r.t0 ? 'scheduled' : 'running';
}

function active(r, t) {
	return run_state(r, t) in [ 'scheduled', 'running', 'stopping' ];
}

// close a bench that has outlived its time, drop members long gone
function tidy(t) {
	if (!B)
		return;
	check_run(t);
	if (t - B.opened > BENCH_MS)
		return bench_closed('the bench closed');
	if (!active(B.run, t) && t - B.coordinator_seen > IDLE_MS)
		return bench_closed('the bench closed');
	let gone = [];
	for (let id, m in B.members)
		if (t - m.seen > AWAY_MS && id != B.coordinator)
			push(gone, id);
	for (let id in gone) {
		end_sessions([ B.members[id].sid ]);
		delete B.members[id];
		delete B.mailbox[id];
	}
	if (length(gone))
		save();
}

function card(m, t) {
	return {
		id: m.id, name: m.name, ip: m.ip, ua: m.ua, platform: m.platform, link: link_of(m.ip),
		seen_ms: t - m.seen, visible: m.visible, clock_us: m.clock_us, phase: m.phase, note: m.note,
		joined: m.joined, live: m.live
	};
}

// what a member measures right now, as it says in its polls: latency to the
// router (r) and the internet (w), ms; its download (d) and upload (u), Mbit/s
function member_live(v) {
	if (type(v) != 'object')
		return null;
	const out = {};
	for (let k in [ 'r', 'w', 'd', 'u', 'p', 'x', 'o', 'k', 'g', 'l' ]) {
		const x = v[k];
		if ((type(x) == 'int' || type(x) == 'double') && x >= 0 && x < 1e6)
			out[k] = x;
	}
	return length(out) ? out : null;
}

// whether a run's schedule pairs members a and b (device to device)
function paired(r, a, b) {
	for (let p in r?.schedule?.phases ?? [])
		if (p.pair && ((p.pair[0] == a && p.pair[1] == b) || (p.pair[0] == b && p.pair[1] == a)))
			return true;
	return false;
}

function run_info(r, t, with_schedule) {
	if (!r)
		return null;
	const out = { id: r.id, state: run_state(r, t), t0: r.t0, end: r.end, started_by: r.started_by, stop: r.stop, ended: r.ended };
	if (with_schedule)
		out.schedule = r.schedule;
	return out;
}

// ---- A run's schedule ----

// the schedule as the router keeps it, or an error: phases in order, each
// MIN_PHASE_MS to MAX_PHASE_MS, roles only for this bench's members
function checked_schedule(s) {
	if (type(s) != 'object')
		return 'invalid schedule';
	if (length(sprintf('%J', s)) > MAX_SCHEDULE)
		return 'the schedule is too long';
	if (type(s.phases) != 'array' || !length(s.phases) || length(s.phases) > MAX_PHASES)
		return 'invalid phases';
	if (s.name != null && !valid_name(s.name))
		return 'invalid plan name';
	if (s.dry != null && type(s.dry) != 'bool')
		return 'invalid dry';
	const phases = [];
	let at = 0;
	for (let p in s.phases) {
		if (type(p) != 'object' || !(p.kind in PHASE_KINDS))
			return 'invalid phase';
		if (type(p.start) != 'int' || type(p.dur) != 'int' || p.start < at || p.dur < MIN_PHASE_MS || p.dur > MAX_PHASE_MS)
			return 'invalid phase times';
		if (p.label != null && !valid_name(p.label))
			return 'invalid phase label';
		const roles = {};
		if (p.roles != null) {
			if (type(p.roles) != 'object')
				return 'invalid roles';
			for (let id, role in p.roles) {
				if (!B.members[id] || type(role) != 'string' || !match(role, /^[a-z_]{1,16}$/))
					return 'invalid roles';
				roles[id] = role;
			}
		}
		const q = { kind: p.kind, start: p.start, dur: p.dur, label: p.label, roles };
		if (p.streams != null) {
			if (type(p.streams) != 'int' || p.streams < 1 || p.streams > 8)
				return 'invalid streams';
			q.streams = p.streams;
		}
		if (p.pair != null) {
			if (type(p.pair) != 'array' || length(p.pair) != 2 || p.pair[0] == p.pair[1] || !B.members[p.pair[0]] || !B.members[p.pair[1]])
				return 'invalid pair';
			q.pair = [ p.pair[0], p.pair[1] ];
		}
		if (p.dir != null) {
			if (!(p.dir in [ 'ab', 'ba', 'both' ]))
				return 'invalid direction';
			q.dir = p.dir;
		}
		at = p.start + p.dur;
		push(phases, q);
	}
	if (at > MAX_RUN_MS)
		return 'the run is too long';
	const o = s.options ?? {};
	if (type(o) != 'object')
		return 'invalid options';
	const options = { endpoint: o.endpoint ?? 'cloudflare', latency: o.latency ?? 'uk', budget_mb: o.budget_mb ?? 2000 };
	// where browsers send their loads; the router itself never fetches anything
	if (!(options.endpoint in ENDPOINTS))
		return 'invalid endpoint';
	if (!(options.latency in LATENCY_TARGETS))
		return 'invalid latency target';
	if (type(options.budget_mb) != 'int' || options.budget_mb < 10 || options.budget_mb > 100000)
		return 'invalid data budget';
	// sites beyond the fixed list (bin/bench-dns) that browsers load and the router looks up: host names only
	const sites = o.custom_sites ?? [];
	if (type(sites) != 'array' || length(sites) > MAX_CUSTOM_SITES)
		return 'invalid sites';
	for (let name in sites)
		if (!valid_host(name))
			return 'invalid sites';
	options.custom_sites = sites;
	return { name: s.name, dry: s.dry == true, phases, length: at, options };
}

// Smart Queue's shaped rates (kbit/s), for the plan's data estimate and the
// report's "shaper reached" check; refreshed every 30 s
let shaper_cache = null, shaper_at = -1e9;
function shaper(t) {
	if (t - shaper_at < 30000)
		return shaper_cache;
	shaper_at = t;
	shaper_cache = null;
	cursor().foreach('sqm', 'queue', (s) => {
		if (shaper_cache == null && s.enabled == '1')
			shaper_cache = { interface: s.interface, down_kbit: +(s.download ?? 0), up_kbit: +(s.upload ?? 0), qdisc: s.qdisc };
	});
	return shaper_cache;
}

// the run's last second, as the runner and prober wrote it
function live_files(r) {
	return { router: load_json(`${RUNS}/${r.id}/live.json`), probes: load_json(`${RUNS}/${r.id}/live-probes.json`) };
}

// what the run is measured against, as configured (read only)
function settings() {
	const u = cursor();
	const out = { sqm: [], firewall: {}, wifi: [], dns: u.get('milkflint', 'dns', 'mode') };
	u.foreach('sqm', 'queue', (s) => {
		push(out.sqm, { interface: s.interface, enabled: s.enabled, download: +(s.download ?? 0), upload: +(s.upload ?? 0),
			qdisc: s.qdisc, script: s.script, use_mq: s.use_mq, linklayer: s.linklayer, overhead: s.overhead });
	});
	u.foreach('firewall', 'defaults', (s) => {
		out.firewall = { flow_offloading: s.flow_offloading, flow_offloading_hw: s.flow_offloading_hw, flow_offloading_bridge: s.flow_offloading_bridge };
	});
	u.foreach('wireless', 'wifi-device', (s) => {
		push(out.wifi, { radio: s['.name'], band: s.band, channel: s.channel, htmode: s.htmode, disabled: s.disabled });
	});
	const release = readfile('/etc/openwrt_release') ?? '';
	out.firmware = match(release, /DISTRIB_DESCRIPTION='([^']*)'/)?.[1];
	out.model = trim(readfile('/tmp/sysinfo/model') ?? '') || null;
	return out;
}

// ---- Stored runs ----

function dir_bytes(dir) {
	let n = 0;
	for (let f in lsdir(dir) ?? [])
		n += stat(`${dir}/${f}`)?.size ?? 0;
	return n;
}

function remove_run(id) {
	const dir = `${RUNS}/${id}`;
	for (let f in lsdir(dir) ?? [])
		unlink(`${dir}/${f}`);
	rmdir(dir);
}

function stored_runs() {
	const out = [];
	for (let id in lsdir(RUNS) ?? []) {
		if (!valid_run_id(id))
			continue;
		const meta = load_json(`${RUNS}/${id}/meta.json`);
		if (meta)
			push(out, { id, meta, end: load_json(`${RUNS}/${id}/end.json`), bytes: dir_bytes(`${RUNS}/${id}`) });
	}
	return sort(out, (a, b) => b.meta.created_wall - a.meta.created_wall);
}

// a stored run in short, for the lists of them
function run_summary(r) {
	return {
		id: r.id, bench: r.meta.bench_name, plan: r.meta.schedule?.name, dry: r.meta.schedule?.dry,
		created_wall: r.meta.created_wall, length: r.meta.schedule?.length,
		members: map(r.meta.members ?? [], (m) => m.name), ended: r.end?.reason, bytes: r.bytes,
		current: B?.run?.id == r.id
	};
}

// keep the newest runs that fit, never the current one's files
function prune(keep) {
	let total = 0, n = 0;
	for (let r in stored_runs()) {
		total += r.bytes;
		if (r.id != keep && (++n > KEEP_RUNS || total > KEEP_BYTES))
			remove_run(r.id);
	}
}

// a part of a stored run, from byte `from`: whole lines up to PAGE_BYTES,
// and where the next page starts (null: the end)
function part_lines(path, from) {
	const f = open(path, 'r');
	if (!f)
		return { lines: [], next: null };
	f.seek(from);
	const chunk = f.read(PAGE_BYTES) ?? '';
	f.close();
	if (!length(chunk))
		return { lines: [], next: null };
	let cut = length(chunk);
	if (length(chunk) == PAGE_BYTES) {
		// end at the last whole line; one line longer than a page is skipped
		let i = cut - 1;
		while (i >= 0 && substr(chunk, i, 1) != '\n')
			i--;
		cut = i >= 0 ? i + 1 : cut;
	}
	const text = substr(chunk, 0, cut);
	return { lines: filter(split(text, '\n'), (l) => length(l)), next: length(chunk) == PAGE_BYTES ? from + cut : null };
}

function run_part(id, part, from) {
	if (!valid_run_id(id) || stat(`${RUNS}/${id}`)?.type != 'directory')
		return { error: 'no such run' };
	if (type(from) != 'int' || from < 0)
		return { error: 'invalid cursor' };
	if (part == 'meta') {
		const t = now_ms();
		const meta = load_json(`${RUNS}/${id}/meta.json`);
		const end = load_json(`${RUNS}/${id}/end.json`);
		const r = B?.run?.id == id ? B.run : null;
		return { meta, end, state: r ? run_state(r, t) : 'done', now: t };
	}
	if (!(part in [ 'router', 'probes', 'dns' ]) && !(type(part) == 'string' && match(part, /^m-m[0-9]{1,4}$/)))
		return { error: 'invalid part' };
	return part_lines(`${RUNS}/${id}/${part}.jsonl`, from);
}

// ---- The join CGI's checks ----

// the bench and member a join's credentials name, or why not; counts wrong codes
function credentials(a, count) {
	if (!B)
		return { error: 'no bench is open' };
	if (a.member != null || a.key != null) {
		const m = valid_member_id(a.member) ? B.members[a.member] : null;
		if (!m || type(a.key) != 'string' || a.key != m.key)
			return { error: 'not a member' };
		return { member: m };
	}
	if (a.token != null) {
		if (type(a.token) != 'string' || a.token != B.token)
			return { error: 'invalid token' };
	}
	else if (a.code != null) {
		if (B.code_failures >= MAX_CODE_FAILURES)
			return { error: 'code disabled' };
		if (type(a.code) != 'string' || length(a.code) > 16 || typed_code(a.code) != B.code) {
			if (count) {
				B.code_failures++;
				save();
			}
			return { error: B.code_failures >= MAX_CODE_FAILURES ? 'code disabled' : 'invalid code' };
		}
	}
	else
		return { error: 'no credentials' };
	if (length(B.members) >= MAX_MEMBERS)
		return { error: 'the bench is full' };
	return {};
}

function join_args(a) {
	for (let k in [ 'name', 'platform' ])
		if (a[k] != null && !valid_name(a[k]))
			return `invalid ${k}`;
	return null;
}

// ---- The methods ----

function new_bench(name, t) {
	return {
		id: random_hex(6), name, opened: t, opened_wall: time(), token: new_token(), code: new_code(), code_failures: 0,
		coordinator: null, coordinator_seen: t, members: {}, next_member: 1, mailbox: {}, signal_n: 0, run: null
	};
}

function admin_view(t) {
	if (!B)
		return { bench: null, now: t };
	return {
		now: t,
		bench: {
			id: B.id, name: B.name, opened: B.opened, closes: min(B.opened + BENCH_MS, B.coordinator_seen + IDLE_MS),
			token: B.token, code: B.code, code_disabled: B.code_failures >= MAX_CODE_FAILURES, coordinator: B.coordinator,
			members: map(sort(values(B.members), (a, b) => a.joined - b.joined), (m) => card(m, t)),
			run: run_info(B.run, t, false)
		}
	};
}

// every member call: the caller, with the bench tidied first
function member(req) {
	const t = now_ms();
	tidy(t);
	const m = sid_member(req.args.ubus_rpc_session);
	return m ? { m, t } : null;
}

const NOT_MEMBER = { error: 'not a member' };
const NOT_COORDINATOR = { error: 'only the coordinator can do that' };

return {
	'milkflint.bench': {
		// the open bench (null: none), with its join token and code
		status: {
			call: function() {
				const t = now_ms();
				tidy(t);
				if (B) {
					B.coordinator_seen = t;
					if (t - saved_at > 10000)
						save();
				}
				return admin_view(t);
			}
		},
		// open a bench (replace: close the open one first)
		create: {
			args: { name: 'name', replace: false },
			call: function(req) {
				const t = now_ms();
				tidy(t);
				const name = req.args.name ?? 'Test bench';
				if (!valid_name(name))
					return { error: 'invalid name' };
				if (B && req.args.replace != true)
					return { error: 'a bench is open' };
				bench_closed('a new bench opened');
				B = new_bench(trim(name), t);
				save();
				return admin_view(t);
			}
		},
		close: {
			call: function() {
				const was = B != null;
				bench_closed('the bench closed');
				return { closed: was };
			}
		},
		// a new join token and code (the old ones stop working), and wrong codes forgiven
		rotate: {
			call: function() {
				const t = now_ms();
				tidy(t);
				if (!B)
					return { error: 'no bench is open' };
				B.token = new_token();
				B.code = new_code();
				B.code_failures = 0;
				save();
				return admin_view(t);
			}
		},
		// make a member the coordinator (the admin's own tab, once it has joined)
		coordinate: {
			args: { member: 'm1' },
			call: function(req) {
				const t = now_ms();
				tidy(t);
				if (!B)
					return { error: 'no bench is open' };
				if (!valid_member_id(req.args.member) || !B.members[req.args.member])
					return { error: 'no such member' };
				B.coordinator = req.args.member;
				B.coordinator_seen = t;
				save();
				return admin_view(t);
			}
		},
		// the stored runs, newest first
		runs: {
			call: function() {
				tidy(now_ms());
				return { runs: map(stored_runs(), run_summary) };
			}
		},
		run_get: {
			args: { run: 'id', part: 'meta', from: 0 },
			call: function(req) {
				tidy(now_ms());
				return run_part(req.args.run, req.args.part, req.args.from ?? 0);
			}
		},
		run_delete: {
			args: { run: 'id' },
			call: function(req) {
				const t = now_ms();
				tidy(t);
				if (!valid_run_id(req.args.run) || stat(`${RUNS}/${req.args.run}`) == null)
					return { error: 'no such run' };
				if (B?.run?.id == req.args.run && active(B.run, t))
					return { error: 'the run is still going' };
				remove_run(req.args.run);
				if (B?.run?.id == req.args.run) {
					B.run = null;
					save();
				}
				return { deleted: true };
			}
		}
	},

	'milkflint.bench.member': {
		// the router's clock, for the member's clock sync (kept short: its time is the measurement)
		sync: {
			call: function(req) {
				if (!sid_member(req.args.ubus_rpc_session))
					return NOT_MEMBER;
				return { now: now_ms() };
			}
		},
		// the bench as this member sees it; also its heartbeat. `run`: the
		// id of the run whose schedule it has already (left out then);
		// `signals`: the last WebRTC signal it has; `clock_us`: how far its
		// clock sync may be off
		poll: {
			args: { run: 'id', signals: 0, visible: true, clock_us: 0, phase: 0, note: 'note', live: {} },
			call: function(req) {
				const c = member(req);
				if (!c)
					return NOT_MEMBER;
				const m = c.m, t = c.t;
				const a = req.args;
				m.seen = t;
				if (type(a.visible) == 'bool')
					m.visible = a.visible;
				if (type(a.clock_us) == 'int' && a.clock_us >= 0)
					m.clock_us = min(a.clock_us, 10000000);
				if (type(a.phase) == 'int' && a.phase >= -1 && a.phase < MAX_PHASES)
					m.phase = a.phase;
				if (type(a.note) == 'string' && length(a.note) <= 64 && !match(a.note, /[[:cntrl:]]/))
					m.note = a.note;
				m.live = member_live(a.live);
				if (m.id == B.coordinator)
					B.coordinator_seen = t;
				if (active(B.run, t) && t - (B.heartbeat ?? 0) >= 1000) {
					B.heartbeat = t;
					writefile(HEARTBEAT, sprintf('%.0f', t));
				}
				// signals it has seen are delivered
				const after = type(a.signals) == 'int' ? a.signals : 0;
				const box = filter(B.mailbox[m.id] ?? [], (s) => s.n > after);
				B.mailbox[m.id] = box;
				if (t - saved_at > 10000)
					save();
				const coord = m.id == B.coordinator;
				const run = run_info(B.run, t, B.run && a.run != B.run.id);
				if (run && run.state in [ 'running', 'stopping' ])
					run.live = live_files(B.run);
				return {
					now: t, me: m.id,
					bench: {
						id: B.id, name: B.name, coordinator: B.coordinator,
						// the coordinator shows the QR code and code, to invite more devices
						token: coord ? B.token : null, code: coord ? B.code : null,
						code_disabled: coord ? B.code_failures >= MAX_CODE_FAILURES : null,
						shaper: shaper(t)
					},
					members: map(sort(values(B.members), (x, y) => x.joined - y.joined), (x) => card(x, t)),
					run, signals: box
				};
			}
		},
		// a member's name: its own, or anyone's for the coordinator
		rename: {
			args: { member: 'm1', name: 'name' },
			call: function(req) {
				const c = member(req);
				if (!c)
					return NOT_MEMBER;
				const id = req.args.member ?? c.m.id;
				if (id != c.m.id && c.m.id != B.coordinator)
					return NOT_COORDINATOR;
				if (!valid_member_id(id) || !B.members[id])
					return { error: 'no such member' };
				if (!valid_name(req.args.name))
					return { error: 'invalid name' };
				B.members[id].name = trim(req.args.name);
				save();
				return { name: B.members[id].name };
			}
		},
		// the member's results for a run, in order (`seq` from 0); a repeat is acknowledged, not stored again
		report: {
			args: { run: 'id', seq: 0, records: [] },
			call: function(req) {
				const c = member(req);
				if (!c)
					return NOT_MEMBER;
				const m = c.m;
				const a = req.args;
				const r = B.run;
				if (!r || a.run != r.id || run_state(r, c.t) == 'done')
					return { error: 'not the current run' };
				if (type(a.seq) != 'int' || a.seq < 0 || type(a.records) != 'array')
					return { error: 'invalid report' };
				r.seq ??= {};
				if (a.seq <= (r.seq[m.id] ?? -1))
					return { stored: false };
				const line = sprintf('%J\n', { m: m.id, seq: a.seq, records: a.records });
				if (length(line) > REPORT_BYTES)
					return { error: 'the report is too long' };
				const path = `${RUNS}/${r.id}/m-${m.id}.jsonl`;
				if ((stat(path)?.size ?? 0) + length(line) > MEMBER_BYTES)
					return { error: 'this member has sent all a run can hold' };
				const f = open(path, 'a');
				if (!f)
					return { error: 'the run is gone' };
				f.write(line);
				f.close();
				r.seq[m.id] = a.seq;
				return { stored: true };
			}
		},
		// a WebRTC offer or answer (`sdp`), or `bye`, for another member:
		// only while a run is on, and only to a member the run pairs it with
		signal: {
			args: { to: 'm1', pair: 'pair', kind: 'offer', sdp: 'sdp' },
			call: function(req) {
				const c = member(req);
				if (!c)
					return NOT_MEMBER;
				const a = req.args;
				if (!valid_member_id(a.to) || !B.members[a.to] || a.to == c.m.id)
					return { error: 'no such member' };
				if (type(a.pair) != 'string' || !match(a.pair, /^[a-z0-9-]{1,24}$/) || !(a.kind in [ 'offer', 'answer', 'bye' ]))
					return { error: 'invalid signal' };
				if (a.sdp != null && (type(a.sdp) != 'string' || length(a.sdp) > MAX_SDP))
					return { error: 'invalid sdp' };
				if (!active(B.run, c.t) || !paired(B.run, c.m.id, a.to))
					return { error: 'not paired in this run' };
				const box = B.mailbox[a.to] ??= [];
				let bytes = length(a.sdp ?? '');
				for (let s in box)
					bytes += length(s.sdp ?? '');
				if (length(box) >= MAILBOX || bytes > MAILBOX_BYTES)
					return { error: "the member's mailbox is full" };
				push(box, { n: ++B.signal_n, from: c.m.id, pair: a.pair, kind: a.kind, sdp: a.sdp });
				return { sent: B.signal_n };
			}
		},
		// stop the current run: every member stops its part within a poll, the router within a second
		stop: {
			call: function(req) {
				const c = member(req);
				if (!c)
					return NOT_MEMBER;
				const r = B.run;
				if (!active(r, c.t))
					return { stopping: false };
				if (!r.stop) {
					r.stop = { by: c.m.name, at: c.t };
					writefile(`${RUNS}/${r.id}/stop`, `stopped by ${c.m.name}`);
					save();
				}
				return { stopping: true };
			}
		},
		leave: {
			call: function(req) {
				const c = member(req);
				if (!c)
					return NOT_MEMBER;
				end_sessions([ c.m.sid ]);
				delete B.members[c.m.id];
				delete B.mailbox[c.m.id];
				if (B.coordinator == c.m.id)
					B.coordinator = null;
				save();
				return { left: true };
			}
		},
		// this bench's stored runs, newest first
		runs: {
			call: function(req) {
				const c = member(req);
				if (!c)
					return NOT_MEMBER;
				return { runs: map(filter(stored_runs(), (r) => r.meta.bench == B.id), run_summary) };
			}
		},
		// a part of one of this bench's runs (see milkflint.bench run_get)
		run_get: {
			args: { run: 'id', part: 'meta', from: 0 },
			call: function(req) {
				const c = member(req);
				if (!c)
					return NOT_MEMBER;
				if (!valid_run_id(req.args.run) || load_json(`${RUNS}/${req.args.run}/meta.json`)?.bench != B.id)
					return { error: 'no such run' };
				return run_part(req.args.run, req.args.part, req.args.from ?? 0);
			}
		},
		// start a run (the coordinator): it begins LEAD_MS from now
		start: {
			args: { schedule: {} },
			call: function(req) {
				const c = member(req);
				if (!c)
					return NOT_MEMBER;
				const m = c.m, t = c.t;
				if (m.id != B.coordinator)
					return NOT_COORDINATOR;
				if (active(B.run, t))
					return { error: 'a run is on' };
				const s = checked_schedule(req.args.schedule);
				if (type(s) == 'string')
					return { error: s };
				const id = random_hex(6);
				const dir = `${RUNS}/${id}`;
				mkdir(DIR);
				mkdir(RUNS);
				mkdir(dir);
				const t0 = int(t + LEAD_MS);
				const members = map(sort(values(B.members), (x, y) => x.joined - y.joined),
					(x) => ({ id: x.id, name: x.name, ip: x.ip, ua: x.ua, platform: x.platform, link: link_of(x.ip) }));
				const meta = {
					id, bench: B.id, bench_name: B.name, created: t, created_wall: time(), t0, end: t0 + s.length,
					schedule: s, members, coordinator: m.name, settings: settings()
				};
				save_json(`${dir}/meta.json`, meta);
				save_json(REQUEST, { id, t0, end: meta.end, members: map(members, (x) => ({ id: x.id, ip: x.ip })), schedule: s, options: s.options });
				writefile(HEARTBEAT, sprintf('%.0f', t));
				B.heartbeat = t;
				B.run = { id, created: t, t0, end: meta.end, started_by: m.name, schedule: s };
				// the last run's WebRTC signals are no use to this one
				B.mailbox = {};
				save();
				prune(id);
				system([ 'start-stop-daemon', '-S', '-b', '-x', RUNNER ]);
				return { run: id, t0 };
			}
		},
		// make another member the coordinator
		handoff: {
			args: { member: 'm1' },
			call: function(req) {
				const c = member(req);
				if (!c)
					return NOT_MEMBER;
				if (c.m.id != B.coordinator)
					return NOT_COORDINATOR;
				if (!valid_member_id(req.args.member) || !B.members[req.args.member])
					return { error: 'no such member' };
				B.coordinator = req.args.member;
				save();
				return { coordinator: B.coordinator };
			}
		},
		// take a member off the bench (its session ends)
		kick: {
			args: { member: 'm1' },
			call: function(req) {
				const c = member(req);
				if (!c)
					return NOT_MEMBER;
				if (c.m.id != B.coordinator)
					return NOT_COORDINATOR;
				const id = req.args.member;
				if (!valid_member_id(id) || !B.members[id] || id == c.m.id)
					return { error: 'no such member' };
				end_sessions([ B.members[id].sid ]);
				delete B.members[id];
				delete B.mailbox[id];
				save();
				return { kicked: id };
			}
		}
	},

	// the join CGI's: only root on the router can call these
	'milkflint.bench.join': {
		// whether these credentials (token, code, or member + key) may join;
		// what to grant the session the CGI then creates
		check: {
			args: { token: 'token', code: 'code', member: 'm1', key: 'key', name: 'name', platform: 'platform' },
			call: function(req) {
				tidy(now_ms());
				const why = join_args(req.args);
				if (why)
					return { error: why };
				const c = credentials(req.args, true);
				if (c.error)
					return c;
				return { methods: MEMBER_METHODS, timeout: SESSION_S };
			}
		},
		// the session the CGI created for these credentials: a new member, or
		// the same member again (its old session ends)
		commit: {
			args: { token: 'token', code: 'code', member: 'm1', key: 'key', name: 'name', platform: 'platform', sid: 'sid', ip: 'ip', ua: 'ua' },
			call: function(req) {
				const t = now_ms();
				tidy(t);
				const a = req.args;
				if (type(a.sid) != 'string' || !match(a.sid, /^[0-9a-f]{32}$/))
					return { error: 'invalid session' };
				if (type(a.ip) != 'string' || !(match(a.ip, /^[0-9]{1,3}(\.[0-9]{1,3}){3}$/) || match(a.ip, /^[0-9a-fA-F:]{2,39}$/)))
					return { error: 'invalid address' };
				const why = join_args(a);
				if (why)
					return { error: why };
				const c = credentials(a, false);
				if (c.error)
					return c;
				const ua = type(a.ua) == 'string' ? substr(replace(a.ua, /[[:cntrl:]]/g, ''), 0, 200) : null;
				let m = c.member;
				if (m) {
					end_sessions([ m.sid ]);
					m.sid = a.sid;
					m.ip = a.ip;
					m.ua = ua ?? m.ua;
					m.seen = t;
				}
				else {
					const id = `m${B.next_member++}`;
					let name = trim(a.name ?? lease_name(a.ip) ?? a.platform ?? `Device ${substr(id, 1)}`);
					// a second device of the same kind: "Mac 2"
					const taken = map(values(B.members), (x) => x.name);
					if (a.name == null && name in taken) {
						let n = 2;
						while (`${name} ${n}` in taken)
							n++;
						name = `${name} ${n}`;
					}
					m = B.members[id] = {
						id, sid: a.sid, key: random_hex(8), ip: a.ip, ua, platform: a.platform, name,
						joined: t, seen: t, visible: true, clock_us: null, phase: -1, note: null
					};
				}
				links_at = 0;
				save();
				return { member: m.id, key: m.key, bench: B.id, name: m.name };
			}
		}
	}
};
