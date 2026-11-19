// DNS programs that can run on the router next to dnsmasq, set up outside
// MilkFlint (ctrld, AdGuard Home installed by hand, Unbound, ...): their
// names as people know them, by the process name the router's DNS check
// finds them by (source/feed/milkflint-ui/files/features/dns/bin/dns-path.uc),
// and whether they keep a cache of their own as installed.
// No imports from the app, so the tests (ui/tests) load it as it is.

/** A DNS program on the router that MilkFlint didn't set up, which devices' lookups reach (milkflint.dns status). */
export interface OutsideDns {
  /** front: it answers on port 53 in place of dnsmasq; forward: dnsmasq sends lookups to it. */
  how: 'front' | 'forward';
  /** Its process name; null when nothing was found listening there. */
  program?: string | null | undefined;
  addr: string;
  port: number;
  /** The dnsmasq config file that sends lookups to it (forward). */
  file?: string | null | undefined;
}

const known: Readonly<Record<string, { name: string; caches: boolean }>> = {
  ctrld: { name: 'ctrld', caches: false },
  AdGuardHome: { name: 'AdGuard Home', caches: true },
  unbound: { name: 'Unbound', caches: true },
  stubby: { name: 'Stubby', caches: false },
  'https-dns-proxy': { name: 'https-dns-proxy', caches: false },
  dnsproxy: { name: 'dnsproxy', caches: false },
  'dnscrypt-proxy': { name: 'dnscrypt-proxy', caches: true },
  smartdns: { name: 'SmartDNS', caches: true },
  'pihole-FTL': { name: 'Pi-hole', caches: true },
  kresd: { name: 'Knot Resolver', caches: true },
  named: { name: 'BIND', caches: true },
  dnsmasq: { name: 'dnsmasq', caches: true },
};

/** A program's name as people know it ("AdGuardHome" → "AdGuard Home"); unknown ones as they are. */
export function programName(program: string): string {
  return known[program]?.name ?? program;
}

/** Whether it answers repeat lookups from a cache of its own as installed (unknown programs: not said). */
export function programCaches(program: string): boolean {
  return known[program]?.caches ?? false;
}

/** Who handles DNS: the program's name, or "A DNS program on port N" when none was found there. */
export function outsideName(o: OutsideDns): string {
  return o.program === undefined || o.program === null || o.program === ''
    ? `A DNS program on port ${String(o.port)}`
    : programName(o.program);
}

/**
 * Network Quality's key for a DNS program on the router: "local:<program>:<port>",
 * or "local:<port>" when nothing was found listening there; undefined for other keys.
 */
export function parseLocalKey(key: string): { program: string | undefined; port: number } | undefined {
  const m = /^local:(?:([^:]+):)?(\d+)$/.exec(key);
  return m === null ? undefined : { program: m[1], port: Number(m[2]) };
}
