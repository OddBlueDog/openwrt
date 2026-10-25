// rpcd plugin for the "upgrade" feature: check an uploaded firmware image
// (/tmp/firmware.bin, uploaded through cgi-io like LuCI does), then start
// sysupgrade or throw the image away.
'use strict';

import { stat, unlink, popen } from 'fs';

const IMAGE = '/tmp/firmware.bin';

function run(cmd) {
	const fd = popen(cmd + ' 2>&1', 'r');
	if (!fd)
		return { code: -1, output: '' };
	const output = fd.read('all');
	const code = fd.close();
	return { code, output };
}

return {
	'milkflint.upgrade': {
		check: {
			call: function() {
				const st = stat(IMAGE);
				if (!st)
					return { present: false };
				const sum = run(`sha256sum ${IMAGE}`);
				const test = run(`/sbin/sysupgrade --test ${IMAGE}`);
				return {
					present: true,
					size: st.size,
					sha256: split(sum.output, ' ')[0],
					test_ok: test.code == 0,
					test_output: trim(test.output)
				};
			}
		},
		// keep: keep settings; force: install although the checks failed
		start: {
			args: { keep: true, force: false },
			call: function(req) {
				if (!stat(IMAGE))
					return { started: false };
				let opts = '';
				if (req.args.keep === false)
					opts += ' -n';
				if (req.args.force === true)
					opts += ' -F';
				system(`(sleep 2; /sbin/sysupgrade${opts} ${IMAGE}) > /dev/null 2>&1 &`);
				return { started: true };
			}
		},
		discard: {
			call: function() {
				unlink(IMAGE);
				return { discarded: true };
			}
		}
	}
};
