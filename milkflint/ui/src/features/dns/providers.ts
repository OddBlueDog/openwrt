// Public DNS providers, as the stock firmware offers them: each with a few
// servers (filtering levels), their plain addresses for static DNS, and
// their encrypted addresses (DNS over HTTPS, TLS and, for some, QUIC).

export type Proto = 'doh' | 'dot' | 'doq';

export const protoLabels: Record<Proto, string> = {
  doh: 'DNS over HTTPS (DoH)',
  dot: 'DNS over TLS (DoT)',
  doq: 'DNS over QUIC (DoQ)',
};

export interface DnsServer {
  name: string;
  description: string;
  doh: string;
  dot: string;
  doq?: string;
  v4: readonly string[];
  v6: readonly string[];
}

export interface DnsProvider {
  label: string;
  protos: readonly Proto[];
  servers: readonly DnsServer[];
}

export const providers = {
  cloudflare: {
    label: 'Cloudflare',
    protos: ['doh', 'dot'],
    servers: [
      {
        name: 'Standard',
        description: 'Nothing filtered. Fast and privacy-focused.',
        doh: 'https://cloudflare-dns.com/dns-query',
        dot: 'tls://one.one.one.one',
        v4: ['1.1.1.1', '1.0.0.1'],
        v6: ['2606:4700:4700::1111', '2606:4700:4700::1001'],
      },
      {
        name: 'Security',
        description: 'Blocks known malware and phishing sites.',
        doh: 'https://security.cloudflare-dns.com/dns-query',
        dot: 'tls://security.cloudflare-dns.com',
        v4: ['1.1.1.2', '1.0.0.2'],
        v6: ['2606:4700:4700::1112', '2606:4700:4700::1002'],
      },
      {
        name: 'Family',
        description: 'Security, and blocks adult content too.',
        doh: 'https://family.cloudflare-dns.com/dns-query',
        dot: 'tls://family.cloudflare-dns.com',
        v4: ['1.1.1.3', '1.0.0.3'],
        v6: ['2606:4700:4700::1113', '2606:4700:4700::1003'],
      },
    ],
  },
  google: {
    label: 'Google',
    protos: ['doh', 'dot'],
    servers: [
      {
        name: 'Default',
        description: 'Nothing filtered.',
        doh: 'https://dns.google/dns-query',
        dot: 'tls://dns.google',
        v4: ['8.8.8.8', '8.8.4.4'],
        v6: ['2001:4860:4860::8888', '2001:4860:4860::8844'],
      },
    ],
  },
  quad9: {
    label: 'Quad9',
    protos: ['doh', 'dot'],
    servers: [
      {
        name: 'Recommended',
        description: 'Blocks malware, validates DNSSEC.',
        doh: 'https://dns.quad9.net/dns-query',
        dot: 'tls://dns.quad9.net',
        v4: ['9.9.9.9', '149.112.112.112'],
        v6: ['2620:fe::fe', '2620:fe::9'],
      },
      {
        name: 'Secured with ECS',
        description: 'As Recommended, and passes part of your address on so CDNs pick nearby servers.',
        doh: 'https://dns11.quad9.net/dns-query',
        dot: 'tls://dns11.quad9.net',
        v4: ['9.9.9.11', '149.112.112.11'],
        v6: ['2620:fe::11', '2620:fe::fe:11'],
      },
      {
        name: 'Unsecured',
        description: 'No malware blocking, no DNSSEC validation.',
        doh: 'https://dns10.quad9.net/dns-query',
        dot: 'tls://dns10.quad9.net',
        v4: ['9.9.9.10', '149.112.112.10'],
        v6: ['2620:fe::10', '2620:fe::fe:10'],
      },
    ],
  },
  adguard: {
    label: 'AdGuard',
    protos: ['doh', 'dot', 'doq'],
    servers: [
      {
        name: 'Default',
        description: 'Blocks ads and trackers.',
        doh: 'https://dns.adguard-dns.com/dns-query',
        dot: 'tls://dns.adguard-dns.com',
        doq: 'quic://dns.adguard-dns.com',
        v4: ['94.140.14.14', '94.140.15.15'],
        v6: ['2a10:50c0::ad1:ff', '2a10:50c0::ad2:ff'],
      },
      {
        name: 'Unfiltered',
        description: 'Nothing blocked.',
        doh: 'https://unfiltered.adguard-dns.com/dns-query',
        dot: 'tls://unfiltered.adguard-dns.com',
        doq: 'quic://unfiltered.adguard-dns.com',
        v4: ['94.140.14.140', '94.140.14.141'],
        v6: ['2a10:50c0::1:ff', '2a10:50c0::2:ff'],
      },
      {
        name: 'Family',
        description: 'Blocks ads, trackers and adult content; Safe Search where possible.',
        doh: 'https://family.adguard-dns.com/dns-query',
        dot: 'tls://family.adguard-dns.com',
        doq: 'quic://family.adguard-dns.com',
        v4: ['94.140.14.15', '94.140.15.16'],
        v6: ['2a10:50c0::bad1:ff', '2a10:50c0::bad2:ff'],
      },
    ],
  },
  opendns: {
    label: 'OpenDNS',
    protos: ['doh', 'dot'],
    servers: [
      {
        name: 'Standard',
        description: 'Nothing filtered.',
        doh: 'https://dns.opendns.com/dns-query',
        dot: 'tls://dns.opendns.com',
        v4: ['208.67.222.222', '208.67.220.220'],
        v6: ['2620:119:35::35', '2620:119:53::53'],
      },
      {
        name: 'FamilyShield',
        description: 'Blocks adult content, proxies and phishing sites.',
        doh: 'https://familyshield.opendns.com/dns-query',
        dot: 'tls://familyshield.opendns.com',
        v4: ['208.67.222.123', '208.67.220.123'],
        v6: ['2620:119:35::123', '2620:119:53::123'],
      },
    ],
  },
  cleanbrowsing: {
    label: 'CleanBrowsing',
    protos: ['doh', 'dot'],
    servers: [
      {
        name: 'Security Filter',
        description: 'Blocks phishing, spam and malware domains.',
        doh: 'https://doh.cleanbrowsing.org/doh/security-filter/',
        dot: 'tls://security-filter-dns.cleanbrowsing.org',
        v4: ['185.228.168.9', '185.228.169.9'],
        v6: ['2a0d:2a00:1::2', '2a0d:2a00:2::2'],
      },
      {
        name: 'Adult Filter',
        description: 'Blocks adult sites; Google and Bing in Safe Mode.',
        doh: 'https://doh.cleanbrowsing.org/doh/adult-filter/',
        dot: 'tls://adult-filter-dns.cleanbrowsing.org',
        v4: ['185.228.168.10', '185.228.169.11'],
        v6: ['2a0d:2a00:1::1', '2a0d:2a00:2::1'],
      },
      {
        name: 'Family Filter',
        description: 'Adult Filter, and blocks proxies, VPNs and mixed-content sites.',
        doh: 'https://doh.cleanbrowsing.org/doh/family-filter/',
        dot: 'tls://family-filter-dns.cleanbrowsing.org',
        v4: ['185.228.168.168', '185.228.169.168'],
        v6: ['2a0d:2a00:1::', '2a0d:2a00:2::'],
      },
    ],
  },
  controld: {
    label: 'Control D',
    protos: ['doh', 'dot', 'doq'],
    servers: [
      {
        name: 'Unfiltered',
        description: 'Nothing blocked.',
        doh: 'https://freedns.controld.com/p0',
        dot: 'tls://p0.freedns.controld.com',
        doq: 'quic://p0.freedns.controld.com',
        v4: ['76.76.2.0', '76.76.10.0'],
        v6: ['2606:1a40::', '2606:1a40:1::'],
      },
      {
        name: 'Malware',
        description: 'Blocks malware.',
        doh: 'https://freedns.controld.com/p1',
        dot: 'tls://p1.freedns.controld.com',
        doq: 'quic://p1.freedns.controld.com',
        v4: ['76.76.2.1', '76.76.10.1'],
        v6: ['2606:1a40::1', '2606:1a40:1::1'],
      },
      {
        name: 'Malware + Ads',
        description: 'Blocks malware, ads and tracking.',
        doh: 'https://freedns.controld.com/p2',
        dot: 'tls://p2.freedns.controld.com',
        doq: 'quic://p2.freedns.controld.com',
        v4: ['76.76.2.2', '76.76.10.2'],
        v6: ['2606:1a40::2', '2606:1a40:1::2'],
      },
      {
        name: 'Malware + Ads + Social',
        description: 'Blocks malware, ads, tracking and social networks.',
        doh: 'https://freedns.controld.com/p3',
        dot: 'tls://p3.freedns.controld.com',
        doq: 'quic://p3.freedns.controld.com',
        v4: ['76.76.2.3', '76.76.10.3'],
        v6: ['2606:1a40::3', '2606:1a40:1::3'],
      },
      {
        name: 'Family',
        description: 'Blocks malware, ads, tracking and adult content.',
        doh: 'https://freedns.controld.com/family',
        dot: 'tls://family.freedns.controld.com',
        doq: 'quic://family.freedns.controld.com',
        v4: ['76.76.2.4', '76.76.10.4'],
        v6: ['2606:1a40::4', '2606:1a40:1::4'],
      },
    ],
  },
} as const satisfies Record<string, DnsProvider>;

export type ProviderId = keyof typeof providers;

export function isProviderId(id: string): id is ProviderId {
  return Object.hasOwn(providers, id);
}

/** The encrypted address of a server for a protocol, if it has one. */
export function urlFor(server: DnsServer, proto: Proto): string | undefined {
  return proto === 'doh' ? server.doh : proto === 'dot' ? server.dot : server.doq;
}

/** What protocol an encrypted DNS address uses, from its scheme (sdns:// stamps: DNSCrypt and others). */
export function protoOf(url: string): Proto | 'sdns' | undefined {
  if (url.startsWith('https://')) return 'doh';
  if (url.startsWith('tls://')) return 'dot';
  if (url.startsWith('quic://')) return 'doq';
  if (url.startsWith('sdns://')) return 'sdns';
  return undefined;
}
