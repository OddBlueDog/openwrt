// rpcd plugin for the "wifi-scan" feature: start a scan of nearby Wi-Fi
// networks, and read what the last one found. The scan itself runs in the
// background (/usr/libexec/milkflint/wifi-scan), since it takes seconds and
// rpcd answers one call at a time; it writes its results to STATE.
'use strict';

import { mkdir, readfile, rename, writefile } from 'fs';

const STATE = '/tmp/milkflint/wifi-scan.json';
// a scan that hasn't finished by then died (it gives up after 30 s)
const STALE_S = 60;

function state() {
	try {
		return json(readfile(STATE) ?? 'null');
	}
	catch (e) {
		return null;
	}
}

function running(s) {
	return s?.state == 'running' && time() - s.started < STALE_S;
}

return {
	'milkflint.wifiscan': {
		// scan these radios (phys) from their access points, all at once;
		// their devices hear nothing from them for the second or few it takes
		start: {
			args: { phys: [] },
			call: function(req) {
				const phys = req.args.phys;
				if (type(phys) != 'array' || !length(phys) || length(phys) > 8)
					return { error: 'invalid phys' };
				for (let p in phys)
					if (type(p) != 'string' || !match(p, /^phy[0-9]+$/) || readfile(`/sys/class/ieee80211/${p}/index`) == null)
						return { error: 'invalid phy' };
				if (running(state()))
					return { error: 'busy' };
				mkdir('/tmp/milkflint');
				writefile(`${STATE}.tmp`, sprintf('%J', { state: 'running', started: time(), phys }));
				rename(`${STATE}.tmp`, STATE);
				system(`/usr/libexec/milkflint/wifi-scan ${join(' ', phys)} > /dev/null 2>&1 &`);
				return { started: true };
			}
		},
		// the last scan (state none, running, done or failed) and the router's clock
		results: {
			call: function() {
				const s = state() ?? { state: 'none' };
				if (s.state == 'running' && !running(s))
					s.state = 'failed';
				s.now = time();
				return s;
			}
		}
	}
};
