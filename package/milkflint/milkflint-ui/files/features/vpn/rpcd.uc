// rpcd plugin for the VPN pages (Remote access, VPN client): WireGuard's
// live state, new keys, the public key of a private one, the UDP ports in
// use, and whether dnsmasq can fill the sites-that-go-direct sets (the
// router flushes them itself when the list changes: vpn-direct.uc). Keys
// only travel through pipes, never on a command line, and the state it
// returns has no private or preshared keys. ubus object "milkflint.vpn".
'use strict';

import { access, popen, readfile, stat, unlink } from 'fs';

const WG = '/usr/bin/wg';
const DNSMASQ = '/usr/sbin/dnsmasq';

function output(cmd) {
	const p = popen(cmd, 'r');
	if (!p)
		return '';
	const out = p.read('all') ?? '';
	p.close();
	return out;
}

// 32 bytes in base64: 43 characters, the last of them only one of 16, then '='
function is_key(s) {
	return type(s) == 'string' && match(s, /^[A-Za-z0-9+\/]{42}[AEIMQUYcgkosw048]=$/) != null;
}

function new_key(cmd) {
	const k = trim(output(`${WG} ${cmd} 2>/dev/null`));
	return is_key(k) ? k : null;
}

// rpcd runs one call at a time, so one file for the answer is enough; it
// only ever holds a public key
function public_key(private_key) {
	const out = '/tmp/milkflint-wg.pub';
	const p = popen(`${WG} pubkey > ${out} 2>/dev/null`, 'w');
	if (!p)
		return null;
	p.write(private_key + '\n');
	p.close();
	const k = trim(readfile(out) ?? '');
	unlink(out);
	return is_key(k) ? k : null;
}

function installed() {
	return access(WG, 'x') == true;
}

// Whether dnsmasq was built with nftset (dnsmasq-full; the basic build says
// no-nftset among its compile-time options). Asked once per binary: the
// status call comes every few seconds, and the binary only changes with an
// upgrade or a package swap, which its inode, size and time show. Only an
// answer that has the options in it is kept: a failed run (no memory for
// the pipe, say) is asked again next time, rather than kept as no nftset,
// which would have the page offer to delete the list.
let nftset_seen = null;
function nftset() {
	const st = stat(DNSMASQ);
	if (!st)
		return false;
	const key = `${st.inode}:${st.size}:${st.mtime}`;
	if (nftset_seen?.key == key)
		return nftset_seen.value;
	const out = output(`${DNSMASQ} --version 2>/dev/null`);
	const value = index(out, ' nftset') >= 0;
	if (index(out, 'Compile time options') >= 0)
		nftset_seen = { key, value };
	return value;
}

// /proc/net/udp and udp6: "sl local_address rem_address st ...", the local
// port in hex after the address's colon
function udp_ports() {
	const seen = {};
	for (let file in [ '/proc/net/udp', '/proc/net/udp6' ]) {
		for (let line in split(readfile(file) ?? '', '\n')) {
			const f = split(trim(line), /[ \t]+/);
			const m = match(f[1] ?? '', /:([0-9A-Fa-f]{4})$/);
			if (m)
				seen[hex(m[1])] = true;
		}
	}
	return sort(map(keys(seen), (p) => +p), (a, b) => a - b);
}

// the watcher's verdict (vpn-watch.uc writes it), or null without one, or
// with one that doesn't parse (the status call itself carries on)
function tunnel_state() {
	const raw = readfile('/var/run/milkflint/vpn-tunnel.json');
	if (raw == null)
		return null;
	let t = null;
	try {
		t = json(raw);
	}
	catch (e) {
		return null;
	}
	if (type(t) != 'object' || type(t.up) != 'bool')
		return null;
	return {
		up: t.up,
		since: +t.since || 0,
		reason: (t.reason == 'interface' || t.reason == 'no-answer' || t.reason == 'no-handshake') ? t.reason : null,
		dns_ok: (type(t.dns_ok) == 'bool') ? t.dns_ok : null
	};
}

return {
	'milkflint.vpn': {
		// `wg show all dump`: an interface's line has 5 fields (name, private
		// key, public key, port, fwmark), a peer's 9 (name, public key,
		// preshared key, endpoint, allowed IPs, latest handshake, rx, tx,
		// keepalive)
		status: {
			call: function() {
				if (!installed())
					return { installed: false, now: time(), interfaces: [], tunnel: null, nftset: nftset() };
				const by_name = {};
				const order = [];
				for (let line in split(output(`${WG} show all dump 2>/dev/null`), '\n')) {
					const f = split(line, '\t');
					if (length(f) == 5) {
						by_name[f[0]] = {
							name: f[0],
							public_key: f[2],
							listen_port: (+f[3] > 0) ? +f[3] : null,
							fwmark: (f[4] == 'off') ? null : f[4],
							peers: []
						};
						push(order, f[0]);
					}
					else if (length(f) == 9 && by_name[f[0]]) {
						push(by_name[f[0]].peers, {
							public_key: f[1],
							endpoint: (f[3] == '(none)') ? null : f[3],
							allowed_ips: (f[4] == '(none)') ? [] : split(f[4], ','),
							latest_handshake: +f[5],
							rx_bytes: +f[6],
							tx_bytes: +f[7],
							keepalive: (f[8] == 'off') ? null : +f[8]
						});
					}
				}
				return {
					installed: true,
					now: time(),
					interfaces: map(order, (n) => by_name[n]),
					tunnel: tunnel_state(),
					nftset: nftset()
				};
			}
		},
		// a new key pair, and a preshared key to go with it
		keys: {
			call: function() {
				if (!installed())
					return { error: 'not installed' };
				const private_key = new_key('genkey');
				const preshared_key = new_key('genpsk');
				const pub = (private_key == null) ? null : public_key(private_key);
				if (pub == null || preshared_key == null)
					return { error: 'wg failed' };
				return { private_key, public_key: pub, preshared_key };
			}
		},
		pubkey: {
			args: { private_key: '' },
			call: function(req) {
				if (!installed() || !is_key(req.args.private_key))
					return { public_key: null };
				return { public_key: public_key(req.args.private_key) };
			}
		},
		udp_ports: {
			call: function() {
				return { ports: udp_ports() };
			}
		}
	}
};
