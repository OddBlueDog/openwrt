// rpcd plugin for the "dns" feature: whether the encrypted-DNS proxy
// (AdGuard's dnsproxy) is installed and running, and a DNS program set up
// outside MilkFlint that devices' lookups reach (bin/dns-path.uc).
'use strict';

import { access } from 'fs';
import { connect } from 'ubus';
import * as dnspath from '/usr/libexec/milkflint/dns-path.uc';

return {
	'milkflint.dns': {
		status: {
			call: function() {
				const installed = access('/etc/init.d/dnsproxy', 'x') == true;
				let running = false;
				if (installed) {
					const bus = connect();
					const svc = bus?.call('service', 'list', { name: 'dnsproxy' });
					bus?.disconnect();
					for (let name, inst in svc?.dnsproxy?.instances ?? {})
						if (inst.running)
							running = true;
				}
				// { how: 'front' | 'forward', program, addr, port, file }, or none
				const outside = dnspath.lookups().outside;
				return outside ? { installed, running, outside } : { installed, running };
			}
		}
	}
};
