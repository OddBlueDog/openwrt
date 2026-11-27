// VPN client DNS forwarding (ui feature "vpn", /etc/init.d/milkflint-vpn):
// when "Use VPN's DNS" is on (milkflint.vpn_client.use_vpn_dns '1'), devices
// marked for the WireGuard client (wg_out) have their port-53 lookups sent to
// a dedicated dnsmasq instance on port 5455 running as user adguardvpn. Its
// outbound packets are marked for the tunnel (0x10000000) so they reach the
// provider's DNS server through wg_out — and hit the kill switch if the tunnel
// drops — while local network names (*.lan, custom DNS records, private PTR)
// still come from the main dnsmasq on 127.0.0.1:53. Every other device, and
// the router itself (including resolving the VPN server's hostname), keeps
// using the router's DNS on port 53.
//
// When AdGuard Home is active, its prerouting dstnat (priority dstnat - 5)
// runs before this table's (dstnat - 2) and forwards the VPN client's lookups
// to 127.0.0.1:5455 after filtering; when AdGuard Home is off or restarting,
// this table catches marked devices directly so lookups never leak to the
// router's DNS.
//
// While the tunnel watcher has the tunnel down with the kill switch on, the
// forwarder runs in refuse mode (forwarder_mode) and this table stays loaded
// beside the watcher's down table, whose redirect (dstnat - 6) comes first:
// the moment that one goes (the tunnel back) or if it's ever missing, marked
// lookups still reach the forwarder and never the router's own DNS.
'use strict';

import { readfile, writefile, mkdir, popen } from 'fs';
import { addresses_of } from '/usr/libexec/milkflint/conntrack.uc';
import { wanted, killswitch } from '/usr/libexec/milkflint/vpn-watch.uc';
import { connect } from 'ubus';
import { cursor } from 'uci';

export const VPN_DNS_PORT = 5455;
export const VPN_USER = 'adguardvpn';
export const VPN_MARK = '0x10000000';
export const VPN_MASK = '0xf0000000';
export const TABLE = 'milkflint_vpn_dns';
export const DNSMASQ_LOCAL = '127.0.0.1#53';
const TUNNEL_STATE = '/var/run/milkflint/vpn-tunnel.json';

// a uci list, or an option holding several values separated by spaces (as
// uci and fw4 read them, and conntrack.uc's)
const as_list = (v) => (type(v) == 'array') ? v : (v != null && v != '') ? split(trim(v), /[ \t]+/) : [];

function ubus_call(object, method, args) {
	const bus = connect();
	const r = bus?.call(object, method, args ?? {});
	bus?.disconnect();
	return r;
}

function is_ipv4(s) {
	const m = match(s, /^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/);
	if (!m)
		return false;
	for (let i = 1; i <= 4; i++)
		if (+m[i] > 255)
			return false;
	return true;
}

function is_ipv6(s) {
	return index(s, ':') >= 0 && match(s, /^[0-9a-fA-F:]+$/) != null && length(split(s, '::')) <= 2;
}

// Whether wg_out is enabled, has at least one marked source zone, and has
// "Use VPN's DNS" enabled with at least one usable server. Returns the list
// of usable server IPs (IPv6 servers are included only when wg_out has an IPv6
// address), or null when VPN DNS shouldn't run.
export function vpn_dns_servers(c) {
	if (!c)
		c = cursor();
	if (c.get('milkflint', 'mode', 'mode') == 'ap')
		return null;
	const iface = c.get_all('network', 'wg_out');
	if (!iface || iface.disabled == '1' || iface.proto != 'wireguard')
		return null;
	const meta = c.get_all('milkflint', 'vpn_client');
	if (!meta || meta.use_vpn_dns != '1')
		return null;
	let has_source = false;
	c.foreach('firewall', 'rule', (r) => {
		if (r.enabled != '0' && match(r['.name'], /^wg_out_mark_[a-z0-9_]+$/))
			has_source = true;
	});
	if (!has_source)
		return null;
	const has_v6 = length(filter(as_list(iface.addresses), (a) => index(`${a}`, ':') >= 0)) > 0;
	const out = [];
	for (let raw in as_list(meta.dns)) {
		const ip = trim(`${raw}`);
		if (is_ipv4(ip) || (has_v6 && is_ipv6(ip))) {
			if (!(ip in out))
				push(out, ip);
		}
	}
	return length(out) ? out : null;
};

