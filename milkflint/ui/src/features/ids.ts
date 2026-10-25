// Every page's id: its route (#/<id>) and its key in the registry. Kept in a
// file with no imports so the router and links can use it without cycles.
export const featureIds = [
  'dashboard',
  'internet',
  'dns',
  'wifi',
  'wifi-guest',
  'wifi-scan',
  'radar-scan',
  'clients',
  'lan',
  'ipv6',
  'remote-access',
  'vpn-client',
  'network-quality',
  'data-statistics',
  'sqm',
  'tuning',
  'firewall',
  'upnp',
  'system-overview',
  'admin-password',
  'upgrade',
  'time',
  'schedules',
  'logs',
  'backup-reset',
] as const;

export type FeatureId = (typeof featureIds)[number];
