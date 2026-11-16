// rpcd plugin for the "themes" feature: the theme every device shows, and
// the custom themes made on the Themes page (ui/src/theme/custom.ts), kept in
// one small JSON file that an upgrade and a backup keep (the package's
// conffiles). `set` replaces the whole file and refuses anything but the
// shapes the page writes: theme ids, names without control characters, and
// colours as #rrggbb, so nothing odd is stored or reaches a page's CSS.
'use strict';

import { readfile, writefile, rename, mkdir } from 'fs';

const DIR = '/etc/milkflint';
const FILE = `${DIR}/themes.json`;
const MAX_CUSTOM = 24;
const MAX_TOKENS = 80;
const MAX_BYTES = 65536;

const fail = (error, x) => ({ error, ...(x ?? {}) });
const is_object = (v) => type(v) == 'object';
const theme_id = (v) => type(v) == 'string' && match(v, /^[a-z][a-z0-9-]{0,47}$/) != null;
const custom_id = (v) => type(v) == 'string' && match(v, /^custom-[a-z0-9-]{1,40}$/) != null;
// up to 40 characters in the page; UTF-8 takes up to 4 bytes each
// (ubus cuts a string at a NUL before it gets here; one is looked for anyway, as a regex can't)
const name_ok = (v) => type(v) == 'string' && length(trim(v)) > 0 && length(v) <= 160 &&
	match(v, /[[:cntrl:]]/) == null && index(v, chr(0)) < 0;

function stored() {
	let data = null;
	try {
		data = json(readfile(FILE) ?? 'null');
	}
	catch (e) {
		data = null;
	}
	return {
		theme: (is_object(data) && theme_id(data.theme)) ? data.theme : null,
		custom: (is_object(data) && type(data.custom) == 'array') ? data.custom : []
	};
}

// One scheme's colours: role names to #rrggbb; null when anything else is there.
function scheme_colors(v) {
	if (v == null)
		return {};
	if (!is_object(v) || length(keys(v)) > MAX_TOKENS)
		return null;
	const out = {};
	for (let k in keys(v)) {
		if (match(k, /^[a-z0-9-]{1,32}$/) == null || type(v[k]) != 'string' || match(v[k], /^#[0-9a-fA-F]{6}$/) == null)
			return null;
		out[k] = lc(v[k]);
	}
	return out;
}

function clean_custom(list) {
	if (type(list) != 'array' || length(list) > MAX_CUSTOM)
		return null;
	const out = [];
	const seen = {};
	for (let c in list) {
		if (!is_object(c) || !custom_id(c.id) || seen[c.id] || !name_ok(c.name) || !theme_id(c.base))
			return null;
		if (c.colors != null && !is_object(c.colors))
			return null;
		const light = scheme_colors(c.colors?.light);
		const dark = scheme_colors(c.colors?.dark);
		if (light == null || dark == null)
			return null;
		seen[c.id] = true;
		push(out, { id: c.id, name: trim(c.name), base: c.base, colors: { light, dark } });
	}
	return out;
}

function set_themes(req) {
	const a = req.args ?? {};
	const theme = a.theme;
	if (theme != null && theme != '' && !theme_id(theme))
		return fail('theme');
	const custom = clean_custom(a.custom ?? []);
	if (custom == null)
		return fail('custom');
	const text = sprintf('%J', { theme: (theme == null || theme == '') ? null : theme, custom });
	if (length(text) > MAX_BYTES)
		return fail('size');
	mkdir(DIR);
	if (!writefile(`${FILE}.tmp`, text) || !rename(`${FILE}.tmp`, FILE))
		return fail('write');
	return { saved: true };
}

return {
	'milkflint.themes': {
		get: { call: () => stored() },
		set: { args: { theme: '', custom: [] }, call: set_themes }
	}
};
