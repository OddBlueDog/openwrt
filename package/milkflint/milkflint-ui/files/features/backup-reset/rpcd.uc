// rpcd plugin for the "backup-reset" feature: factory reset. It answers
// first, then erases the settings overlay and restarts (firstboot -r).
'use strict';

return {
	'milkflint.maintenance': {
		factory_reset: {
			call: function() {
				system('(sleep 2; /sbin/firstboot -r -y) > /dev/null 2>&1 &');
				return { scheduled: true };
			}
		}
	}
};
