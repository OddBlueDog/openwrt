// rpcd plugin for the "wifi" feature: which of a radio's channels need radar
// detection (DFS; iwinfo's channel list doesn't say, `iw phy` does), the
// radar log and those channels' state now, the country rules, and the
// beamforming its access points run with.
'use strict';

import { lsdir, popen, readfile } from 'fs';
import { cursor } from 'uci';

// Linux's regulatory database (wireless-regdb, the rules the kernel
// enforces), read as the kernel does (net/wireless/reg.c): a header ("RGDB",
// version), then countries (alpha2, collection offset / 4) up to one with no
// collection; a collection is (len, n_rules, dfs_region), then 16-bit rule
// offsets / 4; a rule is (len, flags, max EIRP in mBm, start, end and max
// bandwidth in kHz, then optionally the DFS wait in s).
const REGDB = '/lib/firmware/regulatory.db';
const DFS_REGIONS = [ 'unset', 'FCC', 'ETSI', 'JP' ];

function u8(db, o) { return ord(db, o); }
function u16(db, o) { return (ord(db, o) << 8) | ord(db, o + 1); }
// ucode's integers are 64-bit: no sign trouble at bit 31
function u32(db, o) { return (ord(db, o) << 24) | (ord(db, o + 1) << 16) | (ord(db, o + 2) << 8) | ord(db, o + 3); }

// The countries the database has rules for ("00", the world rules, left out):
// a country without an entry is ignored by the kernel, which keeps the rules
// it had.
function regdb_countries() {
	const db = readfile(REGDB);
	const out = [];
	if (!db || substr(db, 0, 4) != 'RGDB')
		return out;
	for (let o = 8; o + 4 <= length(db); o += 4) {
		if (!(u16(db, o + 2) << 2))
			break;
		const c = substr(db, o, 2);
		if (c != '00')
			push(out, c);
	}
	return out;
}

function regdb_rules(alpha2) {
	const db = readfile(REGDB);
	if (!db || substr(db, 0, 4) != 'RGDB')
		return null;
	for (let o = 8; o + 4 <= length(db); o += 4) {
		const coll_ptr = u16(db, o + 2) << 2;
		if (!coll_ptr)
			break;
		if (substr(db, o, 2) != alpha2)
			continue;
		const len = u8(db, coll_ptr), n = u8(db, coll_ptr + 1), region = u8(db, coll_ptr + 2);
		const ptrs = coll_ptr + ((len + 1) & ~1);
		const rules = [];
		for (let i = 0; i < n; i++) {
			const r = u16(db, ptrs + i * 2) << 2;
			const rlen = u8(db, r), flags = u8(db, r + 1);
			push(rules, {
				start: u32(db, r + 4) / 1000,
				end: u32(db, r + 8) / 1000,
				max_bw: u32(db, r + 12) / 1000,
				eirp: u16(db, r + 2) / 100,
				no_ofdm: (flags & 1) != 0,
				indoor_only: (flags & 2) != 0,
				dfs: (flags & 4) != 0,
				no_ir: (flags & 8) != 0,
				auto_bw: (flags & 16) != 0,
				cac: rlen >= 18 ? u16(db, r + 16) : null
			});
		}
		return { country: alpha2, dfs_region: DFS_REGIONS[region] ?? 'unset', rules };
	}
	return null;
}

// A radio (phy), or the radio behind a Wi-Fi interface; null if neither.
function phy_of(dev) {
	const phy = readfile(`/sys/class/ieee80211/${dev}/name`) != null
		? dev
		: trim(readfile(`/sys/class/net/${dev}/phy80211/name`) ?? '');
	return match(phy, /^[A-Za-z0-9_.-]+$/) ? phy : null;
}

// hostapd's config for a phy (/var/run/hostapd-<phy>.conf, which wifi-scripts
// write with only what the radio supports and the settings allow; files of
// earlier phys stay behind after a driver reload, so only while an access
// point of this phy is up: its control socket). VHT (Wi-Fi 5) only on 5 GHz.
function beamforming(phy) {
	const running = length(filter(lsdir('/var/run/hostapd') ?? [], (s) => index(s, `${phy}-`) == 0)) > 0;
	const conf = running ? readfile(`/var/run/hostapd-${phy}.conf`) : null;
	if (conf == null)
		return { running: false, vht: null, he: null };
	const opt = {};
	for (let line in split(conf, '\n')) {
		const m = match(line, /^([a-z0-9_]+)=(.*)$/);
		if (m)
			opt[m[1]] = m[2];
	}
	const vhtcap = opt.vht_capab ?? '';
	const dim = (name) => +(match(vhtcap, regexp(`\\[${name}-([0-9]+)\\]`))?.[1] ?? 0) || null;
	return {
		running: true,
		vht: opt.ieee80211ac == '1' ? {
			su_beamformer: index(vhtcap, '[SU-BEAMFORMER]') >= 0,
			su_beamformee: index(vhtcap, '[SU-BEAMFORMEE]') >= 0,
			mu_beamformer: index(vhtcap, '[MU-BEAMFORMER]') >= 0,
			mu_beamformee: index(vhtcap, '[MU-BEAMFORMEE]') >= 0,
			// how many antennas it sounds the channel with, and steers with when receiving
			sounding_dimensions: dim('SOUNDING-DIMENSION'),
			beamformee_antennas: dim('BF-ANTENNA')
		} : null,
		he: opt.ieee80211ax == '1' ? {
			su_beamformer: opt.he_su_beamformer == '1',
			su_beamformee: opt.he_su_beamformee == '1',
			mu_beamformer: opt.he_mu_beamformer == '1'
		} : null
	};
}

