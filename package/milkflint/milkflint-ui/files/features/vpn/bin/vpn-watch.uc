// The VPN client's tunnel watcher, its pure logic (ui feature "vpn"; the
// loop is bin/vpn-watch, a procd instance of /etc/init.d/milkflint-vpn).
// Interface state can't see a dead WireGuard server: wg_out stays up in
// netifd while nothing comes back. So the watcher, every INTERVAL (10 s):
//   - samples `wg show wg_out dump` (latest handshake, rx/tx bytes) and
//     netifd's up flag (sample);
//   - suspects the server (judge) when:
//     - netifd has the interface down ('interface');
//     - data went out with nothing back for NO_RX (15 s) ('no-answer'): a
//       live peer sends a keepalive within 10 s of receiving data, and the
//       sender itself starts a new handshake after 15 s without an answer
//       (WireGuard's KEEPALIVE_TIMEOUT + REKEY_TIMEOUT). Keepalives alone
//       (32 bytes) aren't data waiting for an answer;
//     - the latest handshake is over HS_MAX (180 s) old, only with
//       persistent keepalive set: its keepalives make even an idle tunnel
//       handshake every 120 s (REKEY_AFTER_TIME), and 180 s is the keys'
//       REJECT_AFTER_TIME. OpenWrt's wireguard_watchdog moved from 150 to
//       180 s in May 2026 (PR #23248), as 150 s gave false alarms. Without
//       keepalive an idle tunnel doesn't handshake at all, so its age says
//       nothing ('no-answer');
//     - no handshake at all NO_HS (30 s) after the interface came up
//       ('no-handshake');
//   - when suspect, and every check while down, confirms with a probe: one
//     DNS A query (probe_query), PROBE_TIMEOUT (2 s), sent with SO_MARK
//     0x10000000 (so it takes the VPN's routing rule) and SO_BINDTODEVICE
//     wg_out (so it can never be answered over the WAN), to the VPN's DNS
//     servers or else 1.1.1.1 and 9.9.9.9 in turn (probe_server). A probe
//     tests the tunnel, not the DNS (answered): it counts as answered if
//     the DNS answers, the peer's rx grows, or a newer handshake appears in
//     its window, so a slow or wrong VPN DNS on a working tunnel can't fake
//     "down". The probes are also the outbound traffic that makes WireGuard
//     try its handshake again once it has given up (after ~90 s);
//   - counts (step): FAILS (3) failed probes in a row → down; OKS (3)
//     answered in a row → up. So at least 30 s each way, and no flapping.
//     Coming back doesn't wait for a handshake under 30 s old: after a short
//     outage WireGuard's keys are still valid, and only the peer can make rx
//     grow or answer the DNS. The interface down in netifd is no shortcut
//     either: it's judged like any suspicion, as netifd can lag behind a VPN
//     just turned on (rule 1002 and the leak DROP block meanwhile);
//   - also checks the VPN's DNS now and then while up (DNS_CHECK), only for
//     dns_ok (dns_state): whether its DNS answers on a working tunnel;
//   - on a change (plan): loads or deletes the table, reloads milkflint-vpn
//     so the forwarder's mode follows, and cuts the devices' connections
//     whenever some of them went out directly before or will now (the kill
//     switch off at either end: masqueraded flows keep the address they
//     started with), and on any change of the kill switch while down. With
//     it on all along nothing is cut: their direct sites' streams carry on.
// While down, the table inet milkflint_vpn_down (down_ruleset) is loaded:
//   - kill switch off: the marked devices' mark is cleared just after fw4's
//     mangle, so they're ordinary devices (main routing, the router's DNS,
//     AdGuard Home's guard no longer applies) until it's back;
//   - kill switch on: the mark stays (rule 1002's unreachable and the WAN
//     drop keep blocking), their lookups go to the :5455 forwarder in refuse
//     mode (only the direct sites answer), lookups on connections opened
//     before the table (which its redirect can't change) are dropped, DoT
//     to the router is refused and their DNS to other zones dropped. It
//     never clears the mark. A connection to another zone's DNS that the
//     flow table already carried skips the forward drop (offloaded packets
//     pass no chain), and can't be cut alone: OpenWrt's conntrack flush
//     takes whole addresses, and there is no conntrack tool in the image.
'use strict';

