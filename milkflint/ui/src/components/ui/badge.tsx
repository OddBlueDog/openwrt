import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactElement } from 'react';
import { StateMark } from '@/components/ui/state-mark';
import { useStateSymbols } from '@/lib/presentation';
import { cn } from '@/lib/utils';

// Status badges carry a dot as well as their colour and their word, so the
// state reads in forced colours and without colour vision too.
const badgeVariants = cva(
  'inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1.5 rounded-full border border-transparent px-2.5 text-xs font-medium whitespace-nowrap forced-colors:border-current [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-primary-subtle text-primary-subtle-foreground',
        secondary: 'bg-muted text-foreground',
        outline: 'border-border text-foreground',
        success: 'bg-success-subtle text-success before:size-1.5 before:rounded-full before:bg-current',
        warning: 'bg-warning-subtle text-warning before:size-1.5 before:rounded-full before:bg-current',
        destructive: 'bg-destructive-subtle text-destructive before:size-1.5 before:rounded-full before:bg-current',
        info: 'bg-info-subtle text-info before:size-1.5 before:rounded-full before:bg-current',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Badge({
  className,
  variant,
  children,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>): ReactElement {
  // in a theme whose states share a colour, trouble carries a "!" in place of the dot
  const mark = useStateSymbols() && (variant === 'warning' || variant === 'destructive');
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), mark && 'before:hidden', className)} {...props}>
      {mark && <StateMark />}
      {children}
    </span>
  );
}
