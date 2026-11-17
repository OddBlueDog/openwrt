// The Wi-Fi country, searchable, with what that country's law lets Wi-Fi
// do (Linux's regulatory database, read on the router for any country).
import { TriangleAlertIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Field } from '@/components/field';
import { type SearchOption, SearchSelect } from '@/components/search-select';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { usePoll } from '@/hooks/use-poll';
import { type Country, getRegulatory, type RegRule } from '@/lib/api/wireless';
import { explain } from '@/components/explain';
import { Note } from '@/components/note';
import { bandLabel, type RadioCountry } from './model';

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
  const rows = bandsHere.flatMap((band) => {
    const b = bands[band];
    if (b === undefined) return [];
    const rules = reg.rules.filter((r) => r.end > b.from && r.start < b.to && channelRanges(band, r) !== '');
    return [{ band, label: b.label, rules }];
  });
  return (
    // one compact table for every band: channels, the most power, the widest width, and what's special
    <div className="@container flex min-w-0 flex-col gap-2">
      <table className="w-full text-sm">
        <caption className="sr-only">What {country} allows on each band</caption>
        <thead>
          <tr className="border-b text-left text-xs whitespace-nowrap text-muted-foreground">
            <th scope="col" className="pr-3 pb-1.5 font-medium">
              Band
            </th>
            <th scope="col" className="pr-3 pb-1.5 font-medium">
              Channels
            </th>
            <th scope="col" className="pr-3 pb-1.5 font-medium">
              Max power
            </th>
            <th scope="col" className="pb-1.5 text-right font-medium">
              Max width
            </th>
          </tr>
        </thead>
        {rows.map(({ band, label, rules }) => (
          <tbody key={band} className="border-b last:border-b-0">
            {rules.length === 0 ? (
              <tr>
                <th scope="row" className="py-1.5 pr-3 text-left font-medium whitespace-nowrap">
                  {label}
                </th>
                <td colSpan={3} className="py-1.5 text-destructive">
                  Not allowed in this country
                </td>
              </tr>
            ) : (
              rules.map((r, i) => (
                <tr key={`${String(r.start)}-${String(r.end)}`} className="align-top">
                  {i === 0 && (
                    <th scope="rowgroup" rowSpan={rules.length} className="py-1.5 pr-3 text-left font-medium whitespace-nowrap">
                      {label}
                    </th>
                  )}
                  <td className="py-1.5 pr-3">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="whitespace-nowrap tabular">{channelRanges(band, r)}</span>
                      {r.indoor_only && <span className="text-xs whitespace-nowrap text-muted-foreground">indoors only</span>}
                      {r.dfs && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap text-warning">
                          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                          radar check
                        </span>
                      )}
                      {r.no_ir && <span className="text-xs whitespace-nowrap text-muted-foreground">can’t start a network</span>}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap tabular">
                    {r.eirp} dBm {/* the milliwatts only where there's room: a phone keeps the dBm */}
                    <span className="hidden text-muted-foreground @md:inline">({Math.round(10 ** (r.eirp / 10))} mW)</span>
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap tabular">{r.max_bw} MHz</td>
                </tr>
              ))
            )}
          </tbody>
        ))}
      </table>
      <p className="text-xs text-muted-foreground">
        From wireless-regdb, the country rules OpenWrt and Linux use.
        {reg.dfs_region in regionNames ? ` Radar detection follows ${regionNames[reg.dfs_region] ?? ''}.` : ''}
      </p>
    </div>
  );
}

/** The country, for every band at once, and what its rules let Wi-Fi do: first on the page, condensed. */
export function CountryCard({
  countries,
  value,
  saved,
  mixed,
  radios,
  bandsHere,
  onChange,
}: {
  countries: readonly Country[];
  value: string;
  /** What's set on the router ('' for nothing, or radios with different ones). */
  saved: string;
  /** Each radio's own country when they differ. */
  mixed: readonly RadioCountry[];
  /** Every radio section: the country is set on each. */
  radios: readonly string[];
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
    // condensed: the heading, the picker and its hint on the left, what the country allows on the right
    <Card aria-labelledby="wifi-country-title">
      <CardContent>
        <div className="grid items-start gap-x-8 gap-y-4 lg:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)]">
          <div className="flex flex-col gap-1">
            <CardTitle id="wifi-country-title">Country</CardTitle>
            <Field
              id="wifi-country"
              label="Country the router is in"
              labelHidden
              className="pt-1 pb-0"
              {...explain(
                'Its rules set every band’s channels and power, and following them is up to you. Each country’s law decides which Wi-Fi channels may be used, how much power they may transmit, which are indoors only, and where Wi-Fi must listen for and give way to radar (weather, aviation, military); the wrong country can break those rules and interfere with radar. The limits shown come from wireless-regdb, the list of country rules OpenWrt and Linux use, and may be out of date or incomplete: check them where you are.',
                radios.map((r) => `wireless.${r}.country`),
              )}
            >
              <SearchSelect id="wifi-country" options={options} value={value} onChange={onChange} placeholder="Not set" />
            </Field>
            {unregulated && (
              <Note tone="warning" icon={<TriangleAlertIcon />}>
                This router has no Wi-Fi rules for {value}, so the radio ignores it and keeps the rules it had. Choose the country
                the router is in.
              </Note>
            )}
            {saved === '' && mixed.length > 0 && (
              <Note tone="warning" icon={<TriangleAlertIcon />}>
                The bands have different countries (
                {mixed.map((r) => `${bandLabel(r.band)}: ${r.code === '' ? 'not set' : r.code}`).join(', ')}
                ), set outside this page; the router uses one of them for every band. Choose the country the router is in: saving
                sets it on every band.
              </Note>
            )}
            {saved === '' && mixed.length === 0 && (
              <Note tone="warning" icon={<TriangleAlertIcon />}>
                The country isn’t set on every band yet, and 5 GHz may not start until it is.
                {value === '' ? '' : ` ${value} is filled in: save to use it.`}
              </Note>
            )}
          </div>
          <Rules country={value} bandsHere={bandsHere} />
        </div>
      </CardContent>
    </Card>
  );
}
