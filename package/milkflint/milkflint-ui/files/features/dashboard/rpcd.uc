// rpcd plugin for the "dashboard" feature (Home): the sensor recorder's
// samples, and Home's layout.
//
// The layout (ui/src/features/dashboard/layout.ts) is the widgets the user
// placed on Home, in order, each with its size in columns (1 to 4) and rows
// (1 or 2), the same for every device, in one small JSON file that an upgrade
// and a backup keep (the package's conffiles). `set` with `widgets` replaces
// it and refuses anything but that shape (ids are checked against the
// widgets the page knows when it reads them back); `set` without them
// removes it, and Home follows the theme's layout again.
'use strict';

import { readfile, writefile, rename, mkdir, unlink, access } from 'fs';

const HOME_DIR = '/etc/milkflint';
const HOME_FILE = `${HOME_DIR}/home.json`;
const HOME_MAX_WIDGETS = 64;
const HOME_MAX_BYTES = 4096;

const read_json = (path) => {
	try {
		return json(readfile(path) ?? 'null');
	}
	catch (e) {
		return null;
	}
};

const whole = (v, low, high) => type(v) == 'int' && v >= low && v <= high;

// The widgets in the stored shape, or null when anything else is there.
function home_widgets(list) {
	if (type(list) != 'array' || length(list) > HOME_MAX_WIDGETS)
		return null;
	// a widget may be on Home more than once (two of Guest Wi-Fi, a CPU tile and its graph)
	const out = [];
	for (let w in list) {
		if (type(w) != 'object' || type(w.id) != 'string' || match(w.id, /^[a-z][a-z0-9-]{0,31}$/) == null)
			return null;
		if (type(w.size) != 'object' || !whole(w.size.w, 1, 4) || !whole(w.size.h, 1, 2))
			return null;
		push(out, { id: w.id, size: { w: w.size.w, h: w.size.h } });
	}
	return out;
}

function home_get() {
	const data = read_json(HOME_FILE);
	const widgets = type(data) == 'object' ? home_widgets(data.widgets) : null;
	// none saved, or a file that isn't what `set` writes: the theme's layout
	return widgets == null ? {} : { widgets };
}

function home_set(req) {
	const list = req.args?.widgets;
	if (list == null) {
		if (access(HOME_FILE) && !unlink(HOME_FILE))
			return { error: 'write' };
		return { saved: true };
	}
	const widgets = home_widgets(list);
	if (widgets == null)
		return { error: 'widgets' };
	const text = sprintf('%J', { widgets });
	if (length(text) > HOME_MAX_BYTES)
		return { error: 'size' };
	mkdir(HOME_DIR);
	if (!writefile(`${HOME_FILE}.tmp`, text) || !rename(`${HOME_FILE}.tmp`, HOME_FILE))
		return { error: 'write' };
	return { saved: true };
}

return {
	'milkflint.sensors': {
		// samples newer than `since` (epoch seconds; 0 = all of the last hour)
		history: {
			args: { since: 0 },
			call: function(req) {
				const state = read_json('/tmp/milkflint/sensors.json');
				const since = req.args.since ?? 0;
				return {
					now: time(),
					interval: state?.interval ?? null,
					samples: filter(state?.samples ?? [], (x) => x.t > since)
				};
			}
		}
	},
	'milkflint.home': {
		get: { call: home_get },
		set: { args: { widgets: [] }, call: home_set }
	}
};
