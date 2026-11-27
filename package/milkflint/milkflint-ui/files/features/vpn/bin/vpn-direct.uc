// The VPN client's sites that go direct (ui feature "vpn"), kept in step on
// the router: /etc/init.d/milkflint-vpn runs sync() at every start and
// reload, and its reload triggers include dhcp, where the list lives
// (dhcp.wg_out_direct), so a save on the VPN page, in LuCI or by uci all
// come here. fw4's sets wg_out_direct4 and 6 have no timeout (an address
// that ran out mid-connection would send its later packets into the
// tunnel), so an address only leaves them by a flush; and the router's DNS
// puts one in only from an answer it gets, never from its cache.
//
// Against the copy of the list it keeps in LIST (plan):
//   - a name gone from the list, or the list gone: in this order, so no
//     lookup puts a removed site's address back
//       1. the router's DNS reloaded (/etc/init.d/dnsmasq reload: procd's
//          own reload for the same change may not have come yet), and
//          answering again: from then on it has the new list;
//       2. both sets flushed;
//       3. SIGHUP to the router's DNS and to the VPN's DNS forwarder
//          (milkflint-vpn's instance dns): their caches go, so the sites
//          still listed are asked afresh as devices look them up, and
//          their addresses go back in the sets;
//   - no copy yet (the first run since boot: the router's DNS starts before
//     the firewall makes the sets, so it may hold answers it couldn't put
//     in them), or the VPN in use (vpn-watch.uc's wanted) with both sets
//     empty: the SIGHUP alone, so those answers are asked again;
//   - a name added needs nothing: the router's DNS and the forwarder
//     restart for the new list, their caches empty.
// The copy is written last, so a run cut short is done again at the next.
// A signal only goes to a dnsmasq that has its handler: the router's answers
// on its port first (a dnsmasq just restarted might not be in its loop yet;
// procd's pid for it is ujail's), the forwarder's SigCgt says so.
'use strict';

import { readfile, writefile, mkdir, rename, popen } from 'fs';
import * as socket from 'socket';
import { connect } from 'ubus';
import { cursor } from 'uci';
import { direct_domains } from '/usr/libexec/milkflint/vpn-dns.uc';
import { wanted } from '/usr/libexec/milkflint/vpn-watch.uc';

export const LIST = '/var/run/milkflint/vpn-direct.list';
export const SETS = [ 'wg_out_direct4', 'wg_out_direct6' ];

// What a run does ({ reload, flush, hup }), from the copy (was: its names,
// or null with no copy), the list now, whether the VPN is in use, and
// empty(): whether both sets are empty, asked only when it matters.
export function plan(was, now, in_use, empty) {
	if (was != null && length(filter(was, (d) => !(d in now))) > 0)
		return { reload: true, flush: true, hup: true };
	return { reload: false, flush: false, hup: length(now) > 0 && (was == null || (in_use && empty())) };
};

// The copy: the names one a line, then the ones left out as not host names,
// each after a '#', so a change to either is logged once.
function copy_text(now, skipped) {
	return join('', map(now, (d) => `${d}\n`)) + join('', map(skipped, (d) => `#${d}\n`));
}

function copy_names(text) {
	return filter(split(text ?? '', '\n'), (d) => d != '' && substr(d, 0, 1) != '#');
}

function set_empty(table, set) {
	const p = popen(`nft list set ${table} ${set} 2>/dev/null`, 'r');
	if (!p)
		return true;
	const out = p.read('all') ?? '';
	p.close();
	return index(out, 'elements = ') < 0;
}

function instances(bus, name) {
	return bus?.call('service', 'list', { name })?.[name]?.instances ?? {};
}

// A CHAOS TXT query for version.bind, which dnsmasq answers itself
const QUERY = chr(0x4d, 0x46, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0) + chr(7) + 'version' + chr(4) + 'bind' + chr(0, 0, 16, 0, 3);

// whether a DNS server on 127.0.0.1:port answers, whatever its rcode, within
// tries x 300 ms
function answers(port, tries) {
	for (let i = 0; i < tries; i++) {
		const s = socket.create(socket.AF_INET, socket.SOCK_DGRAM | socket.SOCK_NONBLOCK, 0);
		if (!s)
			return false;
		s.send(QUERY, 0, { address: '127.0.0.1', port });
		// on a timeout poll gives [[s, 0]], never []: the read says
		socket.poll(300, s);
		const d = s.recvmsg(1500)?.data;
		s.close();
		if (type(d) == 'string' && length(d) >= 12 && ord(d, 0) == 0x4d && ord(d, 1) == 0x46 && (ord(d, 2) & 0x80))
			return true;
	}
	return false;
}

// whether the process catches SIGHUP (its handler set: SigCgt's lowest bit),
// waiting up to 2 s for it
function catches_hup(pid) {
	for (let i = 0; i < 20; i++) {
		for (let line in split(readfile(`/proc/${pid}/status`) ?? '', '\n'))
			if (substr(line, 0, 7) == 'SigCgt:' && (hex(substr(trim(line), -1)) & 1))
				return true;
		sleep(100);
	}
	return false;
}

function log(msg) {
	system([ 'logger', '-t', 'milkflint-vpn', msg ]);
}

// One run, as the init script makes it; o: the tests' own config cursor,
// copy, table, init script, services and port in place of the router's.
// Returns what it did: plan's answer, with the names gone and left out.
export function sync(o) {
	o ??= {};
	const c = o.cursor ?? cursor();
	const file = o.list ?? LIST;
	const table = o.table ?? 'inet fw4';
	const dns = o.dnsmasq ?? 'dnsmasq';
	const forwarder = o.forwarder ?? 'milkflint-vpn';
	const port = o.port ?? 53;
	const skipped = [];
	const now = direct_domains(c, skipped);
	const raw = readfile(file);
	const was = (raw == null) ? null : copy_names(raw);
	const gone = filter(was ?? [], (d) => !(d in now));
	const a = plan(was, now, wanted(c), () => set_empty(table, SETS[0]) && set_empty(table, SETS[1]));

	const bus = (a.reload || a.hup) ? connect() : null;
	const dns_runs = bus != null && length(instances(bus, dns)) > 0;
	// a dnsmasq not running isn't started: only procd's own reload would have it
	if (a.reload && dns_runs) {
		system([ o.init ?? '/etc/init.d/dnsmasq', 'reload' ], 30000);
		answers(port, 10);
	}
	if (a.flush)
		for (let s in SETS)
			system(`nft flush set ${table} ${s} 2> /dev/null`);
	if (a.hup) {
		if (dns_runs && answers(port, 10))
			bus.call('service', 'signal', { name: dns, signal: 1 });
		const f = instances(bus, forwarder)?.dns;
		if (f?.running && f?.pid && catches_hup(f.pid))
			bus.call('service', 'signal', { name: forwarder, instance: 'dns', signal: 1 });
	}
	bus?.disconnect();

	const text = copy_text(now, skipped);
	if (raw != text) {
		if (a.flush)
			log(`sites that go direct: ${join(', ', gone)} taken off the list: both sets emptied, and the DNS caches cleared so the others go back in as they're looked up`);
		if (length(skipped))
			log(`sites that go direct: not a host name, left out: ${join(', ', skipped)}`);
		mkdir(substr(file, 0, rindex(file, '/')), 0o755);
		writefile(`${file}.tmp`, text);
		rename(`${file}.tmp`, file);
	}
	return { ...a, gone, skipped };
};
