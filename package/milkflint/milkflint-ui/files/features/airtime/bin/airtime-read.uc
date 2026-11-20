// What the airtime service (features/airtime) reads of every device every
// second, taken apart with plain string functions where it used patterns: a
// pattern match costs many times a split. Each says what the pattern it
// replaces said of the files as the driver writes them, and of an empty or
// missing one (the router-side tests compare them,
// qemu/ui-test-files/airtime.sh).
'use strict';

const DIGITS = '0123456789';

// one or more digits and nothing else
function number(s) {
	return s != null && s != '' && ltrim(s, DIGITS) == '';
}

// hostapd's ubus object of an access point, "hostapd.phy1-ap0": its
// interface; null for any other object
export function ap_dev(obj) {
	return (substr(obj, 0, 8) == 'hostapd.' && length(obj) > 8) ? substr(obj, 8) : null;
};

// tx_attempts (the MilkFlint mt76's per-frame counters): a line a count,
// "<tries> <frames>" ("1 6263", "3-4 1", "9+ 0", "failed 0"), as
// { '1': 6263, '3-4': 1, failed: 0 }; null without the file
export function attempts(text) {
	if (!text)
		return null;
	const out = {};
	for (let line in split(text, '\n')) {
		const sp = index(line, ' ');
		const count = (sp < 1) ? null : substr(line, sp + 1);
		if (number(count))
			out[substr(line, 0, sp)] = int(count);
	}
	return out;
};

// ps (the firmware's power-save reports): its "dozing_ms <n>" line, how long
// the device has dozed so far; null without it
export function dozed(text) {
	const at = index(text ?? '', 'dozing_ms ');
	if (at < 0)
		return null;
	const rest = substr(text, at + 10);
	const end = index(rest, '\n');
	const n = (end < 0) ? rest : substr(rest, 0, end);
	return number(n) ? int(n) : null;
};

// aqm (mac80211's queues for the device): after the heading, a line a TID,
// "<tid> <ac> <backlog-bytes> <backlog-packets> ...". Whether best effort
// or background (ACs 2 and 3) has packets waiting.
// Nearly always nothing is: then each of those ACs' eight TIDs has a line
// that starts as below, and finding the eight says so without taking the
// file apart. Anything else (traffic waiting, a file that isn't whole) is
// read line by line.
const IDLE = [ '\n0 2 0 0 ', '\n1 3 0 0 ', '\n2 3 0 0 ', '\n3 2 0 0 ', '\n8 2 0 0 ', '\n9 3 0 0 ', '\n10 3 0 0 ', '\n11 2 0 0 ' ];
export function backlog(text) {
	text ??= '';
	let idle = true;
	for (let line in IDLE)
		if (index(text, line) < 0) {
			idle = false;
			break;
		}
	if (idle)
		return false;
	const lines = split(text, '\n');
	for (let i = 1; i < length(lines); i++) {
		const f = split(lines[i], ' ');
		if ((f[1] == '2' || f[1] == '3') && f[3] != '0' && number(f[0]) && number(f[2]) && number(f[3]))
			return true;
	}
	return false;
};

// tx_pace (the MilkFlint mt76's pacing): "<share> <..> <..> <held us> ...",
// as { share, held }; null without the file or its four numbers
export function pace(text) {
	if (!text)
		return null;
	const end = index(text, '\n');
	const f = split((end < 0) ? text : substr(text, 0, end), ' ');
	if (!number(f[0]) || !number(f[1]) || !number(f[2]) || !number(f[3]))
		return null;
	return { share: int(f[0]), held: int(f[3]) };
};
