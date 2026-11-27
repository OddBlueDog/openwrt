// banIP's steps around an update from MilkFlint's package feed (its hooks
// for /usr/libexec/milkflint/pkg-update, ui feature "pkg-update").
//
// Settings: before an install, those of the version that's there are kept
// (the last two versions' worth, under /etc/milkflint/banip-snapshots/
// <version>/), and after one that worked, a copy of them as that version left
// them (/etc/milkflint/banip-installed/). Going back keeps the settings as
// they are, unless they haven't changed since the newer version was
// installed: then the older version's own come back (a newer one's first
// boot may have rewritten them in a way the older doesn't read), with
// ban_enabled and the options MilkFlint keeps up itself as they are now. A
// rollback after a failed install puts back this run's own snapshot, whole.
//
// banIP itself: apk's post-upgrade script starts it (when it's on), and that
// run holds banIP's lock, refusing a restart meanwhile. Once that run has
// ended, the allowlist's backup (which a restart loads in place of the page's
// file) is dropped and banIP restarted. It counts if banIP is running once
// that run has ended, or still running a minute on: otherwise the version
// that was there goes back on.
'use strict';

import { readfile, writefile, mkdir, glob, lsdir, stat, unlink, rmdir, rename, access } from 'fs';
import { cursor } from 'uci';
import * as banip from '/usr/libexec/milkflint/banip.uc';

const SNAPSHOTS = '/etc/milkflint/banip-snapshots';
const INSTALLED = '/etc/milkflint/banip-installed';
const KEEP = 2;
const WAS = '/var/run/milkflint/pkg-update-banip.enabled';
const UNCHANGED = '/var/run/milkflint/pkg-update-banip.unchanged';
const LOCK = '/var/run/banIP/banIP.lock';
// apk's own start of banIP, then our restart: how long each run may take
// (seconds; both within pkg-update's 300 s for a hook)
const FIRST_RUN = 180;
const WAIT = 60;
// procd counts an instance running from the moment it starts it, so a
// service that ends as it starts still reads as running right after the
// restart (and has no run under way to wait for): its state is read this
// many seconds on
const SETTLE = 2;
// what MilkFlint keeps up itself in banIP's config, never taken back with
// an older version's settings: on or off (the page's switch), and Remote
// access's WireGuard ports let through (bin/banip-sync)
const MANAGED = [ 'ban_enabled', 'ban_allowflag' ];

// the files that make up banIP's settings
function files() {
	return [ '/etc/config/banip', ...glob('/etc/banip/*.json'), ...glob('/etc/banip/*.feeds') ];
};

// on, as banip-sync and MilkFlint's init read it: and not an access point
function enabled() {
	const c = cursor();
	return c.get('banip', 'global', 'ban_enabled') == '1' && banip.router_mode(c) != 'ap';
};

// a version's directory name is only what apk writes: no path in it
function dir_for(ver) {
	if (ver == null || ver == '' || index(`${ver}`, '/') >= 0 || index(`${ver}`, '..') >= 0)
		return null;
	return `${SNAPSHOTS}/${ver}`;
};

// a file's name in a snapshot: the config's, or one of /etc/banip's
function kept_name(f) {
	return (f == '/etc/config/banip') ? 'config:banip' : `banip:${replace(f, '/etc/banip/', '')}`;
};

function copy(from, to) {
	const text = readfile(from);
	return text != null && banip.write_atomic(to, text, 0o600);
};

function remove_dir(dir) {
	for (let g in lsdir(dir) ?? [])
		unlink(`${dir}/${g}`);
	rmdir(dir);
};

// banIP's settings now, as a folder: written beside, then moved, so it's
// whole or isn't there
function save_to(dir, extra) {
	const tmp = `${dir}.new`;
	remove_dir(tmp);
	mkdir(tmp, 0o755);
	for (let f in files())
		copy(f, `${tmp}/${kept_name(f)}`);
	for (let n, text in extra ?? {})
		writefile(`${tmp}/${n}`, text);
	remove_dir(dir);
	rename(tmp, dir);
};

// the settings in `a` are those in `b`: the same files, the same contents
function same(a, b) {
	const na = filter(lsdir(a) ?? [], (n) => index(n, ':') > 0), nb = filter(lsdir(b) ?? [], (n) => index(n, ':') > 0);
	if (!length(na) || length(na) != length(nb))
		return false;
	for (let n in na)
		if (readfile(`${a}/${n}`) != readfile(`${b}/${n}`))
			return false;
	return true;
};

