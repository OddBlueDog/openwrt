import type { ComponentProps, ReactElement } from 'react';
import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: ComponentProps<'div'>): ReactElement {
  return <div data-slot="skeleton" className={cn('rounded-lg bg-muted motion-safe:animate-pulse', className)} {...props} />;
}
