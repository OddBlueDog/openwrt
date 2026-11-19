// The DNS page's opening answer, in plain words from the saved settings: who
// your devices ask, where the router sends their lookups, and what the cache
// and protection do. Plain functions, so ui/tests can run them.
import { keepLabel } from './cache-stages';
import { splitAddresses } from './device-dns';
import { backupPick, DEFAULT_CACHE_SIZE, type DnsForm, type Mode, mainPick } from './model';
import { type OutsideDns, outsideName } from './programs';
import { describe, shortName } from './upstreams';

export interface DnsAnswer {
  devices: { who: 'router' | 'own' | 'adguard' | 'outside'; value: string; text: string };
  /** outside: a DNS program set up outside MilkFlint, so whether it encrypts isn't known here. */
  upstream: { value: string; encrypted: boolean; outside?: true; text: string };
  protection: { value: string; text: string };
}

const capital = (s: string): string => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/**
 * `adguard`: AdGuard Home on the router filters the devices' lookups first.
 * `outside`: a DNS program set up outside MilkFlint that their lookups reach
 * (the router's status), in place of dnsmasq or behind it.
 */
export function dnsAnswer(f: DnsForm, routerIp: string, adguard: boolean, outside?: OutsideDns): DnsAnswer {
  const own = [...splitAddresses(f.devices.ipv4), ...splitAddresses(f.devices.ipv6)];
  const devices: DnsAnswer['devices'] = f.devices.own
    ? { who: 'own', value: 'Your own server', text: `At ${own.join(', ')}. Guest networks keep using the router.` }
    : outside?.how === 'front'
      ? {
          who: 'outside',
          value: outsideName(outside),
          text: 'On the router: it answers on port 53 in place of dnsmasq. It was set up outside MilkFlint.',
        }
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
    outside?.how === 'forward'
      ? {
          value: outsideName(outside),
          encrypted: false,
          outside: true,
          text:
            `On the router, at ${outside.addr}#${String(outside.port)}` +
            (outside.file === undefined || outside.file === null || outside.file === '' ? '.' : ` (from ${outside.file}).`) +
            (f.mode === 'auto' ? '' : ' dnsmasq also sends some to the servers chosen below.'),
        }
      : f.mode === 'auto'
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
 * The DNS servers card's warning while a DNS program set up outside
 * MilkFlint handles lookups: these settings don't decide where they go;
 * `status`, the card's line saying where they do go (none: the settings'
 * own still holds for what reaches dnsmasq).
 */
export function outsideNote(o: OutsideDns, mode: Mode): { title: string; text: string; status?: string } {
  const name = outsideName(o);
  if (o.how === 'front')
    return {
      title: `${name} answers your devices’ lookups`,
      text: `It was set up outside MilkFlint and answers on port 53 in place of dnsmasq, so these settings only reach lookups it passes on to dnsmasq. Change where lookups go in ${name} itself.`,
    };
  return {
    title: `${name} handles DNS on this router`,
    status: `Lookups go to ${name}, set up outside MilkFlint${mode === 'auto' ? '.' : ', and to the servers below.'}`,
    text:
      `It was set up outside MilkFlint, and dnsmasq sends lookups to it. ` +
      (mode === 'auto'
        ? 'Choosing servers here would add them next to it, and dnsmasq would split lookups between both. '
        : 'The servers chosen here get lookups too: dnsmasq splits them between both. ') +
      `Change where lookups go in ${name} itself, or remove it first.`,
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
