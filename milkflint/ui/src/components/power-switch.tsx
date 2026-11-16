// A page's own on/off, in one place on every page that has one: the page
// header's actions, the state in words beside the switch, and what a save
// will do while it differs from what's saved. (Smart Queue and Network
// quality use it; a candidate for the shared kit.)
import { type ReactElement, useId } from 'react';
import { Switch } from '@/components/ui/switch';

export function PowerSwitch({
  name,
  on,
  saved,
  disabled = false,
  onChange,
}: {
  /** what it turns on, for screen readers: "Smart Queue" */
  name: string;
  on: boolean;
  /** as saved; undefined while that isn't known */
  saved: boolean | undefined;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}): ReactElement {
  const id = useId();
  const state = saved === undefined || on === saved ? (on ? 'On' : 'Off') : on ? 'On when saved' : 'Off when saved';
  return (
    <div className="flex h-9 items-center gap-2.5 rounded-md border bg-card px-3 shadow-xs">
      <span id={`${id}-state`} className="text-sm font-medium" aria-live="polite">
        {state}
      </span>
      <Switch
        checked={on}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={`${name} on`}
        aria-describedby={`${id}-state`}
      />
    </div>
  );
}
