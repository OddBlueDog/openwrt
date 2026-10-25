// Small pieces the Firewall page's tabs and dialogs share.
import type { LucideIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useId } from 'react';
import { SearchSelect } from '@/components/search-select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { Device } from './api';
import { deviceLabel, type ScheduleForm, scheduleError } from './forms';
import { WEEKDAYS } from './model';

/** Cards to pick one of, each with a line on what it means (a radio group). */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = 1,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; hint?: string; icon?: LucideIcon; tone?: 'allow' | 'block' }[];
  onChange: (value: T) => void;
  columns?: 1 | 3;
}): ReactElement {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className={cn('grid gap-2', columns === 3 && 'sm:grid-cols-3')}>
      {options.map((o) => {
        const selected = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-labelledby={`${id}-${o.value}`}
            aria-describedby={o.hint === undefined ? undefined : `${id}-${o.value}-hint`}
            onClick={() => {
              onChange(o.value);
            }}
            className={cn(
              'flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50',
              selected && 'border-primary bg-primary/5 ring-1 ring-primary',
            )}
          >
            <span id={`${id}-${o.value}`} className="flex items-center gap-2 text-sm font-medium">
              {Icon !== undefined && (
                <Icon className={cn('size-4', o.tone === 'allow' ? 'text-success' : o.tone === 'block' ? 'text-destructive' : 'text-muted-foreground')} />
              )}
              {o.label}
            </span>
            {o.hint !== undefined && (
              <span id={`${id}-${o.value}-hint`} className="text-xs text-muted-foreground">
                {o.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A small segmented control, for short choices. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}): ReactElement {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-fit flex-wrap rounded-md border bg-muted/50 p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => {
            onChange(o.value);
          }}
          className={cn('rounded-sm px-2.5 py-1 text-muted-foreground', value === o.value && 'bg-card text-foreground shadow-xs')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A labelled field in a dialog: label, control, then a hint or the error. */
export function DialogField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error !== undefined ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        hint !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** Pick a known device by name, searchable. `by` is what the value holds. */
export function DeviceSelect({
  id,
  devices,
  value,
  by,
  onChange,
  extra = [],
}: {
  id: string;
  devices: readonly Device[];
  value: string;
  by: 'ip' | 'mac';
  onChange: (value: string) => void;
  /** options before the devices, like "This router" */
  extra?: readonly { value: string; label: string }[];
}): ReactElement {
  const options = [
    ...extra,
    ...devices.flatMap((d) => {
      const v = by === 'ip' ? d.ip : d.mac;
      return v === undefined ? [] : [{ value: v, label: deviceLabel(d), keywords: `${d.mac} ${d.ip ?? ''}` }];
    }),
  ];
  return <SearchSelect id={id} options={options} value={value} onChange={onChange} placeholder="Choose a device" />;
}

/** From, to and days: what fw4's start_time, stop_time and weekdays hold. */
export function ScheduleFields({ id, value, onChange }: { id: string; value: ScheduleForm; onChange: (s: ScheduleForm) => void }): ReactElement {
  const error = scheduleError(value);
  return (
    <div className="grid gap-3 rounded-lg border border-dashed p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-start`}>From</Label>
          <Input
            id={`${id}-start`}
            type="time"
            className="w-32 font-mono"
            value={value.start}
            onChange={(e) => {
              onChange({ ...value, start: e.target.value });
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-stop`}>Until</Label>
          <Input
            id={`${id}-stop`}
            type="time"
            className="w-32 font-mono"
            value={value.stop}
            onChange={(e) => {
              onChange({ ...value, stop: e.target.value });
            }}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Days">
        {WEEKDAYS.map((d) => {
          const on = value.days.includes(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              onClick={() => {
                onChange({ ...value, days: on ? value.days.filter((x) => x !== d) : WEEKDAYS.filter((w) => w === d || value.days.includes(w)) });
              }}
              className={cn(
                'h-8 w-11 rounded-md border text-xs transition-colors',
                on ? 'border-primary/40 bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {d}
            </button>
          );
        })}
      </div>
      <p className={cn('text-xs', error === undefined ? 'text-muted-foreground' : 'text-destructive')}>
        {error ?? 'By the router’s clock. Over midnight (22:00 until 07:00) it covers both ends of each day ticked: its early morning and its evening.'}
      </p>
    </div>
  );
}

/** Are you sure? For deletes that aren't easily undone by hand. */
export function ConfirmDialog({
  title,
  children,
  action,
  destructive = true,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  action: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}): ReactElement {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="grid gap-2">{children}</div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm}>
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A switch with its label and an optional line under it. */
export function SwitchRow({
  id,
  checked,
  onChange,
  title,
  hint,
  boxed = false,
  disabled = false,
}: {
  id: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  title: ReactNode;
  hint?: ReactNode;
  boxed?: boolean;
  disabled?: boolean;
}): ReactElement {
  return (
    <div className={cn('flex items-start gap-3 text-sm', boxed && 'rounded-lg border border-dashed p-3', disabled && 'opacity-60')}>
      <Switch id={id} className="mt-0.5" checked={checked} disabled={disabled} onCheckedChange={onChange} />
      <label htmlFor={id} className="flex flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        {hint !== undefined && <span className="text-xs text-muted-foreground">{hint}</span>}
      </label>
    </div>
  );
}

