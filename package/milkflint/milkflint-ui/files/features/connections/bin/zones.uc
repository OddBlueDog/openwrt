// The firewall zones, as the connections reader and the devices-seen recorder
// both read them. Nothing here touches anything but uci.
'use strict';

import { cursor } from 'uci';

// The networks of the inside zones: every zone that doesn't masquerade (masq
// not '1': LAN, guests, Remote access) and isn't disabled (enabled not '0').
// A zone's `network` is a list, or one space-separated string. Returns a set,
// { "<network name>": true }.
export function inside_networks() {
	const nets = {};
	cursor().foreach('firewall', 'zone', (z) => {
		if (z.masq == '1' || z.enabled == '0')
			return;
		for (let n in (type(z.network) == 'array' ? z.network : split(z.network ?? '', ' ')))
			if (length(n))
				nets[n] = true;
	});
	return nets;
};
