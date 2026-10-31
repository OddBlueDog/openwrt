// rpcd plugin for the "mode" feature: whether MilkFlint is the main router
// or an access point on another router's network, and switching between
// the two. The switch runs in the background
// (/usr/libexec/milkflint/mode-switch), since it cuts the browser off: it
// checks by itself that the new mode works and goes back to the old one if
// it doesn't, writing its progress to STATE.
'use strict';

import { glob, mkdir, readfile, rename, writefile } from 'fs';
import { connect } from 'ubus';
import { cursor } from 'uci';

const DIR = '/tmp/milkflint';
const STATE = DIR + '/mode.json';
const REQUEST = DIR + '/mode-request.json';
// how long the switch may take to prove the new mode works, as mode-switch has it
const WAIT_S = { ap: 120, router: 45 };

function state() {
	try {
		return json(readfile(STATE) ?? 'null');
	}
	catch (e) {
		return null;
	}
}

function alive(pid) {
	return type(pid) == 'int' && index(readfile(`/proc/${pid}/cmdline`) ?? '', 'mode-switch') >= 0;
}

const switching = (s) => s?.state == 'switching' && alive(s.pid);

const enabled = (svc) => length(glob(`/etc/rc.d/S*${svc}`) ?? []) > 0;

// An access point set up by hand (OpenWrt's "dumb AP" recipe, or in LuCI)
// rather than on this page: the LAN takes its address from another router
// (DHCP, or a fixed one with a gateway) and doesn't hand out addresses (its
// DHCP pool ignored, gone, or dnsmasq off). A router's LAN does neither.
function handmade_ap(c) {
	const proto = c.get('network', 'lan', 'proto');
	const upstream = proto == 'dhcp' || (proto == 'static' && c.get('network', 'lan', 'gateway') != null);
	const no_dhcp = c.get('dhcp', 'lan') == null || c.get('dhcp', 'lan', 'ignore') == '1' || !enabled('dnsmasq');
	return upstream && no_dhcp;
}

// access point mode as this page switched to it, or as set up by hand
function mode(c) {
	return (c.get('milkflint', 'mode', 'mode') == 'ap' || handmade_ap(c)) ? 'ap' : 'router';
}

// the board's WAN port, which access point mode adds to the LAN bridge
function wan_port(c) {
	let board;
	try {
		board = json(readfile('/etc/board.json') ?? '{}');
	}
	catch (e) {
		board = {};
	}
	const dev = board?.network?.wan?.device ?? c.get('network', 'wan', 'device');
	return (type(dev) == 'string' && match(dev, /^[A-Za-z0-9_-]+/)) ? match(dev, /^[A-Za-z0-9_-]+/)[0] : null;
}

// an interface's IPv4 address and prefix, default gateway and DNS servers, as netifd has them now
function addressing(bus, iface) {
	const st = bus?.call(`network.interface.${iface}`, 'status', {});
	if (st == null)
		return null;
	const a = st['ipv4-address']?.[0];
	let gateway = null;
	for (let r in st.route ?? [])
		if (r.target == '0.0.0.0' && r.mask == 0)
			gateway = r.nexthop;
	return { up: st.up == true, ipaddr: a?.address, prefix: a?.mask, gateway, dns: st['dns-server'] ?? [] };
}

// an option that may be a list (OpenWrt 25.12 has `list ipaddr '192.168.1.1/24'`): its first value
function first(v) {
	return (type(v) == 'array') ? v[0] : v;
}

function ip4(s) {
	const a = (type(s) == 'string') ? iptoarr(s) : null;
	return (a != null && length(a) == 4) ? ((a[0] << 24) | (a[1] << 16) | (a[2] << 8) | a[3]) : null;
}

// a netmask's prefix length, or null if it isn't one
function prefix_of(mask) {
	const m = ip4(mask);
	if (m == null)
		return null;
	for (let p = 0; p <= 32; p++)
		if (m == ((p == 0) ? 0 : ((0xffffffff << (32 - p)) & 0xffffffff)))
			return p;
	return null;
}

