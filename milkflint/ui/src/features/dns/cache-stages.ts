// What happens to one DNS answer over time, as the DNS cache card tells it.
//
// dnsmasq holds fresh answers, for each answer's own TTL, and its size setting
// counts records (one site takes several). Expired ones are kept for a time
// counted from when they expired, and each reuse fetches a new answer, which
// starts that clock again. Encrypted DNS does that in dnsproxy, with its own
// memory; the others in dnsmasq (use_stale_cache), in the same room as the
// fresh ones.
import { DEFAULT_CACHE_SIZE, type DnsForm } from './model';

export interface CacheStage {
  id: 'fresh' | 'expired' | 'forgotten';
  title: string;
  /** How long the stage lasts; none for the last one, which has no end. */
  lasts: string | undefined;
  /** Whether a device gets its answer from the router at once, or waits for the DNS server. */
  instant: boolean;
  text: string;
}

export const keepLabel = (hours: string): string => (hours === '1' ? '1 hour' : hours === '24' ? '1 day' : hours === '48' ? '2 days' : `${hours} hours`);

/** The size setting's hint: expired answers only share its room when dnsmasq is the one keeping them. */
export function sizeHint(f: Pick<DnsForm, 'mode' | 'quick'>): string {
  const room = !f.quick ? '' : f.mode === 'encrypted' ? ' Expired answers are kept separately, so they don’t use this room.' : ' Fresh and expired answers share this room, so a bigger number helps.';
  return `One site usually takes a few.${room} When there’s no room left, the oldest make way. Default ${DEFAULT_CACHE_SIZE}.`;
}

/** The HTTPS records setting's hint: it's dnsmasq's, and dnsproxy's cache, when on, keeps every record type anyway. */
export function httpsHint(f: Pick<DnsForm, 'mode' | 'quick'>): string {
  const what = 'Phones and browsers ask for one alongside a site’s address, to connect faster.';
  return f.quick && f.mode === 'encrypted'
    ? `${what} While expired answers are being reused, these are kept anyway, so this makes little difference.`
    : `${what} With this on, repeats are answered here too, instead of each one going out.`;
}

const WAITS = 'The next visit waits while the router fetches a new answer, which is then fresh again.';

/** The stages an answer goes through with these settings, in order; none with the cache off. */
export function cacheStages(f: Pick<DnsForm, 'cacheOn' | 'quick' | 'keepHours'>): CacheStage[] {
  if (!f.cacheOn) return [];
  const fresh: CacheStage = {
    id: 'fresh',
    title: 'Fresh',
    lasts: 'For as long as the site allows',
    instant: true,
    text: 'Devices get the answer from the router straight away. Each site sets its own limit, often a few minutes, sometimes a day.',
  };
  if (!f.quick) return [fresh, { id: 'expired', title: 'Expired', lasts: 'Not kept', instant: false, text: `The answer is dropped. ${WAITS}` }];
  return [
    fresh,
    {
      id: 'expired',
      title: 'Expired',
      lasts: `For up to ${keepLabel(f.keepHours)}`,
      instant: true,
      text: 'Devices still get the old answer straight away, while the router fetches a new one in the background for next time.',
    },
    { id: 'forgotten', title: 'Forgotten', lasts: undefined, instant: false, text: WAITS },
  ];
}
