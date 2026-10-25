// rpcd plugin for the "upnp" feature: the port mappings devices have opened
// through UPnP / NAT-PMP (miniupnpd's lease file), and clearing them.
'use strict';

import { readfile, unlink } from 'fs';
import { cursor } from 'uci';

function lease_file() {
	return cursor().get('upnpd', 'config', 'upnp_lease_file') ?? '/var/run/miniupnpd.leases';
}

return {
	'milkflint.upnp': {
		mappings: {
			call: function() {
				const out = [];
				// PROTO:EXT_PORT:INT_IP:INT_PORT:EXPIRES:DESCRIPTION
				for (let line in split(readfile(lease_file()) ?? '', '\n')) {
					const f = split(line, ':', 6);
					if (length(f) < 6)
						continue;
					const expires = +f[4];
					// seconds left by the router's clock; null: the mapping never expires
					const remaining = (expires > 0) ? ((expires > time()) ? expires - time() : 0) : null;
					push(out, { proto: f[0], ext_port: +f[1], int_addr: f[2], int_port: +f[3], remaining, description: f[5] });
				}
				return { mappings: out };
			}
		},
		// Stopping miniupnpd flushes its firewall chains, but it restores every
		// mapping in the lease file when it starts, so remove that in between.
		clear: {
			call: function() {
				system('/etc/init.d/miniupnpd stop > /dev/null 2>&1');
				unlink(lease_file());
				system('/etc/init.d/miniupnpd start > /dev/null 2>&1');
				return { cleared: true };
			}
		}
	}
};
