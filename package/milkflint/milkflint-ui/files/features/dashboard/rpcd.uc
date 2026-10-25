// rpcd plugin for the "dashboard" feature: the sensor recorder's samples.
'use strict';

import { readfile } from 'fs';

return {
	'milkflint.sensors': {
		// samples newer than `since` (epoch seconds; 0 = all of the last hour)
		history: {
			args: { since: 0 },
			call: function(req) {
				let state = null;
				try {
					state = json(readfile('/tmp/milkflint/sensors.json') ?? 'null');
				}
				catch (e) {
					state = null;
				}
				const since = req.args.since ?? 0;
				return {
					now: time(),
					interval: state?.interval ?? null,
					samples: filter(state?.samples ?? [], (x) => x.t > since)
				};
			}
		}
	}
};
