import { ChevronDownIcon, RotateCcwIcon, SlidersHorizontalIcon } from 'lucide-react';
import { type ReactElement, useId, useState } from 'react';
import { NumberInput } from '@/components/number-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import {
  type Check,
  defaultThresholds,
  type Status,
  THRESHOLDS,
  type ThresholdDef,
  type ThresholdKey,
  thresholdKeys,
  type Thresholds,
} from './checks';
import { Arrowed } from '@/components/dir';
import { saveThresholds, useThresholds } from './thresholds';

// ---- The panel ----

function ThresholdRow({ k, t }: { k: ThresholdKey; t: Thresholds }): ReactElement {
  const d: ThresholdDef = THRESHOLDS[k];
  const level = t[k];
  const word = d.better === 'lower' ? 'up to' : 'at least';
  const set = (part: 'pass' | 'warn', v: number): void => {
    saveThresholds({ ...t, [k]: { ...level, [part]: v } });
  };
  const wrongWay = level.warn !== null && (d.better === 'lower' ? level.warn < level.pass : level.warn > level.pass);
  return (
    <div className="flex flex-col gap-2 border-b py-3 last:border-b-0">
      <span className="text-sm font-medium">{d.label}</span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="flex items-center gap-2">
          <Label htmlFor={`th-${k}-pass`} className="font-normal text-muted-foreground">
            Pass {word}
          </Label>
          <NumberInput
            id={`th-${k}-pass`}
            value={level.pass}
            step={d.step}
            className="h-8 w-24 tabular"
            onChange={(v) => {
              set('pass', v);
            }}
          />
          <span className="text-xs text-muted-foreground">{d.unit}</span>
        </span>
        {level.warn !== null && (
          <span className="flex items-center gap-2">
            <Label htmlFor={`th-${k}-warn`} className="font-normal text-muted-foreground">
              Warn {word}
            </Label>
            <NumberInput
              id={`th-${k}-warn`}
              value={level.warn}
              step={d.step}
              className="h-8 w-24 tabular"
              onChange={(v) => {
                set('warn', v);
              }}
            />
            <span className="text-xs text-muted-foreground">{d.unit}</span>
          </span>
        )}
      </div>
      {d.warn === undefined && <span className="text-xs text-muted-foreground">Short of it is only noted, not a warning.</span>}
      {wrongWay && (
        <span className="text-xs text-warning">
          The warning level is on the passing side, so nothing warns: past the pass level fails.
        </span>
      )}
    </div>
  );
}

export function ThresholdsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): ReactElement {
  const t = useThresholds();
  const changed = thresholdKeys.some(
    (k) => t[k].pass !== defaultThresholds()[k].pass || t[k].warn !== defaultThresholds()[k].warn,
  );
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <div className="flex flex-col gap-1 border-b px-5 py-4 pr-12">
          <SheetTitle>Thresholds</SheetTitle>
          <SheetDescription>
            What each check passes and warns at. They’re kept in this browser, and saved with the checks in an export.
          </SheetDescription>
        </div>
        <div className="flex-1 overflow-y-auto px-5">
          {thresholdKeys.map((k) => (
            <ThresholdRow key={k} k={k} t={t} />
          ))}
        </div>
        <div className="flex justify-end border-t px-5 py-3">
          <Button
            type="button"
            variant="outline"
            disabled={!changed}
            onClick={() => {
              saveThresholds(undefined);
            }}
          >
            <RotateCcwIcon /> Back to the defaults
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---- The verdicts ----

/** A check's outcome in the interface's status words: a badge with a dot, never colour alone. */
const statusLook: Record<
  Status,
  { text: string; variant: 'success' | 'warning' | 'destructive' | 'info' | 'outline'; tone: string }
> = {
  pass: { text: 'Pass', variant: 'success', tone: 'text-success' },
  warn: { text: 'Warning', variant: 'warning', tone: 'text-warning' },
  fail: { text: 'Fail', variant: 'destructive', tone: 'text-destructive' },
  info: { text: 'Note', variant: 'info', tone: 'text-info' },
  skip: { text: 'Not measured', variant: 'outline', tone: 'text-muted-foreground' },
};

export function StatusBadge({ status, children }: { status: Status; children?: string }): ReactElement {
  const look = statusLook[status];
  return <Badge variant={look.variant}>{children ?? look.text}</Badge>;
}

const countWords: Record<Status, (n: number) => string> = {
  fail: () => 'failed',
  warn: (n) => (n === 1 ? 'warning' : 'warnings'),
  pass: () => 'passed',
  info: (n) => (n === 1 ? 'note' : 'notes'),
  skip: () => 'not measured',
};

function CheckRow({ c }: { c: Check }): ReactElement {
  const look = statusLook[c.status];
  const [open, setOpen] = useState(false);
  const more = c.notes.length > 0 || c.status !== 'skip';
  const panel = useId();
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium">{c.title}</span>
        <StatusBadge status={c.status} />
      </div>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
        <span className="text-xs text-muted-foreground">
          {c.detail}
          {more && (
            <>
              {' '}
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panel}
                onClick={() => {
                  setOpen((o) => !o);
                }}
                className="inline-flex cursor-pointer items-center gap-0.5 rounded-sm font-medium link"
              >
                Why?
                <ChevronDownIcon className={cn('size-3 transition-transform duration-fast', open && 'rotate-180')} />
              </button>
            </>
          )}
        </span>
        {c.value !== undefined && (
          <span
            className={cn(
              'text-sm font-medium tabular sm:max-w-[45%] sm:shrink-0 sm:text-right',
              c.status === 'skip' ? 'text-muted-foreground' : look.tone,
            )}
          >
            <Arrowed text={c.value} />
          </span>
        )}
      </div>
      {more && (
        <div id={panel} hidden={!open} className="mt-1 max-w-prose rounded-md bg-muted px-3 py-2 text-xs text-foreground">
          {c.notes.length > 0 && (
            <ul className="mb-1.5 flex list-disc flex-col gap-0.5 pl-4">
              {c.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground">{c.why}</p>
        </div>
      )}
    </li>
  );
}

/** Every check in the report's order, how many came out each way, and the thresholds behind them. */
export function Verdict({ checks }: { checks: readonly Check[] }): ReactElement {
  const [open, setOpen] = useState(false);
  const heading = useId();
  const counts = (['fail', 'warn', 'pass', 'info', 'skip'] as const)
    .map((s) => ({ s, n: checks.filter((c) => c.status === s).length }))
    .filter((x) => x.n > 0);
  return (
    <section className="flex flex-col gap-3" aria-labelledby={heading}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={heading} className="mr-1 text-sm font-semibold">
            Checks
          </h3>
          {counts.map(({ s, n }) => (
            <StatusBadge key={s} status={s}>{`${String(n)} ${countWords[s](n)}`}</StatusBadge>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setOpen(true);
          }}
        >
          <SlidersHorizontalIcon /> Thresholds
        </Button>
      </div>
      <ul className="divide-y border-y">
        {checks.map((c) => (
          <CheckRow key={c.id} c={c} />
        ))}
      </ul>
      <ThresholdsSheet open={open} onOpenChange={setOpen} />
    </section>
  );
}
