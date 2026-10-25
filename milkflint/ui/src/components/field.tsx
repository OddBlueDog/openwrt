import type { ReactElement, ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** A labelled form control with an optional hint and error, in a two-column row. */
export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div className={cn('grid gap-2 py-3 sm:grid-cols-[minmax(10rem,14rem)_1fr] sm:gap-6', className)}>
      <div className="flex flex-col gap-1 pt-2">
        <Label htmlFor={id}>{label}</Label>
        {hint !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex max-w-md flex-col gap-1.5">
        {children}
        {error !== undefined && (
          <p id={`${id}-error`} className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
