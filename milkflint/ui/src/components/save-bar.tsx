import { LoaderCircleIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Sticky bar at the bottom of a settings page while there are unsaved edits. */
export function SaveBar({
  visible,
  busy,
  invalid,
  onSave,
  onRevert,
}: {
  visible: boolean;
  busy: boolean;
  invalid: boolean;
  onSave: () => void;
  onRevert: () => void;
}): ReactElement | null {
  if (!visible && !busy) return null;
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      className="sticky bottom-4 z-20 mt-6 flex animate-[mf-pop-in_var(--mf-duration-base)_var(--mf-ease-enter)] flex-wrap items-center justify-between gap-3 rounded-xl border bg-popover px-4 py-3 shadow-lg"
    >
      <p aria-live="polite" className={cn('text-sm', invalid ? 'font-medium text-destructive' : 'text-muted-foreground')}>
        {invalid ? 'Fix the highlighted fields to save.' : busy ? 'Applying your changes…' : 'You have unsaved changes.'}
      </p>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onRevert} disabled={busy}>
          Discard
        </Button>
        <Button size="sm" onClick={onSave} disabled={busy || invalid}>
          {busy && <LoaderCircleIcon className="animate-spin" />}
          Save &amp; apply
        </Button>
      </div>
    </div>
  );
}
