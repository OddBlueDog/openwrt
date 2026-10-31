import type { ReactElement, ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * A labelled form control with an optional hint and error. The label and
 * hint sit beside the control when the row is at least 40rem wide, judged by
 * the row's own width (a container query), so in a half-width card they go
 * above it and the control gets the card's full width. The control's column
 * may shrink below its content, so a long choice ends in … instead of
 * pushing past the card.
 */
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
    <div className="@container">
      <div className={cn('grid gap-2 py-3 @min-[40rem]:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)] @min-[40rem]:gap-6', className)}>
        <div className="flex flex-col gap-1 @min-[40rem]:pt-2">
          <Label htmlFor={id}>{label}</Label>
          {hint !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 @min-[40rem]:max-w-md">
          {children}
          {error !== undefined && (
            <p id={`${id}-error`} className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