export const IFACE = 'wg_out';
export const TABLE = 'milkflint_vpn_down';
export const STATE_FILE = '/var/run/milkflint/vpn-tunnel.json';
export const VPN_MARK = '0x10000000';
export const VPN_MASK = '0xf0000000';
export const VPN_DNS_PORT = 5455;

export const INTERVAL = 10;
export const NO_RX = 15;
export const HS_MAX = 180;
export const NO_HS = 30;
export const PROBE_TIMEOUT = 2;
export const FAILS = 3;
export const OKS = 3;
// how often a working tunnel's DNS is checked, for dns_ok
export const DNS_CHECK = 300;
// how far back judge keeps samples
export const HISTORY = 120;
// a step's tx growth this size or under is keepalives (32 bytes each: up to
// a passive and a persistent one in 10 s), not data
export const KEEPALIVE_BYTES = 64;

export const PROBE_NAME = 'a.root-servers.net';
export const PROBE_SERVERS = [ '1.1.1.1', '9.9.9.9' ];

// `wg show wg_out dump` (an interface line of 4 fields, a peer's 8) or
// `wg show all dump` (each with the interface's name first: 5 and 9) and
// netifd's up flag, at `now`: one sample, its peers' counters summed and
// their newest handshake. No wg_out in the kernel is down.
export function sample(dump, iface_up, now) {
	const s = { up_if: false, hs: 0, rx: 0, tx: 0, keepalive: null, at: now };
	let found = false;
	for (let line in split(dump ?? '', '\n')) {
		let f = split(line, '\t');
		const n = length(f);
		if (n == 5 || n == 9) {
			if (f[0] != IFACE)
				continue;
			f = slice(f, 1);
		}
		else if (n != 4 && n != 8)
			continue;
		if (length(f) == 4) {
			found = true;
			continue;
		}
		const hs = +f[4], rx = +f[5], tx = +f[6];
		if (hs > s.hs)
			s.hs = hs;
		s.rx += (rx >= 0) ? rx : 0;
		s.tx += (tx >= 0) ? tx : 0;
		const ka = (f[7] == 'off') ? null : +f[7];
		if (ka > 0 && (s.keepalive == null || ka < s.keepalive))
			s.keepalive = ka;
	}
	s.up_if = found && iface_up == true;
	return s;
};

// hist: the recent samples, newest last. Returns null (nothing wrong seen)
// or why the server is suspect: 'interface', 'no-handshake' or 'no-answer'.
// It keeps hist bounded, in place: samples older than HISTORY go, and so
// does everything before a counter reset (rx or tx lower than before: netifd
// made wg_out again), so the new interface's empty counters are judged on
// their own and never read as traffic.
export function judge(hist, now) {
	let n = length(hist);
	if (!n)
		return null;
	for (let i = n - 1; i > 0; i--)
		if (hist[i].rx < hist[i - 1].rx || hist[i].tx < hist[i - 1].tx) {
			splice(hist, 0, i);
			break;
		}
	let old = 0;
	while (old < length(hist) - 1 && hist[old].at < now - HISTORY)
		old++;
	if (old)
		splice(hist, 0, old);
	n = length(hist);
	const cur = hist[n - 1];
	if (!cur.up_if)
		return 'interface';

	// since the interface came up, as far as the history goes back
	let first = n - 1;
	while (first > 0 && hist[first - 1].up_if)
		first--;
	if (cur.hs == 0 && now - hist[first].at >= NO_HS)
		return 'no-handshake';

	// rx unchanged since hist[j]; the first data sent after that, sent
	// after hist[i - 1] was taken
	let j = n - 1;
	while (j > first && hist[j - 1].rx == cur.rx)
		j--;
	for (let i = j + 1; i < n; i++)
		if (hist[i].tx - hist[i - 1].tx > KEEPALIVE_BYTES) {
			if (now - hist[i - 1].at >= NO_RX)
				return 'no-answer';
			break;
		}

	if (cur.keepalive != null && cur.hs > 0 && now - cur.hs > HS_MAX)
		return 'no-answer';
	return null;
};

