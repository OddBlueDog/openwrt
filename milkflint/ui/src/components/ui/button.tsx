import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '@/lib/utils';

// Disabled buttons turn grey rather than fading, so "unavailable" never reads
// as "loading" (a fading primary button looked like one). Focus is the global
// outline (styles.css), the same on every control.
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow] duration-fast ease-standard disabled:pointer-events-none disabled:border-transparent disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover',
        destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
        outline: 'border border-rule bg-card text-foreground shadow-xs hover:border-input hover:bg-accent',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent',
        ghost: 'text-foreground hover:bg-accent disabled:bg-transparent',
        link: 'h-auto px-0 link underline-offset-4 disabled:bg-transparent',
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 gap-1.5 px-3',
        lg: 'h-10 px-5',
        icon: 'size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }): ReactElement {
  const Comp = asChild ? Slot : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
