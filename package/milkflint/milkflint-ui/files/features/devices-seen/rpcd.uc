// rpcd plugin for the "devices-seen" feature (ubus milkflint.devices): when each
// device was first and last seen by the router. Written by bin/devices-seen.
'use strict';

import { readfile } from 'fs';

const FILE = '/etc/milkflint/devices-seen.json';

return {
	'milkflint.devices': {
		// {}: { since, devices: { <mac>: [ first, last ] } } as the recorder keeps it;
		// { since: null, devices: {} } before it has seen anything
		seen: {
			call: function() {
				let d = null;
				try {
					d = json(readfile(FILE) ?? '');
				}
				catch (e) {
				}
				if (type(d?.devices) != 'object')
					return { since: null, devices: {} };
				return { since: d.since, devices: d.devices };
			}
		}
	}
};
