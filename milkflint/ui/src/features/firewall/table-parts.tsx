// What the Firewall page's tables share (rules, port forwards, zones): the
// grouped table frame, its group headers, and the small cells.
import { ArrowRightIcon, type LucideIcon, PowerIcon, RouterIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function RouterPill(): ReactElement {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-1.5 py-px text-xs text-primary">
      <RouterIcon className="size-3" /> router
    </span>
  );
}

/** An icon and a name or address in mono, cut short when long (whole in its tooltip). */
export function Who({ icon: Icon, children, title }: { icon: LucideIcon; children: ReactNode; title?: string | undefined }): ReactElement {
  return (
    <span className="inline-flex max-w-44 items-center gap-1.5 truncate" title={title}>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate font-mono text-xs">{children}</span>
    </span>
  );
}

/** fw4's word for what happens (accept, reject, drop, dnat…), coloured by whether it lets things through. */
export function VerdictBadge({ verdict }: { verdict: string }): ReactElement {
  const v = verdict.toLowerCase();
  return (
    <Badge variant={v === 'accept' ? 'success' : v === 'reject' || v === 'drop' ? 'destructive' : 'secondary'} className="font-mono font-normal">
      {v}
    </Badge>
  );
}

/** "Internet → Router", with the arrow read out as "to". */
export function Path({ from, to }: { from: ReactNode; to: ReactNode }): ReactElement {
  return (
    <>
      <span className="font-medium">{from}</span>
      <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-label="to" />
      <span className="font-medium">{to}</span>
    </>
  );
}

/** A group's header: its title and size on the left, an action on the right; a table row when it has columns to span. */
export function GroupHeader({
  title,
  count,
  noun,
  action,
  colSpan,
}: {
  title: ReactNode;
  /** how many it holds, with its noun singular and plural; left out for a group of one kind */
  count?: number;
  noun?: readonly [string, string];
  action?: ReactNode;
  colSpan?: number;
}): ReactElement {
  const content = (
    <div className="flex min-h-7 items-center justify-between gap-2">
      <span className="flex flex-wrap items-center gap-2 text-sm">
        {title}
        {count !== undefined && noun !== undefined && (
          <span className="text-xs text-muted-foreground">
            · {count} {count === 1 ? noun[0] : noun[1]}
          </span>
        )}
      </span>
      {action}
    </div>
  );
  return colSpan === undefined ? (
    <div className="border-y bg-muted/40 px-4 py-1.5">{content}</div>
  ) : (
    <tr>
      <th scope="colgroup" colSpan={colSpan} className="border-y bg-muted/40 px-3 py-1.5 text-left font-normal">
        {content}
      </th>
    </tr>
  );
}

/** A small action in a group header, like "Add rule". */
export function HeaderButton({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick: () => void }): ReactElement {
  return (
    <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}

/** The table's column headings: small capitals, as in the rest of the page's tables. */
export function HeadRow({ columns }: { columns: readonly { label: string; className?: string; hidden?: boolean }[] }): ReactElement {
  return (
    <tr className="text-left text-[11px] tracking-wide text-muted-foreground uppercase">
      {columns.map((c) => (
        <th key={c.label} scope="col" className={cn('px-3 py-2 font-medium', c.className)}>
          {c.hidden === true ? <span className="sr-only">{c.label}</span> : c.label}
        </th>
      ))}
    </tr>
  );
}

/** On or off, as a power button named after its row. */
export function PowerButton({ on, name, disabled, onToggle }: { on: boolean; name: string; disabled: boolean; onToggle: () => void }): ReactElement {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label={on ? `Turn ${name} off` : `Turn ${name} on`}
      aria-pressed={on}
      title={on ? 'On: click to turn off' : 'Off: click to turn on'}
      disabled={disabled}
      onClick={onToggle}
    >
      <PowerIcon className={on ? 'text-success' : 'text-muted-foreground'} />
    </Button>
  );
}

/** A row's icon action (edit, delete). */
export function RowButton({ label, icon: Icon, disabled, onClick }: { label: string; icon: LucideIcon; disabled?: boolean; onClick: () => void }): ReactElement {
  return (
    <Button variant="ghost" size="icon" className="size-8" aria-label={label} disabled={disabled} onClick={onClick}>
      <Icon />
    </Button>
  );
}