// the oldest snapshots go: the one just made and the one before it stay,
// and the one the install goes back to
function prune(current, target) {
	let found = [];
	for (let n in lsdir(SNAPSHOTS) ?? []) {
		const s = stat(`${SNAPSHOTS}/${n}`);
		if (s?.type == 'directory' && n != current && n != target)
			push(found, { name: n, mtime: s.mtime });
	}
	found = sort(found, (a, b) => b.mtime - a.mtime);
	for (let i = KEEP - 1; i < length(found); i++)
		remove_dir(`${SNAPSHOTS}/${found[i].name}`);
};

// The settings of the version that's there, kept; whether banIP is on,
// noted; and, going back, whether they're as that version left them when it
// was installed (read now: the older version's install changes its files)
export function before(ver, from, back) {
	mkdir('/var/run/milkflint', 0o755);
	writefile(WAS, enabled() ? '1' : '0');
	unlink(UNCHANGED);
	from ??= banip.package_version();
	const dir = dir_for(from);
	if (!dir)
		return;
	mkdir('/etc/milkflint', 0o755);
	mkdir(SNAPSHOTS, 0o755);
	save_to(dir);
	if (back)
		writefile(UNCHANGED, (trim(readfile(`${INSTALLED}/version`) ?? '') == from && same(dir, INSTALLED)) ? '1' : '0');
	prune(from, ver);
};

// a snapshot's files back in place
function restore(ver) {
	const dir = dir_for(ver);
	if (!dir || stat(dir)?.type != 'directory') {
		print(`no settings kept for banIP ${ver}\n`);
		return false;
	}
	for (let g in lsdir(dir) ?? []) {
		if (index(g, '.milkflint-tmp') >= 0)
			continue;
		if (g == 'config:banip')
			copy(`${dir}/${g}`, '/etc/config/banip');
		else if (index(g, 'banip:') == 0 && index(g, '/') < 0)
			copy(`${dir}/${g}`, `/etc/banip/${substr(g, 6)}`);
	}
	return true;
};

// a snapshot's files back, MilkFlint's options (ban_enabled, ban_allowflag)
// as they are now
function restore_keeping(ver) {
	const now = {};
	const c = cursor();
	for (let o in MANAGED)
		now[o] = c.get('banip', 'global', o);
	if (!restore(ver))
		return false;
	const r = cursor();
	for (let o in MANAGED) {
		if (now[o] == null)
			r.delete('banip', 'global', o);
		else
			r.set('banip', 'global', o, now[o]);
	}
	r.commit('banip');
	return true;
};

// Going back by choice: the settings stay, unless they're as the newer
// version left them (then the older one's own, MilkFlint's options as now)
function go_back(ver, from) {
	if (trim(readfile(UNCHANGED) ?? '') != '1') {
		print(`banIP's settings kept as they are (changed since ${from} was installed, or not known)\n`);
		return;
	}
	if (restore_keeping(ver))
		print(`banIP ${ver}'s own settings back, unchanged since ${from} was installed\n`);
};

function running() {
	const r = banip.ubus_call('service', 'list', { name: 'banip' });
	for (let k, i in r?.banip?.instances ?? {})
		if (i?.running)
			return true;
	return false;
};

// banIP's run under way: its lock (a directory) while the run's process
// lives, as banip-action reads it
function busy() {
	if (stat(LOCK)?.type != 'directory')
		return false;
	const pid = trim(readfile(banip.PIDFILE) ?? '');
	return match(pid, /^[0-9]+$/) != null && access(`/proc/${pid}`) == true;
};

// true when no run is under way, waiting up to `n` seconds for one to end
function run_ended(n) {
	for (let i = 0; i < n && busy(); i++)
		system('sleep 1');
	return !busy();
};

export function after(ver, from, back, rollback) {
	if (rollback) {
		// the older version didn't go back on (ver is what stays installed):
		// its snapshot is from before the run, so the options as they are now
		if (ver == from)
			restore_keeping(ver);
		else
			restore(ver);
	}
	else if (back)
		go_back(ver, from);
	// what the install started with (a restored config may say otherwise)
	const was = readfile(WAS);
	const on = (was != null) ? trim(was) == '1' : enabled();
	if (on) {
		if (!run_ended(FIRST_RUN))
			print(`banIP's own start was still running after ${FIRST_RUN} s\n`);
		// a restart loads the allowlist from its backup when there is one:
		// the page's edits are in the file
		banip.drop_backups(null, [ 'allowlist' ]);
		system('/etc/init.d/banip restart > /dev/null 2>&1');
		system(`sleep ${SETTLE}`);
		run_ended(WAIT);
		if (!running()) {
			print(`banIP isn't running after its restart\n`);
			return false;
		}
	}
	if (!rollback && dir_for(ver)) {
		mkdir('/etc/milkflint', 0o755);
		save_to(INSTALLED, { version: `${ver}\n` });
	}
	return true;
};
