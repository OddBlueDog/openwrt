// Small pieces the Firewall page's tabs and dialogs share.
import { ChevronDownIcon, type LucideIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useId, useState } from 'react';
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
import { ChoiceCards } from '@/components/page-kit';

/** Cards to pick one of, each with a line on what it means: the shared ChoiceCards. */
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
  columns?: 1 | 2 | 3;
}): ReactElement {
  return (
    <ChoiceCards
      label={label}
      value={value}
      onChange={onChange}
      columns={columns}
      options={options.map((o) => ({
        value: o.value,
        label: o.label,
        ...(o.hint !== undefined ? { hint: o.hint } : {}),
        ...(o.icon !== undefined ? { icon: o.icon } : {}),
        ...(o.tone !== undefined ? { tone: o.tone === 'allow' ? ('success' as const) : ('destructive' as const) } : {}),
      }))}
    />
  );
}

/** The shared segmented control (components/ui/segmented.tsx). */
export { Segmented } from '@/components/ui/segmented';

/** "Why?" after a one-line hint, and the longer explanation it opens (the mechanism, its cost, the UCI option). */
function useWhy(why: ReactNode | undefined): { button: ReactNode; panel: ReactNode } {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (why === undefined) return { button: null, panel: null };
  return {
    button: (
      <>
        {' '}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => {
            setOpen((o) => !o);
          }}
          className="inline-flex cursor-pointer items-center gap-0.5 rounded-sm font-medium link"
        >
          Why?
          <ChevronDownIcon className={cn('size-3 transition-transform duration-fast', open && 'rotate-180')} />
        </button>
      </>
    ),
    panel: (
      <div id={id} hidden={!open} className="max-w-prose rounded-md bg-muted px-3 py-2 text-xs text-foreground">
        {why}
      </div>
    ),
  };
}

/** A labelled field in a dialog or sheet: label, control, then a one-line hint (with an optional "Why?") or the error. */
export function DialogField({
  id,
  label,
  hint,
  why,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  /** the longer explanation, behind "Why?" after the hint */
  why?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
}): ReactElement {
  const more = useWhy(why);
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error !== undefined ? (
        <p id={`${id}-error`} className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : (
        hint !== undefined && (
          <p className="text-xs text-muted-foreground">
            {hint}
            {more.button}
          </p>
        )
      )}
      {more.panel}
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
export function ScheduleFields({
  id,
  value,
  onChange,
}: {
  id: string;
  value: ScheduleForm;
  onChange: (s: ScheduleForm) => void;
}): ReactElement {
  const error = scheduleError(value);
  return (
    <div className="grid gap-3 rounded-lg border border-dashed p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-start`}>From</Label>
          <Input
            id={`${id}-start`}
            type="time"
            className="w-32 tabular"
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
            className="w-32 tabular"
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
                onChange({
                  ...value,
                  days: on ? value.days.filter((x) => x !== d) : WEEKDAYS.filter((w) => w === d || value.days.includes(w)),
                });
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
        {error ??
          'By the router’s clock. Over midnight (22:00 until 07:00) it covers both ends of each day ticked: its early morning and its evening.'}
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

/** A switch with its label and an optional line under it (with an optional "Why?"). */
export function SwitchRow({
  id,
  checked,
  onChange,
  title,
  hint,
  why,
  boxed = false,
  disabled = false,
}: {
  id: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  title: ReactNode;
  hint?: ReactNode;
  why?: ReactNode;
  boxed?: boolean;
  disabled?: boolean;
}): ReactElement {
  const more = useWhy(why);
  return (
    <div className={cn('flex items-start gap-3 text-sm', boxed && 'rounded-lg border border-dashed p-3')}>
      <Switch id={id} className="mt-0.5" checked={checked} disabled={disabled} onCheckedChange={onChange} />
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={id} className={cn('flex flex-col gap-0.5', disabled && 'text-muted-foreground')}>
          <span className="font-medium">{title}</span>
        </label>
        {hint !== undefined && (
          <p className="text-xs text-muted-foreground">
            {hint}
            {more.button}
          </p>
        )}
        {more.panel}
      </div>
    </div>
  );
}
