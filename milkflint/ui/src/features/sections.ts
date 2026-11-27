// Parts of a page the menu's search opens directly: a tab, or a card the page
// scrolls to, at #/<page>/<id>. Each page reads that id from its address
// (lib/router's tabFrom, or its own effect for a card). Keywords as in
// keywords.ts: other words for what it is, lower case.
import type { FeatureId } from './ids';

export interface Section {
  page: FeatureId;
  /** What follows the page's id in the address. */
  id: string;
  title: string;
  keywords: string;
}

export const sections: readonly Section[] = [
  // Nearby networks' tabs (wifi-scan/page.tsx)
  { page: 'wifi-scan', id: 'radar', title: 'Radar scan', keywords: 'radar dfs weather channel check listen 5 ghz' },
  // Logs' tabs (logs/page.tsx)
  { page: 'logs', id: 'system', title: 'System log', keywords: 'syslog logread messages events' },
  { page: 'logs', id: 'kernel', title: 'Kernel log', keywords: 'dmesg kernel driver' },
  { page: 'logs', id: 'wifi', title: 'Wi-Fi log', keywords: 'wireless hostapd connects disconnects roaming' },
  { page: 'logs', id: 'radar', title: 'Radar log', keywords: 'radar dfs weather channel check' },
  { page: 'logs', id: 'debug', title: 'Debug log', keywords: 'debug counters snapshot dropout' },
  { page: 'logs', id: 'dns', title: 'DNS log', keywords: 'dns slow lookups queries' },
  { page: 'logs', id: 'banip', title: 'banIP log', keywords: 'banip blocked blocks' },
  { page: 'logs', id: 'crash', title: 'Crash reports', keywords: 'crash crashes oops panic kfence memory errors' },
  // banIP's tabs (banip/page.tsx)
  { page: 'banip', id: 'lists', title: 'Your lists', keywords: 'allowlist blocklist allow block own addresses' },
  { page: 'banip', id: 'activity', title: 'Activity', keywords: 'blocked hits recent attacks' },
  // Firewall's tabs (firewall/page.tsx)
  { page: 'firewall', id: 'zones', title: 'Zones', keywords: 'zone lan wan guest forwarding masquerade' },
  // Router access's tabs (admin-password/page.tsx)
  { page: 'admin-password', id: 'https', title: 'HTTPS', keywords: 'https certificate tls ssl redirect secure' },
  { page: 'admin-password', id: 'ssh', title: 'SSH', keywords: 'ssh dropbear port password logins shell command line' },
  {
    page: 'admin-password',
    id: 'ssh-keys',
    title: 'SSH keys',
    keywords: 'ssh keys authorized_keys public key ed25519 passwordless login',
  },
  {
    page: 'admin-password',
    id: 'package-keys',
    title: 'Package keys',
    keywords: 'apk repository public keys signing feed packages',
  },
  // Startup's tab (startup/page.tsx)
  { page: 'startup', id: 'local', title: 'Local startup', keywords: 'rc.local boot commands script' },
  // cards a page scrolls to (tuning/page.tsx)
  {
    page: 'tuning',
    id: 'diagnostics',
    title: 'Diagnostics',
    keywords: 'debug counters snapshot kfence memory error checker crash dropout',
  },
];
