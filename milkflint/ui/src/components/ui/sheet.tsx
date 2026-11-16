// A panel that slides over the page from the right (full width on a phone),
// for editors with more to them than a dialog holds. The same Radix dialog
// underneath: focus stays inside, Escape and the overlay close it.
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '@/lib/utils';

export const Sheet = DialogPrimitive.Root;

export function SheetContent({ className, children, ...props }: ComponentProps<typeof DialogPrimitive.Content>): ReactElement {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=open]:animate-[mf-fade-in_var(--mf-duration-base)_var(--mf-ease-standard)]" />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-popover text-popover-foreground shadow-lg data-[state=open]:animate-[mf-sheet-in_var(--mf-duration-slow)_var(--mf-ease-enter)] sm:max-w-xl',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute top-3.5 right-3.5 flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast hover:bg-accent hover:text-foreground">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>): ReactElement {
  return <DialogPrimitive.Title className={cn('pr-8 text-base font-semibold', className)} {...props} />;
}

export function SheetDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>): ReactElement {
  return <DialogPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
