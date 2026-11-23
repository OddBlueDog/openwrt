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
'use strict';

import { readfile, writefile, mkdir } from 'fs';
import { connect } from 'ubus';
import { cursor } from 'uci';

export const VPN_DNS_PORT = 5455;
export const VPN_USER = 'adguardvpn';
export const VPN_MARK = '0x10000000';
export const VPN_MASK = '0xf0000000';
export const TABLE = 'milkflint_vpn_dns';
export const DNSMASQ_LOCAL = '127.0.0.1#53';

const as_list = (v) => (type(v) == 'array') ? v : (v != null && v != '') ? [ v ] : [];

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

// Arguments for the dedicated /usr/sbin/dnsmasq instance serving VPN devices
// on VPN_DNS_PORT as user adguardvpn; null when VPN DNS isn't active.
export function dnsmasq_args(c) {
	if (!c)
		c = cursor();
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

// The interfaces of the inside zones (no masquerading), and of the zones the
// DNS page's intercept covers, falling back to UCI network.<name>.device when
// an interface isn't up yet during boot.
export function zone_devices(c) {
	if (!c)
		c = cursor();
	const l3 = {};
	for (let i in ubus_call('network.interface', 'dump')?.interface ?? [])
		if (i.l3_device || i.device)
			l3[i.interface] = i.l3_device ?? i.device;
	c.foreach('network', 'interface', (i) => {
		const name = i['.name'];
		if (!l3[name] && (i.device || i.ifname))
			l3[name] = i.device ?? i.ifname;
	});
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

function vpn_uid() {
	const m = match(readfile('/etc/passwd') ?? '', regexp(`(^|\\n)${VPN_USER}:[^:]*:([0-9]+):`));
	return m ? +m[2] : null;
}

function nft_set(name, elems) {
	return `\tset ${name} {\n\t\ttype ifname\n` +
		(length(elems) ? `\t\telements = { ${join(', ', map(elems, (d) => sprintf('%J', d)))} }\n` : '') +
		'\t}\n';
}

export function ruleset(c) {
	if (!c)
		c = cursor();
	const uid = vpn_uid();
	if (uid == null || !vpn_dns_servers(c))
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

export function apply_nft(c) {
	const text = ruleset(c);
	if (!text) {
		clear_nft();
		return false;
	}
	mkdir('/var/run/milkflint', 0o755);
	const f = '/var/run/milkflint/vpn-dns.nft';
	writefile(f, text);
	return system(`nft -f ${f}`) == 0;
};
