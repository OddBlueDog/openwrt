// The Startup page's model: the services in /etc/init.d as rpcd's rc list
// gives them, what the common ones do, what stopping one the router can't
// do without would do, and /etc/rc.local as LuCI saves it.
import { z } from 'zod';

/** One script in rc list's reply. */
export interface RcEntry {
  /** Its place in the start order (/etc/rc.d/S<start><name>); none while it's turned off at boot. */
  start?: number | undefined;
  stop?: number | undefined;
  enabled: boolean;
  /** Whether procd runs it now; only for services procd keeps running. */
  running?: boolean | undefined;
}

export interface Service {
  name: string;
  start: number | undefined;
  enabled: boolean;
  running: boolean | undefined;
}

/** In start order, then by name, as LuCI lists them; those without a start number (turned off) last. */
export function servicesOf(list: Readonly<Record<string, RcEntry>>): Service[] {
  return Object.entries(list)
    .map(([name, e]) => ({ name, start: e.start, enabled: e.enabled, running: e.running }))
    .sort((a, b) => {
      const order = (a.start ?? Infinity) - (b.start ?? Infinity);
      return order !== 0 && !Number.isNaN(order) ? order : a.name.localeCompare(b.name);
    });
}

// what the router's own services do, in a line
const what: Readonly<Record<string, string>> = {
  adguardhome: 'AdGuard Home: blocks ads and trackers for every device',
  banip: 'banIP: blocks known bad addresses',
  boot: 'Sets the router up as it starts',
  bootcount: 'Counts the starts, for a failed upgrade to fall back',
  cron: 'Runs scheduled tasks',
  dnsmasq: 'Hands out addresses (DHCP) and answers names (DNS)',
  dnsproxy: 'Encrypted DNS to your DNS provider',
  done: 'Runs /etc/rc.local once the router has started',
  dropbear: 'SSH: a command line on the router',
  firewall: 'Loads the firewall’s rules',
  gpio_switch: 'Sets the board’s switches and pins',
  led: 'Sets the lights',
  log: 'Keeps the system log',
  miniupnpd: 'UPnP: lets games and apps open ports',
  network: 'Every network: internet, LAN, Wi-Fi’s bridges, VPNs',
  nlbwmon: 'Counts each device’s data use',
  odhcpd: 'Hands out IPv6 addresses (DHCPv6, router adverts)',
  packet_steering: 'Spreads network work over the CPU cores',
  rpcd: 'Answers this page and LuCI',
  sqm: 'Smart Queue: keeps delay down under load',
  sysctl: 'Applies kernel settings',
  sysfixtime: 'Sets the clock from the last time it was saved',
  sysntpd: 'Sets the clock from time servers',
  system: 'Hostname, time zone and lights',
  ubihealthd: 'Checks the flash memory',
  ucitrack: 'Reloads services when their settings change',
  uhttpd: 'The web server for this page and LuCI',
  umount: 'Unmounts storage as the router shuts down',
  urandom_seed: 'Saves randomness for the next start',
  urngd: 'Gathers randomness for encryption',
  wpad: 'Wi-Fi (hostapd): networks and passwords',
  // MilkFlint's own (source/feed/milkflint-ui/files/features/*/init)
  'milkflint-adguardhome': 'Sends devices’ DNS to AdGuard Home while it answers',
  'milkflint-airtime': 'Airtime fairness: a smaller share of the air for a poor Wi-Fi link',
  'milkflint-banip': 'Keeps banIP’s start and updates in step with its page',
  'milkflint-dashboard': 'Keeps Home’s sensor history',
  'milkflint-data-statistics': 'Turns data statistics (nlbwmon) on and off',
  'milkflint-device-control': 'Device control’s times and cut-offs',
  'milkflint-dns': 'Turns encrypted DNS (dnsproxy) on and off',
  'milkflint-logs': 'Keeps the logs on the router’s storage, and the Wi-Fi log',
  'milkflint-network-quality': 'Network Quality’s probe',
  'milkflint-tuning': 'Puts Performance tuning’s settings into effect',
  'milkflint-vpn': 'DNS through the VPN, when the VPN client asks for it',
  'milkflint-wifi': 'Keeps the radar log',
};

export function describeService(name: string): string | undefined {
  return what[name];
}

// what goes when one the router can't do without stops
const needed: Readonly<Record<string, string>> = {
  network: 'Every network goes down, and this page with it.',
  rpcd: 'This page and LuCI stop working.',
  uhttpd: 'This page and LuCI stop answering.',
  firewall: 'The firewall’s rules come out, so nothing guards the router from the internet.',
  dnsmasq: 'Devices stop getting addresses and names (DHCP and DNS).',
  odhcpd: 'Devices stop getting IPv6 addresses.',
  wpad: 'Wi-Fi goes off.',
  dropbear: 'SSH stops answering.',
  boot: 'The router’s setup as it starts is skipped.',
  system: 'The hostname, time zone and lights aren’t set.',
  log: 'Nothing is logged.',
};

/** What stopping it (or turning it off at boot) would do, for a service the router needs. */
export function consequence(name: string): string | undefined {
  return needed[name];
}

/** The file as LuCI's Local Startup saves it: Unix line ends, trimmed, one newline at the end. */
export function rcLocalText(text: string): string {
  return `${text.replace(/\r\n/g, '\n').trim()}\n`;
}

/** Local startup's form: /etc/rc.local's text. */
export const rcLocalFormSchema = z.object({ text: z.string() });
