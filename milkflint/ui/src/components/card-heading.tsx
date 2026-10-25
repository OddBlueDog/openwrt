import type { LucideIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** The standard card header: icon tile, title, one-line description, optional action on the right. */
export function CardHeading({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}): ReactElement {
  return (
    <CardHeader className="items-center">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <CardTitle className="text-base">{title}</CardTitle>
        {description !== undefined && <CardDescription>{description}</CardDescription>}
      </div>
      {action !== undefined && <div className="ml-auto flex items-center gap-2">{action}</div>}
    </CardHeader>
  );
}

/** A label/value row in a key-value list. */
export function InfoRow({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right tabular">{children}</span>
    </div>
  );
}
