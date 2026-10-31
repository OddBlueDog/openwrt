// rpcd plugin for the "network-quality" feature: the probe daemon's samples.
'use strict';

import { readfile } from 'fs';
import { cursor } from 'uci';

const HISTORY = '/root/milkflint-netquality';

// the probe's minute stats ([typical, worst, lost, rounds]) merged: the
// median of the typicals, the worst worst, losses and rounds added up (as
// the probe's merge() for its -15m files: keep the two alike)
function merge(stats) {
	stats = filter(stats, (x) => x != null);
	if (!length(stats))
		return null;
	const typ = sort(filter(map(stats, (x) => x[0]), (v) => v != null), (a, b) => a - b);
	const worst = filter(map(stats, (x) => x[1]), (v) => v != null);
	let lost = 0, rounds = 0;
	for (let x in stats) {
		lost += x[2];
		rounds += x[3];
	}
	return [ length(typ) ? typ[int((length(typ) - 1) / 2)] : null, length(worst) ? max(...worst) : null, lost, rounds ];
}

function day_name(t) {
	const d = gmtime(t);
	return sprintf('%04d-%02d-%02d', d.year, d.mon, d.mday);
}

// a day file's minute lines: one json() for the whole file (a 7-day view
// parsed line by line takes seconds on the router), line by line only when a
// line is damaged, e.g. cut short by a power cut
function day_lines(name) {
	const text = trim(readfile(`${HISTORY}/${name}.jsonl`) ?? '');
	if (text == '')
		return [];
	try {
		return json(`[${replace(text, /\n/g, ',')}]`);
	}
	catch (e) {
		const out = [];
		for (let line in split(text, '\n')) {
			try {
				push(out, json(line));
			}
			catch (e2) {
				// skip it
			}
		}
		return out;
	}
}

return {
	'milkflint.netquality': {
		// samples newer than `since` (epoch seconds; 0 = all of the last hour)
		status: {
			args: { since: 0 },
			call: function(req) {
				let state = null;
				try {
					state = json(readfile('/tmp/milkflint/netquality.json') ?? 'null');
				}
				catch (e) {
					state = null;
				}
				const since = req.args.since ?? 0;
				const s = cursor().get_all('milkflint', 'netquality') ?? {};
				return {
					enabled: s.enabled == '1',
					now: time(),
					interval: state?.interval ?? null,
					targets: state?.targets ?? null,
					// false: the gateway hasn't answered a ping since the probe
					// started (many providers' don't); null: no gateway
					gateway_answers: state?.gateway_answers ?? null,
					samples: filter(state?.samples ?? [], (x) => x.t > since)
				};
			}
		},
		// the minute history of the last `span` seconds (up to 8 days) in
		// `step`-second buckets (at least 60): { now, start, step, days,
		// buckets: [{ i, internet, dns, gateway?, routes?, dns_servers? }] }, bucket i
		// covering start + i * step. Steps of whole quarter hours read the
		// probe's -15m files (7 days of minutes would take seconds).
		history: {
			args: { span: 86400, step: 120 },
			call: function(req) {
				const span = min(max(int(req.args.span ?? 86400), 3600), 8 * 86400);
				const step = max(int(req.args.step ?? 120), 60);
				const now = time();
				const start = now - span;
				const s = cursor().get_all('milkflint', 'netquality') ?? {};
				const groups = {};
				const quarters = (step % 900 == 0);
				for (let day = start - start % 86400; day <= now; day += 86400) {
					let lines = day_lines(day_name(day) + (quarters ? '-15m' : ''));
					// what the quarter hours don't cover yet (the one going on,
					// or since the history began) from the day's minutes
					const covered = length(lines) ? lines[-1].t + 900 : day;
					if (quarters && covered < min(day + 86400, now))
						lines = [ ...lines, ...filter(day_lines(day_name(day)), (m) => m?.t >= covered) ];
					for (let m in lines) {
						if (type(m?.t) != 'int' || m.t < start)
							continue;
						const i = int((m.t - start) / step);
						push(groups[i] ??= [], m);
					}
				}
				const buckets = [];
				for (let i in sort(map(keys(groups), (k) => +k), (a, b) => a - b)) {
					const ms = groups[i];
					const b = { i, internet: merge(map(ms, (m) => m.internet)), dns: merge(map(ms, (m) => m.dns)) };
					const gw = merge(map(ms, (m) => m.gateway));
					if (gw != null)
						b.gateway = gw;
					for (let field in [ 'routes', 'dns_servers' ]) {
						const by = {};
						for (let m in ms)
							for (let k, v in m[field] ?? {})
								push(by[k] ??= [], v);
						if (length(by)) {
							b[field] = {};
							for (let k, v in by)
								b[field][k] = merge(v);
						}
					}
					push(buckets, b);
				}
				return { now, start, step, days: int(s.history_days ?? 7), buckets };
			}
		}
	}
};
