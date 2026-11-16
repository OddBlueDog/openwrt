import * as SelectPrimitive from '@radix-ui/react-select';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '@/lib/utils';

export const Select = SelectPrimitive.Root;
/** The chosen item's text, marked for SelectTrigger's styles (Radix's Value ignores className). */
export function SelectValue(props: ComponentProps<typeof SelectPrimitive.Value>): ReactElement {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}
export const SelectGroup = SelectPrimitive.Group;

export function SelectTrigger({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Trigger>): ReactElement {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        'flex h-9 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-sm whitespace-nowrap shadow-xs transition-[border-color,box-shadow] duration-fast ease-standard data-[placeholder]:text-muted-foreground',
        'focus-visible:border-ring disabled:cursor-not-allowed disabled:border-dashed disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive',
        // a long value ends in … rather than widening the trigger (open the list for all of it)
        '*:data-[slot=select-value]:block *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:truncate [&_svg]:pointer-events-none [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>): ReactElement {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          'relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-lg border bg-popover text-popover-foreground shadow-lg data-[state=open]:animate-[mf-pop-in_var(--mf-duration-base)_var(--mf-ease-enter)]',
          position === 'popper' && 'w-full min-w-(--radix-select-trigger-width) translate-y-1',
          className,
        )}
        position={position}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Item>): ReactElement {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex w-full cursor-pointer items-center gap-2 rounded-md py-2 pr-8 pl-2.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:text-muted-foreground data-[state=checked]:font-medium',
        className,
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4 text-primary" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
