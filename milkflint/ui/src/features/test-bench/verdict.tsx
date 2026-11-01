import { CircleCheckIcon, CircleDashedIcon, CircleXIcon, InfoIcon, type LucideIcon, RotateCcwIcon, SlidersHorizontalIcon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { type Check, defaultThresholds, type Status, THRESHOLDS, type ThresholdDef, type ThresholdKey, thresholdKeys, type Thresholds } from './checks';
import { saveThresholds, useThresholds } from './thresholds';

// ---- The panel ----

function LevelInput({ id, value, step, onChange }: { id: string; value: number; step: number; onChange: (v: number) => void }): ReactElement {
  const [text, setText] = useState(String(value));
  // another change (Reset) since it was typed
  const [was, setWas] = useState(value);
  if (was !== value) {
    setWas(value);
    setText(String(value));
  }
  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      step={step}
      value={text}
      className="h-8 w-24 tabular"
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(v)) {
          setWas(v);
          onChange(v);
        }
      }}
    />
  );
}

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
          <LevelInput
            id={`th-${k}-pass`}
            value={level.pass}
            step={d.step}
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
            <LevelInput
              id={`th-${k}-warn`}
              value={level.warn}
              step={d.step}
              onChange={(v) => {
                set('warn', v);
              }}
            />
            <span className="text-xs text-muted-foreground">{d.unit}</span>
          </span>
        )}
      </div>
      {d.warn === undefined && <span className="text-[11px] text-muted-foreground">Short of it is only noted, not a warning.</span>}
      {wrongWay && <span className="text-[11px] text-warning">The warning level is on the passing side, so nothing warns: past the pass level fails.</span>}
    </div>
  );
}

export function ThresholdsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): ReactElement {
  const t = useThresholds();
  const changed = thresholdKeys.some((k) => t[k].pass !== defaultThresholds()[k].pass || t[k].warn !== defaultThresholds()[k].warn);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <div className="flex flex-col gap-1 border-b px-5 py-4 pr-12">
          <SheetTitle>Thresholds</SheetTitle>
          <SheetDescription>What each check passes and warns at. They’re kept in this browser, and saved with the checks in an export.</SheetDescription>
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

const statusLook: Record<Status, { icon: LucideIcon; text: string; tone: string }> = {
  pass: { icon: CircleCheckIcon, text: 'Pass', tone: 'text-success' },
  warn: { icon: TriangleAlertIcon, text: 'Warning', tone: 'text-warning' },
  fail: { icon: CircleXIcon, text: 'Fail', tone: 'text-destructive' },
  info: { icon: InfoIcon, text: 'Note', tone: 'text-info' },
  skip: { icon: CircleDashedIcon, text: 'Not measured', tone: 'text-muted-foreground' },
};

const countWords: Record<Status, (n: number) => string> = {
  fail: () => 'failed',
  warn: (n) => (n === 1 ? 'warning' : 'warnings'),
  pass: () => 'passed',
  info: (n) => (n === 1 ? 'note' : 'notes'),
  skip: () => 'not measured',
};

function CheckRow({ c }: { c: Check }): ReactElement {
  const look = statusLook[c.status];
  const Icon = look.icon;
  const more = c.notes.length > 0 || c.status !== 'skip';
  return (
    <li className="flex gap-3 py-3">
      <Icon className={cn('mt-0.5 size-4 shrink-0', look.tone)} aria-label={look.text} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-sm font-medium">{c.title}</span>
          {c.value !== undefined && <span className={cn('text-sm font-medium tabular', c.status === 'skip' ? 'text-muted-foreground' : look.tone)}>{c.value}</span>}
        </div>
        <span className="text-xs text-muted-foreground">{c.detail}</span>
        {more && (
          <details className="group text-xs text-muted-foreground">
            <summary className="w-fit cursor-pointer text-[11px] text-primary select-none hover:underline">More</summary>
            <ul className="mt-1.5 flex list-disc flex-col gap-0.5 pl-4">
              {c.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
              <li className="list-none pt-1 -ml-4 italic">{c.why}</li>
            </ul>
          </details>
        )}
      </div>
    </li>
  );
}

/** Every check in the report's order, how many came out each way, and the thresholds behind them. */
export function Verdict({ checks }: { checks: readonly Check[] }): ReactElement {
  const [open, setOpen] = useState(false);
  const counts = (['fail', 'warn', 'pass', 'info', 'skip'] as const).map((s) => ({ s, n: checks.filter((c) => c.status === s).length })).filter((x) => x.n > 0);
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold">Verdict</h3>
          {counts.map(({ s, n }) => {
            const Icon = statusLook[s].icon;
            return (
              <span key={s} className={cn('inline-flex items-center gap-1 text-xs tabular', statusLook[s].tone)}>
                <Icon className="size-3.5" /> {String(n)} {countWords[s](n)}
              </span>
            );
          })}
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
      <ul className="divide-y rounded-lg border px-3">
        {checks.map((c) => (
          <CheckRow key={c.id} c={c} />
        ))}
      </ul>
      <ThresholdsSheet open={open} onOpenChange={setOpen} />
    </section>
  );
}
