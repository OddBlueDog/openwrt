// The DNS page's opening answer, in plain words from the saved settings: who
// your devices ask, where the router sends their lookups, and what the cache
// and protection do. Plain functions, so ui/tests can run them.
import { keepLabel } from './cache-stages';
import { splitAddresses } from './device-dns';
import { backupPick, DEFAULT_CACHE_SIZE, type DnsForm, mainPick } from './model';
import { describe, shortName } from './upstreams';

export interface DnsAnswer {
  devices: { who: 'router' | 'own' | 'adguard'; value: string; text: string };
  upstream: { value: string; encrypted: boolean; text: string };
  protection: { value: string; text: string };
}

const capital = (s: string): string => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/** `adguard`: AdGuard Home on the router filters the devices' lookups first. */
export function dnsAnswer(f: DnsForm, routerIp: string, adguard: boolean): DnsAnswer {
  const own = [...splitAddresses(f.devices.ipv4), ...splitAddresses(f.devices.ipv6)];
  const devices: DnsAnswer['devices'] = f.devices.own
    ? { who: 'own', value: 'Your own server', text: `At ${own.join(', ')}. Guest networks keep using the router.` }
    : adguard
      ? {
          who: 'adguard',
          value: 'AdGuard Home',
          text: 'On the router: it filters each lookup first, and what it doesn’t block goes on as below.',
        }
      : {
          who: 'router',
          value: 'This router',
          text: `At ${routerIp}. It also answers names on your network, such as name.${f.domain}.`,
        };

  const main = mainPick(f);
  const backup = backupPick(f);
  const upstream: DnsAnswer['upstream'] =
    f.mode === 'auto'
      ? {
          value: 'Your provider',
          encrypted: false,
          text: 'Your internet provider’s DNS servers. Your provider sees every lookup.',
        }
      : {
          value: capital(backup === undefined ? shortName(main) : `${shortName(main)} and ${shortName(backup)}`),
          encrypted: f.mode === 'encrypted',
          text: describe(f.mode, main, backup, f.pair),
        };

  const size = f.cacheSize === '' ? DEFAULT_CACHE_SIZE : f.cacheSize;
  const cache = !f.cacheOn
    ? 'Every lookup goes out to the DNS server.'
    : `Keeps up to ${Number(size).toLocaleString('en-GB')} answers${f.quick ? `, and reuses expired ones for up to ${keepLabel(f.keepHours)}` : ''}.`;
  const caught = f.devices.own
    ? undefined
    : f.intercept
      ? 'Catches devices with their own DNS.'
      : 'Devices set to their own DNS aren’t caught.';
  const rebind = f.rebind ? 'Rebinding protection on.' : 'Rebinding protection off.';
  return {
    devices,
    upstream,
    protection: {
      value: f.cacheOn ? 'Cache on' : 'Cache off',
      text: [cache, caught, rebind].filter((x) => x !== undefined).join(' '),
    },
  };
}

/**
 * What's under the devices card's More settings that isn't at its usual
 * value, so nothing unusual hides behind the fold; undefined when all is.
 */
export function moreSummary(f: DnsForm, flags: { uncovered: boolean; invalid: boolean }): string | undefined {
  const names = f.records.length;
  const odd = [
    flags.invalid ? 'needs a fix' : undefined,
    flags.uncovered ? 'not on every guest network yet' : undefined,
    f.intercept && !f.devices.own ? 'catches devices’ own DNS' : undefined,
    f.rebind ? undefined : 'rebinding protection off',
    f.domain === 'lan' ? undefined : `domain ${f.domain}`,
    names === 0 ? undefined : `${String(names)} custom ${names === 1 ? 'name' : 'names'}`,
  ].filter((x) => x !== undefined);
  return odd.length === 0 ? undefined : odd.join(' · ');
}
