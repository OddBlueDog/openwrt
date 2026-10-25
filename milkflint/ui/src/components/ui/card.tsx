import type { ComponentProps, ReactElement } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: ComponentProps<'section'>): ReactElement {
  return (
    <section
      data-slot="card"
      className={cn('flex flex-col gap-4 rounded-xl border bg-card py-5 text-card-foreground shadow-xs', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>): ReactElement {
  return <div data-slot="card-header" className={cn('flex items-start gap-3 px-5', className)} {...props} />;
}

export function CardTitle({ className, children, ...props }: ComponentProps<'h2'>): ReactElement {
  return (
    <h2 data-slot="card-title" className={cn('text-sm leading-none font-semibold', className)} {...props}>
      {children}
    </h2>
  );
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>): ReactElement {
  return <p data-slot="card-description" className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function CardAction({ className, ...props }: ComponentProps<'div'>): ReactElement {
  return <div data-slot="card-action" className={cn('ml-auto flex items-center gap-2', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>): ReactElement {
  return <div data-slot="card-content" className={cn('px-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>): ReactElement {
  return (
    <div data-slot="card-footer" className={cn('flex items-center gap-2 border-t px-5 pt-4', className)} {...props} />
  );
}
