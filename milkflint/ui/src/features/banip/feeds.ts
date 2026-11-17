// The banIP page's words for banIP's feed catalogue (/etc/banip/banip.feeds,
// banIP 1.9.1): each list grouped by what it holds, said plainly, with its
// chance of blocking something legitimate where that's well known, and the
// presets built from them. Feeds not named here (the page's own, or a
// catalogue newer than this) still show, with banIP's own description.

export type Category = 'attackers' | 'networks' | 'compilations' | 'malware' | 'dns' | 'anonymizers' | 'spam' | 'own';

export const CATEGORIES: readonly { id: Category; title: string; text: string }[] = [
  {
    id: 'attackers',
    title: 'Attackers and scanners',
    text: 'Addresses seen probing for open services and guessing passwords. Blocked as they come in.',
  },
  {
    id: 'networks',
    title: 'Hijacked and unused networks',
    text: 'Address ranges run by criminals, or not given to anyone, where nothing legitimate lives.',
  },
  {
    id: 'compilations',
    title: 'Compilations',
    text: 'FireHOL’s lists built from many others, from the safest (level 1) to the widest (level 4).',
  },
  {
    id: 'malware',
    title: 'Malware and scams',
    text: 'Servers that spread malware or control infected devices: blocked when your devices try to reach them.',
  },
  {
    id: 'dns',
    title: 'Other DNS servers',
    text: 'Public DNS servers, blocked for your devices so they use the router’s DNS (and its filtering) instead.',
  },
  {
    id: 'anonymizers',
    title: 'Tor, proxies, VPNs and data centres',
    text: 'Addresses people hide behind. Useful for a server at home; outbound, they block a lot that’s legitimate.',
  },
  { id: 'spam', title: 'Spam senders', text: 'For a mail server at home: addresses and networks that send spam.' },
  { id: 'own', title: 'Your own feeds', text: 'Lists you added: any web address with one address or network a line.' },
];

export type Risk = 'low' | 'some' | 'high';

export interface FeedInfo {
  category: Category;
  text: string;
  /** the chance of blocking something legitimate */
  risk: Risk;
  /** why, when it's more than low */
  riskText?: string;
  /** where a list that needs an Auth-Key (see needsKey) gets one */
  keyFrom?: { name: string; url: string };
}