// a fixed address for access point mode: an error, or null if it's fine
function static_error(a) {
	const ip = ip4(a.ipaddr), p = prefix_of(a.netmask);
	if (ip == null)
		return 'invalid ipaddr';
	if (p == null || p < 8 || p > 30)
		return 'invalid netmask';
	const mask = (0xffffffff << (32 - p)) & 0xffffffff;
	const host = ip & ~mask & 0xffffffff;
	if (host == 0 || host == (~mask & 0xffffffff))
		return 'invalid ipaddr';
	const gw = ip4(a.gateway);
	if (gw == null || (gw & mask) != (ip & mask) || gw == ip)
		return 'invalid gateway';
	if (type(a.dns) != 'array' || length(a.dns) > 3 || length(filter(a.dns, (d) => ip4(d) == null)))
		return 'invalid dns';
	return null;
}

return {
	'milkflint.mode': {
		// the mode, the switch under way or the last one, the LAN's addressing
		// (configured and now), the WAN's in router mode (the network an
		// access point would join), the bridge fast path, and the router's
		// clock (switches are timed by it)
		status: {
			call: function() {
				const c = cursor();
				const bus = connect();
				const m = mode(c);
				const s = state();
				let defaults = null;
				c.foreach('firewall', 'defaults', (d) => { defaults ??= d; });
				const dns = c.get('network', 'lan', 'dns');
				const res = {
					now: time(),
					mode: m,
					// access point mode that this page didn't set up: switching
					// back gives OpenWrt's router defaults
					handmade: m == 'ap' && c.get('milkflint', 'mode', 'mode') != 'ap',
					switching: switching(s),
					last: s,
					wan_port: wan_port(c),
					lan: {
						proto: c.get('network', 'lan', 'proto') ?? 'static',
						ipaddr: first(c.get('network', 'lan', 'ipaddr')),
						netmask: c.get('network', 'lan', 'netmask'),
						gateway: c.get('network', 'lan', 'gateway'),
						dns: (type(dns) == 'array') ? dns : ((dns != null) ? split(dns, /\s+/) : []),
					},
					lan_now: addressing(bus, 'lan'),
					uplink: (m == 'router') ? addressing(bus, 'wan') : null,
					// where router mode puts the LAN back (as access point mode kept it)
					router_address: (m == 'ap') ?
						split(first(c.get('milkflint_router', 'network_lan', 'ipaddr')) ?? '192.168.1.1', '/')[0] : null,
					firewall_defaults: defaults?.['.name'],
					bridge_offload: defaults?.flow_offloading_bridge == '1',
					bridge_offload_available: length(glob('/lib/modules/*/nf_flow_table_bridge.ko') ?? []) > 0,
				};
				bus?.disconnect();
				return res;
			}
		},
		// to mode 'ap' (proto 'dhcp', or 'static' with ipaddr, netmask,
		// gateway and up to 3 dns; bridge_offload for the bridge fast path)
		// or 'router' (as it was before access point mode)
		switch: {
			args: { mode: 'mode', proto: 'proto', ipaddr: 'ipaddr', netmask: 'netmask', gateway: 'gateway', dns: [], bridge_offload: false },
			call: function(req) {
				const a = req.args;
				const c = cursor();
				if (!(a.mode in [ 'ap', 'router' ]))
					return { error: 'invalid mode' };
				if (a.mode == mode(c))
					return { error: 'already in that mode' };
				const request = { mode: a.mode };
				if (a.mode == 'ap') {
					if (!(a.proto in [ 'dhcp', 'static' ]))
						return { error: 'invalid proto' };
					if (wan_port(c) == null)
						return { error: 'no WAN port' };
					request.proto = a.proto;
					request.bridge_offload = a.bridge_offload == true;
					if (a.proto == 'static') {
						const err = static_error(a);
						if (err != null)
							return { error: err };
						request.ipaddr = a.ipaddr;
						request.netmask = a.netmask;
						request.gateway = a.gateway;
						request.dns = a.dns;
					}
				}
				if (switching(state()))
					return { error: 'busy' };
				mkdir(DIR);
				writefile(REQUEST, sprintf('%J', request));
				const at = time();
				writefile(`${STATE}.tmp`, sprintf('%J', { state: 'switching', target: a.mode, started: at }));
				rename(`${STATE}.tmp`, STATE);
				system([ 'start-stop-daemon', '-S', '-b', '-x', '/usr/libexec/milkflint/mode-switch' ]);
				return { started: true, at, seconds: WAIT_S[a.mode] };
			}
		},
	}
};