export function forwarder_running() {
	const svc = ubus_call('service', 'list', { name: 'milkflint-vpn' });
	return svc?.['milkflint-vpn']?.instances?.dns?.running == true;
};

// The VPN page's host rule (ui/src/lib/hostnames.ts, validHost): two labels
// or more, each 1 to 63 of a-z, 0-9 and '-', not starting or ending with
// '-', the last starting with a letter (so no addresses); 253 at most.
// Checked a character at a time: no regexp per name.
function host_name(s) {
	if (length(s) > 253)
		return false;
	const labels = split(s, '.');
	if (length(labels) < 2)
		return false;
	for (let l in labels) {
		const n = length(l);
		if (n < 1 || n > 63 || ord(l, 0) == 45 || ord(l, n - 1) == 45)
			return false;
		for (let i = 0; i < n; i++) {
			const ch = ord(l, i);
			if (!((ch >= 97 && ch <= 122) || (ch >= 48 && ch <= 57) || ch == 45))
				return false;
		}
	}
	const first = ord(labels[length(labels) - 1], 0);
	return first >= 97 && first <= 122;
}

// The direct ("bypass") sites' names: the `domain` list of dhcp section
// wg_out_direct (the VPN page's sites that go out directly), in lower case
// (as the page writes them, and DNS compares them), the ones that pass the
// page's host rule only, once each. The others go in `skipped` (an array)
// when given, for the one caller that logs them (vpn-direct.uc).
export function direct_domains(c, skipped) {
	if (!c)
		c = cursor();
	const out = [];
	for (let d in as_list(c.get('dhcp', 'wg_out_direct', 'domain'))) {
		const raw = trim(`${d}`);
		const name = lc(raw);
		if (raw == '' || name in out)
			continue;
		if (host_name(name))
			push(out, name);
		else if (type(skipped) == 'array' && !(raw in skipped))
			push(skipped, raw);
	}
	return out;
};

// 'refuse' while the VPN client is wanted (vpn-watch.uc's wanted: wg_out on,
// with devices marked for it), its kill switch is on (vpn-watch.uc's
// killswitch: network.wg_out_kill, not turned off) and the tunnel watcher's
// state file says down; else 'normal'. So the VPN turned off on its page
// while down never leaves a refusing forwarder behind, whatever the state
// file still says. The file is state_file in tests.
export function forwarder_mode(c, state_file) {
	if (!c)
		c = cursor();
	if (!wanted(c) || !killswitch(c))
		return 'normal';
	let st = null;
	try {
		st = json(readfile(state_file ?? TUNNEL_STATE) ?? 'null');
	}
	catch (e) {
		// unreadable: as if none
	}
	return (type(st) == 'object' && st.up == false) ? 'refuse' : 'normal';
};

// One `--server=/<name>/127.0.0.1#53` per direct site: those names are
// answered by this router's own dnsmasq (which fills the fw4 sets), in
// normal and refuse mode alike.
function direct_servers(c) {
	return map(direct_domains(c), (d) => `--server=/${d}/${DNSMASQ_LOCAL}`);
};

// The forwarder with the kill switch on and the tunnel down: no resolver and
// no default server, so everything is refused (REFUSED), except the direct
// sites' names, which go to this router's own dnsmasq. A restart with it
// leaves the cache empty. The down table's dstnat rule sends the devices'
// lookups here, and this file's own table (ruleset) stays loaded behind it.
function refuse_args(c) {
	const cachesize = c.get('dhcp', '@dnsmasq[0]', 'cachesize') ?? '1000';
	const out = [
		'--conf-file=/dev/null',
		'--keep-in-foreground',
		'--no-resolv',
		'--no-hosts',
		'--no-poll',
		`--port=${VPN_DNS_PORT}`,
		`--cache-size=${match(`${cachesize}`, /^[0-9]+$/) ? cachesize : '1000'}`,
		'--local-ttl=0',
	];
	for (let a in direct_servers(c))
		push(out, a);
	return out;
};

