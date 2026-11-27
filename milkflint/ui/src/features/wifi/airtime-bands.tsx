// A band's airtime policy settings as one small table, on the band's card
// while its policy is on: how the shares of the devices held back are set
// (goals by hand, or auto at a strength), then a row a link class, best
// first, with the useful rate the class starts at and, for the classes that
// are held back, the airtime goal, or with auto that their share goes by
// their rate. Each rate is typed once, where a class starts; the class below
// it ends there. With auto, where slow links start being held back is worked
// out from the good-link rate and the strength, so it's shown, not typed.
import { type ReactElement, useMemo } from 'react';
import { type Column, DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  AIRTIME_AUTO_LABELS,
  AIRTIME_AUTOS,
  type AirtimeAuto,
  type AirtimeBandKey,
  type AirtimeBands,
  type AirtimeClass,
  type AirtimeStrength,
  airtimeAutoPaceRate,
  airtimeAutoShare,
  airtimeBandDefaults,
  airtimeBandsAreDefault,
  airtimeBandsErrors,
  airtimeBandsReset,
} from './airtime';
import { airtimeFill } from './airtime-colors';

interface Row {
  name: string;
  /** whose colour its dot has: a very slow link is a slow one that is held back too */
  cls: AirtimeClass;
  /** the rate it starts at, where that's a setting */
  from?: AirtimeBandKey;
  /** its airtime goal, where it is held back */
  goal?: AirtimeBandKey;
  /** what it gets where it isn't held back */
  share?: string;
}

const ROWS: readonly Row[] = [
  { name: 'Good link', cls: 'full', from: 'full', share: 'Full share' },
  { name: 'Slow link', cls: 'slow', from: 'pace', share: 'Smaller share' },
  { name: 'Very slow link', cls: 'slow', from: 'weak', goal: 'goal_slow' },
  { name: 'Weak link', cls: 'weak', goal: 'goal_weak' },
  { name: 'Not answering', cls: 'lost', goal: 'goal_lost' },
];

/** A cell as tight as a narrow card needs, in line with the heading above the table; a heading wraps there. */
const CELL = 'py-1.5 pr-2 pl-0 whitespace-normal @min-[24rem]:pr-3';

/** How each strength turns a slower link into a smaller share, in words */
const STRENGTH_WORDS: Record<AirtimeStrength, string> = {
  gentle: 'with the square root of its useful rate',
  balanced: 'in proportion to its useful rate',
  strict: 'with its useful rate to the power 1.5',
};

/** A share as a whole percent, at least 1 */
function pct(share: number): string {
  return `${String(Math.max(1, Math.round(share * 100)))}%`;
}

