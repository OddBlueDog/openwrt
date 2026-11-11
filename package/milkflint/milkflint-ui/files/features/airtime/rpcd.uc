// rpcd plugin for the "airtime" feature: what the airtime service sees and
// does (/tmp/milkflint/airtime.json), for the Wi-Fi page. Reading it also
// says someone is looking, which keeps the service measuring while every
// band's policy is off.
'use strict';

import { readfile, writefile, mkdir } from 'fs';

const DIR = '/tmp/milkflint';

return {
	'milkflint.airtime': {
		// { running, now, radios: [{ phy, radio, band, channel, width, channels, on, weights, pacing,
		//   rates: { full, pace, weak }, goals: { slow, weak, lost }, auto, competing, busy, other, noise,
		//   devices: [{ mac, name, dev, ssid, signal, rate, rx_rate, delivery,
		//   useful, class, reason, weight, narrowed, tries, paced, pace, held, aim, trim,
		//   air_tx, air_rx, tx_mbit, rx_mbit, asleep, tx_phy, rx_phy, chains, connected }],
		//   history: [{ t, full, slow, weak, lost, other }] }] }
		// `running` is false while the service hasn't written a state in the
		// last few seconds (it isn't installed or started, or it has only
		// just been asked to measure).
		status: {
			call: function() {
				mkdir(DIR);
				writefile(`${DIR}/airtime.watch`, '');
				let state = null;
				try {
					state = json(readfile(`${DIR}/airtime.json`) ?? 'null');
				}
				catch (e) {
					state = null;
				}
				const now = time();
				const fresh = type(state?.t) == 'int' && now - state.t <= 5 && !state.idle;
				return { running: fresh, now, radios: fresh ? (state.radios ?? []) : [] };
			}
		}
	}
};
