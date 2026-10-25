// The DNS page's "catch devices with their own DNS": a port forward (fw4
// redirect) that sends DNS from a zone's devices to the router, whatever
// server they asked. fw4 takes one source zone per redirect, so there's one
// for the home network and one for each guest network's zone and the
// Remote access zone. The home network's is the switch: while it's on, the
// DNS page makes one for every such zone there is, the Guest Wi-Fi and
// Remote access pages make one for a zone they set up, and their Remove
// takes it out with the rest of the zone. Those zones' own rules already let
// DNS through to the router.
import { bool, type Change, type Section } from '@/lib/api/uci';
import { SERVER } from '../remote-access/sections';
import { GUEST_IDS, type GuestId } from '../wifi-guest/guest';

/** The home network's (its old name, kept so the switch reads what's there). */
export const INTERCEPT = 'milkflint_dns_intercept';

export type InterceptZone = 'lan' | GuestId | typeof SERVER;

/** milkflint_dns_intercept, milkflint_dns_intercept_guest2… */
export function interceptSection(zone: InterceptZone): string {
  return zone === 'lan' ? INTERCEPT : `${INTERCEPT}_${zone}`;
}

/** Every section name an intercept can have. */
export const INTERCEPT_SECTIONS: readonly string[] = (['lan', ...GUEST_IDS, SERVER] as const).map(interceptSection);

/** The switch: the home network's redirect is there and on. */
export function interceptOn(firewall: readonly Section[]): boolean {
  const s = firewall.find((x) => x['.name'] === INTERCEPT);
  return s !== undefined && bool(s, 'enabled', true);
}

export function addIntercept(zone: InterceptZone): Change {
  // Intercept DNS (MilkFlint), Intercept DNS Guest2 (MilkFlint), Intercept DNS Remote access (MilkFlint)…
  const which = zone === 'lan' ? '' : zone === SERVER ? ' Remote access' : ` ${zone.charAt(0).toUpperCase()}${zone.slice(1)}`;
  return {
    op: 'add',
    config: 'firewall',
    type: 'redirect',
    name: interceptSection(zone),
    values: { name: `Intercept DNS${which} (MilkFlint)`, src: zone, src_dport: '53', proto: 'tcp udp', target: 'DNAT', family: 'any' },
  };
}
