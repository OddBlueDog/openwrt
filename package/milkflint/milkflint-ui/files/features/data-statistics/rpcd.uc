// rpcd plugin for the "data-statistics" feature: nlbwmon's traffic
// accounting per device, and its accounting periods.
'use strict';

import { popen, access, lsdir, readfile } from 'fs';
import { cursor } from 'uci';
import * as uh from '/usr/libexec/milkflint/usage-history.uc';

function nlbw(args) {
	const fd = popen(`nlbw ${args} 2>/dev/null`, 'r');
	if (!fd)
		return null;
	const out = fd.read('all');
	fd.close();
	return out;
}

return {
	'milkflint.traffic': {
		// accounting periods with data, newest first (YYYY-MM-DD start dates);
		// none while it's off (milkflint.datastats.enabled: nlbwmon is stopped)
		periods: {
			call: function() {
				const enabled = cursor().get('milkflint', 'datastats', 'enabled') != '0';
				if (!access('/usr/sbin/nlbw', 'x'))
					return { installed: false, enabled, periods: [] };
				const out = nlbw('-c list') ?? '';
				return { installed: true, enabled, periods: sort(filter(split(trim(out), '\n'), (l) => match(l, /^\d{4}-\d{2}-\d{2}$/)), (a, b) => (a > b) ? -1 : ((a < b) ? 1 : 0)) };
			}
		},
		// the opt-in 24-hour history (usage-history sampler): each device's
		// bytes over the last 1/4/8/24 h, and the samples of one device (the
		// sum of all when mac is ''); nothing while the switch is off
		history: {
			args: { mac: '' },
			call: function(req) {
				const c = cursor();
				const on = c.get('milkflint', 'datastats', 'enabled') != '0' && c.get('milkflint', 'datastats', 'history') == '1';
				if (!on)
					return { on: false, since: null, windows: {}, series: [] };
				const now = time();
				const mac = lc(req.args.mac ?? '');
				const lines = [];
				for (let f in lsdir(uh.DIR) ?? []) {
					if (uh.hour_start(f) == null || uh.expired(f, now))
						continue;
					for (let l in split(readfile(`${uh.DIR}/${f}`) ?? '', '\n')) {
						if (l == '')
							continue;
						try {
							push(lines, json(l));
						}
						catch (e) {
							// a torn last line
						}
					}
				}
				return { on: true, since: uh.since(lines, now), windows: uh.windows(lines, now), series: uh.series(lines, mac, now) };
			}
		},
		// traffic per device (mac) or per protocol (layer7) in a period
		usage: {
			args: { period: '', group: 'mac' },
			call: function(req) {
				const group = (req.args.group == 'layer7') ? 'layer7' : 'mac,ip';
				let args = `-c json -g ${group} -o -rx_bytes`;
				if (match(req.args.period ?? '', /^\d{4}-\d{2}-\d{2}$/))
					args += ` -t ${req.args.period}`;
				let parsed = null;
				try {
					parsed = json(nlbw(args) ?? 'null');
				}
				catch (e) {
					parsed = null;
				}
				return parsed ?? { columns: [], data: [] };
			}
		}
	}
};