export const FEED_INFO: Readonly<Record<string, FeedInfo>> = {
  cinsscore: {
    category: 'attackers',
    text: 'Addresses CINS Army’s sensors saw attacking, scored by how bad they are.',
    risk: 'low',
  },
  debl: {
    category: 'attackers',
    text: 'Addresses fail2ban users reported to blocklist.de for break-in attempts, over the last two days.',
    risk: 'low',
  },
  turris: { category: 'attackers', text: 'Addresses Turris routers’ Sentinel network saw attacking.', risk: 'low' },
  dshield: { category: 'attackers', text: 'The networks attacking the most, from SANS DShield’s sensors.', risk: 'low' },
  bruteforceblock: { category: 'attackers', text: 'Addresses guessing SSH passwords, from Bruteforce Blocker.', risk: 'low' },
  greensnow: { category: 'attackers', text: 'Addresses GreenSnow saw attacking or scanning.', risk: 'low' },
  binarydefense: { category: 'attackers', text: 'Binary Defense’s list of attacking addresses.', risk: 'low' },
  etcompromised: { category: 'attackers', text: 'Hosts Emerging Threats knows to be compromised.', risk: 'low' },
  ipsum: { category: 'attackers', text: 'Addresses on at least three public blocklists at once (IPsum, level 3).', risk: 'low' },
  threatview: { category: 'attackers', text: 'Threatview’s high-confidence malicious addresses.', risk: 'low' },
  becyber: {
    category: 'attackers',
    text: 'Data-Shield’s large list of malicious addresses.',
    risk: 'some',
    riskText: 'A big list, from automated reports.',
  },
  ipthreat: {
    category: 'attackers',
    text: 'IPThreat’s hacker and botnet addresses of the last 30 days.',
    risk: 'some',
    riskText: 'Reports from many users, checked less.',
  },
  ipblackhole: {
    category: 'attackers',
    text: 'BlackHole Monster’s daily list of attacking addresses.',
    risk: 'some',
    riskText: 'Gathered automatically.',
  },
  ipexdbl: {
    category: 'attackers',
    text: 'IPEX’s lists, extracted from many public sources.',
    risk: 'some',
    riskText: 'Gathered automatically from many lists.',
  },
  myip: {
    category: 'attackers',
    text: 'myip.ms’s real-time list of addresses of bad bots and crawlers.',
    risk: 'some',
    riskText: 'Some are crawlers rather than attackers.',
  },
  voip: {
    category: 'attackers',
    text: 'Addresses trying fraud on internet phone (SIP) servers, from VoIPBL. For a phone system at home.',
    risk: 'some',
    riskText: 'Has whole networks as well as addresses.',
  },
  spamhaus: {
    category: 'networks',
    text: 'Spamhaus DROP: networks hijacked or run by criminals. Nothing legitimate is there.',
    risk: 'low',
  },
  threat: {
    category: 'networks',
    text: 'Emerging Threats’ list of compromised hosts and criminal networks to block.',
    risk: 'low',
  },
  bogon: {
    category: 'networks',
    text: 'Address space no one has been given yet, so no real traffic comes from it.',
    risk: 'some',
    riskText: 'Newly given-out space is blocked until the list catches up; its IPv6 part is large.',
  },
  firehol1: {
    category: 'compilations',
    text: 'Level 1: the safest compilation, attacks and networks that are always bad.',
    risk: 'low',
  },
  firehol2: { category: 'compilations', text: 'Level 2: attacks of the last two days, from several lists.', risk: 'low' },
  firehol3: {
    category: 'compilations',
    text: 'Level 3: attacks and malware of the last month.',
    risk: 'some',
    riskText: 'Older reports, so some addresses have changed hands.',
  },
  firehol4: {
    category: 'compilations',
    text: 'Level 4: the widest compilation.',
    risk: 'high',
    riskText: 'FireHOL itself says it has false positives.',
  },
  feodo: {
    category: 'malware',
    text: 'The servers that control banking malware (Emotet, Dridex and others), from abuse.ch.',
    risk: 'low',
  },
  urlhaus: {
    category: 'malware',
    text: 'Servers abuse.ch’s URLhaus saw spreading malware, on web ports.',
    risk: 'low',
    keyFrom: { name: 'abuse.ch', url: 'https://auth.abuse.ch/' },
  },
  urlvir: { category: 'malware', text: 'Hosts serving malware, on web ports.', risk: 'low' },
  webclient: {
    category: 'malware',
    text: 'FireHOL’s list of addresses web browsers should never reach, on web ports.',
    risk: 'low',
  },
  hagezi: {
    category: 'malware',
    text: 'Hagezi’s threat addresses (malware, phishing, scams), on web ports.',
    risk: 'some',
    riskText: 'Shared hosting can put a good site on a listed address.',
  },
  doh: {
    category: 'dns',
    text: 'Public encrypted-DNS servers (DNS over HTTPS), on web ports.',
    risk: 'some',
    riskText: 'Apps that insist on their own DNS stop working until they give up and use the router’s.',
  },
  dns: {
    category: 'dns',
    text: 'Public DNS servers, plain and over TLS.',
    risk: 'high',
    riskText: 'Devices that have a DNS server written in them (some TVs and speakers) lose their names.',
  },
  tor: {
    category: 'anonymizers',
    text: 'Tor’s exit nodes, both ways.',
    risk: 'some',
    riskText: 'Blocks Tor users reaching you, and Tor for your devices.',
  },
  proxy: {
    category: 'anonymizers',
    text: 'Open proxies, both ways.',
    risk: 'some',
    riskText: 'Proxy addresses change hands often.',
  },
  vpn: {
    category: 'anonymizers',
    text: 'VPN providers’ addresses, both ways.',
    risk: 'high',
    riskText: 'Your devices can’t use a VPN service, and VPN users can’t reach you.',
  },
  vpndc: {
    category: 'anonymizers',
    text: 'Data centre and cloud ranges, both ways.',
    risk: 'high',
    riskText: 'Much of the internet’s legitimate services run in data centres: outbound, many sites and apps stop working.',
  },
  uceprotect1: {
    category: 'spam',
    text: 'Single addresses that sent spam to UCEPROTECT’s traps.',
    risk: 'some',
    riskText: 'Meant for mail servers.',
  },
  uceprotect2: {
    category: 'spam',
    text: 'Whole networks with too much spam (UCEPROTECT level 2).',
    risk: 'high',
    riskText: 'Blocks whole networks, people included.',
  },
  uceprotect3: {
    category: 'spam',
    text: 'Whole providers with too much spam (UCEPROTECT level 3).',
    risk: 'high',
    riskText: 'Blocks entire providers and their customers.',
  },
  backscatterer: {
    category: 'spam',
    text: 'Mail servers that send misdirected bounces.',
    risk: 'some',
    riskText: 'Meant for mail servers.',
  },
};

/** banIP's own feeds the page treats apart: countries and networks by number (ASN) */
export const SPECIAL_FEEDS = ['country', 'asn'] as const;

export type PresetId = 'off' | 'recommended' | 'strict' | 'custom';

export interface Preset {
  id: PresetId;
  title: string;
  text: string;
  feeds: readonly string[];
}

const RECOMMENDED = ['cinsscore', 'debl', 'turris', 'spamhaus'];

export const PRESETS: readonly Preset[] = [
  { id: 'off', title: 'Off', text: 'Nothing blocked. banIP doesn’t run.', feeds: [] },
  {
    id: 'recommended',
    title: 'Recommended',
    text: 'Attackers from the most reliable lists, and hijacked networks. Very unlikely to block anything you use.',
    feeds: RECOMMENDED,
  },
  {
    id: 'strict',
    title: 'Strict',
    text: 'More lists, and malware’s servers blocked for your devices too. A little more chance that something legitimate is blocked.',
    feeds: [
      ...RECOMMENDED,
      'firehol1',
      'dshield',
      'etcompromised',
      'bruteforceblock',
      'ipsum',
      'threatview',
      'threat',
      'feodo',
      'urlvir',
      'webclient',
      'hagezi',
    ],
  },
  { id: 'custom', title: 'Custom', text: 'Your own choice of lists, countries and networks.', feeds: [] },
];

export function infoOf(name: string): FeedInfo | undefined {
  return FEED_INFO[name];
}