// Arguments for the dedicated /usr/sbin/dnsmasq instance serving VPN devices
// on VPN_DNS_PORT as user adguardvpn; null when VPN DNS isn't active.
export function dnsmasq_args(c, mode) {
	if (!c)
		c = cursor();
	if (mode == 'refuse')
		return refuse_args(c);
	const servers = vpn_dns_servers(c);
	if (!servers)
		return null;
	const domain = c.get('dhcp', '@dnsmasq[0]', 'domain') ?? 'lan';
	const rebind = c.get('dhcp', '@dnsmasq[0]', 'rebind_protection') != '0';
	const rebind_localhost = c.get('dhcp', '@dnsmasq[0]', 'rebind_localhost') == '1';
	const cachesize = c.get('dhcp', '@dnsmasq[0]', 'cachesize') ?? '1000';
	const out = [
		'--conf-file=/dev/null',
		'--keep-in-foreground',
		'--no-resolv',
		'--no-hosts',
		'--no-poll',
		`--port=${VPN_DNS_PORT}`,
		`--cache-size=${match(`${cachesize}`, /^[0-9]+$/) ? cachesize : '1000'}`,
		'--local-ttl=0',
	];
	// local domain names and private reverse lookups still come from the main dnsmasq
	if (match(domain, /^[A-Za-z0-9.-]+$/))
		push(out, `--server=/${domain}/${DNSMASQ_LOCAL}`);
	for (let rev in [ '168.192.in-addr.arpa', '10.in-addr.arpa', 'd.f.ip6.arpa' ])
		push(out, `--server=/${rev}/${DNSMASQ_LOCAL}`);
	for (let n = 16; n <= 31; n++)
		push(out, `--server=/${n}.172.in-addr.arpa/${DNSMASQ_LOCAL}`);

	// custom DNS records defined on the DNS page (dhcp domain sections)
	const custom_domains = [];
	const seen_domain = {};
	c.foreach('dhcp', 'domain', (d) => {
		const name = trim(`${d.name ?? ''}`);
		if (name == '' || !match(name, /^[A-Za-z0-9.-]+$/) || seen_domain[name])
			return;
		seen_domain[name] = true;
		push(custom_domains, name);
		push(out, `--server=/${name}/${DNSMASQ_LOCAL}`);
	});

	// sites that go direct (the VPN page): the router's own DNS fills their fw4 sets
	for (let a in direct_servers(c))
		push(out, a);

	for (let s in servers)
		push(out, `--server=${s}`);

	if (rebind) {
		push(out, '--stop-dns-rebind');
		if (rebind_localhost)
			push(out, '--rebind-localhost-ok');
		if (match(domain, /^[A-Za-z0-9.-]+$/))
			push(out, `--rebind-domain-ok=/${domain}/`);
		for (let d in custom_domains)
			push(out, `--rebind-domain-ok=/${d}/`);
		for (let d in as_list(c.get('dhcp', '@dnsmasq[0]', 'rebind_domain'))) {
			const clean = trim(replace(`${d}`, /^\/|\/$/g, ''));
			if (clean != '' && match(clean, /^[A-Za-z0-9.-]+$/))
				push(out, `--rebind-domain-ok=/${clean}/`);
		}
	}
	return out;
};

// network name -> its device, from ubus and falling back to UCI
function l3_devices(c) {
	const l3 = {};
	for (let i in ubus_call('network.interface', 'dump')?.interface ?? [])
		if (i.l3_device || i.device)
			l3[i.interface] = i.l3_device ?? i.device;
	c.foreach('network', 'interface', (i) => {
		const name = i['.name'];
		if (!l3[name] && (i.device || i.ifname))
			l3[name] = i.device ?? i.ifname;
	});
	return l3;
}

// The interfaces of the inside zones (no masquerading), and of the zones the
// DNS page's intercept covers, falling back to UCI network.<name>.device when
// an interface isn't up yet during boot.
export function zone_devices(c) {
	if (!c)
		c = cursor();
	const l3 = l3_devices(c);
	const devices = {};
	const inside = [];
	c.foreach('firewall', 'zone', (z) => {
		const devs = [ ...as_list(z.device) ];
		for (let n in as_list(z.network))
			if (l3[n])
				push(devs, l3[n]);
		devices[z.name] = devs;
		if (z.masq != '1' && z.enabled != '0')
			for (let d in devs)
				if (!(d in inside))
					push(inside, d);
	});
	const caught = [];
	c.foreach('firewall', 'redirect', (r) => {
		if (!match(r['.name'], /^milkflint_dns_intercept(_[a-z0-9_]+)?$/) || r.enabled == '0')
			return;
		for (let d in devices[r.src] ?? [])
			if (!(d in caught))
				push(caught, d);
	});
	return { home: sort(inside), intercept: sort(caught) };
};

