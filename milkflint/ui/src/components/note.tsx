// A note inside a card: an icon in the state's colour beside plain text, with
// no box of its own, so a card never holds a card. (The kit's Alert is for
// notes that stand on the page by themselves.)
import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/utils';

const tones = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
} as const;

export function Note({
  tone,
  icon,
  title,
  children,
  className,
}: {
  tone: keyof typeof tones;
  /** A lucide icon element; it's drawn at text size in the tone's colour */
  icon: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div className={cn('flex items-start gap-2.5 text-sm', className)}>
      <span className={cn('mt-0.5 shrink-0 [&>svg]:size-4', tones[tone])} aria-hidden>
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        {title !== undefined && <p className="font-medium">{title}</p>}
        {children !== undefined && <div className={title === undefined ? undefined : 'text-muted-foreground'}>{children}</div>}
      </div>
    </div>
  );
}