// a probe's window, from the sample before it to the one after: answered
// if the DNS answered, the peer's rx grew or a newer handshake appeared
export function answered(before, after, dns_ok) {
	if (dns_ok == true)
		return true;
	if (!before || !after)
		return false;
	return after.rx > before.rx || after.hs > before.hs;
};

// the watcher's state at its start: up, with no table, until probes say not
export function start(now) {
	return { up: true, fails: 0, oks: 0, since: now, reason: null };
};

// st = { up, fails, oks, since, reason }; ev = { suspect (judge's), probed,
// answered, now } → the new state (st isn't changed).
// Up: a failed probe counts, an answered one or a check with nothing
// suspect starts again, and the third failure in a row goes down, with the
// suspicion as the reason (the interface down too: no shortcut, since netifd
// can lag behind a VPN just turned on).
// Down: answered probes in a row count, a failed one starts again, and OKS
// of them go up.
export function step(st, ev) {
	const s = { up: st.up != false, fails: st.fails ?? 0, oks: st.oks ?? 0, since: st.since, reason: st.reason };
	if (s.up) {
		if (ev.probed && !ev.answered) {
			s.fails++;
			if (s.fails >= FAILS) {
				s.up = false;
				s.since = ev.now;
				s.reason = ev.suspect ?? 'no-answer';
				s.fails = 0;
				s.oks = 0;
			}
		}
		else if (ev.probed || !ev.suspect)
			s.fails = 0;
	}
	else if (ev.probed) {
		s.oks = ev.answered ? s.oks + 1 : 0;
		if (s.oks >= OKS) {
			s.up = true;
			s.since = ev.now;
			s.reason = null;
			s.fails = 0;
			s.oks = 0;
		}
	}
	return s;
};

// What a check's change does, from was = { up, ks } (the state and the kill
// switch at the last check) to now: { table: 'on' | 'off' (load that down
// table) | 'delete' | null, cut (the VPN devices' connections), reload
// (milkflint-vpn, for the forwarder's mode) }. A masqueraded connection
// keeps the source address it started with, so one that changes way (the
// tunnel or the WAN) hangs until it's cut and starts again.
//   - down: the table for the kill switch; cut with it off (they go out
//     directly now; with it on, their direct sites' streams carry on);
//   - back up: the table goes; cut unless the kill switch was on all along
//     (their direct connections move back into the tunnel);
//   - the kill switch changed while down: the other table, and a cut either
//     way: turned on, they were going out directly; turned off, their
//     connections still have the tunnel's address and would never recover.
export function plan(was, now) {
	const a = { table: null, cut: false, reload: false };
	if (was.up && !now.up) {
		a.table = now.ks ? 'on' : 'off';
		a.cut = !now.ks;
	}
	else if (!was.up && now.up) {
		a.table = 'delete';
		a.cut = !was.ks || !now.ks;
	}
	else if (!now.up && (was.ks == true) != (now.ks == true)) {
		a.table = now.ks ? 'on' : 'off';
		a.cut = true;
	}
	a.reload = a.table != null;
	return a;
};

// dns_ok after a check: null without the VPN's own DNS to ask (vpn_dns);
// else, when a probe went to it (replied true or false; null: no probe),
// true if it answered, false if it didn't while the tunnel worked (working:
// the peer answered in the probe's window, or nothing was suspect while
// up), and unchanged if it didn't with the tunnel in doubt (that says
// nothing about the DNS)
export function dns_state(prev, vpn_dns, replied, working) {
	if (!vpn_dns)
		return null;
	if (replied == null)
		return prev;
	if (replied)
		return true;
	return working ? false : prev;
};

// whether the watcher runs: wg_out enabled, with at least one device or
// network marked for it, and not in access point mode
export function wanted(c) {
	if (c.get('milkflint', 'mode', 'mode') == 'ap')
		return false;
	const i = c.get_all('network', IFACE);
	if (!i || i.disabled == '1' || i.proto != 'wireguard')
		return false;
	let marked = false;
	c.foreach('firewall', 'rule', (r) => {
		if (r.enabled != '0' && index(r['.name'], 'wg_out_mark_') == 0)
			marked = true;
	});
	return marked;
};