// The radar events radar-log kept (oldest first, the last 200): time,
// interface, the event without hostapd's "DFS-" (LEFT: hostapd left its
// radar-check state, for fields.state) and its key=value fields.
const RADAR_LOG = '/root/milkflint-wifi/radar.log';

function radar_events() {
	const events = [];
	for (let path in [ RADAR_LOG + '.old', RADAR_LOG ]) {
		for (let line in split(readfile(path) ?? '', '\n')) {
			// "<ctime> [1792851635.123] phy1-ap0: DFS-CAC-START freq=5220 chan=44 sec_chan=1, width=2, ..."
			const m = match(line, /^.{24} \[([0-9]+)\.([0-9]+)\] ([^:]+): (.*)$/);
			if (!m)
				continue;
			const ev = { ms: int(m[1]) * 1000 + int(m[2]), iface: m[3], fields: {} };
			const words = split(m[4], ' ');
			if (index(m[4], 'interface state DFS->') == 0) {
				ev.event = 'LEFT';
				ev.fields.state = substr(m[4], length('interface state DFS->'));
			}
			else {
				ev.event = substr(shift(words), length('DFS-'));
				for (let w in words) {
					const kv = match(rtrim(w, ','), /^([a-z0-9_]+)=(.*)$/);
					if (kv)
						ev.fields[kv[1]] = kv[2];
				}
			}
			push(events, ev);
		}
	}
	return slice(events, -200);
}

// The radar channels of a phy now, from `iw phy <phy> channels`: usable
// (needs a radar check first), available (checked, usable at once) or
// unavailable (radar heard, off limits), for how long, and the check's length.
function dfs_channels(phy) {
	const out = [];
	let cur = null;
	const p = popen(`iw phy ${phy} channels`);
	for (let line = p.read('line'); length(line); line = p.read('line')) {
		let m = match(line, /\* ([0-9]+) MHz \[([0-9]+)\]/);
		if (m) {
			cur = { mhz: +m[1], channel: +m[2] };
			continue;
		}
		if (cur == null)
			continue;
		m = match(line, /DFS state: ([a-z]+)(.*\(for ([0-9]+) sec\))?/);
		if (m) {
			cur.state = m[1];
			cur.for_s = m[3] != null ? +m[3] : null;
			push(out, cur);
		}
		m = match(line, /DFS CAC time: ([0-9]+) ms/);
		if (m)
			cur.cac_ms = +m[1];
	}
	p.close();
	return out;
}

return {
	'milkflint.wifi': {
		countries: {
			call: function() {
				return { countries: regdb_countries() };
			}
		},
		// what a country lets Wi-Fi do, from the regulatory database (any country, before it's set)
		regulatory: {
			args: { country: 'country' },
			call: function(req) {
				const c = uc(req.args.country ?? '');
				if (!match(c, /^[A-Z0-9]{2}$/))
					return { error: 'invalid country' };
				return regdb_rules(c) ?? { error: 'no rules for this country' };
			}
		},
		dfs: {
			args: { device: 'device' },
			call: function(req) {
				const dev = req.args.device;
				if (type(dev) != 'string' || !match(dev, /^[A-Za-z0-9_.-]+$/))
					return { error: 'invalid device' };
				const phy = phy_of(dev);
				if (phy == null)
					return { mhz: [] };
				const mhz = [];
				const p = popen(`iw phy ${phy} info`);
				for (let line = p.read('line'); length(line); line = p.read('line')) {
					// "* 5260.0 MHz [52] (20.0 dBm) (radar detection)"
					const m = match(line, /\* ([0-9]+)(\.[0-9]+)? MHz \[[0-9]+\].*\(radar detection\)/);
					if (m)
						push(mhz, +m[1]);
				}
				p.close();
				return { mhz };
			}
		},
		// the radar log (every radio's; logging: radar-log keeps new events,
		// unless the Logs page turned it off) and this radio's radar channels now
		radar: {
			args: { device: 'device' },
			call: function(req) {
				const dev = req.args.device;
				if (type(dev) != 'string' || !match(dev, /^[A-Za-z0-9_.-]+$/))
					return { error: 'invalid device' };
				const phy = phy_of(dev);
				return {
					events: radar_events(),
					logging: cursor().get('milkflint', 'logs', 'radar') != '0',
					channels: phy == null ? [] : dfs_channels(phy)
				};
			}
		},
		// the beamforming the radio's access points run with, from hostapd's
		// config for it (by phy or interface); running: false while none is up
		beamforming: {
			args: { device: 'device' },
			call: function(req) {
				const dev = req.args.device;
				if (type(dev) != 'string' || !match(dev, /^[A-Za-z0-9_.-]+$/))
					return { error: 'invalid device' };
				const phy = phy_of(dev);
				return phy == null ? { running: false, vht: null, he: null } : beamforming(phy);
			}
		}
	}
};
