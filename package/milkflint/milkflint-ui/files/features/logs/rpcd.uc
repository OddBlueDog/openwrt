// rpcd plugin for the "logs" feature: the system log, the kernel log, the
// Wi-Fi log, the radar log (the "wifi" feature's radar-log), the debug log
// (counters and snapshots), the DNS log and the kernel's last crash reports
// (pstore).
// With milkflint.logs.persist on, the system and kernel logs come from the
// copy /usr/libexec/milkflint/logs-keeper keeps on the router's storage,
// which goes back past the last reboot.
'use strict';

import { popen, stat, lsdir, readfile } from 'fs';
import { cursor } from 'uci';

const DISK = '/root/milkflint-logs';
const RAM = '/tmp/milkflint-logs';
const RADAR = '/root/milkflint-wifi/radar.log';
// what the kernel saved before its last crashes (ramoops): dmesg-ramoops-N
// is an oops or panic's kernel log, console-ramoops-N the console up to
// the last reboot, where the kernel keeps one
const PSTORE = '/sys/fs/pstore';

function run(cmd) {
	const fd = popen(cmd + ' 2>/dev/null', 'r');
	if (!fd)
		return [];
	const out = fd.read('all');
	fd.close();
	return filter(split(out, '\n'), (l) => length(l) > 0);
}

function settings() {
	const s = cursor().get_all('milkflint', 'logs') ?? {};
	return {
		persist: s.persist == '1',
		wifi: s.wifi != '0',
		channel: s.wifi_channel != '0',
		mu: s.wifi_mu != '0',
		rrm: s.wifi_rrm != '0',
		net: s.wifi_net != '0',
		radar: s.radar != '0',
		counters: s.debug_counters == '1',
		snapshot: s.debug_snapshot == '1',
		dns: s.dns == '1'
	};
}

// the last n lines of <path>.old and <path> together
function tail(path, n) {
	const lines = run(`tail -n ${n} ${path}`);
	if (length(lines) >= n)
		return lines;
	const older = run(`tail -n ${n - length(lines)} ${path}.old`);
	push(older, ...lines);
	return older;
}

function bytes(path) {
	return (stat(path)?.size ?? 0) + (stat(path + '.old')?.size ?? 0);
}

function crash_files() {
	return sort(filter(lsdir(PSTORE) ?? [], (f) => match(f, /^(dmesg|console)-ramoops-[0-9]+$/)));
}

// by localtime()'s wday % 7: ucode counts Monday 1 to Sunday 7
const DAYS = [ 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat' ];
const MONTHS = [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ];

// a time as logread writes it (ctime), so the headers read like the lines
function ctime(t) {
	const l = localtime(t);
	return sprintf('%s %s %2d %02d:%02d:%02d %d', DAYS[l.wday % 7], MONTHS[l.mon - 1], l.mday, l.hour, l.min, l.sec, l.year);
}

// each report under a line saying what it is and when the kernel wrote
// it; the last n lines of them all
function crash_lines(n) {
	const out = [];
	for (let f in crash_files()) {
		const what = match(f, /^dmesg/) ? 'the kernel log of a crash' : 'the console up to the last restart';
		push(out, `---- ${f}: ${what}, recorded ${ctime(stat(`${PSTORE}/${f}`)?.mtime ?? 0)} ----`);
		push(out, ...filter(split(readfile(`${PSTORE}/${f}`) ?? '', '\n'), (l) => length(l) > 0));
	}
	return slice(out, max(0, length(out) - n));
}

return {
	'milkflint.logs': {
		read: {
			args: { kind: 'system', lines: 500 },
			call: function(req) {
				const n = (type(req.args.lines) == 'int' && req.args.lines > 0 && req.args.lines <= 5000) ? req.args.lines : 500;
				const s = settings();
				const kind = req.args.kind;
				if (kind == 'wifi' || kind == 'debug' || kind == 'dns')
					return { lines: tail(`${s.persist ? DISK : RAM}/${kind}.log`, n) };
				// "<ctime> [<epoch>.<ms>] <interface>: <event>": without the
				// epoch, which is only there for the radar log's own restarts
				if (kind == 'radar')
					return { lines: map(tail(RADAR, n), (l) => replace(l, /^(.{24}) \[[0-9]+\.[0-9]+\]/, '$1')) };
				if (kind == 'crash')
					return { lines: crash_lines(n) };
				if (s.persist && stat(DISK + '/system.log')) {
					if (kind == 'kernel')
						return { lines: run(`cat ${DISK}/system.log.old ${DISK}/system.log | grep ' kernel: ' | tail -n ${n}`) };
					return { lines: tail(DISK + '/system.log', n) };
				}
				if (kind == 'kernel')
					return { lines: run(`dmesg | tail -n ${n}`) };
				// with the DNS log on, dnsmasq logs every lookup: the keeper
				// keeps those out of system.log, and they're left out here
				if (s.dns)
					return { lines: run(`logread | grep -v -E ' dnsmasq\\[[0-9]+\\]: [0-9]+ [^ ]+/[0-9]+ ' | tail -n ${n}`) };
				return { lines: run(`logread -l ${n}`) };
			}
		},
		// where the logs are kept, how big they are, and whether the keeper runs
		status: {
			call: function() {
				const s = settings();
				let svc = null;
				try {
					svc = json(join('\n', run(`ubus call service list '{"name":"milkflint-logs"}'`)) || '{}');
				}
				catch (e) {
					svc = null;
				}
				let recording = false;
				for (let name, inst in svc?.['milkflint-logs']?.instances ?? {})
					if (inst.running == true)
						recording = true;
				return {
					persist: s.persist,
					wifi: s.wifi,
					channel: s.channel,
					mu: s.mu,
					rrm: s.rrm,
					net: s.net,
					radar: s.radar,
					counters: s.counters,
					snapshot: s.snapshot,
					dns: s.dns,
					recording,
					dir: s.persist ? DISK : RAM,
					system_bytes: s.persist ? bytes(DISK + '/system.log') : null,
					wifi_bytes: s.wifi ? bytes(`${s.persist ? DISK : RAM}/wifi.log`) : null,
					radar_bytes: s.radar ? bytes(RADAR) : null,
					debug_bytes: (s.counters || s.snapshot) ? bytes(`${s.persist ? DISK : RAM}/debug.log`) : null,
					dns_bytes: s.dns ? bytes(`${s.persist ? DISK : RAM}/dns.log`) : null,
					crash_reports: length(filter(crash_files(), (f) => match(f, /^dmesg/)))
				};
			}
		}
	}
};
