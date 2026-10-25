// The sections the Remote access page makes and keeps up, all named after
// its WireGuard interface, wg_in, so LuCI shows each in its usual place: the
// interface and its peers, one per device (Network → Interfaces), and the
// zone, the open port, DNS and the ways out (Network → Firewall). Shared with
// the Firewall page, which labels them, and the DNS page, whose intercept
// covers the zone too.

export const SERVER = 'wg_in';

/** OpenWrt's section type for the interface's peers. */
export const PEER_TYPE = `wireguard_${SERVER}`;

/** The zone, the open port, DNS to the router, and its forwardings to the internet and the home network. */
export const SERVER_FIREWALL = [SERVER, `${SERVER}_port`, `${SERVER}_dns`, `${SERVER}_wan`, `${SERVER}_lan`] as const;

/** milkflint.remote_access: the address devices connect to, which OpenWrt has nowhere for. */
export const SERVER_META = 'remote_access';
