// What dhcp.lan.dhcpv6 means to odhcpd: 'server' and 'hybrid' hand out the
// leases, 'relay' passes them to the main router (which keeps them), and
// anything else, or nothing set, is off (odhcpd's default is 'disabled').
export type Dhcpv6Mode = 'server' | 'relay' | 'off';

export function dhcpv6Mode(value: string | undefined): Dhcpv6Mode {
  if (value === 'server' || value === 'hybrid') return 'server';
  return value === 'relay' ? 'relay' : 'off';
}
