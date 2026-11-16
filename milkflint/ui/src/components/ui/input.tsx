import type { ComponentProps, ReactElement } from 'react';
import { cn } from '@/lib/utils';

/** The look every text field shares (search-select and others reuse it). */
export const inputClass =
  'flex h-9 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm shadow-xs transition-[border-color,box-shadow] duration-fast ease-standard placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:border-dashed disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive';

export function Input({ className, type, ...props }: ComponentProps<'input'>): ReactElement {
  return <input type={type} data-slot="input" className={cn(inputClass, className)} {...props} />;
}
