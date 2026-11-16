// An editor in a side sheet: a heading, the form scrolling under it, and a
// footer with the status on the left (a Delete button, what's left to fix)
// and the actions on the right. A list's row opens one of these.
import { type ReactElement, type ReactNode, useId } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';

/**
 * An editor in a side sheet: its title and a line under it, the body that
 * scrolls, and a footer that stays in reach with what's left to do on the
 * left and the actions on the right.
 */
export function EditorSheet({
  title,
  description,
  children,
  status,
  actions,
  onClose,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
  /** the footer's left: a Delete button, what's left to fix */
  status?: ReactNode;
  actions: ReactNode;
  onClose: () => void;
}): ReactElement {
  const id = useId();
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent aria-describedby={`${id}-desc`}>
        <div className="border-b px-6 py-4">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription id={`${id}-desc`} className="mt-0.5 pr-6">
            {description}
          </SheetDescription>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t px-6 py-3">
          <div className="flex min-w-0 items-center gap-3">{status}</div>
          <div className="ml-auto flex gap-2">{actions}</div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
