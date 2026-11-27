import type { ComponentProps, ReactElement } from 'react';
import { inputClass } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** A text field of several lines, with the look every text field shares. */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>): ReactElement {
  return <textarea data-slot="textarea" className={cn(inputClass, 'h-auto py-2', className)} {...props} />;
}
