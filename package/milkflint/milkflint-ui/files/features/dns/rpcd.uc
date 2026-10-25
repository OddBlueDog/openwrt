// rpcd plugin for the "dns" feature: whether the encrypted-DNS proxy
// (AdGuard's dnsproxy) is installed and running.
'use strict';

import { access } from 'fs';
import { connect } from 'ubus';

return {
	'milkflint.dns': {
		status: {
			call: function() {
				const installed = access('/etc/init.d/dnsproxy', 'x') == true;
				let running = false;
				if (installed) {
					const svc = connect()?.call('service', 'list', { name: 'dnsproxy' });
					for (let name, inst in svc?.dnsproxy?.instances ?? {})
						if (inst.running)
							running = true;
				}
				return { installed, running };
			}
		}
	}
};
