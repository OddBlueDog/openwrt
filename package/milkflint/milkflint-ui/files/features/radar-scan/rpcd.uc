// rpcd plugin for the "radar-scan" feature: start and stop a DFS radar scan
// of the 5 GHz radio's radar channels, its progress and results, and the
// chip's radar reports. The scan runs in the background
// (/usr/libexec/milkflint/radar-scan), since it takes minutes and takes the
// 5 GHz network down meanwhile (rpcd answers one call at a time); it writes
// its state to STATE.
'use strict';

import { mkdir, popen, readfile, rename, unlink, writefile } from 'fs';
import { cursor } from 'uci';

const DIR = '/tmp/milkflint';
const STATE = DIR + '/radar-scan.json';
const REQUEST = DIR + '/radar-scan-request.json';
const STOP = DIR + '/radar-scan.stop';
const MIN_S = 10;
const MAX_S = 3600;
// the 5 GHz network stays down for the whole scan: at most two hours
const MAX_TOTAL_S = 7200;

function state() {
	try {
		return json(readfile(STATE) ?? 'null');
	}
	catch (e) {
		return null;
	}
}

function alive(pid) {
	return type(pid) == 'int' && index(readfile(`/proc/${pid}/cmdline`) ?? '', 'radar-scan') >= 0;
}

function running(s) {
	return (s?.state == 'starting' || s?.state == 'running') && alive(s.pid);
}

// the channels with radar detection on a phy, and their DFS state
function radar_channels(phy) {
	const out = {};
	let ch = null;
	const p = popen(`iw phy ${phy} channels`);
	for (let line = p.read('line'); length(line); line = p.read('line')) {
		let m = match(line, /\* [0-9]+ MHz \[([0-9]+)\]/);
		if (m) {
			ch = +m[1];
			continue;
		}
		m = match(line, /DFS state: ([a-z]+)/);
		if (m && ch != null)
			out[ch] = m[1];
	}
	p.close();
	return out;
}

// the chip's radar reports, as radar-scan reads them; null when the driver doesn't keep them
function reports(phy) {
	const text = readfile(`/sys/kernel/debug/ieee80211/${phy}/mt76/rdd_reports`);
	if (text == null)
		return null;
	const out = [];
	for (let line in split(text, '\n')) {
		const w = split(trim(line), ' ');
		if (w[0] == 'report') {
			const r = { seq: +w[1], pulses: [] };
			for (let i = 2; i + 1 < length(w); i += 2)
				r[w[i]] = (w[i] == 'pri_stg') ? map(split(w[i + 1], ','), (x) => +x) : +w[i + 1];
			push(out, r);
		}
		else if (w[0] == 'pulse' && length(out))
			push(out[length(out) - 1].pulses, { kind: w[1], start: +w[3], width: +w[5], power: +w[7] });
	}
	return out;
}

const valid_phy = (p) => type(p) == 'string' && match(p, /^phy[0-9]+$/) && readfile(`/sys/class/ieee80211/${p}/index`) != null;

return {
	'milkflint.radarscan': {
		// listen on these blocks ({ freq: control MHz, width: 20/40/80/160,
		// center: MHz }) of the 5 GHz radio, `seconds` each, its network down meanwhile
		start: {
			args: { radio: 'radio', phy: 'phy', blocks: [], seconds: 60 },
			call: function(req) {
				const a = req.args;
				if (type(a.radio) != 'string' || !match(a.radio, /^[A-Za-z0-9_]+$/) ||
				    cursor().get('wireless', a.radio, 'band') != '5g')
					return { error: 'invalid radio' };
				if (!valid_phy(a.phy))
					return { error: 'invalid phy' };
				const seconds = a.seconds;
				if (type(seconds) != 'int' || seconds < MIN_S || seconds > MAX_S)
					return { error: 'invalid seconds' };
				if (type(a.blocks) != 'array' || !length(a.blocks) || length(a.blocks) > 8 ||
				    length(a.blocks) * seconds > MAX_TOTAL_S)
					return { error: 'invalid blocks' };
				const dfs = radar_channels(a.phy);
				const blocks = [];
				for (let b in a.blocks) {
					if (type(b) != 'object' || !(b.width in [ 20, 40, 80, 160 ]) || type(b.freq) != 'int' || type(b.center) != 'int')
						return { error: 'invalid block' };
					const n = b.width / 20;
					const centre = (b.center - 5000) / 5;
					const channels = [];
					for (let i = 0; i < n; i++)
						push(channels, centre - 2 * (n - 1) + 4 * i);
					// every channel needs radar detection, and the control channel is one of them
					if (length(filter(channels, (ch) => dfs[ch] == null)) || !(((b.freq - 5000) / 5) in channels))
						return { error: 'invalid block' };
					push(blocks, { freq: b.freq, width: b.width, center: b.center, channels });
				}
				if (running(state()))
					return { error: 'busy' };
				mkdir(DIR);
				unlink(STOP);
				writefile(REQUEST, sprintf('%J', { radio: a.radio, phy: a.phy, seconds, blocks }));
				writefile(`${STATE}.tmp`, sprintf('%J', { state: 'starting', started: time(), radio: a.radio, phy: a.phy, seconds,
					blocks: map(blocks, (b) => ({ ...b, status: 'waiting' })) }));
				rename(`${STATE}.tmp`, STATE);
				system([ 'start-stop-daemon', '-S', '-b', '-x', '/usr/libexec/milkflint/radar-scan' ]);
				return { started: true, seconds: length(blocks) * seconds };
			}
		},
		// end the scan early: it stops listening within a second and brings 5 GHz back
		stop: {
			call: function() {
				if (!running(state()))
					return { stopping: false };
				mkdir(DIR);
				writefile(STOP, '');
				return { stopping: true };
			}
		},
		// the last scan (state none, starting, running or done), whether its process is alive, and the router's clock
		status: {
			call: function() {
				const s = state() ?? { state: 'none' };
				s.alive = alive(s.pid);
				s.now = time();
				return s;
			}
		},
		// the chip's radar reports (the last 8, from scans and normal use); reports null when the driver doesn't keep them
		reports: {
			args: { phy: 'phy' },
			call: function(req) {
				if (!valid_phy(req.args.phy))
					return { error: 'invalid phy' };
				return { reports: reports(req.args.phy), now: time() };
			}
		}
	}
};
