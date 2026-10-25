// rpcd plugin for the "admin-password" feature: whether the admin (root)
// account has a password. A fresh install (or a factory reset) has none, as
// on OpenWrt, until one is set; rpcd's login then takes any password, and
// the web interface asks for one on every page. Only says yes or no.
'use strict';

import { readfile } from 'fs';

return {
	'milkflint.adminpassword': {
		status: {
			call: function() {
				let hash = null;
				for (let line in split(readfile('/etc/shadow') ?? '', '\n')) {
					const f = split(line, ':');
					if (f[0] == 'root')
						hash = f[1] ?? '';
				}
				// "root::...", as a fresh install has it
				return { set: hash != null && hash != '' };
			}
		}
	}
};
