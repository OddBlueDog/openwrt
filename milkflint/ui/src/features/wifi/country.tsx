// The Wi-Fi country, searchable, with what that country's law lets Wi-Fi
// do (Linux's regulatory database, read on the router for any country).
import { InfoIcon, TriangleAlertIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Field } from '@/components/field';
import { type SearchOption, SearchSelect } from '@/components/search-select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { usePoll } from '@/hooks/use-poll';
import { type Country, getRegulatory, type RegRule } from '@/lib/api/wireless';

/** Names people search by that aren't in the list's own names. */
const aliases: Record<string, string> = {
  GB: 'uk britain great britain england scotland wales northern ireland',
  US: 'usa america united states',
  AE: 'uae emirates dubai',
  NL: 'holland',
  KR: 'south korea',
  CZ: 'czech republic czechia',
  RU: 'russia',
  TW: 'taiwan',
};

const bands: Record<string, { label: string; from: number; to: number; channels: [number, number][] }> = {
  '2g': {
    label: '2.4 GHz',
    from: 2400,
    to: 2500,
    channels: [...Array.from({ length: 13 }, (_, i): [number, number] => [i + 1, 2412 + 5 * i]), [14, 2484]],
  },
  '5g': {
    label: '5 GHz',
    from: 5150,
    to: 5925,
    // 20 MHz channels: 36–64, 100–144, 149–177 (centre = 5000 + 5 × channel)
    channels: [
      ...Array.from({ length: 8 }, (_, i) => 36 + 4 * i),
      ...Array.from({ length: 12 }, (_, i) => 100 + 4 * i),
      ...Array.from({ length: 8 }, (_, i) => 149 + 4 * i),
    ].map((ch): [number, number] => [ch, 5000 + 5 * ch]),
  },
  '6g': {
    label: '6 GHz',
    from: 5925,
    to: 7125,
    channels: Array.from({ length: 59 }, (_, i): [number, number] => [1 + 4 * i, 5955 + 20 * i]),
  },
};

/** "36–48, 52–64": the 20 MHz channels that fit in a rule's range. */
function channelRanges(band: string, rule: RegRule): string {
  const step = band === '2g' ? 1 : 4;
  // 144 → 149 isn't a step of 4, so 100–144 and 149–165 stay separate
  const fit = (bands[band]?.channels ?? []).filter(([, mhz]) => mhz - 10 >= rule.start && mhz + 10 <= rule.end).map(([ch]) => ch);
  const runs: string[] = [];
  let first: number | undefined;
  let last: number | undefined;
  for (const ch of [...fit, Number.NaN]) {
    if (first !== undefined && last !== undefined && ch === last + step) {
      last = ch;
      continue;
    }
    if (first !== undefined && last !== undefined) runs.push(first === last ? String(first) : `${String(first)}–${String(last)}`);
    first = last = Number.isNaN(ch) ? undefined : ch;
  }
  return runs.join(', ');
}

// The radar-detection (DFS) standard a country's rules follow: many countries
// adopt one of these three rather than their own (the channels and power are
// still the country's).
const regionNames: Record<string, string> = {
  ETSI: 'the European ETSI standard, which many countries use',
  FCC: 'the US FCC standard, which many countries use',
  JP: 'Japan’s own standard',
};

function Rules({ country, bandsHere }: { country: string; bandsHere: readonly string[] }): ReactElement | null {
  const reg = usePoll(() => getRegulatory(country), 3_600_000, country).data;
  if (country === '' || reg === undefined) return null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">
        What wireless-regdb says {country} allows.{reg.dfs_region in regionNames ? ` Its radar detection (DFS) follows ${regionNames[reg.dfs_region] ?? ''}.` : ''}
      </p>
      {bandsHere.map((band) => {
        const b = bands[band];
        if (b === undefined) return null;
        const rules = reg.rules.filter((r) => r.end > b.from && r.start < b.to && channelRanges(band, r) !== '');
        return (
          <div key={band} className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{b.label}</span>
            {rules.length === 0 ? (
              <span className="text-xs text-destructive">Not allowed in this country.</span>
            ) : (
              rules.map((r) => (
                <div key={`${String(r.start)}-${String(r.end)}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span className="font-mono">Channels {channelRanges(band, r)}</span>
                  <span className="text-muted-foreground">
                    up to {r.eirp} dBm ({Math.round(10 ** (r.eirp / 10))} mW), {r.max_bw} MHz wide
                  </span>
                  {r.indoor_only && <Badge variant="outline">Indoors only</Badge>}
                  {r.dfs && <Badge variant="warning">Radar detection (DFS)</Badge>}
                  {r.no_ir && <Badge variant="outline">Can’t start a network</Badge>}
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

export function CountryField({
  countries,
  value,
  saved,
  bandsHere,
  onChange,
}: {
  countries: readonly Country[];
  value: string;
  /** What's set on the router ('' for nothing). */
  saved: string;
  bandsHere: readonly string[];
  onChange: (country: string) => void;
}): ReactElement {
  const options: SearchOption[] = countries.map((c) => ({
    value: c.code,
    label: `${c.name} (${c.code})`,
    ...(aliases[c.code] === undefined ? {} : { keywords: aliases[c.code] }),
  }));
  // set before (LuCI, or an older version of this page) to a country with no rules
  const unregulated = value !== '' && !countries.some((c) => c.code === value);
  if (unregulated) options.unshift({ value, label: `${value} (no Wi-Fi rules)` });
  return (
    <div className="flex flex-col gap-3">
      <Field id="wifi-country" label="Country" hint="Where the router is. It sets which channels and transmit power Wi-Fi may use. Applies to every band.">
        <SearchSelect id="wifi-country" options={options} value={value} onChange={onChange} placeholder="Not set" />
      </Field>
      <Alert variant="info">
        <InfoIcon />
        <AlertDescription>
          Set the country the router is in. Each country’s law decides which Wi-Fi channels may be used, how much power they may transmit,
          which are indoors-only, and where Wi-Fi must listen for and give way to radar (weather, aviation, military). The wrong country can
          break those rules and interfere with radar. You’re responsible for choosing the right country and for checking that your channels
          and transmit power follow the laws where you are: the limits shown here come from wireless-regdb, the list of country rules
          OpenWrt and Linux use, and may be out of date or incomplete.
        </AlertDescription>
      </Alert>
      {unregulated && (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertDescription>
            This router has no Wi-Fi rules for {value}, so the radio ignores it and keeps the rules it had. Choose the country the router is in.
          </AlertDescription>
        </Alert>
      )}
      {saved === '' && (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertDescription>
            The country isn’t set yet, and 5 GHz may not start until it is.{value === '' ? '' : ` ${value} is filled in: save to use it.`}
          </AlertDescription>
        </Alert>
      )}
      <Rules country={value} bandsHere={bandsHere} />
    </div>
  );
}