// The addresses of the devices that use the VPN client now, for cutting
// their connections: the marked home devices when it's for some only (their
// MACs), else every neighbour on the home zone's devices except the skipped
// MACs; the guest networks' zones likewise, whole.
export function vpn_device_addresses(c) {
	if (!c)
		c = cursor();
	const l3 = l3_devices(c);
	const zdevs = {};
	c.foreach('firewall', 'zone', (z) => {
		const devs = [ ...as_list(z.device) ];
		for (let n in as_list(z.network))
			if (l3[n])
				push(devs, l3[n]);
		zdevs[z.name] = devs;
	});
	const out = {};
	let skip = [];
	c.foreach('firewall', 'rule', (r) => {
		if (r['.name'] == 'wg_out_skip' && r.enabled != '0')
			skip = as_list(r.src_mac);
	});
	c.foreach('firewall', 'rule', (r) => {
		if (r.enabled == '0' || !match(r['.name'], /^wg_out_mark_[a-z0-9_]+$/))
			return;
		const macs = as_list(r.src_mac);
		if (length(macs)) {
			for (let a in addresses_of(macs))
				out[a] = true;
			return;
		}
		const not = {};
		if (r['.name'] == 'wg_out_mark_lan')
			for (let a in addresses_of(skip))
				not[a] = true;
		for (let d in zdevs[r.src] ?? []) {
			const p = popen(`ip neigh show dev '${replace(d, "'", '')}'`, 'r');
			if (!p)
				continue;
			for (let line in split(p.read('all') ?? '', '\n')) {
				const f = split(line, ' ');
				if (index(f, 'lladdr') > 0 && !not[f[0]])
					out[f[0]] = true;
			}
			p.close();
		}
	});
	return sort(keys(out));
};

function vpn_uid() {
	const m = match(readfile('/etc/passwd') ?? '', regexp(`(^|\\n)${VPN_USER}:[^:]*:([0-9]+):`));
	return m ? +m[2] : null;
}

function nft_set(name, elems) {
	return `\tset ${name} {\n\t\ttype ifname\n` +
		(length(elems) ? `\t\telements = { ${join(', ', map(elems, (d) => sprintf('%J', d)))} }\n` : '') +
		'\t}\n';
}

// The forwarder's table, or null when no forwarder runs: in mode 'refuse'
// (forwarder_mode) it runs even with Use VPN's DNS off, and so does this.
export function ruleset(c, mode) {
	if (!c)
		c = cursor();
	const uid = vpn_uid();
	if (uid == null || mode != 'refuse' && !vpn_dns_servers(c))
		return null;
	const z = zone_devices(c);
	const mark = `meta mark & ${VPN_MASK} == ${VPN_MARK}`;
	return `table inet ${TABLE}\ndelete table inet ${TABLE}\n` +
		`table inet ${TABLE} {\n` +
		nft_set('home', z.home) +
		nft_set('intercept', z.intercept) +
		'\tchain dstnat {\n' +
		'\t\ttype nat hook prerouting priority dstnat - 2; policy accept;\n' +
		`\t\t${mark} meta l4proto { tcp, udp } th dport 53 iifname @home fib daddr type local counter redirect to :${VPN_DNS_PORT} comment "MilkFlint: VPN devices' lookups to the router go to VPN DNS"\n` +
		`\t\t${mark} meta l4proto { tcp, udp } th dport 53 iifname @intercept counter redirect to :${VPN_DNS_PORT} comment "MilkFlint: caught lookups from VPN devices go to VPN DNS"\n` +
		'\t}\n' +
		'\tchain vpn_out {\n' +
		'\t\ttype route hook output priority mangle; policy accept;\n' +
		'\t\tfib daddr type local return\n' +
		`\t\tmeta skuid ${uid} meta mark set meta mark & 0x0fffffff | ${VPN_MARK} counter comment "MilkFlint: VPN DNS lookups go out through the tunnel"\n` +
		'\t}\n' +
		'}\n';
};

export function clear_nft() {
	system(`nft delete table inet ${TABLE} 2>/dev/null`);
};

// Loads the forwarder's table for its mode, or takes it away when no
// forwarder runs. In refuse mode it stays: the down table's redirect comes
// first, and this one covers the moment that table goes.
export function apply_nft(c) {
	if (!c)
		c = cursor();
	const text = ruleset(c, forwarder_mode(c));
	if (!text) {
		clear_nft();
		return false;
	}
	mkdir('/var/run/milkflint', 0o755);
	const f = '/var/run/milkflint/vpn-dns.nft';
	writefile(f, text);
	return system(`nft -f ${f}`) == 0;
};
