// What logs-keeper (features/logs) asks of every line of the system log,
// with plain string functions where it used patterns: a pattern match costs
// many times a string search, and with the DNS log on nearly every line is
// one of dnsmasq's lookup lines, which most of these have nothing to say
// about. Each says exactly what the pattern above it says (the router-side
// tests compare them, qemu/ui-test-files/log-readers.sh).
'use strict';

const DIGITS = '0123456789';
const ALNUM = DIGITS + 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

// one or more of `set`'s characters and nothing else
function only(s, set) {
	return s != '' && ltrim(s, set) == '';
}

// dnsmasq's log-queries=extra lines, "<n> <client>/<port> <what> <name>
// [is|to|from <more>]":
//   /^([0-9]+) ([^ \/]+)\/[0-9]+ ([^ ]+) ([^ ]+)( (is|to|from) (.*))?$/
// { id, client, what, name, word, more } (word and more null on a line that
// ends at the name), or null for any other line.
export function lookup(msg) {
	const f = split(msg, ' ');
	const n = length(f);
	if (n < 4 || !only(f[0], DIGITS) || f[2] == '' || f[3] == '')
		return null;
	// one slash: the client before it, the port's digits after
	const slash = index(f[1], '/');
	if (slash < 1 || !only(substr(f[1], slash + 1), DIGITS))
		return null;
	const out = { id: f[0], client: substr(f[1], 0, slash), what: f[2], name: f[3], word: null, more: null };
	if (n == 4)
		return out;
	if (n < 6 || (f[4] != 'is' && f[4] != 'to' && f[4] != 'from'))
		return null;
	out.word = f[4];
	out.more = join(' ', slice(f, 5));
	return out;
};

// a lookup line's <what> when it's the question, "query[AAAA]": its type
//   /^query\[([A-Za-z0-9]+)\]$/
export function query_type(what) {
	if (substr(what, 0, 6) != 'query[' || substr(what, -1) != ']')
		return null;
	const asked_for = substr(what, 6, length(what) - 7);
	return only(asked_for, ALNUM) ? asked_for : null;
};

// an answer that says dnsmasq couldn't ask its servers, or that they failed
//   /^(REFUSED|SERVFAIL)/
export function failed_answer(more) {
	return substr(more, 0, 7) == 'REFUSED' || substr(more, 0, 8) == 'SERVFAIL';
};

// a tag of the Wi-Fi daemons, whose every line is a Wi-Fi line
//   /^(hostapd|wpa_supplicant|milkflint-wifi|milkflint-tuning)/
export function wifi_daemon(tag) {
	return substr(tag, 0, 7) == 'hostapd' || substr(tag, 0, 14) == 'wpa_supplicant' ||
		substr(tag, 0, 14) == 'milkflint-wifi' || substr(tag, 0, 16) == 'milkflint-tuning';
};

// The driver's and mac80211's lines when the Wi-Fi firmware stops answering
// or the chip is being reset: a command that timed out (which starts a chip
// reset), a firmware crash, an error recovery (L1 SER) and its escalation,
// a failed reset, mac80211 restarting the radios. The pattern's match (its
// first group: what the driver said), or null. Every such line names the
// driver or the restart, so any other line is told apart by two searches.
const FW_TROUBLE = /mt7915e [^ ]+: (Message [0-9a-f]+ \(seq [0-9]+\) timeout|.*firmware crash|L1 SER|chip full reset|band[0-9]: PLE error)|Hardware restart was requested/;
export function fw_trouble(rest) {
	if (index(rest, 'mt7915e ') < 0 && index(rest, 'Hardware restart was requested') < 0)
		return null;
	return match(rest, FW_TROUBLE);
};

// the kernel's line for a packet banIP dropped or refused (its own log, not
// the system log's business)
//   /^kern\.[a-z]+ kernel: (\[ *[0-9.]+\] )?banIP\//
export function banip_drop(rest) {
	return index(rest, 'banIP/') >= 0 && match(rest, /^kern\.[a-z]+ kernel: (\[ *[0-9.]+\] )?banIP\//) != null;
};
