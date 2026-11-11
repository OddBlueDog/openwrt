import type { ReactElement, ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}): ReactElement {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-6 sm:flex-nowrap sm:items-start">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description !== undefined && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {/* top right beside the title, below it on a phone */}
      {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
