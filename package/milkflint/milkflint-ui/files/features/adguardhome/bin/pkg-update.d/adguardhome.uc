// AdGuard Home's steps around an update from MilkFlint's package feed (its
// hooks for /usr/libexec/milkflint/pkg-update, ui feature "pkg-update").
// AdGuard Home's own updater is off (--no-check-update). Meanwhile the
// devices' lookups go to dnsmasq, which answers while it restarts. Going back
// to an older one takes its settings back to the format that one reads when
// a newer one changed it (see adguardhome.uc's SCHEMA_STEP_DOWN); if it
// can't read them, the version that was there goes back on ('settings').
// Before each install the settings of the version that's there are kept
// (/etc/milkflint/adguardhome-snapshots/<version>.yaml, the last two
// versions' and the one going back to): a rollback puts back those of the
// version it leaves installed, so it starts with settings it reads.
'use strict';

import { readfile, mkdir, lsdir, stat, unlink } from 'fs';
import * as agh from '/usr/libexec/milkflint/adguardhome.uc';

const PAUSE = '/var/run/milkflint/adguardhome.pause';
const SNAPSHOTS = '/etc/milkflint/adguardhome-snapshots';
const KEEP = 2;

// a version's snapshot: only what apk writes as a version, no path in it
function snapshot_of(ver) {
	if (ver == null || ver == '' || index(`${ver}`, '/') >= 0 || index(`${ver}`, '..') >= 0)
		return null;
	return `${SNAPSHOTS}/${ver}.yaml`;
};

// the oldest go: the one just made, the one before it and the target stay
function prune(current, target) {
	let found = [];
	for (let n in lsdir(SNAPSHOTS) ?? []) {
		const s = stat(`${SNAPSHOTS}/${n}`);
		if (s?.type == 'file' && n != `${current}.yaml` && n != `${target}.yaml`)
			push(found, { name: n, mtime: s.mtime });
	}
	found = sort(found, (a, b) => b.mtime - a.mtime);
	for (let i = KEEP - 1; i < length(found); i++)
		unlink(`${SNAPSHOTS}/${found[i].name}`);
};

function write_config(text) {
	agh.write_atomic(agh.CONFIG, text, 0o600);
	system(`chown adguardhome:adguardhome ${agh.sh_quote(agh.CONFIG)}`);
};

// the redirect off meanwhile: dnsmasq answers while it restarts; and the
// settings of the version that's there, kept
export function before(ver, from, back) {
	mkdir('/var/run/milkflint', 0o755);
	agh.write_atomic(PAUSE, `${time() + 300}`, 0o644);
	system('nft delete table inet milkflint_adguardhome 2>/dev/null');
	const text = readfile(agh.CONFIG), kept = snapshot_of(from ?? agh.package_version());
	if (text != null && kept != null) {
		mkdir('/etc/milkflint', 0o755);
		mkdir(SNAPSHOTS, 0o700);
		agh.write_atomic(kept, text, 0o600);
		prune(from ?? agh.package_version(), ver);
	}
};

// Gone back to an older one: it must read the settings the newer one left
// (agh.SCHEMA_STEP_DOWN), or the one that was there goes back on. A
// rollback: the settings this version had before (its snapshot), else those
// there now, stepped down if they must be.
export function settings_ok(ver, from, back, rollback) {
	if ((!back && !rollback) || readfile(agh.CONFIG) == null)
		return true;
	// stopped first: stopping, it may write them again
	system('/etc/init.d/adguardhome stop');
	const kept = rollback ? readfile(snapshot_of(ver) ?? '') : null;
	if (kept != null) {
		write_config(kept);
		print(`AdGuard Home ${ver}'s own settings put back\n`);
		return true;
	}
	const why = [];
	const text = readfile(agh.CONFIG);
	const fixed = agh.settings_for_installed(text, why);
	if (fixed != null && fixed != text)
		write_config(fixed);
	if (length(why))
		print(join('\n', why), '\n');
	return fixed != null;
};

// started again if it's on, and the redirect back
export function after(ver, from, back, rollback) {
	if (agh.cmd('uci -q get adguardhome.config.enabled') == '1')
		system('/etc/init.d/adguardhome restart');
	// a trace, not a delete: the monitor sees a pause that fell between two of its ticks
	agh.write_atomic(PAUSE, `${time() + 1}`, 0o644);
	return true;
};
