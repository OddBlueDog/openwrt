import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '@/lib/utils';

// A notice: a tinted panel with its icon in the state's colour and its text in
// the page's. It has no live role of its own: a notice that's there when the
// page opens shouldn't be announced as an alert. Pass role="status" (or
// "alert", for an error that interrupts) when it appears in answer to something.
const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-1 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted text-foreground [&>svg]:text-muted-foreground',
        info: 'border-info/25 bg-info-subtle text-foreground [&>svg]:text-info',
        warning: 'border-warning/30 bg-warning-subtle text-foreground [&>svg]:text-warning',
        destructive: 'border-destructive/30 bg-destructive-subtle text-foreground [&>svg]:text-destructive',
        success: 'border-success/30 bg-success-subtle text-foreground [&>svg]:text-success',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Alert({
  className,
  variant,
  ...props
}: ComponentProps<'div'> & VariantProps<typeof alertVariants>): ReactElement {
  return <div data-slot="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: ComponentProps<'div'>): ReactElement {
  return <div data-slot="alert-title" className={cn('col-start-2 font-semibold', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<'div'>): ReactElement {
  return (
    <div
      data-slot="alert-description"
      className={cn('col-start-2 grid justify-items-start gap-1 text-sm text-foreground', className)}
      {...props}
    />
  );
}
