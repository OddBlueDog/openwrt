// The sections the VPN client page makes and keeps up, all named after its
// WireGuard interface, wg_out, so LuCI shows each in its usual place: the
// interface and its one peer, the VPN provider's server, and the routing
// rules that send marked devices through it (Network → Interfaces, Network
// → Routing); the zone, its forwardings, the rules that mark devices and the
// kill switch's block (Network → Firewall); and a Smart Queue inside the
// tunnel (Network → SQM QoS). Shared with the Firewall and Smart Queue pages,
// which label them or leave them out.
import { GUEST_IDS, type GuestId } from '../wifi-guest/guest';

export const CLIENT = 'wg_out';

/** OpenWrt's section type for the interface's peer. */
export const CLIENT_PEER_TYPE = `wireguard_${CLIENT}`;
export const CLIENT_PEER = `${CLIENT}_server`;

/**
 * The routing table the tunnel's routes go in (netifd's ip4table and
 * ip6table), and the mark (fw4's MARK rules) that sends a device's traffic
 * there: the top four bits, clear of what mwan3, pbr and SQM use.
 */
export const CLIENT_TABLE = '2100';
export const CLIENT_MARK = '0x10000000/0xf0000000';

/** The zones whose devices may use it: the home network and the guest networks. */
export type SourceZone = 'lan' | GuestId;
export const SOURCE_ZONES: readonly SourceZone[] = ['lan', ...GUEST_IDS];

/** wg_out_lan, wg_out_guest2…: the forwarding from a zone into the tunnel. */
export function forwardSection(zone: SourceZone): string {
  return `${CLIENT}_${zone}`;
}

/** wg_out_mark_lan…: the MARK rule for a zone's devices. */
export function markSection(zone: SourceZone): string {
  return `${CLIENT}_mark_${zone}`;
}

/** wg_out_leak_lan…: the kill switch's block of a zone's marked traffic to the internet. */
export function leakSection(zone: SourceZone): string {
  return `${CLIENT}_leak_${zone}`;
}

/** The home network's devices that don't use it ("everyone except"). */
export const CLIENT_SKIP = `${CLIENT}_skip`;

/**
 * Sites that go direct: fw4's two sets of their addresses (no timeout), and
 * dhcp's ipset section of the same name without the family, the one place
 * the list of names lives, which has dnsmasq fill the sets as it answers
 * (LuCI: DHCP and DNS → IP Sets). The VPN's DNS forwarder and AdGuard Home
 * read the names from there too.
 */
export const DIRECT_SET4 = `${CLIENT}_direct4`;
export const DIRECT_SET6 = `${CLIENT}_direct6`;
export const DIRECT_DNS = `${CLIENT}_direct`;

/** wg_out_direct_lan_4…: per zone and family, the MARK rule that takes the VPN's bits off traffic to those addresses. */
export function directRuleSection(zone: SourceZone, family: 4 | 6): string {
  return `${DIRECT_DNS}_${zone}_${String(family)}`;
}

export const CLIENT_FIREWALL: readonly string[] = [
  CLIENT,
  CLIENT_SKIP,
  DIRECT_SET4,
  DIRECT_SET6,
  ...SOURCE_ZONES.flatMap((z) => [
    forwardSection(z),
    markSection(z),
    leakSection(z),
    directRuleSection(z, 4),
    directRuleSection(z, 6),
  ]),
];

/** netifd's rule and rule6 sections: past the main table's own routes, into the tunnel's table, and the kill switch. */
export const CLIENT_RULES = [`${CLIENT}_main`, `${CLIENT}_via`, `${CLIENT}_kill`] as const;
export const CLIENT_RULES6 = CLIENT_RULES.map((r) => `${r}6`);

/** The Smart Queue inside the tunnel: sqm.wg_out, on the wg_out device and its ifb4wg_out. */
export const CLIENT_QUEUE = CLIENT;

/** milkflint.vpn_client: the provider's DNS servers and whether the tunnel's devices use them. */
export const CLIENT_META = 'vpn_client';

export function isVpnShaper(device: string | undefined): boolean {
  return device === CLIENT || device === `ifb4${CLIENT}`;
}

/**
 * Saved presets of the whole form: milkflint.vpnp_<n> (type vpn_profile), and
 * the pointer to the active one, milkflint.vpn_profiles option active. Neither
 * is part of what the client owns: Remove keeps the profiles.
 */
export const PROFILE_TYPE = 'vpn_profile';
export const PROFILE_PREFIX = 'vpnp_';
export const PROFILES_POINTER = 'vpn_profiles';
export const PROFILES_POINTER_TYPE = 'vpn_profiles';
