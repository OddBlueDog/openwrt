// rpcd plugin for the "pkg-update" feature (ubus milkflint.packages): the
// package updater's status, version check and install for the packages with a
// hook (bin/pkg-update.d/<name>.uc: AdGuard Home, banIP). The work is
// bin/pkg-update's, run detached; this only starts it and reads what it wrote.
'use strict';

import { readfile, access } from 'fs';

const RUN = '/var/run/milkflint';
const UPDATER = '/usr/libexec/milkflint/pkg-update';
const HOOKS = '/usr/libexec/milkflint/pkg-update.d';
// a status left busy this long (seconds) is a run that died: bin/pkg-update's
// STALE is the same
const STALE = 600;

// names with a hook only (and nothing path-like: the name is part of file names)
function known(name) {
	return type(name) == 'string' && length(name) <= 64 && !!match(name, /^[a-z0-9][a-z0-9_-]*$/) && !!access(`${HOOKS}/${name}.uc`);
}

function sh_quote(s) {
	return `'${replace(s, "'", "'\\''")}'`;
}

// the installed version, from apk's database ('' for none)
function installed(name) {
	const db = '\n' + (readfile('/lib/apk/db/installed') ?? '');
	const at = index(db, `\nP:${name}\n`);
	if (at < 0)
		return '';
	const rest = substr(db, at + 1);
	const end = index(rest, '\n\n');
	const block = end < 0 ? rest : substr(rest, 0, end);
	for (let l in split(block, '\n'))
		if (substr(l, 0, 2) == 'V:')
			return substr(l, 2);
	return '';
}

function status_of(name) {
	let st = null;
	try {
		st = json(readfile(`${RUN}/pkg-update-${name}.json`) ?? 'null');
	}
	catch (e) {
		st = null;
	}
	if (type(st) != 'object')
		st = { busy: false };
	if (st.busy && time() - (st.started ?? 0) >= STALE) {
		st.busy = false;
		st.waiting = false;
	}
	st.installed = installed(name);
	return st;
}

// start-stop-daemon with its own pid file: it would otherwise take the
// monitor (also ucode) for the updater already running
function start(name, action, version) {
	const cmd = `start-stop-daemon -S -b -m -p ${RUN}/pkg-update-${name}.pid -x /usr/bin/ucode -- ${UPDATER} ${name} ${action}${version == null ? '' : ' ' + sh_quote(version)}`;
	system(cmd);
}

return {
	'milkflint.packages': {
		// { busy, waiting, action, started, checked, installed, latest, versions, ... }
		status: {
			args: { name: '' },
			call: function(req) {
				if (!known(req.args.name))
					return { error: 'name' };
				return status_of(req.args.name);
			}
		},

		// the versions MilkFlint's package feed has for this release, in the background
		check: {
			args: { name: '' },
			call: function(req) {
				const name = req.args.name;
				if (!known(name))
					return { error: 'name' };
				if (status_of(name).busy)
					return { error: 'busy' };
				start(name, 'check', null);
				return { ok: true };
			}
		},

		// that version installed from it ('' for the newest), in the background
		install: {
			args: { name: '', version: '' },
			call: function(req) {
				const name = req.args.name, v = req.args.version ?? '';
				if (!known(name))
					return { error: 'name' };
				if (type(v) != 'string' || (v != '' && !match(v, /^[0-9][0-9a-z.]*-r[0-9]+$/)))
					return { error: 'version' };
				if (status_of(name).busy)
					return { error: 'busy' };
				start(name, 'install', v);
				return { ok: true };
			}
		}
	}
};