/** A rate as typed, or as worked out, without a needless ".0" */
function rate(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/**
 * With auto, what a device at the weak rate gets beside one and beside three
 * devices with a good link, from the settings as typed; undefined while
 * they can't be saved.
 */
function autoExample(b: AirtimeBands, strength: AirtimeStrength, floor: number): string | undefined {
  if (Object.keys(airtimeBandsErrors(b)).length > 0) return undefined;
  const full = Number(b.full);
  const weak = Number(b.weak);
  const one = airtimeAutoShare(weak, full, strength, 1, floor);
  const three = airtimeAutoShare(weak, full, strength, 3, floor);
  return `At ${rate(weak)} Mbit/s, a device gets ${pct(one)} beside one device with a good link that wants the air, ${pct(three)} beside three.`;
}

export function AirtimeBandsTable({
  idPrefix,
  band,
  value,
  errors,
  onChange,
}: {
  /** for the inputs' ids: unique to the band's card */
  idPrefix: string;
  band: string;
  value: AirtimeBands;
  errors: Partial<Record<AirtimeBandKey, string>>;
  onChange: (value: AirtimeBands) => void;
}): ReactElement {
  const defaults = airtimeBandDefaults(band);
  const strength = value.auto === 'manual' ? undefined : value.auto;
  // with auto the not-answering goal isn't shown, but no share goes under it: as saved, or its default
  const lost =
    /^\d+(\.\d+)?$/.test(value.goal_lost.trim()) && Number(value.goal_lost) >= 1 && Number(value.goal_lost) <= 100
      ? Number(value.goal_lost)
      : Number(defaults.goal_lost);
  const example = strength === undefined ? undefined : autoExample(value, strength, lost / 100);
  // with auto, where slow links start being held back, from the rates as typed
  const fullN = Number(value.full);
  const weakN = Number(value.weak);
  const autoPace =
    strength !== undefined &&
    errors.full === undefined &&
    errors.weak === undefined &&
    Number.isFinite(fullN) &&
    Number.isFinite(weakN)
      ? airtimeAutoPaceRate(fullN, weakN, strength)
      : undefined;
  // the cells hold the inputs, so the columns go with what's typed
  const columns = useMemo((): Column<Row>[] => {
    const input = (key: AirtimeBandKey, label: string, unit: string): ReactElement => (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <Input
          id={`${idPrefix}-${key}`}
          aria-label={label}
          title={`Default: ${defaults[key]}${unit === '%' ? '%' : ` ${unit}`}`}
          inputMode="decimal"
          className="h-8 w-12 px-1 text-center tabular @min-[24rem]:w-14 @min-[24rem]:px-1.5"
          value={value[key]}
          aria-invalid={errors[key] !== undefined}
          aria-describedby={errors[key] === undefined ? undefined : `${idPrefix}-${key}-error`}
          onChange={(e) => {
            onChange({ ...value, [key]: e.target.value });
          }}
        />
        {/* in a narrow card the unit is in the column's heading instead */}
        <span className="hidden text-xs text-muted-foreground @min-[24rem]:inline">{unit}</span>
      </span>
    );
    // the lowest class has no rate of its own: it is whatever is below the one above
    const below = value.weak.trim() === '' ? '…' : value.weak.trim();
    return [
      {
        label: 'Link',
        className: CELL,
        cell: (row) => (
          <span className="flex items-center gap-2">
            <span className={cn('size-2 shrink-0 rounded-full', airtimeFill[row.cls])} aria-hidden />
            {row.name}
          </span>
        ),
      },
      {
        label: 'Useful rate',
        header: (
          <>
            Useful rate<span className="@min-[24rem]:hidden">, Mbit/s</span>
          </>
        ),
        className: CELL,
        cell: (row) =>
          // with auto the slow row's start is worked out
          strength !== undefined && row.from === 'pace' ? (
            <span
              className="text-xs whitespace-nowrap text-muted-foreground tabular"
              title="Worked out from the good-link rate and the strength: below it, a device’s share beside one good link would be under four fifths of an even split"
            >
              {autoPace === undefined ? '…' : `from ${rate(autoPace)} Mbit/s`}
            </span>
          ) : row.from !== undefined ? (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="hidden text-xs text-muted-foreground @min-[24rem]:inline">from</span>
              {input(row.from, `${row.name} from, in Mbit/s`, 'Mbit/s')}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {row.cls === 'weak' ? `under ${below} Mbit/s` : 'frames keep failing'}
            </span>
          ),
      },
      // with auto, the shares are worked out: no column for them
      ...(strength === undefined
        ? [
            {
              label: 'Airtime goal',
              header: (
                <>
                  Airtime goal<span className="@min-[24rem]:hidden">, %</span>
                </>
              ),
              className: 'py-1.5 pr-0 whitespace-normal',
              cell: (row: Row) =>
                row.goal !== undefined ? (
                  input(row.goal, `${row.name}: airtime goal, in percent`, '%')
                ) : (
                  <span className="text-xs text-muted-foreground">{row.share}</span>
                ),
            },
          ]
        : []),
    ];
  }, [idPrefix, defaults, value, errors, onChange, strength, autoPace]);
  // a row's errors under it, across the table: in the first column they would wrap to a word a line
  const wrong = (row: Row): ReactElement | undefined => {
    const goal = strength === undefined ? row.goal : undefined;
    const from = strength !== undefined && row.from === 'pace' ? undefined : row.from;
    const lines = [from, goal].flatMap((key) =>
      key !== undefined && errors[key] !== undefined ? [{ key, text: errors[key] }] : [],
    );
    return lines.length === 0 ? undefined : (
      <span className="flex flex-col text-xs text-destructive">
        {lines.map((e) => (
          <span key={e.key} id={`${idPrefix}-${e.key}-error`}>
            {e.text}
          </span>
        ))}
      </span>
    );
  };

  return (
    // a section of the band's column, under a hairline, not a box (the table tightens in a narrow card by its own width)
    <div className="flex flex-col gap-2 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h4 className="text-sm font-semibold">{strength === undefined ? 'Link classes and airtime goals' : 'Link classes'}</h4>
          <p className="text-xs text-muted-foreground">
            A device’s class goes by its useful rate: the rate the router sends to it at, times the share of its frames that get
            through.{' '}
            {strength === undefined ? (
              <>
                A goal is the most of the time that class is sent to while a device with a good link is waiting. Alone, it gets
                all of it.
              </>
            ) : (
              <>
                Held back, its share of the air goes {STRENGTH_WORDS[strength]}, against the devices wanting the air at that
                moment (a good link counts as {rate(fullN)} Mbit/s), never under {rate(lost)}%, and its pacing is trimmed to what
                it’s measured taking.
              </>
            )}
          </p>
          {example !== undefined && <p className="text-xs text-muted-foreground tabular">{example}</p>}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={airtimeBandsAreDefault(band, value)}
          onClick={() => {
            onChange(airtimeBandsReset(band, value));
          }}
        >
          Reset
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label htmlFor={`${idPrefix}-auto`} className="text-sm">
          Shares
        </label>
        <Select
          value={value.auto}
          onValueChange={(v) => {
            onChange({ ...value, auto: v as AirtimeAuto });
          }}
        >
          <SelectTrigger id={`${idPrefix}-auto`} className="h-8 w-auto min-w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AIRTIME_AUTOS.map((a) => (
              <SelectItem key={a} value={a}>
                {AIRTIME_AUTO_LABELS[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DataTable
        label={strength === undefined ? 'Link classes and airtime goals' : 'Link classes'}
        columns={columns}
        rows={ROWS}
        rowKey={(row) => row.name}
        empty=""
        framed={false}
        cards={false}
        detail={wrong}
      />
    </div>
  );
}
