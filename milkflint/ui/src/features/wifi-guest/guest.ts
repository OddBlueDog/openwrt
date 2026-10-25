// Guest networks as OpenWrt's own guide sets one up, so LuCI shows every
// part of each in its usual place: an interface on a bridge of its own
// (Network → Interfaces), a DHCP pool (DHCP and DNS), a firewall zone that
// may only go out to the internet (Network → Firewall), and an access point
// on each band (Network → Wireless). There can be up to three, each named
// after its interface: guest (the first, as the page has always made it),
// guest2 and guest3. Shared by the Wi-Fi, SQM and Firewall pages, which
// leave the guest networks' parts out of their own settings.
import { list, type Section, str } from '@/lib/api/uci';

/** The guest networks' interface names, in the order they're offered. */
export const GUEST_IDS = ['guest', 'guest2', 'guest3'] as const;
export type GuestId = (typeof GUEST_IDS)[number];

export function isGuestNetwork(name: string | undefined): name is GuestId {
  return GUEST_IDS.some((id) => id === name);
}

/** br-guest, br-guest2…: each guest network's own bridge. */
export function guestBridge(id: GuestId): string {
  return `br-${id}`;
}

/** "Guests", "Guest network 2"…: a guest network's label when it has none of its own. */
export function defaultGuestLabel(id: GuestId): string {
  const n = GUEST_IDS.indexOf(id) + 1;
  return n === 1 ? 'Guests' : `Guest network ${String(n)}`;
}

/** What the Guest Wi-Fi page calls each guest network: its label in /etc/config/milkflint, or the default. */
export function guestLabels(milkflint: readonly Section[]): Record<GuestId, string> {
  const label = (id: GuestId): string => {
    const set = str(milkflint.find((s) => s['.type'] === 'guest_network' && s['.name'] === id), 'label')?.trim();
    return set === undefined || set === '' ? defaultGuestLabel(id) : set;
  };
  return { guest: label('guest'), guest2: label('guest2'), guest3: label('guest3') };
}

/**
 * A guest network's speed limit is an SQM queue on its bridge (Network →
 * SQM QoS in LuCI), so the bridge and its ingress IFB carry CAKE too: the
 * Smart Queue page, which is about the internet port, leaves them out.
 */
export function isGuestShaper(device: string | undefined): boolean {
  return GUEST_IDS.some((id) => device === guestBridge(id) || device === `ifb4${guestBridge(id)}`);
}

/** A wifi-iface (from UCI, or netifd's status) on a guest network. */
export function onGuestNetwork(networks: readonly string[] | undefined): boolean {
  return networks?.some(isGuestNetwork) === true;
}

export function isGuestIface(s: Section): boolean {
  return s['.type'] === 'wifi-iface' && onGuestNetwork(list(s, 'network'));
}

/** The firewall sections a guest network's page made and keeps up, by section name. */
export function guestFirewallSections(id: GuestId): string[] {
  return [id, `${id}_wan`, `${id}_dns`, `${id}_dhcp`];
}
