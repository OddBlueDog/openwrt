// Pure helpers of the opt-in 24-hour per-device history (ui feature
// "data-statistics"): the sampler (usage-history) and the rpcd method
// milkflint.traffic history use them. Hourly files
// /root/milkflint-usage/<YYYYMMDDHH>.jsonl (UTC hour of the sample) hold one
// line per sample, {"t":<epoch>,"d":{"<mac>":[down,up]}}, with the devices
// that moved only. Nothing here touches the disk or the clock.
'use strict';

export const DIR = '/root/milkflint-usage';
export const KEEP = 86400;	// s a sample is read, and an hour's file kept after the hour ends
export const AHEAD = 300;	// s a line may be ahead of the clock

// nlbw -c json -g mac, parsed -> { "<mac>": [ down, up ] }: rx_bytes is the
// device's download, tx_bytes its upload (as the Data usage page reads it)
export function columns(nlbw) {
	const out = {};
	const cols = nlbw?.columns;
	if (type(cols) != 'array' || type(nlbw?.data) != 'array')
		return out;
	let cm = -1, cr = -1, ct = -1;
	for (let i, c in cols) {
		if (c == 'mac')
			cm = i;
		else if (c == 'rx_bytes')
			cr = i;
		else if (c == 'tx_bytes')
			ct = i;
	}
	if (cm < 0 || cr < 0 || ct < 0)
		return out;
	for (let row in nlbw.data) {
		const mac = row[cm];
		if (type(mac) != 'string' || length(mac) != 17)
			continue;
		const k = lc(mac);
		const d = (type(row[cr]) == 'int') ? row[cr] : 0;
		const u = (type(row[ct]) == 'int') ? row[ct] : 0;
		out[k] = out[k] ? [ out[k][0] + d, out[k][1] + u ] : [ d, u ];
	}
	return out;
};

// whether any device's total fell between two readings (nlbwmon's period
// started, or it reloaded an older database)
export function fell(prev, cur) {
	if (prev == null || cur == null)
		return false;
	for (let mac, c in cur) {
		const p = prev[mac];
		if (p != null && (c[0] < p[0] || c[1] < p[1]))
			return true;
	}
	return false;
};

// what each device moved between two readings of the totals. A device whose
// total fell in either direction (both restart together) counts the new
// reading for both, when `new_period` says nlbwmon's period has changed since
// `prev`; in the same period the fall is a crash and reload, which counts
// nothing (the device starts a new baseline). A device not in `prev` counts
// its whole reading; no `prev` (the first reading) counts nothing.
export function delta(prev, cur, new_period) {
	const out = {};
	if (prev == null || cur == null)
		return out;
	for (let mac, c in cur) {
		const p = prev[mac];
		if (p == null)
			out[mac] = [ c[0], c[1] ];
		else if (c[0] < p[0] || c[1] < p[1])
			out[mac] = new_period ? [ c[0], c[1] ] : [ 0, 0 ];
		else
			out[mac] = [ c[0] - p[0], c[1] - p[1] ];
	}
	return out;
};

function two(n) {
	return (n < 10 ? '0' : '') + n;
}

// the file for the hour `t` falls in
export function hour_file(t) {
	const d = gmtime(t);
	return `${DIR}/${d.year}${two(d.mon)}${two(d.mday)}${two(d.hour)}.jsonl`;
};

// the start of the hour a file name (or path) stands for, or null
export function hour_start(name) {
	const base = (index(name, '/') >= 0) ? replace(name, /^.*\//, '') : name;
	const m = match(base, /^(\d{4})(\d{2})(\d{2})(\d{2})\.jsonl$/);
	if (!m)
		return null;
	return timegm({ year: +m[1], mon: +m[2], mday: +m[3], hour: +m[4], min: 0, sec: 0 });
};

// whether an hour's file should be deleted: 24 h after its hour ended, or,
// once the clock is known to be right (`synced`), more than an hour in the
// future (the clock was wrong when it was written). A stale clock at boot
// makes real files look like the future, so those are kept until then. A name
// that isn't an hour file is never expired.
export function expired(name, now, synced) {
	const s = hour_start(name);
	if (s == null)
		return false;
	return s + 3600 + KEEP <= now || (synced == true && s > now + 3600);
};

// whether a parsed line is one the windows and the series read
export function valid(line, now) {
	return type(line) == 'object' && type(line.t) == 'int' && type(line.d) == 'object'
		&& line.t >= now - KEEP && line.t <= now + AHEAD;
};

// the oldest time of the lines that are read, or null
export function since(lines, now) {
	let t = null;
	for (let line in lines)
		if (valid(line, now) && (t == null || line.t < t))
			t = line.t;
	return t;
};

// each device's bytes over the last 1, 4, 8 and 24 hours:
// { "<mac>": { h1: [down, up], h4, h8, h24 } }. Lines older than 24 h or
// more than 5 minutes ahead of `now` are ignored.
export function windows(lines, now) {
	const spans = [ [ 'h1', 3600 ], [ 'h4', 14400 ], [ 'h8', 28800 ], [ 'h24', 86400 ] ];
	const out = {};
	for (let line in lines) {
		if (!valid(line, now))
			continue;
		for (let mac, v in line.d) {
			if (type(v) != 'array')
				continue;
			const w = out[mac] ??= { h1: [ 0, 0 ], h4: [ 0, 0 ], h8: [ 0, 0 ], h24: [ 0, 0 ] };
			for (let s in spans)
				if (line.t >= now - s[1]) {
					w[s[0]][0] += v[0] ?? 0;
					w[s[0]][1] += v[1] ?? 0;
				}
		}
	}
	return out;
};

// one device's samples, oldest first, [[t, down, up], ...]; the sum of all
// devices when `mac` is ''
export function series(lines, mac, now) {
	const pts = [];
	for (let line in lines) {
		if (!valid(line, now))
			continue;
		let d = 0, u = 0;
		for (let k, v in line.d)
			if ((mac == '' ? k != '00:00:00:00:00:00' : k == mac) && type(v) == 'array') {
				d += v[0] ?? 0;
				u += v[1] ?? 0;
			}
		if (mac == '' || line.d[mac] != null)
			push(pts, [ line.t, d, u ]);
	}
	return sort(pts, (a, b) => a[0] - b[0]);
};