// the kill switch: network.wg_out_kill there and not turned off (disabled),
// as the VPN page and Home's VPN card read it; wg_out_kill6 alone is only
// the tunnel having no IPv6. vpn-dns.uc's forwarder_mode and AdGuard Home's
// tunnel_direct read it here too.
export function killswitch(c) {
	const r = c.get_all('network', 'wg_out_kill');
	return r != null && !(r.disabled in [ '1', 'true', 'yes', 'on', 'enabled' ]);
};

// an interface name nft can take in quotes
function ifname_ok(d) {
	return type(d) == 'string' && length(d) > 0 && length(d) < 16 &&
		index(d, '"') < 0 && index(d, '\\') < 0 && index(d, '\n') < 0;
}

// The down table, replacing any loaded one in the same transaction.
// ifaces: the inside interfaces the VPN's devices come in on; direct: the
// direct sites (piece 5), only counted in a comment (the forwarder's refuse
// mode answers them).
export function down_ruleset(killswitch, ifaces, direct) {
	const names = filter(ifaces ?? [], ifname_ok);
	const mark = `meta mark & ${VPN_MASK} == ${VPN_MARK}`;
	let t = `table inet ${TABLE}\ndelete table inet ${TABLE}\n` +
		`table inet ${TABLE} {\n` +
		'\tset ifaces {\n\t\ttype ifname\n' +
		(length(names) ? `\t\telements = { ${join(', ', map(names, (d) => `"${d}"`))} }\n` : '') +
		'\t}\n';
	if (!killswitch) {
		t += '\tchain prerouting {\n' +
			'\t\ttype filter hook prerouting priority mangle + 1; policy accept;\n' +
			`\t\tiifname @ifaces ${mark} meta mark set meta mark & 0x0fffffff counter comment "MilkFlint: VPN down, no kill switch: its devices go out directly"\n` +
			'\t}\n';
	}
	else {
		const nd = length(direct ?? []);
		const sites = nd == 0 ? 'nothing' : nd == 1 ? 'only the 1 direct site' : `only the ${nd} direct sites`;
		t += '\tchain dstnat {\n' +
			'\t\ttype nat hook prerouting priority dstnat - 6; policy accept;\n' +
			`\t\tiifname @ifaces ${mark} meta l4proto { tcp, udp } th dport 53 counter redirect to :${VPN_DNS_PORT} comment "MilkFlint: VPN down, kill switch on: lookups go to the forwarder, which answers ${sites}"\n` +
			'\t}\n' +
			'\tchain input {\n' +
			'\t\ttype filter hook input priority filter - 1; policy accept;\n' +
			`\t\tiifname @ifaces ${mark} meta l4proto { tcp, udp } th dport != ${VPN_DNS_PORT} ct original proto-dst 53 counter drop comment "MilkFlint: VPN down, kill switch on: no lookups on connections opened before"\n` +
			`\t\t${mark} meta l4proto { tcp, udp } th dport 853 counter reject comment "MilkFlint: VPN down, kill switch on: no DNS over TLS to the router"\n` +
			'\t}\n' +
			'\tchain forward {\n' +
			'\t\ttype filter hook forward priority filter - 1; policy accept;\n' +
			`\t\t${mark} meta l4proto { tcp, udp } th dport { 53, 853 } counter drop comment "MilkFlint: VPN down, kill switch on: no DNS to other networks"\n` +
			'\t}\n';
	}
	return t + '}\n';
};

// the probe: an A query for PROBE_NAME with recursion desired
export function probe_query(id) {
	let q = chr(id >> 8, id & 255, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0);
	for (let label in split(PROBE_NAME, '.'))
		q += chr(length(label)) + label;
	return q + chr(0, 0, 1, 0, 1);
};

// whether `d` is a reply to the probe `id`, whatever its rcode: any answer
// is the server answering
export function probe_reply(d, id) {
	return type(d) == 'string' && length(d) >= 12 &&
		((ord(d, 0) << 8) | ord(d, 1)) == id && (ord(d, 2) & 0x80) != 0;
};

// the n-th probe's server: the VPN's DNS servers in turn, else PROBE_SERVERS'
export function probe_server(servers, n) {
	const list = length(servers ?? []) ? servers : PROBE_SERVERS;
	return list[n % length(list)];
};
