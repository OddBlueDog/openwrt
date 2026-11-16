import * as SwitchPrimitive from '@radix-ui/react-switch';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '@/lib/utils';

// On is a filled track with the thumb at the end; off an outlined one. A
// switch that can't be changed has a dashed outline and a faded thumb, so it
// never looks like an ordinary "off". 40 × 24 px, a comfortable target.
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>): ReactElement {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer group inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-fast ease-standard',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=unchecked]:border-input data-[state=unchecked]:bg-muted',
        'disabled:cursor-not-allowed disabled:border-dashed disabled:data-[state=checked]:border-input disabled:data-[state=checked]:bg-muted',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block size-4.5 rounded-full shadow-sm transition-transform duration-fast ease-standard forced-colors:border',
          'data-[state=checked]:translate-x-[calc(var(--spacing)*5-2px)] data-[state=checked]:bg-primary-foreground data-[state=unchecked]:translate-x-0.5 data-[state=unchecked]:bg-card',
          'group-disabled:opacity-60',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
